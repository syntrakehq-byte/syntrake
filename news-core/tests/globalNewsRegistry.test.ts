import assert from "node:assert/strict";
import { test } from "node:test";
import { createGlobalNewsRegistry, sourceToJsonFeedConfig, validateGlobalNewsRegistryEntry, type GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const entry = (sourceId: string, checkpointScope = `${sourceId}:global`): GlobalNewsRegistryEntry => ({
  registryVersion: "1.0", sourceId, publisherId: `${sourceId}-publisher`, publisher: "Example Central Bank",
  category: "CENTRAL_BANK", geoScope: ["EU"], sourceType: "JSON_FEED_V1",
  endpoint: `https://feeds.example.org/${sourceId}.json`, allowedArticleHosts: ["feeds.example.org"],
  rightsPolicyId: "metadata-only-v1", updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 500 },
  storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" },
  status: "DISABLED", checkpointScope,
});

test("registry validates versioned source policy and maps only implemented adapters", () => {
  const registry = createGlobalNewsRegistry([entry("ecb-json")]);
  assert.equal(registry.version, "1.0");
  assert.equal(registry.entries.length, 1);
  assert.equal(sourceToJsonFeedConfig(registry.entries[0]).sourceId, "ecb-json");
  assert.throws(() => sourceToJsonFeedConfig({ ...entry("rss"), sourceType: "RSS_2" }), /GLOBAL_NEWS_SOURCE_ADAPTER_NOT_IMPLEMENTED/);
});

test("registry rejects unsafe endpoints, duplicate checkpoints and active unvalidated entries", () => {
  assert.throws(() => validateGlobalNewsRegistryEntry({ ...entry("private"), endpoint: "https://127.0.0.1/feed", allowedArticleHosts: ["127.0.0.1"] }), /GLOBAL_NEWS_REGISTRY_ENTRY_INVALID|GLOBAL_NEWS_REGISTRY_ENDPOINT_INVALID|GLOBAL_NEWS_REGISTRY_HOST_NOT_ALLOWED|GLOBAL_NEWS_SOURCE_INVALID/);
  assert.throws(() => createGlobalNewsRegistry([entry("one"), entry("two", "one:global")]), /GLOBAL_NEWS_REGISTRY_DUPLICATE_CHECKPOINT_SCOPE/);
  assert.throws(() => createGlobalNewsRegistry([{ ...entry("bad"), endpoint: "https://feeds.example.org/a?token=secret" }]), /GLOBAL_NEWS_REGISTRY_ENTRY_INVALID|GLOBAL_NEWS_REGISTRY_ENDPOINT_INVALID|GLOBAL_NEWS_SOURCE_INVALID/);
});

test("source entries are isolated by stable source and checkpoint scope", () => {
  const registry = createGlobalNewsRegistry([entry("bank-a"), entry("bank-b")]);
  assert.notEqual(registry.entries[0].sourceId, registry.entries[1].sourceId);
  assert.notEqual(registry.entries[0].checkpointScope, registry.entries[1].checkpointScope);
  assert.notEqual(registry.entries[0].rightsPolicyId, "");
});
