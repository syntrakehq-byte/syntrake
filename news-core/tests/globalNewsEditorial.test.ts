import assert from "node:assert/strict";
import test from "node:test";
import { NEWS_DAILY_EDITORIAL_CANDIDATES_V1 } from "../globalNewsEditorialSources";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1, resolveGlobalNewsWorkerSources } from "../globalNewsOfficialSources";

test("three daily editorial metadata sources have unique identities and bounded rights", () => {
  assert.equal(NEWS_DAILY_EDITORIAL_CANDIDATES_V1.length, 3);
  const ids = NEWS_DAILY_EDITORIAL_CANDIDATES_V1.map(x => x.sourceId);
  assert.deepEqual(ids, ["world-un-news", "world-france24", "us-cnbc-business"]);
  assert.equal(new Set(ids).size, 3);
  assert.ok(NEWS_DAILY_EDITORIAL_CANDIDATES_V1.every(x => x.storagePolicy.content === "METADATA_ONLY"));
  assert.ok(NEWS_DAILY_EDITORIAL_CANDIDATES_V1.every(x => x.rightsPolicyId === "editorial-metadata-review-v1"));
  assert.ok(NEWS_DAILY_EDITORIAL_CANDIDATES_V1.every(x => x.allowedArticleHosts.includes(new URL(x.endpoint).hostname)));
});
test("daily publisher profile is opt-in and does not change the existing worker default", () => {
  assert.deepEqual(resolveGlobalNewsWorkerSources({}), []);
  const profile = resolveGlobalNewsWorkerSources({ profile: "official-plus-daily-news-v1" });
  assert.deepEqual(profile, NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1);
  assert.equal(profile.length, 10);
  assert.equal(new Set(profile.map(x => x.checkpointScope)).size, 10);
  assert.throws(() => resolveGlobalNewsWorkerSources({ profile: "official-plus-daily-news-v1", json: "[]" }), /CONFIG_CONFLICT/);
});
