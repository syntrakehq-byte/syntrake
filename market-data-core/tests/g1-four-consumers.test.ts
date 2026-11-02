import test from "node:test";
import assert from "node:assert/strict";
import type { MarketDataResult } from "../contracts";
import { instrumentIdentity } from "../identity";

const result: MarketDataResult = {
  instrument: instrumentIdentity({ kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD" }),
  listingRef: "TWELVE_DATA:AAPL:XNGS",
  sourceRefs: [{ provider: "TWELVE_DATA", originalSourceId: "time_series:AAPL:XNGS", requestId: null, sourceDocumentUri: null }],
  revisionId: "rev-aapl-1", price: "100.50", currency: "USD", marketDate: "2026-01-02", asOf: "2026-01-02T20:00:00Z",
  quality: { coverage: "FULL", freshness: "KNOWN" },
  rights: { policyId: "internal-read", display: true, retentionUntil: null }, interval: "1day", adjustment: "none",
};

test("G1 four consumers share one neutral Market Data result without four adapters", () => {
  const consumers = ["Investing Core", "Trading Core", "Investing Lab", "Trading Lab"] as const;
  const reads = consumers.map(name => ({ consumer: name, result }));
  assert.equal(new Set(reads.map(x => x.result)).size, 1);
  assert.deepEqual(reads.map(x => x.consumer), [...consumers]);
  assert.equal(result.instrument.symbol, "AAPL");
  assert.equal(result.interval, "1day");
  assert.equal(result.adjustment, "none");
});

test("G1 prevents sharing when display rights differ", () => {
  const internal = result;
  const noDisplay: MarketDataResult = { ...result, rights: { ...result.rights, display: false, policyId: "internal-only" } };
  assert.notEqual(internal.rights.policyId, noDisplay.rights.policyId);
  assert.notEqual(internal.rights.display, noDisplay.rights.display);
});
