import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertMarketNewsBoundaryV1, validateNewsTemporalV1, type MarketTemporalEnvelopeV1 } from "../consumerContracts";

/**
 * N0-T33 cross-branch rehearsal: the actual Market Core validator is loaded
 * from the separately checked-out branch, not a locally reconstructed stub.
 * This proves contract interoperability only, not a deployed Market/News PIT join.
 */
test("T33: genuine Market Core DataEnvelope validates independently of News temporal boundary", async () => {
  const root = process.env.N0_MARKET_CORE_CHECKOUT;
  assert.ok(root, "N0_MARKET_CORE_CHECKOUT must point to the real Market Core branch checkout");
  const modulePath = pathToFileURL(path.resolve(root, "market-data-core/contracts.ts")).href;
  const marketModule = await import(modulePath) as {
    validateEnvelope: (value: unknown, predicate: (v: unknown) => v is string) => unknown;
  };
  const isPrice = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d{2}$/.test(value);
  const market = {
    status: "AVAILABLE", value: "100.50",
    firstSeenAt: "2026-11-15T09:00:00.000Z",
    ingestedAt: "2026-11-15T10:00:00.000Z",
    asKnownAt: "2026-11-15T09:30:00.000Z",
    revisionId: "market-rev-1", schemaVersion: "1.0",
    sourceRefs: [{ provider: "TWELVE_DATA", originalSourceId: "official-market-contract-rehearsal", requestId: null, sourceDocumentUri: null }],
    quality: { flags: [], coverage: "FULL" },
    rights: { policyId: "rehearsal-only", display: true, retentionUntil: null },
  };
  const validated = marketModule.validateEnvelope(market, isPrice) as MarketTemporalEnvelopeV1;
  assert.strictEqual(validated, market);
  const news = validateNewsTemporalV1({
    firstSeenAt: "2026-11-15T09:00:00.000Z",
    ingestedAt: "2026-11-15T10:00:00.000Z",
    asKnownAt: "2026-11-15T10:05:00.000Z",
    asOf: "2026-11-15T10:05:00.000Z",
    revisionId: "news-rev-1",
  });
  assert.doesNotThrow(() => assertMarketNewsBoundaryV1(validated, news));
  assert.throws(() => marketModule.validateEnvelope({ ...market, asKnownAt: "2026-11-15T10:01:00.000Z" }, isPrice));
  assert.throws(() => marketModule.validateEnvelope({ ...market, status: "UNAVAILABLE", value: "100.50", quality: { flags: [], coverage: "NONE" } }, isPrice));
  assert.throws(() => marketModule.validateEnvelope({ ...market, status: "AVAILABLE", value: 100.5 }, isPrice));
  assert.throws(() => assertMarketNewsBoundaryV1(validated, { ...news, asOf: "2026-11-15T10:06:00.000Z" }), /NEWS_TEMPORAL_LOOKAHEAD/);
  assert.throws(() => assertMarketNewsBoundaryV1(validated, { ...news, revisionId: market.revisionId }), /MARKET_NEWS_REVISION_NAMESPACE_COLLISION/);
  console.log("N0_T33_CROSS_BRANCH_PROOF actualMarketValidator=true marketNewsSeparate=true lookaheadRejected=true invalidMarketPayloadRejected=true");
});
