import assert from "node:assert/strict";
import { test } from "node:test";
import { collectRegisteredGlobalNewsSources } from "../globalNewsCollector";
import type { GlobalNewsItem } from "../globalNewsAdapter";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const source = (id: string): GlobalNewsRegistryEntry => ({
  registryVersion: "1.0", sourceId: id, publisherId: `${id}-publisher`, publisher: id, category: "CORPORATE", geoScope: ["US"], sourceType: "RSS_2", endpoint: `https://feeds.example.org/${id}.xml`, allowedArticleHosts: ["feeds.example.org"], rightsPolicyId: "metadata-only-v1", updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 50 }, storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${id}-global`,
});
const item = (sourceId: string): GlobalNewsItem => ({ sourceId, providerKey: "rss", externalId: `${sourceId}-1`, publicationId: `${sourceId}-publication`, originalUrl: `https://feeds.example.org/${sourceId}/1`, title: "Update", summary: null, publishedAt: null, updatedAt: null, retrievedAt: "2026-11-16T10:00:00.000Z", publisher: sourceId, rightsPolicyId: "metadata-only-v1", contentFingerprint: `${sourceId}-fingerprint`, qualityFlags: ["SOURCE_PUBLICATION_DATE_UNKNOWN"] });

test("empty feeds are successful observations and do not block another source", async () => {
  const persisted: string[] = [];
  const cycles = await collectRegisteredGlobalNewsSources({ sources: [source("empty"), source("healthy"), source("failed")], retrieve: async entry => entry.sourceId === "empty" ? [] : entry.sourceId === "failed" ? Promise.reject(new Error("remote body must not leak")) : [item(entry.sourceId)], sink: { async persistBatch(entry) { persisted.push(entry.sourceId); } } });
  assert.deepEqual(cycles.map(cycle => cycle.status), ["EMPTY", "INGESTED", "ERROR"]);
  assert.deepEqual(persisted, ["healthy"]);
  assert.equal(cycles[2].errorCode, "GLOBAL_NEWS_SOURCE_FAILED");
});
