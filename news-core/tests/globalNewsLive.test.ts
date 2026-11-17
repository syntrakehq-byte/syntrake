import assert from "node:assert/strict";
import { test } from "node:test";
import { collectRegisteredGlobalNewsSources } from "../globalNewsCollector";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";
import { fetchAndParseRegisteredSource } from "../globalNewsCollector";

const source = (sourceId: string, publisher: string, endpoint: string): GlobalNewsRegistryEntry => ({
  registryVersion: "1.0", sourceId, publisherId: sourceId, publisher, category: sourceId === "sec" ? "REGULATOR" : "CENTRAL_BANK", geoScope: [sourceId === "ecb" ? "EU" : "US"], sourceType: "RSS_2", endpoint, allowedArticleHosts: [new URL(endpoint).hostname], rightsPolicyId: "official-metadata-v1", updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 50 }, storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${sourceId}:press`,
});

test("live official RSS sources return real normalized publications", { skip: !process.env.RUN_GLOBAL_NEWS_LIVE && "RUN_GLOBAL_NEWS_LIVE=1 required for external-source rehearsal" }, async () => {
  const sources = [
    source("ecb", "European Central Bank", "https://www.ecb.europa.eu/rss/press.html"),
    // The Board's RSS index currently exposes the Data Download announcements
    // feed as the stable public XML endpoint; the historical press_all.xml
    // endpoint returns 404 in the CI runner.
    source("fed", "Federal Reserve Board", "https://www.federalreserve.gov/feeds/datadownload.html"),
    source("sec", "U.S. Securities and Exchange Commission", "https://www.sec.gov/rss/news/press.xml"),
  ];
  const persisted: Array<{ sourceId: string; count: number; firstId: string }> = [];
  const retrieve = async (entry: GlobalNewsRegistryEntry, signal?: AbortSignal) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try { return await fetchAndParseRegisteredSource(entry, signal); }
      catch (error) { lastError = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750)); }
    }
    throw lastError;
  };
  const cycles = await collectRegisteredGlobalNewsSources({ sources, retrieve, sink: { async persistBatch(sourceEntry, items) { persisted.push({ sourceId: sourceEntry.sourceId, count: items.length, firstId: items[0].publicationId }); } } });
  assert.equal(cycles.length, 3);
  assert.ok(cycles.every(cycle => cycle.status === "INGESTED" && cycle.observed > 0), JSON.stringify(cycles));
  assert.equal(new Set(persisted.map(row => row.sourceId)).size, 3);
  assert.ok(persisted.every(row => row.firstId.length === 32));
});
