import { fetchGdeltIndex, isGdeltIndex } from "./globalNewsAggregator";
import { parseJsonNewsFeed } from "./globalNewsAdapter";
import { fetchSafeRegisteredNewsFeed } from "./sourceSecurity";
import { parseAtomNewsFeed, parseRssNewsFeed } from "./globalNewsXml";
import type { GlobalNewsItem } from "./globalNewsAdapter";
import type { GlobalNewsRegistryEntry } from "./globalNewsRegistry";

export type OfficialNewsApiAdapter = Readonly<{
  apiId: string;
  supports(source: GlobalNewsRegistryEntry): boolean;
  fetch(source: GlobalNewsRegistryEntry, signal?: AbortSignal): Promise<readonly GlobalNewsItem[]>;
}>;

export type GlobalNewsCollectionCycle = Readonly<{ sourceId: string; status: "INGESTED" | "EMPTY" | "ERROR"; observed: number; errorCode: string | null }>;
export type GlobalNewsCollectionSink = Readonly<{ persistBatch(source: GlobalNewsRegistryEntry, items: readonly GlobalNewsItem[]): Promise<void> }>;

export async function fetchAndParseRegisteredSource(source: GlobalNewsRegistryEntry, signal?: AbortSignal): Promise<readonly GlobalNewsItem[]> {
  if (isGdeltIndex(source)) return fetchGdeltIndex(source, signal);
  const response = await fetchSafeRegisteredNewsFeed(source.endpoint, new URL(source.endpoint).hostname, { headers: { Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, text/html;q=0.9", "User-Agent": process.env.SEC_USER_AGENT ?? "SYNTRAKE Global News/1.0" }, signal });
  if (!response.ok) throw new Error(`GLOBAL_NEWS_FETCH_HTTP_${response.status}`);
  const retrievedAt = new Date().toISOString();
  const body = await response.text();
  if (source.sourceType === "RSS_2") return parseRssNewsFeed(source, body, retrievedAt, source.updatePolicy.maxItemsPerCycle);
  if (source.sourceType === "ATOM") return parseAtomNewsFeed(source, body, retrievedAt, source.updatePolicy.maxItemsPerCycle);
  if (source.sourceType === "JSON_FEED_V1") return parseJsonNewsFeed({ sourceId: source.sourceId, publisher: source.publisher, feedUrl: source.endpoint, allowedArticleHosts: source.allowedArticleHosts, format: "JSON_FEED_V1", rightsPolicyId: source.rightsPolicyId }, JSON.parse(body), retrievedAt, source.updatePolicy.maxItemsPerCycle);
  throw new Error("GLOBAL_NEWS_SOURCE_ADAPTER_NOT_IMPLEMENTED");
}

export async function collectRegisteredGlobalNewsSources(options: Readonly<{ sources: readonly GlobalNewsRegistryEntry[]; sink: GlobalNewsCollectionSink; retrieve?: (source: GlobalNewsRegistryEntry, signal?: AbortSignal) => Promise<readonly GlobalNewsItem[]>; signal?: AbortSignal }>): Promise<readonly GlobalNewsCollectionCycle[]> {
  const cycles: GlobalNewsCollectionCycle[] = [];
  for (const source of options.sources) {
    if (options.signal?.aborted) break;
    try {
      const items = await (options.retrieve ?? fetchAndParseRegisteredSource)(source, options.signal);
      if (options.signal?.aborted) break;
      if (items.length === 0) { cycles.push({ sourceId: source.sourceId, status: "EMPTY", observed: 0, errorCode: null }); continue; }
      await options.sink.persistBatch(source, items);
      cycles.push({ sourceId: source.sourceId, status: "INGESTED", observed: items.length, errorCode: null });
    } catch (error) {
      const code = error instanceof Error && /^GLOBAL_NEWS_[A-Z0-9_]+$/.test(error.message) ? error.message : "GLOBAL_NEWS_SOURCE_FAILED";
      cycles.push({ sourceId: source.sourceId, status: "ERROR", observed: 0, errorCode: code });
    }
  }
  return cycles;
}
