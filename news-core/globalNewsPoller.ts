import { parseJsonNewsFeed, validateGlobalNewsSource, type GlobalNewsItem, type GlobalNewsSource } from "./globalNewsAdapter";
import { fetchSafeRegisteredNewsFeed } from "./sourceSecurity";
import { GlobalNewsObservabilityV1 } from "./globalNewsObservability";

export type NewsSourceCycle = Readonly<{
  sourceId: string;
  status: "INGESTED" | "NOT_MODIFIED" | "ERROR";
  observed: number;
  errorCode: string | null;
}>;

/**
 * Durable ingestion is owned by a supplied store adapter, not the polling layer.
 * The sink MUST be transactional and idempotent per (sourceId, externalId,
 * contentFingerprint). The poller never advances source state itself.
 */
export type GlobalNewsSink = Readonly<{
  persistBatch(source: GlobalNewsSource, items: readonly GlobalNewsItem[]): Promise<void>;
}>;

export type RegisteredFeedFetcher = (source: GlobalNewsSource, signal?: AbortSignal) => Promise<unknown>;

export async function fetchRegisteredJsonFeed(source: GlobalNewsSource, signal?: AbortSignal): Promise<unknown> {
  validateGlobalNewsSource(source);
  const approvedHost = new URL(source.feedUrl).hostname;
  const response = await fetchSafeRegisteredNewsFeed(source.feedUrl, approvedHost, {
    headers: { Accept: "application/feed+json, application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`GLOBAL_NEWS_FETCH_HTTP_${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/feed+json") throw new Error("GLOBAL_NEWS_CONTENT_TYPE_UNSUPPORTED");
  try { return await response.json(); } catch { throw new Error("GLOBAL_NEWS_JSON_INVALID"); }
}

export async function pollRegisteredGlobalNewsSources(options: Readonly<{
  sources: readonly GlobalNewsSource[];
  sink: GlobalNewsSink;
  retrieve?: RegisteredFeedFetcher;
  now?: () => Date;
  signal?: AbortSignal;
  observability?: GlobalNewsObservabilityV1;
}>): Promise<readonly NewsSourceCycle[]> {
  const { sources, sink, signal } = options;
  if (!Array.isArray(sources) || sources.length > 100 || !sink || typeof sink.persistBatch !== "function") throw new Error("GLOBAL_NEWS_POLL_CONFIG_INVALID");
  const unique = new Set<string>();
  for (const source of sources) {
    validateGlobalNewsSource(source);
    if (unique.has(source.sourceId)) throw new Error("GLOBAL_NEWS_SOURCE_DUPLICATE");
    unique.add(source.sourceId);
  }
  const cycles: NewsSourceCycle[] = [];
  for (const source of sources) {
    if (signal?.aborted) break;
    const startedAt = Date.now();
    try {
      const feed = await (options.retrieve ?? fetchRegisteredJsonFeed)(source, signal);
      if (signal?.aborted) break;
      const now = (options.now ?? (() => new Date()))();
      if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error("GLOBAL_NEWS_CLOCK_INVALID");
      const items = parseJsonNewsFeed(source, feed, now.toISOString());
      if (signal?.aborted) break;
      // If persistence rejects the batch, it is an error. No cursor is advanced.
      await sink.persistBatch(source, items);
      const cycle = { sourceId: source.sourceId, status: items.length === 0 ? "NOT_MODIFIED" as const : "INGESTED" as const, observed: items.length, errorCode: null };
      cycles.push(cycle); options.observability?.recordCycle(source.sourceId, cycle, startedAt, Date.now());
    } catch (error) {
      // Avoid embedding arbitrary remote errors or body text in operator telemetry.
      const message = error instanceof Error ? error.message : "";
      const safe = /^GLOBAL_NEWS_[A-Z0-9_]+$/.test(message) ? message : "GLOBAL_NEWS_SOURCE_FAILED";
      const cycle = { sourceId: source.sourceId, status: "ERROR" as const, observed: 0, errorCode: safe };
      cycles.push(cycle); options.observability?.recordCycle(source.sourceId, cycle, startedAt, Date.now());
    }
  }
  return cycles;
}
