import { fetchSafeRegisteredNewsFeed } from "./sourceSecurity";
import { parseJsonNewsFeed, type GlobalNewsItem } from "./globalNewsAdapter";
import { createGlobalNewsRegistry, type GlobalNewsRegistryEntry } from "./globalNewsRegistry";

/**
 * GDELT is a world-news discovery index, not a primary publisher.
 * Never fetch the indexed third-party URLs or store third-party article bodies.
 */
export const GDELT_DOC_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
export const GDELT_WORLD_INDEX_V1: GlobalNewsRegistryEntry = createGlobalNewsRegistry([{
  registryVersion: "1.0", sourceId: "gdelt-world-finance", publisherId: "gdelt-project",
  publisher: "GDELT Project (news discovery index)", category: "EDITORIAL", geoScope: ["WW"],
  sourceType: "OFFICIAL_API", endpoint: GDELT_DOC_ENDPOINT,
  allowedArticleHosts: ["api.gdeltproject.org"], rightsPolicyId: "gdelt-index-metadata-v1",
  updatePolicy: { minIntervalSeconds: 300, maxItemsPerCycle: 20 },
  storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" },
  status: "ACTIVE", checkpointScope: "gdelt-world-finance:doc-v1",
}]).entries[0];

export function isGdeltIndex(source: GlobalNewsRegistryEntry): boolean {
  return source.sourceType === "OFFICIAL_API" && source.publisherId === "gdelt-project" &&
    source.endpoint === GDELT_DOC_ENDPOINT &&
    (source.sourceId === "gdelt-world-finance" || source.sourceId.startsWith("gdelt-world-finance-"));
}

export function gdeltFeedUrl(): string {
  const url = new URL(GDELT_DOC_ENDPOINT);
  url.searchParams.set("query", '(economy OR inflation OR "central bank" OR "stock market" OR sanctions OR energy)');
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "jsonfeed");
  url.searchParams.set("timespan", "24h");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("maxrecords", "20");
  return url.toString();
}

/** Retain only third-party HTTPS LINKS as metadata. No article dereferencing. */
export function parseGdeltIndex(source: GlobalNewsRegistryEntry, payload: unknown, retrievedAt: string): readonly GlobalNewsItem[] {
  if (!isGdeltIndex(source)) throw new Error("GLOBAL_NEWS_GDELT_SOURCE_INVALID");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("GLOBAL_NEWS_GDELT_FEED_INVALID");
  const feed = payload as Record<string, unknown>;
  if (!Array.isArray(feed.items) || feed.items.length > 20) throw new Error("GLOBAL_NEWS_GDELT_FEED_INVALID");
  const items = feed.items.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.url !== "string") return false;
    try {
      const link = new URL(item.url);
      return link.protocol === "https:" && !link.port && !link.username && !link.password &&
        !link.hash && link.hostname !== "localhost" && !link.hostname.endsWith(".local") &&
        !link.hostname.includes(":") && !/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(link.hostname);
    } catch { return false; }
  }).map(item => ({ id: item.id, title: item.title, url: item.url, date_published: item.date_published, date_modified: item.date_modified }));
  const hosts = [...new Set(items.map(item => new URL(item.url as string).hostname.toLowerCase()))];
  // A trusted GDELT index may point at many publisher domains. The hosts
  // are used solely for validating returned links: no remote article fetch.
  const parsed = parseJsonNewsFeed({
    sourceId: source.sourceId, publisher: source.publisher, feedUrl: source.endpoint,
    allowedArticleHosts: hosts.length ? hosts : ["example.org"],
    format: "JSON_FEED_V1", rightsPolicyId: source.rightsPolicyId,
  }, { version: feed.version, items }, retrievedAt, 20);
  return Object.freeze(parsed.map(item => Object.freeze({
    ...item, summary: null,
    qualityFlags: Object.freeze([...item.qualityFlags, "THIRD_PARTY_DISCOVERY_INDEX", "PUBLISHER_UNVERIFIED", "RIGHTS_METADATA_ONLY"]),
  })));
}

export async function fetchGdeltIndex(source: GlobalNewsRegistryEntry, signal?: AbortSignal): Promise<readonly GlobalNewsItem[]> {
  if (!isGdeltIndex(source)) throw new Error("GLOBAL_NEWS_GDELT_SOURCE_INVALID");
  const response = await fetchSafeRegisteredNewsFeed(gdeltFeedUrl(), "api.gdeltproject.org", {
    headers: { Accept: "application/feed+json, application/json", "User-Agent": process.env.SEC_USER_AGENT ?? "SYNTRAKE World News Index/1.0" },
    signal,
  });
  if (!response.ok) throw new Error("GLOBAL_NEWS_GDELT_HTTP_" + response.status);
  let feed: unknown;
  try { feed = JSON.parse(await response.text()); }
  catch { throw new Error("GLOBAL_NEWS_GDELT_FEED_INVALID"); }
  return parseGdeltIndex(source, feed, new Date().toISOString());
}
