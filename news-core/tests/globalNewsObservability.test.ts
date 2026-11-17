import assert from "node:assert/strict";
import test from "node:test";
import { GlobalNewsObservabilityV1 } from "../globalNewsObservability";

test("N-G7 records per-source freshness, latency, coverage and sanitized error state", () => {
  const metrics = new GlobalNewsObservabilityV1(30); const start = Date.parse("2026-11-17T10:00:00.000Z");
  metrics.recordCycle("ecb", { sourceId: "ecb", status: "INGESTED", observed: 2, errorCode: null, latestPublishedAt: "2026-11-17T10:00:00.000Z" }, start, start + 120, new Date("2026-11-17T10:00:05.000Z"));
  metrics.recordCycle("fed", { sourceId: "fed", status: "ERROR", observed: 0, errorCode: "GLOBAL_NEWS_SOURCE_FAILED" }, start, start + 900, new Date("2026-11-17T10:00:05.000Z"));
  const snapshot = metrics.snapshot(new Date("2026-11-17T10:00:20.000Z"));
  assert.deepEqual(snapshot.sources.map(source => source.sourceId), ["ecb", "fed"]); assert.equal(snapshot.sources[0].lastLatencyMs, 120); assert.equal(snapshot.sources[0].health, "HEALTHY"); assert.equal(snapshot.sources[1].health, "ERROR"); assert.equal(snapshot.totals.observed, 2);
  assert.equal(metrics.snapshot(new Date("2026-11-17T10:01:00.000Z")).sources[0].health, "STALE");
});
