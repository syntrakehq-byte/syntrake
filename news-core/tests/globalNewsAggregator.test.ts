import assert from "node:assert/strict";
import test from "node:test";
import { GDELT_WORLD_INDEX_V1, gdeltFeedUrl, isGdeltIndex, parseGdeltIndex } from "../globalNewsAggregator";
import { NEWS_OFFICIAL_PLUS_WORLD_INDEX_V1, resolveGlobalNewsWorkerSources } from "../globalNewsOfficialSources";

const payload = { version: "https://jsonfeed.org/version/1", items: [
  { id: "article-a", url: "https://samplepublisher.example/economy", title: "Global growth projection", date_published: "2026-11-25T12:00:00Z", content_html: "<p>Article body must not be copied</p>", summary: "Never store this snippet" },
  { id: "article-b", url: "https://anotherpublisher.example/finance", title: "International markets update", date_published: "2026-11-25T13:00:00Z" },
  { id: "article-c", url: "http://insecure.example/article", title: "Unsafe HTTP link" },
] };

test("worldwide discovery index stores only verified-shape metadata, not article bodies", () => {
  assert.ok(isGdeltIndex(GDELT_WORLD_INDEX_V1));
  const news = parseGdeltIndex(GDELT_WORLD_INDEX_V1, payload, "2026-11-25T14:00:00Z");
  assert.equal(news.length, 2);
  assert.equal(news[0].title, "Global growth projection");
  assert.equal(news[0].summary, null);
  assert.equal(news[0].publishedAt, "2026-11-25T12:00:00.000Z");
  assert.ok(news[0].qualityFlags.includes("PUBLISHER_UNVERIFIED"));
  assert.ok(news.every(x => x.publisher === GDELT_WORLD_INDEX_V1.publisher));
  assert.ok(news.every(x => x.originalUrl.startsWith("https://")));
  assert.equal(new Set(news.map(x => x.publicationId)).size, 2);
  assert.equal(JSON.stringify(news).includes("Article body must not be copied"), false);
  assert.equal(JSON.stringify(news).includes("Never store this snippet"), false);
  assert.deepEqual(parseGdeltIndex(GDELT_WORLD_INDEX_V1, payload, "2026-11-25T14:00:00Z"), news);
  assert.throws(() => parseGdeltIndex(GDELT_WORLD_INDEX_V1, { items: [] }, "2026-11-25T14:00:00Z"), /FEED_INVALID/);
});
test("GDELT configuration is fixed, opt-in and keeps direct official sources separate", () => {
  const url = new URL(gdeltFeedUrl());
  assert.equal(url.origin, "https://api.gdeltproject.org");
  assert.equal(url.searchParams.get("format"), "jsonfeed");
  assert.equal(url.searchParams.get("mode"), "artlist");
  assert.equal(url.searchParams.get("timespan"), "24h");
  assert.equal(url.searchParams.get("maxrecords"), "20");
  assert.equal(resolveGlobalNewsWorkerSources({}).length, 0);
  const combined = resolveGlobalNewsWorkerSources({ profile: "official-plus-world-index-v1" });
  assert.equal(combined.length, 8);
  assert.deepEqual(combined, NEWS_OFFICIAL_PLUS_WORLD_INDEX_V1);
  assert.equal(new Set(combined.map(x => x.checkpointScope)).size, 8);
  assert.ok(combined.every(x => x.storagePolicy.content === "METADATA_ONLY"));
  assert.equal(combined.find(x => x.sourceId === GDELT_WORLD_INDEX_V1.sourceId)?.category, "EDITORIAL");
  assert.throws(() => resolveGlobalNewsWorkerSources({ profile: "official-plus-world-index-v1", json: "[]" }), /CONFIG_CONFLICT/);
});
