import { Pool } from "pg";
import { fetchSecFilings, secCollectionScopeKey } from "./secAdapter";
import { PostgresNewsStore, type ClaimedTarget, type ExecutionLease } from "./postgresStore";

export type NewsExecutorOptions = Readonly<{
  store: PostgresNewsStore; workerId: string; secUserAgent: string; leaseSeconds?: number;
  collectionScopeKey?: string; heartbeatIntervalMs?: number; fetchTimeoutMs?: number; fetchImpl?: typeof fetch; now?: Date; signal?: AbortSignal;
}>;

async function runTarget(store: PostgresNewsStore, target: ClaimedTarget, options: NewsExecutorOptions, signal: AbortSignal, lease: ExecutionLease): Promise<number> {
  if (target.providerKey !== "sec") throw new Error("UNSUPPORTED_NEWS_PROVIDER");
  const checkpoint = await store.getCheckpoint(target.collectionScopeKey);
  const result = await fetchSecFilings({ cik: target.entityKey, userAgent: options.secUserAgent, cursor: checkpoint?.cursor, fetchImpl: options.fetchImpl, now: options.now, signal });
  if (signal.aborted) throw new Error("NEWS_EXECUTION_CANCELLED");
  const observedAt = (options.now ?? new Date()).toISOString();
  const committed = await store.ingest({
    publications: result.publications, observations: result.observations,
    checkpoint: { sourceId: "sec-edgar", collectionScopeKey: target.collectionScopeKey, cursor: result.nextCursor, updatedAt: observedAt },
  }, { lease });
  return committed.insertedPublications;
}

export async function runNewsExecutorOnce(options: NewsExecutorOptions): Promise<{ claimed: boolean; ingested: number }> {
  const target = await options.store.claimNext(options.workerId, options.leaseSeconds ?? 60, options.collectionScopeKey);
  if (!target) return { claimed: false, ingested: 0 };
  const lease: ExecutionLease = { executionId: target.executionId, collectionScopeKey: target.collectionScopeKey, workerId: options.workerId, leaseSeconds: options.leaseSeconds ?? 60 };
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  let leaseLost = false;
  const heartbeatMs = Math.max(50, Math.min(options.heartbeatIntervalMs ?? Math.floor(lease.leaseSeconds * 1000 / 3), Math.max(50, lease.leaseSeconds * 1000 - 50)));
  const heartbeat = setInterval(() => {
    options.store.heartbeat(lease).then(alive => {
      if (!alive) { leaseLost = true; controller.abort(); }
    }).catch(() => { leaseLost = true; controller.abort(); });
  }, heartbeatMs);
  const timeout = setTimeout(() => controller.abort(), options.fetchTimeoutMs ?? Math.max(1000, lease.leaseSeconds * 1000 * 10));
  try {
    const ingested = await runTarget(options.store, target, options, controller.signal, lease);
    clearTimeout(timeout); clearInterval(heartbeat); options.signal?.removeEventListener("abort", forwardAbort);
    if (leaseLost || controller.signal.aborted) throw new Error("NEWS_LEASE_LOST");
    const result = await options.store.finish(lease, true);
    if (result.status === "STALE") throw new Error("NEWS_LEASE_LOST");
    return { claimed: true, ingested };
  } catch (error) {
    clearTimeout(timeout); clearInterval(heartbeat); options.signal?.removeEventListener("abort", forwardAbort);
    const result = await options.store.finish(lease, false, error);
    if (result.status === "STALE" || leaseLost) throw new Error("NEWS_LEASE_LOST");
    throw error;
  }
}

function waitForNextPoll(intervalMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runNewsExecutorForever(options: NewsExecutorOptions & { intervalMs?: number }): Promise<void> {
  const intervalMs = options.intervalMs ?? 30_000;
  while (!options.signal?.aborted) {
    try { await runNewsExecutorOnce(options); }
    catch (error) { console.error(error instanceof Error ? error.message : "NEWS_EXECUTOR_FAILED"); }
    if (options.signal?.aborted) break;
    await waitForNextPoll(intervalMs, options.signal);
  }
}

export async function registerSecTarget(store: PostgresNewsStore, cik: string): Promise<string> {
  const scope = secCollectionScopeKey(cik);
  await store.ensureSource("sec-edgar", "sec");
  await store.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: cik, parameters: { forms: ["10-K", "10-Q", "8-K", "20-F", "6-K"], overlapDays: 7 } });
  return scope;
}

if (process.argv[1]?.endsWith("news-postgres-worker.ts")) {
  const url = process.env.NEWS_DATABASE_URL; const userAgent = process.env.SEC_USER_AGENT;
  if (!url || !userAgent) throw new Error("NEWS_DATABASE_URL and SEC_USER_AGENT are required");
  const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, application_name: "syntrake-news-worker" });
  const store = new PostgresNewsStore(pool); const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort()); process.once("SIGINT", () => abort.abort());
  registerSecTarget(store, process.env.SEC_CIK ?? "0000320193")
    .then(() => runNewsExecutorForever({ store, workerId: process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`, secUserAgent: userAgent, leaseSeconds: Number(process.env.NEWS_LEASE_SECONDS ?? 60), intervalMs: Number(process.env.NEWS_POLL_INTERVAL_MS ?? 30000), signal: abort.signal }))
    .catch(error => { console.error(error instanceof Error ? error.message : "NEWS_WORKER_FAILED"); process.exitCode = 1; })
    .finally(() => store.close());
}
