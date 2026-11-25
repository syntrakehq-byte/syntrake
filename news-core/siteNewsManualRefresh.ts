import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { registerGlobalTarget, runNewsExecutorOnce } from "./autonomousExecutor";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 } from "./globalNewsOfficialSources";
import type { GlobalNewsRegistryEntry } from "./globalNewsRegistry";
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
export function manualNewsRefreshAllowed(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
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

/** Server-only entry point. Reuses the global executor and N1/N2 persistence,
 * not a second ingestion system. The ten sources are metadata-only; this
 * does not claim factual classification or investing decision integration. */
export async function refreshPersistedSiteNews(userId: string): Promise<ManualNewsRefreshResult> {
  const unavailable: ManualNewsRefreshResult = { status: "UNAVAILABLE", sources: [] };
  if (!manualNewsRefreshAllowed(userId)) return unavailable;
  const connectionString = process.env.NEWS_MANUAL_WRITER_DATABASE_URL ?? "";
  const ca = process.env.NEWS_MANUAL_WRITER_CA_PEM ?? "";
  const secUserAgent = process.env.SEC_USER_AGENT ?? "";
  if (!connectionString || !ca.includes("BEGIN CERTIFICATE") || !ca.includes("END CERTIFICATE") || !secUserAgent) return unavailable;
  let url: URL;
  try { url = new URL(connectionString); } catch { return unavailable; }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      url.port === "6543" || [...url.searchParams.keys()].some(key => ["options", "sslmode", "sslcert", "sslkey", "sslrootcert"].includes(key.toLowerCase()))) return unavailable;
  url.searchParams.set("options", "-c role=news_service");
  const pool = new Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: 4000, idleTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: "syntrake-news-manual-writer" });
  const store = new PostgresNewsStore(pool);
  const deadline = AbortSignal.timeout(40_000);
  try {
    const identity = await pool.query<ManualWriterIdentity>(
      "select current_user as role_name, session_user as login_name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, " +
      "coalesce((select bool_or(pg_has_role(r.rolname,p.rolname,'MEMBER')) from pg_roles p where p.rolname in " +
      "('news_reader','news_pipeline_verifier','news_factual_attestor','news_factual_writer')),false) as has_other_news_membership " +
      "from pg_roles r where r.rolname=session_user",
    );
    assertManualWriterIdentity(identity.rows[0]);
    const workerId = "site-manual-" + randomUUID();
    return await runManualSourceBatch(NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1, async source => {
      await registerGlobalTarget(store, source);
      if (deadline.aborted) throw new Error("NEWS_MANUAL_DEADLINE");
      return await runNewsExecutorOnce({ store, workerId, secUserAgent, collectionScopeKey: source.checkpointScope,
        globalSources: [source], signal: deadline, leaseSeconds: 60, fetchTimeoutMs: 8000 });
    }, deadline);
  } catch {
    return unavailable;
  } finally {
    await store.close();
  }
}
