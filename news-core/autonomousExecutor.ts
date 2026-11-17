import { fetchSecFilings, secCollectionScopeKey } from "./secAdapter";
import { PostgresNewsStore, type ClaimedTarget, type ExecutionLease } from "./postgresStore";
import { NewsFactualPipelineV1, type FactualPipelineOutcomeV1 } from "./factualPipeline";
import { fetchAndParseRegisteredSource } from "./globalNewsCollector";
import { globalProviderKey } from "./globalNewsPersistence";
import type { GlobalNewsRegistryEntry } from "./globalNewsRegistry";

export type NewsExecutorOptions = Readonly<{
  store: PostgresNewsStore; workerId: string; secUserAgent: string; leaseSeconds?: number;
  collectionScopeKey?: string; heartbeatIntervalMs?: number; fetchTimeoutMs?: number; fetchImpl?: typeof fetch; now?: Date; signal?: AbortSignal;
  onExecutionError?: (error: unknown) => void;
  factualPipeline?: NewsFactualPipelineV1;
  factualPublicationIds?: readonly string[];
  globalSources?: readonly GlobalNewsRegistryEntry[];
  globalRetrieve?: (source: GlobalNewsRegistryEntry, signal?: AbortSignal) => Promise<readonly import("./globalNewsAdapter").GlobalNewsItem[]>;
}>;

async function runTarget(store: PostgresNewsStore, target: ClaimedTarget, options: NewsExecutorOptions, signal: AbortSignal, lease: ExecutionLease): Promise<{ ingested: number; factualOutcomes: readonly FactualPipelineOutcomeV1[] }> {
  if (target.providerKey !== "sec") {
    const source = options.globalSources?.find(candidate => candidate.sourceId === target.sourceId && globalProviderKey(candidate.sourceType) === target.providerKey);
    if (!source) throw new Error("UNSUPPORTED_NEWS_PROVIDER");
    let items: readonly import("./globalNewsAdapter").GlobalNewsItem[];
    try {
      items = await (options.globalRetrieve ?? fetchAndParseRegisteredSource)(source, signal);
    } catch (error) {
      await store.recordGlobalOperationalState({ sourceId: source.sourceId, collectionScopeKey: target.collectionScopeKey, coverage: "UNKNOWN", health: "ERROR", observed: 0, insertedPublications: 0, lastErrorCode: error instanceof Error && /^GLOBAL_NEWS_[A-Z0-9_]+$/.test(error.message) ? error.message : "GLOBAL_NEWS_SOURCE_FAILED" });
      throw error;
    }
    if (signal.aborted) throw new Error("NEWS_EXECUTION_CANCELLED");
    const committed = await store.ingestGlobalBatch(source, items, {});
    const latestPublishedAt = items.reduce<string | null>((latest, item) => item.publishedAt && (!latest || Date.parse(item.publishedAt) > Date.parse(latest)) ? item.publishedAt : latest, null);
    await store.recordGlobalOperationalState({ sourceId: source.sourceId, collectionScopeKey: target.collectionScopeKey, coverage: "KNOWN", health: items.length ? "HEALTHY" : "EMPTY", observed: items.length, insertedPublications: committed.insertedPublications, lastPublishedAt: latestPublishedAt });
    const factualOutcomes = options.factualPipeline ? await drainFactualBacklog(store, options.factualPipeline, options, signal, lease) : [];
    return { ingested: committed.insertedPublications, factualOutcomes };
  }
  const checkpoint = await store.getCheckpoint(target.collectionScopeKey);
  const result = await fetchSecFilings({ cik: target.entityKey, userAgent: options.secUserAgent, cursor: checkpoint?.cursor, fetchImpl: options.fetchImpl, now: options.now, signal });
  if (signal.aborted) throw new Error("NEWS_EXECUTION_CANCELLED");
  const observedAt = (options.now ?? new Date()).toISOString();
  const committed = await store.ingest({
    publications: result.publications, observations: result.observations,
    checkpoint: { sourceId: "sec-edgar", collectionScopeKey: target.collectionScopeKey, cursor: result.nextCursor, updatedAt: observedAt },
  }, { lease });
  const factualOutcomes = options.factualPipeline
    ? await drainFactualBacklog(store, options.factualPipeline, options, signal, lease)
    : [];
  for (const outcome of factualOutcomes) console.log(JSON.stringify({ pipeline: "SEC>N1>N2>N3A>N3B>N3C>N5", publicationId: outcome.publicationId, status: outcome.status, reason: outcome.reason, factEventId: outcome.factEventId ?? null, confirmationStatus: outcome.confirmationStatus ?? null, documentSha256: outcome.documentSha256 ?? null }));
  return { ingested: committed.insertedPublications, factualOutcomes };
}

async function drainFactualBacklog(store: PostgresNewsStore, pipeline: NewsFactualPipelineV1, options: NewsExecutorOptions, signal: AbortSignal, lease?: ExecutionLease): Promise<readonly FactualPipelineOutcomeV1[]> {
  return await (async () => {
        await store.reconcileFactualBacklog(1000, options.factualPublicationIds);
        const factualLeaseSeconds = Math.max(1, Math.floor(lease?.leaseSeconds ?? options.leaseSeconds ?? 60));
        const claims = await store.claimFactualBacklog(options.factualPipeline!.maxDocuments, options.workerId, factualLeaseSeconds, options.factualPublicationIds);
        if (claims.length === 0) return [];
        const localAbort = new AbortController();
        const combinedSignal = AbortSignal.any([signal, localAbort.signal]);
        let ownershipLost = false;
        const renewal = setInterval(() => {
          for (const claim of claims) void store.renewFactualBacklogClaim(claim.publication.publicationId, options.workerId, claim.claimToken, factualLeaseSeconds).then(alive => {
            if (!alive) { ownershipLost = true; localAbort.abort(); }
          }).catch(() => { ownershipLost = true; localAbort.abort(); });
        }, Math.max(100, Math.floor(factualLeaseSeconds * 1000 / 3)));
        let outcomes: readonly FactualPipelineOutcomeV1[];
        try { outcomes = await options.factualPipeline!.processPublications(claims.map(claim => claim.publication), combinedSignal, () => { if (ownershipLost) throw new Error("NEWS_FACTUAL_LEASE_LOST"); }); }
        catch (error) { outcomes = claims.map(claim => ({ publicationId: claim.publication.publicationId, canonicalClaimId: `sec:${claim.publication.externalId}`, status: "FAILED_RETRYABLE" as const, reason: error instanceof Error ? error.message : "NEWS_FACTUAL_RETRYABLE_FAILURE" })); }
        finally { clearInterval(renewal); }
        for (const [index, outcome] of outcomes.entries()) {
          const claim = claims[index];
          if (!claim) continue;
          if (outcome.status === "FAILED_RETRYABLE") await store.retryFactualBacklog(outcome.publicationId, options.workerId, claim.claimToken, outcome.reason);
          else await store.finishFactualBacklog(outcome.publicationId, options.workerId, claim.claimToken, outcome.status, outcome.reason);
        }
        return outcomes;
      })();
}

export async function runNewsExecutorOnce(options: NewsExecutorOptions): Promise<{ claimed: boolean; ingested: number; factualOutcomes: readonly FactualPipelineOutcomeV1[] }> {
  const preDrain = options.factualPipeline ? await drainFactualBacklog(options.store, options.factualPipeline, options, options.signal ?? new AbortController().signal) : [];
  const target = await options.store.claimNext(options.workerId, options.leaseSeconds ?? 60, options.collectionScopeKey);
  if (!target) return { claimed: false, ingested: 0, factualOutcomes: preDrain };
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
    return { claimed: true, ingested: cycle.ingested, factualOutcomes: [...preDrain, ...cycle.factualOutcomes] };
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

export async function registerGlobalTarget(store: PostgresNewsStore, source: GlobalNewsRegistryEntry): Promise<string> {
  await store.ensureGlobalSource(source);
  await store.upsertTarget({ collectionScopeKey: source.checkpointScope, sourceId: source.sourceId, providerKey: globalProviderKey(source.sourceType), entityKey: source.publisherId, parameters: { endpoint: source.endpoint, sourceType: source.sourceType, rightsPolicyId: source.rightsPolicyId } });
  return source.checkpointScope;
}
