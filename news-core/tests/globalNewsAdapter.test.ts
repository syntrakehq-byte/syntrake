import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonNewsFeed, validateGlobalNewsSource, type GlobalNewsSource } from "../globalNewsAdapter";

const source: GlobalNewsSource = {
  sourceId: "example-central-bank",
  publisher: "Example Central Bank",
  feedUrl: "https://news.example.org/feed.json",
  allowedArticleHosts: ["news.example.org"],
  format: "JSON_FEED_V1",
  rightsPolicyId: "internal-metadata-v1",
};

const one = {
  version: "https://jsonfeed.org/version/1.1",
  items: [{ id: "notice-123", url: "https://news.example.org/notices/123", title: "Policy statement", date_published: "2026-11-16T08:00:00Z", summary: "Official statement" }],
};

test("global news source registry validation is explicit", () => {
  assert.doesNotThrow(() => validateGlobalNewsSource(source));
  assert.throws(() => validateGlobalNewsSource({ ...source, feedUrl: "http://localhost:8080/feed" }), /GLOBAL_NEWS_URL_INVALID/);
  assert.throws(() => validateGlobalNewsSource({ ...source, allowedArticleHosts: ["news.example.org", "news.example.org"] }), /GLOBAL_NEWS_SOURCE_INVALID/);
});

test("normalize a registered independent JSON Feed without inventing dates", () => {
  const result = parseJsonNewsFeed(source, one, "2026-11-16T08:05:00Z");
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Policy statement");
  assert.equal(result[0].publishedAt, "2026-11-16T08:00:00.000Z");
  assert.equal(result[0].retrievedAt, "2026-11-16T08:05:00.000Z");
  assert.deepEqual(result[0].qualityFlags, []);
  const same = parseJsonNewsFeed(source, one, "2026-11-17T08:05:00Z");
  assert.equal(same[0].publicationId, result[0].publicationId);
  assert.equal(same[0].contentFingerprint, result[0].contentFingerprint);
  const undated = parseJsonNewsFeed(source, { ...one, items: [{ id: "undated", url: "https://news.example.org/undated", title: "Unspecified time" }] }, "2026-11-16T08:05:00Z");
  assert.equal(undated[0].publishedAt, null);
  assert.deepEqual(undated[0].qualityFlags, ["SOURCE_PUBLICATION_DATE_UNKNOWN"]);
});

test("reject untrusted hosts, duplicates and invalid dates without partial success", () => {
  assert.throws(() => parseJsonNewsFeed(source, { ...one, items: [{ ...one.items[0], url: "https://evil.example.net/a" }] }, "2026-11-16T08:05:00Z"), /GLOBAL_NEWS_ARTICLE_HOST_NOT_ALLOWED/);
  assert.throws(() => parseJsonNewsFeed(source, { ...one, items: [one.items[0], one.items[0]] }, "2026-11-16T08:05:00Z"), /GLOBAL_NEWS_DUPLICATE_EXTERNAL_ID/);
  assert.throws(() => parseJsonNewsFeed(source, { ...one, items: [{ ...one.items[0], date_modified: "2020-01-01T00:00:00Z" }] }, "2026-11-16T08:05:00Z"), /GLOBAL_NEWS_DATE_ORDER_INVALID/);
  assert.throws(() => parseJsonNewsFeed(source, { ...one, items: [{ ...one.items[0], date_published: "yesterday" }] }, "2026-11-16T08:05:00Z"), /GLOBAL_NEWS_DATE_INVALID/);
});

test("reject malformed feeds and links without publishing incomplete batches", () => {
  assert.throws(() => parseJsonNewsFeed(source, { items: [] }, "2026-11-16T08:05:00Z"), /GLOBAL_NEWS_FEED_INVALID/);
  assert.throws(() => parseJsonNewsFeed(source, { ...one, items: [{ ...one.items[0], url: "https://news.example.org:8443/a" }] }, "2026-11-16T08:05:00Z"), /GLOBAL_NEWS_URL_INVALID/);
});
