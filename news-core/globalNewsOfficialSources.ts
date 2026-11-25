import { createGlobalNewsRegistry, type GlobalNewsRegistryEntry } from "./globalNewsRegistry";

/**
 * Public RSS source candidates for the global News Core.
 * The registry stores metadata only; inclusion here does NOT activate a
 * production daemon or grant redistribution rights.
 * Live integration must pass before activation.
 */
function officialRss(
  sourceId: string,
  publisher: string,
  category: GlobalNewsRegistryEntry["category"],
  country: string,
  endpoint: string,
): GlobalNewsRegistryEntry {
  const host = new URL(endpoint).hostname;
  const canonicalHost = host.startsWith("www.") ? host.slice(4) : host;
  return {
    registryVersion: "1.0",
    sourceId,
    publisherId: sourceId,
    publisher,
    category,
    geoScope: [country],
    sourceType: "RSS_2",
    endpoint,
    allowedArticleHosts: [...new Set([host, canonicalHost])],
    rightsPolicyId: "official-metadata-v1",
    updatePolicy: { minIntervalSeconds: 300, maxItemsPerCycle: 100 },
    storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" },
    status: "ACTIVE",
    checkpointScope: sourceId + ":official:v1",
  };
}

export const NEWS_EXPANSION_OFFICIAL_CANDIDATES_V1 = createGlobalNewsRegistry([
  officialRss("ca-boc-press", "Bank of Canada", "CENTRAL_BANK", "CA", "https://www.bankofcanada.ca/content_type/press-releases/feed/"),
  officialRss("au-rba-press", "Reserve Bank of Australia", "CENTRAL_BANK", "AU", "https://www.rba.gov.au/rss/rss-cb-media-releases.xml"),
  officialRss("us-bls-latest", "U.S. Bureau of Labor Statistics", "GOVERNMENT", "US", "https://www.bls.gov/feed/bls_latest.rss"),
  officialRss("us-fed-press", "Federal Reserve Board", "CENTRAL_BANK", "US", "https://www.federalreserve.gov/feeds/press_all.xml"),
]).entries;
