import assert from "node:assert/strict";
import test from "node:test";
import { adaptNewsForConsumerV1, assertMarketNewsBoundaryV1, validateMarketTemporalV1, validateNewsTemporalV1 } from "../consumerContracts";
import type { NewsEnvelope } from "../n5Api";

const news: NewsEnvelope<unknown> = {
  schemaVersion: "1.0", requestId: "contract-test", status: "AVAILABLE", asOf: "2026-11-15T10:00:00.000Z",
  servedAt: "2026-11-15T10:01:00.000Z", data: [], sourceRefs: [], qualityFlags: [], nextCursor: null,
};

test("T21: Investing and Trading consume the same versioned neutral News boundary", () => {
  const investing = adaptNewsForConsumerV1("INVESTING", news);
  const trading = adaptNewsForConsumerV1("TRADING", news);
  assert.equal(investing.contractVersion, "news-consumer-v1");
  assert.equal(trading.contractVersion, "news-consumer-v1");
  assert.deepEqual(investing.news, trading.news);
  assert.equal(Object.hasOwn(investing, "accountId"), false);
  assert.equal(Object.hasOwn(investing, "portfolio"), false);
  assert.equal(Object.hasOwn(trading, "order"), false);
});

test("T33: Market and News temporal envelopes remain separate and reject look-ahead", () => {
  const market = validateMarketTemporalV1({ status: "AVAILABLE", firstSeenAt: "2026-11-15T09:00:00.000Z", ingestedAt: "2026-11-15T10:00:00.000Z", asKnownAt: "2026-11-15T09:30:00.000Z", revisionId: "market-rev-1" });
  const newsTemporal = validateNewsTemporalV1({ firstSeenAt: "2026-11-15T09:00:00.000Z", ingestedAt: "2026-11-15T10:00:00.000Z", asKnownAt: "2026-11-15T10:05:00.000Z", asOf: "2026-11-15T10:05:00.000Z", revisionId: "news-rev-1" });
  assert.doesNotThrow(() => assertMarketNewsBoundaryV1(market, newsTemporal));
  assert.throws(() => validateNewsTemporalV1({ ...newsTemporal, asKnownAt: "2026-11-15T09:59:00.000Z" }), /NEWS_TEMPORAL_CONTRACT_INVALID/);
  assert.throws(() => validateMarketTemporalV1({ ...market, asKnownAt: "2026-11-15T10:01:00.000Z" }), /MARKET_TEMPORAL_CONTRACT_INVALID/);
  assert.throws(() => assertMarketNewsBoundaryV1(market, { ...newsTemporal, asOf: "2026-11-15T10:06:00.000Z" }), /NEWS_TEMPORAL_LOOKAHEAD/);
  assert.throws(() => assertMarketNewsBoundaryV1(market, { ...newsTemporal, revisionId: "market-rev-1" }), /MARKET_NEWS_REVISION_NAMESPACE_COLLISION/);
});
