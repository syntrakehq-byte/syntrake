import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { registerGlobalTarget, runNewsExecutorOnce } from "./autonomousExecutor";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 } from "./globalNewsOfficialSources";
import type { GlobalNewsRegistryEntry } from "./globalNewsRegistry";
import { NewsFactualPipelineV1 } from "./factualPipeline";
import { PostgresNewsStore } from "./postgresStore";

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

function roleUrl(connectionString: string, role: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c role=${role}`);
  return url.toString();
}

/** Server-only entry point. Reuses the global executor and N1/N2 persistence,
 * then drains a bounded N2 -> N3-A -> N3-B -> N3-C -> N5 backlog. Headlines
 * without permitted text remain conservatively refused. */
export async function refreshPersistedSiteNews(userId: string): Promise<ManualNewsRefreshResult> {
  const unavailable: ManualNewsRefreshResult = { status: "UNAVAILABLE", sources: [] };
  if (!manualNewsRefreshAllowed(userId)) return unavailable;
  const connectionString = process.env.NEWS_MANUAL_WRITER_DATABASE_URL ?? "";
  const ca = process.env.NEWS_MANUAL_WRITER_CA_PEM ?? "";
  const secUserAgent = process.env.SEC_USER_AGENT ?? "";
  const verifierUrl = process.env.NEWS_MANUAL_VERIFIER_DATABASE_URL ?? "";
  const attestorUrl = process.env.NEWS_MANUAL_ATTESTOR_DATABASE_URL ?? "";
  const factualWriterUrl = process.env.NEWS_MANUAL_FACTUAL_WRITER_DATABASE_URL ?? "";
  if (!connectionString || !verifierUrl || !attestorUrl || !factualWriterUrl || !ca.includes("BEGIN CERTIFICATE") || !ca.includes("END CERTIFICATE") || !secUserAgent) return unavailable;
  let url: URL;
  try { url = new URL(connectionString); } catch { return unavailable; }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      url.port === "6543" || [...url.searchParams.keys()].some(key => ["options", "sslmode", "sslcert", "sslkey", "sslrootcert"].includes(key.toLowerCase()))) return unavailable;
  url.searchParams.set("options", "-c role=news_service");
  const pool = new Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: 4000, idleTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: "syntrake-news-manual-writer" });
  const poolOptions = (raw: string, role: string, applicationName: string): Pool => new Pool({
    connectionString: roleUrl(raw, role), ssl: { ca, rejectUnauthorized: true }, max: 2,
    connectionTimeoutMillis: 4000, idleTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: applicationName,
  });
  const verifierPool = poolOptions(verifierUrl, "news_pipeline_verifier", "syntrake-news-manual-verifier");
  const attestorPool = poolOptions(attestorUrl, "news_factual_attestor", "syntrake-news-manual-attestor");
  const factualWriterPool = poolOptions(factualWriterUrl, "news_factual_writer", "syntrake-news-manual-factual-writer");
  for (const candidate of [pool, verifierPool, attestorPool, factualWriterPool]) candidate.on("error", () => undefined);
  const store = new PostgresNewsStore(pool);
  const factualPipeline = new NewsFactualPipelineV1({
    news: store, verifierPool, attestorPool, writerPool: factualWriterPool, userAgent: secUserAgent,
    maxDocuments: Math.max(1, Math.min(Number(process.env.NEWS_MANUAL_FACTUAL_DOCUMENT_LIMIT ?? 5), 20)),
  });
  const deadline = AbortSignal.timeout(40_000);
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
    return await runManualSourceBatch(NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1, async source => {
      await registerGlobalTarget(store, source);
      if (deadline.aborted) throw new Error("NEWS_MANUAL_DEADLINE");
      return await runNewsExecutorOnce({ store, workerId, secUserAgent, collectionScopeKey: source.checkpointScope,
        globalSources: [source], factualPipeline, signal: deadline, leaseSeconds: 60, fetchTimeoutMs: 8000 });
    }, deadline);
  } catch {
    return unavailable;
  } finally {
    await factualPipeline.close();
    await store.close();
  }
}
