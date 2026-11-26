import assert from "node:assert/strict";
import test from "node:test";
import {
  NEWS_EXPANSION_OFFICIAL_CANDIDATES_V1,
  NEWS_OFFICIAL_EXPANDED_PROFILE_V1,
  resolveGlobalNewsWorkerSources,
} from "../globalNewsOfficialSources";

test("global official-source worker profile adds 4 verified feeds to the 3 existing official feeds", () => {
  assert.equal(NEWS_EXPANSION_OFFICIAL_CANDIDATES_V1.length, 4);
  const selected = resolveGlobalNewsWorkerSources({ profile: "official-expanded-v1" });
  assert.deepEqual(selected, NEWS_OFFICIAL_EXPANDED_PROFILE_V1);
  assert.equal(selected.length, 7);
  assert.equal(new Set(selected.map(s => s.sourceId)).size, 7);
  assert.equal(new Set(selected.map(s => s.checkpointScope)).size, 7);
  assert.ok(selected.every(s => s.status === "ACTIVE" && s.sourceType === "RSS_2"));
  assert.ok(selected.every(s => s.storagePolicy.content === "PERMITTED_TEXT"));
  assert.ok(selected.every(s => s.allowedArticleHosts.includes(new URL(s.endpoint).hostname)));
  assert.deepEqual(NEWS_EXPANSION_OFFICIAL_CANDIDATES_V1.map(s => s.sourceId), [
    "ca-boc-press", "au-rba-press", "us-bls-latest", "us-fed-press",
  ]);
});

test("source configuration is explicit and rejects mixed, invalid or unknown profiles", () => {
  assert.deepEqual(resolveGlobalNewsWorkerSources({}), []);
  assert.deepEqual(resolveGlobalNewsWorkerSources({ json: "[]" }), []);
  assert.throws(() => resolveGlobalNewsWorkerSources({ profile: "unknown" }), /PROFILE_INVALID/);
  assert.throws(() => resolveGlobalNewsWorkerSources({ profile: "official-expanded-v1", json: "[]" }), /CONFIG_CONFLICT/);
  assert.throws(() => resolveGlobalNewsWorkerSources({ json: "{broken" }), /JSON_INVALID/);
  assert.throws(() => resolveGlobalNewsWorkerSources({ json: "{}" }), /JSON_INVALID/);
  assert.throws(() => resolveGlobalNewsWorkerSources({ json: '[{"sourceId":"unsafe"}]' }), /REGISTRY_ENTRY_INVALID/);
});
