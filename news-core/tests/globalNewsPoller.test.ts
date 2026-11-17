import assert from "node:assert/strict";
import { test } from "node:test";
import { pollRegisteredGlobalNewsSources, type GlobalNewsSink } from "../globalNewsPoller";
import type { GlobalNewsSource, GlobalNewsItem } from "../globalNewsAdapter";

const source = (id: string): GlobalNewsSource => ({
  sourceId: id, publisher: id,
  feedUrl: `https://feeds.example.org/${id}.json`,
  allowedArticleHosts: ["feeds.example.org"], format: "JSON_FEED_V1",
  rightsPolicyId: "metadata-only-v1",
});

const payload = (id: string) => ({
  version: "https://jsonfeed.org/version/1.1",
  items: [{ id, url: `https://feeds.example.org/${id}`, title: "Official news update", date_published: "2026-11-16T10:00:00Z" }],
});

test("different sources are processed independently and records retain identity", async () => {
  const saved: GlobalNewsItem[] = [];
  const sink: GlobalNewsSink = {
    async persistBatch(_s, items) { saved.push(...items); },
  };
  const result = await pollRegisteredGlobalNewsSources({
    sources: [source("bank-one"), source("bank-two")],
    retrieve: async s => payload(s.sourceId),
    sink,
    now: () => new Date("2026-11-16T11:00:00Z"),
  });
  assert.deepEqual(result.map(r => r.status), ["INGESTED", "INGESTED"]);
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0].publicationId, saved[1].publicationId);
  assert.equal(saved[0].publishedAt, "2026-11-16T10:00:00.000Z");
});

test("invalid feeds and sink failures isolate sources without committing partial batches", async () => {
  const called: string[] = [];
  const result = await pollRegisteredGlobalNewsSources({
    sources: [source("bad-feed"), source("sink-error"), source("healthy")],
    retrieve: async s => s.sourceId === "bad-feed" ? { version: "invalid", items: [] } : payload(s.sourceId),
    sink: { async persistBatch(s, items) {
      if (s.sourceId === "sink-error") throw new Error("database connection details not for logs");
      called.push(`${s.sourceId}:${items.length}`);
    }},
    now: () => new Date("2026-11-16T11:00:00Z"),
  });
  assert.deepEqual(result.map(r => r.status), ["ERROR", "ERROR", "INGESTED"]);
  assert.deepEqual(called, ["healthy:1"]);
  assert.equal(result[1].errorCode, "GLOBAL_NEWS_SOURCE_FAILED");
});

test("source registry validation fails before executing any external work", async () => {
  let calls = 0;
  await assert.rejects(() => pollRegisteredGlobalNewsSources({
    sources: [source("same-source"), source("same-source")],
    sink: { async persistBatch() { calls++; } },
    retrieve: async () => { calls++; return payload("x"); },
  }), /GLOBAL_NEWS_SOURCE_DUPLICATE/);
  assert.equal(calls, 0);
});

test("aborted cycles do not attempt another source", async () => {
  const abort = new AbortController();
  const saved: string[] = [];
  const result = await pollRegisteredGlobalNewsSources({
    sources: [source("one"), source("two")],
    signal: abort.signal,
    retrieve: async s => { abort.abort(); return payload(s.sourceId); },
    sink: { async persistBatch(s) { saved.push(s.sourceId); } },
  });
  assert.equal(result.length, 0);
  assert.deepEqual(saved, []);
});
