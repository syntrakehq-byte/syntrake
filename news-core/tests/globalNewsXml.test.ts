import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAtomNewsFeed, parseRssNewsFeed } from "../globalNewsXml";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const base = (sourceType: "RSS_2" | "ATOM"): GlobalNewsRegistryEntry => ({
  registryVersion: "1.0", sourceId: `official-${sourceType === "RSS_2" ? "rss2" : "atom"}`, publisherId: "official-publisher", publisher: "Official Publisher",
  category: "REGULATOR", geoScope: ["US"], sourceType, endpoint: "https://feeds.example.org/news.xml", allowedArticleHosts: ["feeds.example.org"], rightsPolicyId: "metadata-only-v1",
  updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 10 }, storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${sourceType === "RSS_2" ? "rss2" : "atom"}:global`,
});

test("RSS 2.0 normalizes item identity, dates and permitted summary", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item><guid isPermaLink="false">rel-1</guid><title><![CDATA[Rate &amp; outlook]]></title><link>https://feeds.example.org/releases/1</link><description>Summary &amp; context</description><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseRssNewsFeed(base("RSS_2"), xml, "2026-11-16T10:01:00Z");
  assert.equal(items.length, 1);
  assert.equal(items[0].externalId, "rel-1");
  assert.equal(items[0].publishedAt, "2026-11-16T10:00:00.000Z");
  assert.equal(items[0].retrievedAt, "2026-11-16T10:01:00Z");
});

test("Atom selects alternate link and keeps unknown time unknown", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:official,2026:1</id><title>Statement</title><link rel="alternate" href="https://feeds.example.org/releases/1"/><summary>Text</summary><updated>2026-11-16T10:00:00Z</updated></entry></feed>`;
  const items = parseAtomNewsFeed(base("ATOM"), xml, "2026-11-16T10:01:00Z");
  assert.equal(items[0].publishedAt, null);
  assert.deepEqual(items[0].qualityFlags, ["SOURCE_PUBLICATION_DATE_UNKNOWN"]);
});

test("XML external entities and unsafe article links fail closed", () => {
  assert.throws(() => parseRssNewsFeed(base("RSS_2"), `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>`, "2026-11-16T10:01:00Z"), /GLOBAL_NEWS_XML_INVALID/);
  assert.throws(() => parseRssNewsFeed(base("RSS_2"), `<?xml version="1.0"?><rss><item><guid>x</guid><title>X</title><link>https://evil.example.org/x</link></item></rss>`, "2026-11-16T10:01:00Z"), /GLOBAL_NEWS_ITEM_INVALID/);
});
