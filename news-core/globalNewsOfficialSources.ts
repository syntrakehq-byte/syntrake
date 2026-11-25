import { GDELT_WORLD_INDEX_V1 } from "./globalNewsAggregator";
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

/**
 * Opt-in worker profile. The seven feeds have independently passed a live
 * source test (three in N-G8, four in the official-source expansion gate).
 * This declaration alone does not deploy, schedule or enable collection.
 */
export const NEWS_OFFICIAL_EXPANDED_PROFILE_V1 = createGlobalNewsRegistry([
  officialRss("eu-ecb-press", "European Central Bank", "CENTRAL_BANK", "EU", "https://www.ecb.europa.eu/rss/press.html"),
  officialRss("uk-boe-news", "Bank of England", "CENTRAL_BANK", "UK", "https://www.bankofengland.co.uk/rss/news"),
  officialRss("us-sec-press", "U.S. Securities and Exchange Commission", "REGULATOR", "US", "https://www.sec.gov/rss/news/press.xml"),
  ...NEWS_EXPANSION_OFFICIAL_CANDIDATES_V1,
]).entries;

/** Explicit index + direct-source profile. GDELT is an unverified discovery index. */
export const NEWS_OFFICIAL_PLUS_WORLD_INDEX_V1 = createGlobalNewsRegistry([
  ...NEWS_OFFICIAL_EXPANDED_PROFILE_V1, GDELT_WORLD_INDEX_V1,
]).entries;

/** Fail-closed runtime profile selection; the default remains unchanged. */
export function resolveGlobalNewsWorkerSources(
  config: Readonly<{ profile?: string; json?: string }>,
): readonly GlobalNewsRegistryEntry[] {
  if (config.profile && config.json) throw new Error("NEWS_GLOBAL_SOURCES_CONFIG_CONFLICT");
  if (config.profile) {
    if (config.profile === "official-expanded-v1") return NEWS_OFFICIAL_EXPANDED_PROFILE_V1;
    if (config.profile === "official-plus-world-index-v1") return NEWS_OFFICIAL_PLUS_WORLD_INDEX_V1;
    throw new Error("NEWS_GLOBAL_SOURCES_PROFILE_INVALID");
  }
  if (!config.json) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(config.json); }
  catch { throw new Error("NEWS_GLOBAL_SOURCES_JSON_INVALID"); }
  if (!Array.isArray(parsed)) throw new Error("NEWS_GLOBAL_SOURCES_JSON_INVALID");
  return createGlobalNewsRegistry(parsed as GlobalNewsRegistryEntry[]).entries;
}
