import { fetchSecFilings, secCollectionScopeKey } from "./secAdapter";
import { PostgresNewsStore, type ClaimedTarget, type ExecutionLease } from "./postgresStore";
import { NewsFactualPipelineV1, type FactualPipelineOutcomeV1 } from "./factualPipeline";

export type NewsExecutorOptions = Readonly<{
  store: PostgresNewsStore; workerId: string; secUserAgent: string; leaseSeconds?: number;
  collectionScopeKey?: string; heartbeatIntervalMs?: number; fetchTimeoutMs?: number; fetchImpl?: typeof fetch; now?: Date; signal?: AbortSignal;
  onExecutionError?: (error: unknown) => void;
  factualPipeline?: NewsFactualPipelineV1;
}>;

async function runTarget(store: PostgresNewsStore, target: ClaimedTarget, options: NewsExecutorOptions, signal: AbortSignal, lease: ExecutionLease): Promise<{ ingested: number; factualOutcomes: readonly FactualPipelineOutcomeV1[] }> {
  if (target.providerKey !== "sec") throw new Error("UNSUPPORTED_NEWS_PROVIDER");
  const checkpoint = await store.getCheckpoint(target.collectionScopeKey);
  const result = await fetchSecFilings({ cik: target.entityKey, userAgent: options.secUserAgent, cursor: checkpoint?.cursor, fetchImpl: options.fetchImpl, now: options.now, signal });
  if (signal.aborted) throw new Error("NEWS_EXECUTION_CANCELLED");
  const observedAt = (options.now ?? new Date()).toISOString();
  const committed = await store.ingest({
    publications: result.publications, observations: result.observations,
    checkpoint: { sourceId: "sec-edgar", collectionScopeKey: target.collectionScopeKey, cursor: result.nextCursor, updatedAt: observedAt },
  }, { lease });
  const factualOutcomes = options.factualPipeline
    ? await (async () => {
        await store.enqueueFactualBacklog(result.publications);
        const publications = await store.claimFactualBacklog(options.factualPipeline!.maxDocuments);
        const outcomes = await options.factualPipeline!.processPublications(publications, signal);
        for (const outcome of outcomes) {
          if (outcome.status === "FAILED_RETRYABLE") await store.retryFactualBacklog(outcome.publicationId, outcome.reason);
          else await store.finishFactualBacklog(outcome.publicationId, outcome.status, outcome.reason);
        }
        return outcomes;
      })()
    : [];
  for (const outcome of factualOutcomes) console.log(JSON.stringify({ pipeline: "SEC>N1>N2>N3A>N3B>N3C>N5", publicationId: outcome.publicationId, status: outcome.status, reason: outcome.reason, factEventId: outcome.factEventId ?? null, confirmationStatus: outcome.confirmationStatus ?? null, documentSha256: outcome.documentSha256 ?? null }));
  return { ingested: committed.insertedPublications, factualOutcomes };
}

export async function runNewsExecutorOnce(options: NewsExecutorOptions): Promise<{ claimed: boolean; ingested: number; factualOutcomes: readonly FactualPipelineOutcomeV1[] }> {
  const target = await options.store.claimNext(options.workerId, options.leaseSeconds ?? 60, options.collectionScopeKey);
  if (!target) return { claimed: false, ingested: 0, factualOutcomes: [] };
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
    const cycle = await runTarget(options.store, target, options, controller.signal, lease);
    clearTimeout(timeout); clearInterval(heartbeat); options.signal?.removeEventListener("abort", forwardAbort);
    if (leaseLost || controller.signal.aborted) throw new Error("NEWS_LEASE_LOST");
    const result = await options.store.finish(lease, true);
    if (result.status === "STALE") throw new Error("NEWS_LEASE_LOST");
    return { claimed: true, ingested: cycle.ingested, factualOutcomes: cycle.factualOutcomes };
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
    catch (error) { options.onExecutionError?.(error); console.error(error instanceof Error ? error.message : "NEWS_EXECUTOR_FAILED"); }
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
