import { validateGlobalNewsSource, type GlobalNewsSource } from "./globalNewsAdapter";

export const GLOBAL_NEWS_REGISTRY_VERSION = "1.0" as const;

export type GlobalNewsCategory = "CORPORATE" | "CENTRAL_BANK" | "GOVERNMENT" | "REGULATOR" | "EXCHANGE" | "EDITORIAL";
export type GlobalNewsSourceType = "RSS_2" | "ATOM" | "JSON_FEED_V1" | "OFFICIAL_API" | "DOCUMENT";
export type GlobalNewsSourceStatus = "ACTIVE" | "DEGRADED" | "DISABLED" | "UNAVAILABLE";

export type GlobalNewsRegistryEntry = Readonly<{
  registryVersion: typeof GLOBAL_NEWS_REGISTRY_VERSION;
  sourceId: string;
  publisherId: string;
  publisher: string;
  category: GlobalNewsCategory;
  geoScope: readonly string[];
  sourceType: GlobalNewsSourceType;
  endpoint: string;
  allowedArticleHosts: readonly string[];
  rightsPolicyId: string;
  updatePolicy: Readonly<{ minIntervalSeconds: number; maxItemsPerCycle: number }>;
  storagePolicy: Readonly<{ content: "METADATA_ONLY" | "PERMITTED_TEXT"; retentionDays: number; presentation: "PUBLIC" | "RESTRICTED" }>;
  status: GlobalNewsSourceStatus;
  checkpointScope: string;
}>;

export type GlobalNewsRegistry = Readonly<{
  version: typeof GLOBAL_NEWS_REGISTRY_VERSION;
  entries: readonly GlobalNewsRegistryEntry[];
}>;

const idPattern = /^[a-z0-9][a-z0-9._:-]{1,100}$/;
const geoPattern = /^[A-Z]{2,3}$/;
const categories = new Set<GlobalNewsCategory>(["CORPORATE", "CENTRAL_BANK", "GOVERNMENT", "REGULATOR", "EXCHANGE", "EDITORIAL"]);
const sourceTypes = new Set<GlobalNewsSourceType>(["RSS_2", "ATOM", "JSON_FEED_V1", "OFFICIAL_API", "DOCUMENT"]);
const statuses = new Set<GlobalNewsSourceStatus>(["ACTIVE", "DEGRADED", "DISABLED", "UNAVAILABLE"]);

function endpointUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("GLOBAL_NEWS_REGISTRY_ENDPOINT_INVALID"); }
  const host = url.hostname.toLowerCase();
  const privateLiteral = host === "localhost" || host === "localhost.localdomain" ||
    /^(0|10|127|169\.254|192\.0\.2|192\.168|198\.18|198\.19|198\.51\.100|203\.0\.113)\./.test(host) ||
    /^(172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "[::1]" || host === "[::]" || host.endsWith(".local");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search || /\.$/.test(host) || privateLiteral) throw new Error("GLOBAL_NEWS_REGISTRY_ENDPOINT_INVALID");
  return url;
}

export function validateGlobalNewsRegistryEntry(entry: GlobalNewsRegistryEntry): void {
  if (!entry || entry.registryVersion !== GLOBAL_NEWS_REGISTRY_VERSION || !idPattern.test(entry.sourceId) ||
      !idPattern.test(entry.publisherId) || !entry.publisher.trim() || !categories.has(entry.category) ||
      !sourceTypes.has(entry.sourceType) || !statuses.has(entry.status) || !idPattern.test(entry.rightsPolicyId) ||
      !idPattern.test(entry.checkpointScope) || !Array.isArray(entry.geoScope) || entry.geoScope.length === 0 ||
      entry.geoScope.some(scope => !geoPattern.test(scope)) || !Array.isArray(entry.allowedArticleHosts) ||
      entry.allowedArticleHosts.length === 0 || entry.allowedArticleHosts.some(host => host !== host.toLowerCase() || !/^[a-z0-9.-]+$/.test(host) || /\.$/.test(host))) {
    throw new Error("GLOBAL_NEWS_REGISTRY_ENTRY_INVALID");
  }
  const endpoint = endpointUrl(entry.endpoint);
  if (entry.allowedArticleHosts.includes(endpoint.hostname) === false) throw new Error("GLOBAL_NEWS_REGISTRY_HOST_NOT_ALLOWED");
  if (!Number.isInteger(entry.updatePolicy?.minIntervalSeconds) || entry.updatePolicy.minIntervalSeconds < 15 ||
      !Number.isInteger(entry.updatePolicy?.maxItemsPerCycle) || entry.updatePolicy.maxItemsPerCycle < 1 || entry.updatePolicy.maxItemsPerCycle > 5000 ||
      !Number.isInteger(entry.storagePolicy?.retentionDays) || entry.storagePolicy.retentionDays < 1) throw new Error("GLOBAL_NEWS_REGISTRY_POLICY_INVALID");
  if (entry.sourceType === "JSON_FEED_V1") {
    const source: GlobalNewsSource = { sourceId: entry.sourceId, publisher: entry.publisher, feedUrl: entry.endpoint, allowedArticleHosts: entry.allowedArticleHosts, format: "JSON_FEED_V1", rightsPolicyId: entry.rightsPolicyId };
    validateGlobalNewsSource(source);
  }
}

export function createGlobalNewsRegistry(entries: readonly GlobalNewsRegistryEntry[]): GlobalNewsRegistry {
  if (!Array.isArray(entries) || entries.length > 100) throw new Error("GLOBAL_NEWS_REGISTRY_INVALID");
  const sourceIds = new Set<string>();
  const checkpointScopes = new Set<string>();
  for (const entry of entries) {
    validateGlobalNewsRegistryEntry(entry);
    if (sourceIds.has(entry.sourceId)) throw new Error("GLOBAL_NEWS_REGISTRY_DUPLICATE_SOURCE");
    if (checkpointScopes.has(entry.checkpointScope)) throw new Error("GLOBAL_NEWS_REGISTRY_DUPLICATE_CHECKPOINT_SCOPE");
    sourceIds.add(entry.sourceId);
    checkpointScopes.add(entry.checkpointScope);
  }
  return Object.freeze({ version: GLOBAL_NEWS_REGISTRY_VERSION, entries: Object.freeze([...entries]) });
}

export function sourceToJsonFeedConfig(entry: GlobalNewsRegistryEntry): GlobalNewsSource {
  validateGlobalNewsRegistryEntry(entry);
  if (entry.sourceType !== "JSON_FEED_V1") throw new Error("GLOBAL_NEWS_SOURCE_ADAPTER_NOT_IMPLEMENTED");
  return { sourceId: entry.sourceId, publisher: entry.publisher, feedUrl: entry.endpoint, allowedArticleHosts: entry.allowedArticleHosts, format: "JSON_FEED_V1", rightsPolicyId: entry.rightsPolicyId };
}
