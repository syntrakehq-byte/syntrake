import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { drainFactualBacklog, registerGlobalTarget, runNewsExecutorOnce } from "./autonomousExecutor";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 } from "./globalNewsOfficialSources";
import type { GlobalNewsRegistryEntry } from "./globalNewsRegistry";
import { NewsFactualPipelineV1 } from "./factualPipeline";
import { PostgresNewsStore } from "./postgresStore";
import { normalizeNewsTlsCaPem, makeNewsDatabasePool, type NewsDatabaseRole } from "./databaseTls";

export type ManualSourceResult = Readonly<{
  sourceId: string;
  status: "COLLECTED" | "NOT_DUE_OR_BUSY" | "ERROR" | "DEADLINE";
  inserted: number;
}>;
export type ManualNewsRefreshResult = Readonly<{
  status: "COMPLETED" | "PARTIAL" | "UNAVAILABLE";
  sources: readonly ManualSourceResult[];
}>;

/** Feature is off by default. Explicit operator allowlist, not every signed-in account. */
export function manualNewsRefreshAllowed(userId: string | null | undefined, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(userId && env.NEWS_SITE_READ_MODE === "N5" &&
    env.NEWS_MANUAL_REFRESH_ENABLED === "1" &&
    (env.NEWS_MANUAL_REFRESH_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(userId));
}

/** Bounded, per-source isolation. The existing durable lease and retry policy
 * controls claims; NOT_DUE_OR_BUSY is not represented as a successful fetch. */
export async function runManualSourceBatch(
  sources: readonly GlobalNewsRegistryEntry[],
  execute: (source: GlobalNewsRegistryEntry) => Promise<{ claimed: boolean; ingested: number }>,
  signal: AbortSignal,
): Promise<ManualNewsRefreshResult> {
  const results: ManualSourceResult[] = [];
  // Three concurrent sources, never an unbounded fan-out.
  for (let index = 0; index < sources.length; index += 3) {
    const batch = await Promise.all(sources.slice(index, index + 3).map(async (source): Promise<ManualSourceResult> => {
      if (signal.aborted) return { sourceId: source.sourceId, status: "DEADLINE", inserted: 0 };
      try {
        const result = await execute(source);
        return { sourceId: source.sourceId, status: result.claimed ? "COLLECTED" : "NOT_DUE_OR_BUSY", inserted: result.ingested };
      } catch {
        return { sourceId: source.sourceId, status: "ERROR", inserted: 0 };
      }
    }));
    results.push(...batch);
  }
  return {
    status: results.some(row => row.status === "ERROR" || row.status === "DEADLINE") ? "PARTIAL" : "COMPLETED",
    sources: results,
  };
}

/** Collection must finish (or reach its own deadline) before factual processing.
 * A factual retry must never turn a completed source collection into an error. */
export async function collectThenProcessFacts<T>(collect: () => Promise<T>, processFacts: () => Promise<void>): Promise<T> {
  const result = await collect();
  try { await processFacts(); }
  catch { console.warn("[NEWS_MANUAL] factual processing deferred"); }
  return result;
}

type ManualWriterIdentity = {
  role_name: string; login_name: string; rolsuper: boolean; rolbypassrls: boolean;
  rolcreaterole: boolean; rolcreatedb: boolean; has_other_news_membership: boolean;
};
export function assertManualWriterIdentity(identity: ManualWriterIdentity | undefined): void {
  if (!identity || identity.role_name !== "news_service" || !identity.login_name ||
      identity.login_name === "news_service" || identity.rolsuper || identity.rolbypassrls ||
      identity.rolcreaterole || identity.rolcreatedb || identity.has_other_news_membership) {
    throw new Error("NEWS_MANUAL_WRITER_ROLE_REQUIRED");
  }
}

async function assertManualFactualIdentity(pool: Pool, expectedRole: "news_pipeline_verifier" | "news_factual_attestor" | "news_factual_writer"): Promise<void> {
  const result = await pool.query<ManualWriterIdentity & { expected_role: string }>(
    "select current_user as role_name, session_user as login_name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, $1::text as expected_role, " +
    "coalesce((select bool_or(pg_has_role(r.rolname,p.rolname,'MEMBER')) from pg_roles p where p.rolname in " +
    "('news_reader','news_service','news_pipeline_verifier','news_factual_attestor','news_factual_writer') and p.rolname <> $1),false) as has_other_news_membership " +
    "from pg_roles r where r.rolname=session_user", [expectedRole],
  );
  const identity = result.rows[0];
  if (!identity || identity.role_name !== expectedRole || !identity.login_name || identity.login_name === expectedRole ||
      identity.rolsuper || identity.rolbypassrls || identity.rolcreaterole || identity.rolcreatedb || identity.has_other_news_membership) {
    throw new Error("NEWS_MANUAL_FACTUAL_ROLE_REQUIRED");
  }
}

/** Server-only entry point. Reuses the global executor and N1/N2 persistence,
 * then drains a bounded N2 -> N3-A -> N3-B -> N3-C -> N5 backlog. Headlines
 * without permitted text remain conservatively refused. */
export async function refreshPersistedSiteNews(userId: string, mode: "SITE" | "PREVIEW_FACTUAL_ACCEPTANCE" = "SITE"): Promise<ManualNewsRefreshResult> {
  const unavailable: ManualNewsRefreshResult = { status: "UNAVAILABLE", sources: [] };
  if (!manualNewsRefreshAllowed(userId)) return unavailable;
  const acceptance = mode === "PREVIEW_FACTUAL_ACCEPTANCE";
  if (acceptance && (process.env.VERCEL_ENV !== "preview" ||
      !/^[a-f0-9]{40}$/.test(process.env.NEWS_PREVIEW_ACCEPTANCE_REFRESH_SHA ?? "") ||
      process.env.NEWS_PREVIEW_ACCEPTANCE_REFRESH_SHA !== process.env.VERCEL_GIT_COMMIT_SHA)) return unavailable;
  const connectionString = process.env.NEWS_MANUAL_WRITER_DATABASE_URL ?? "";
  const ca = normalizeNewsTlsCaPem(process.env.NEWS_MANUAL_WRITER_CA_PEM ?? "");
  const secUserAgent = process.env.SEC_USER_AGENT ?? "";
  const verifierUrl = process.env.NEWS_MANUAL_VERIFIER_DATABASE_URL ?? "";
  const attestorUrl = process.env.NEWS_MANUAL_ATTESTOR_DATABASE_URL ?? "";
  const factualWriterUrl = process.env.NEWS_MANUAL_FACTUAL_WRITER_DATABASE_URL ?? "";
  if (!connectionString || !verifierUrl || !attestorUrl || !factualWriterUrl || !ca.includes("BEGIN CERTIFICATE") || !ca.includes("END CERTIFICATE") || !secUserAgent) return unavailable;
  const pool = makeNewsDatabasePool(connectionString, "news_service", ca, {
    max: 3, connectionTimeoutMillis: 4000, idleTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: "syntrake-news-manual-writer" });
  const poolOptions = (raw: string, role: NewsDatabaseRole, applicationName: string): Pool => makeNewsDatabasePool(raw, role, ca, {
    max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: applicationName,
  });
  const verifierPool = poolOptions(verifierUrl, "news_pipeline_verifier", "syntrake-news-manual-verifier");
  const attestorPool = poolOptions(attestorUrl, "news_factual_attestor", "syntrake-news-manual-attestor");
  const factualWriterPool = poolOptions(factualWriterUrl, "news_factual_writer", "syntrake-news-manual-factual-writer");
  for (const candidate of [pool, verifierPool, attestorPool, factualWriterPool]) candidate.on("error", () => undefined);
  const store = new PostgresNewsStore(pool);
  const factualPipeline = new NewsFactualPipelineV1({
    news: store, verifierPool, attestorPool, writerPool: factualWriterPool, userAgent: secUserAgent,
    maxDocuments: acceptance ? 1 : Math.max(1, Math.min(Number(process.env.NEWS_MANUAL_FACTUAL_DOCUMENT_LIMIT ?? 5), 20)),
  });
  const deadline = AbortSignal.timeout(acceptance ? 150_000 : 48_000);
  try {
    const identity = await pool.query<ManualWriterIdentity>(
      "select current_user as role_name, session_user as login_name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, " +
      "coalesce((select bool_or(pg_has_role(r.rolname,p.rolname,'MEMBER')) from pg_roles p where p.rolname in " +
      "('news_reader','news_pipeline_verifier','news_factual_attestor','news_factual_writer')),false) as has_other_news_membership " +
      "from pg_roles r where r.rolname=session_user",
    );
    assertManualWriterIdentity(identity.rows[0]);
    await Promise.all([
      assertManualFactualIdentity(verifierPool, "news_pipeline_verifier"),
      assertManualFactualIdentity(attestorPool, "news_factual_attestor"),
      assertManualFactualIdentity(factualWriterPool, "news_factual_writer"),
    ]);
    const workerId = "site-manual-" + randomUUID();
    if (acceptance) {
      // Only a bounded, one-off Preview acceptance run. Select actual durable
      // publications, prioritize official rate/macro/regulatory announcements,
      // and use the exact same fenced pipeline as a normal manual refresh.
      await store.reconcileFactualBacklog(1000);
      const selected = await pool.query<{ publication_id: string; source_id: string }>(
        `select p.publication_id,p.source_id
           from news_core.factual_pipeline_backlog b
           join news_core.publications p using(publication_id)
          where b.state='PENDING' and b.next_attempt_at<=clock_timestamp()
            and p.visibility_state='COMMITTED' and p.as_known_at<=clock_timestamp()
          order by (p.source_id in ('us-fed-press','eu-ecb-press','uk-boe-news','us-sec-press','us-bls-latest','ca-boc-press','au-rba-press')) desc,
                   (p.title ~* '(bank rate|policy rate|interest rate|inflation|unemployment|GDP|price index|threshold|charges|earnings)') desc,
                   p.published_at desc nulls last,p.publication_id
          limit 243`);
      const totals = { persisted: 0, refused: 0, retryable: 0 };
      // Keep at most three sources active, never two simultaneous requests
      // to the same publisher, and use distinct fenced worker identities.
      const sourceGroups = [...new Set(selected.rows.map(row => row.source_id))]
        .map(sourceId => selected.rows.filter(row => row.source_id === sourceId));
      let groupIndex = 0;
      await Promise.all(Array.from({ length: Math.min(3, sourceGroups.length) }, async (_, index) => {
        while (!deadline.aborted && groupIndex < sourceGroups.length) {
          const group = sourceGroups[groupIndex++];
          for (const row of group) {
            if (deadline.aborted) break;
            const outcomes = await drainFactualBacklog(store, factualPipeline, {
              store, workerId: workerId + "-" + index, secUserAgent, leaseSeconds: 60, factualPublicationIds: [row.publication_id],
            }, deadline);
            for (const result of outcomes) {
              if (result.status === "PERSISTED") totals.persisted++;
              else if (result.status === "REFUSED") totals.refused++;
              else totals.retryable++;
              const reason = /^[A-Z0-9_]{3,100}$/.test(result.reason) ? result.reason : "NEWS_FACTUAL_RETRYABLE_FAILURE";
              console.log("NEWS_PREVIEW_FACTUAL_RECEIPT", { source: row.source_id, status: result.status, reason });
            }
          }
        }
      }));
      console.log("NEWS_PREVIEW_FACTUAL_TOTALS", totals);
      return { status: totals.persisted ? "COMPLETED" : "PARTIAL", sources: [] };
    }
    const collectionDeadline = AbortSignal.any([deadline, AbortSignal.timeout(36_000)]);
    return await collectThenProcessFacts(
      () => runManualSourceBatch(NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1, async source => {
        await registerGlobalTarget(store, source);
        if (collectionDeadline.aborted) throw new Error("NEWS_MANUAL_DEADLINE");
        return await runNewsExecutorOnce({ store, workerId, secUserAgent, collectionScopeKey: source.checkpointScope,
          globalSources: [source], signal: collectionDeadline, leaseSeconds: 60, fetchTimeoutMs: 30_000 });
      }, collectionDeadline),
      async () => {
        if (deadline.aborted) return;
        const outcomes = await drainFactualBacklog(store, factualPipeline, { store, workerId, secUserAgent, leaseSeconds: 60 }, deadline);
        console.log("[NEWS_MANUAL] factual batch", { persisted: outcomes.filter(x => x.status === "PERSISTED").length,
          refused: outcomes.filter(x => x.status === "REFUSED").length, retryable: outcomes.filter(x => x.status === "FAILED_RETRYABLE").length });
      },
    );
  } catch {
    return unavailable;
  } finally {
    await factualPipeline.close();
    await store.close();
  }
}
