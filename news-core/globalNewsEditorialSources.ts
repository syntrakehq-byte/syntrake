import { createGlobalNewsRegistry, type GlobalNewsRegistryEntry } from "./globalNewsRegistry";

/**
 * Direct daily publisher/newsroom RSS feeds. This is a metadata-only,
 * explicitly selected source catalog, NOT a content syndication licence.
 * Every provider retains its own usage terms and attribution.
 */
function editorialRss(
  sourceId: string, publisher: string, country: string, endpoint: string,
  articleHosts: readonly string[],
): GlobalNewsRegistryEntry {
  const feedHost = new URL(endpoint).hostname;
  return {
    registryVersion: "1.0", sourceId, publisherId: sourceId, publisher,
    category: "EDITORIAL", geoScope: [country],
    sourceType: "RSS_2", endpoint,
    allowedArticleHosts: [...new Set([feedHost, ...articleHosts])],
    rightsPolicyId: "editorial-metadata-review-v1",
    updatePolicy: { minIntervalSeconds: 300, maxItemsPerCycle: 100 },
    storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" },
    status: "ACTIVE", checkpointScope: sourceId + ":rss-v1",
  };
}

export const NEWS_DAILY_EDITORIAL_CANDIDATES_V1 = createGlobalNewsRegistry([
  editorialRss("world-un-news", "United Nations News", "WW",
    "https://news.un.org/feed/subscribe/en/news/all/rss.xml", ["news.un.org"]),
  editorialRss("world-france24", "France 24", "WW",
    "https://www.france24.com/en/rss", ["www.france24.com", "france24.com"]),
  editorialRss("us-cnbc-business", "CNBC Business", "US",
    "https://www.cnbc.com/id/10001147/device/rss/rss.html", ["www.cnbc.com", "cnbc.com"]),
]).entries;
