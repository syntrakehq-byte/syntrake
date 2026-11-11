import { Pool } from "pg";
import { fetchSecFilings, secCollectionScopeKey } from "./secAdapter";
import { PostgresNewsStore, type ClaimedTarget } from "./postgresStore";

export type NewsExecutorOptions = Readonly<{
  store: PostgresNewsStore; workerId: string; secUserAgent: string; leaseSeconds?: number;
  fetchImpl?: typeof fetch; now?: Date;
}>;

async function runTarget(store: PostgresNewsStore, target: ClaimedTarget, options: NewsExecutorOptions): Promise<number> {
  if (target.providerKey !== "sec") throw new Error("UNSUPPORTED_NEWS_PROVIDER");
  const cik = target.entityKey;
  const checkpoint = await store.getCheckpoint(target.collectionScopeKey);
  const result = await fetchSecFilings({ cik, userAgent: options.secUserAgent, cursor: checkpoint?.cursor, fetchImpl: options.fetchImpl, now: options.now });
  const observedAt = (options.now ?? new Date()).toISOString();
  const committed = await store.ingest({
    publications: result.publications,
    observations: result.observations,
    checkpoint: { sourceId: "sec-edgar", collectionScopeKey: target.collectionScopeKey, cursor: result.nextCursor, updatedAt: observedAt },
  });
  return committed.insertedPublications;
}

export async function runNewsExecutorOnce(options: NewsExecutorOptions): Promise<{ claimed: boolean; ingested: number }> {
  const target = await options.store.claimNext(options.workerId, options.leaseSeconds ?? 60);
  if (!target) return { claimed: false, ingested: 0 };
  try {
    const ingested = await runTarget(options.store, target, options);
    await options.store.finish(target.collectionScopeKey, options.workerId, true);
    return { claimed: true, ingested };
  } catch (error) {
    await options.store.finish(target.collectionScopeKey, options.workerId, false, error);
    throw error;
  }
}

export async function runNewsExecutorForever(options: NewsExecutorOptions & { intervalMs?: number; signal?: AbortSignal }): Promise<void> {
  const intervalMs = options.intervalMs ?? 30_000;
  while (!options.signal?.aborted) {
    try { await runNewsExecutorOnce(options); }
    catch (error) { console.error(error instanceof Error ? error.message : "NEWS_EXECUTOR_FAILED"); }
    if (options.signal?.aborted) break;
    await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
  }
}

export async function registerSecTarget(store: PostgresNewsStore, cik: string): Promise<string> {
  const scope = secCollectionScopeKey(cik);
  await store.ensureSource("sec-edgar", "sec");
  await store.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: cik, parameters: { forms: ["10-K", "10-Q", "8-K", "20-F", "6-K"], overlapDays: 7 } });
  return scope;
}

if (process.argv[1]?.endsWith("news-postgres-worker.ts")) {
  const url = process.env.NEWS_DATABASE_URL;
  const userAgent = process.env.SEC_USER_AGENT;
  if (!url || !userAgent) throw new Error("NEWS_DATABASE_URL and SEC_USER_AGENT are required");
  const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, application_name: "syntrake-news-worker" });
  const store = new PostgresNewsStore(pool);
  const cik = process.env.SEC_CIK ?? "0000320193";
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort()); process.once("SIGINT", () => abort.abort());
  registerSecTarget(store, cik).then(() => runNewsExecutorForever({ store, workerId: process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`, secUserAgent: userAgent, intervalMs: Number(process.env.NEWS_POLL_INTERVAL_MS ?? 30000), signal: abort.signal })).catch(error => { console.error(error instanceof Error ? error.message : "NEWS_WORKER_FAILED"); process.exitCode = 1; }).finally(() => store.close());
}
