import test from "node:test";
import assert from "node:assert/strict";
import { readMarketDataForConsumer } from "../contracts";
import { discoverMarketDataPreview } from "../discoveryMarketDataInvesting";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import type { CatalogSource } from "../instrumentDiscovery";

const source: CatalogSource = {
  providerKey: "TWELVE_DATA", snapshotId: "g1-four-consumers", snapshotVersion: "1",
  observedAt: "2026-01-01T00:00:00Z", licensePolicyId: "g1-license",
  storageAllowed: true, sharingAllowed: false,
};
const env = {
  VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/r3-market-data-core-20261030",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40), SYNTRAKE_R3_PREVIEW_APPROVED_SHA: "a".repeat(40),
  SYNTRAKE_R3_PROVIDER_ENABLED: "enabled", SYNTRAKE_TWELVE_DATA_API_KEY: "offline-test-key-1234",
};
const catalog = () => createTwelveDataCatalogConnector({
  env: { TWELVE_DATA_API_KEY: "offline-only" }, source,
  transport: async () => new Response(JSON.stringify({
    status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.",
      mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" }],
  }), { status: 200 }),
});

test("G1 four consumers use one R3 result from injected HTTP; Labs are optional", async () => {
  let quoteCalls = 0;
  const response = await discoverMarketDataPreview({
    connector: catalog(), query: { ticker: "AAPL", marketMic: "XNGS" },
    price: {
      env, quotaRemaining: 1, estimatedCredits: 1,
      rights: { policyId: "g1-license", query: true, display: true, retentionUntil: null },
      transport: async () => {
        quoteCalls++;
        return new Response(JSON.stringify({
          status: "ok", meta: { symbol: "AAPL", interval: "1day", currency: "USD",
            exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNGS" },
          values: [{ datetime: "2026-01-02", open: "100.00", high: "110.00", low: "90.00", close: "100.50", volume: "42" }],
        }), { status: 200 });
      },
    },
  });
  assert.equal(response.status, "READY");
  assert.ok(response.marketData);
  assert.equal(quoteCalls, 1);
  assert.equal(response.marketData.price, "100.50");
  assert.equal(response.marketData.sourceRefs[0]?.provider, "TWELVE_DATA");
  assert.equal(response.marketData.quality.freshness, "UNKNOWN");
  assert.equal(response.identityVerified, false); // descriptive preview never claims Registry EXACT

  const consumers = ["Investing Core", "Trading Core", "Investing Lab", "Trading Lab"] as const;
  const reads = consumers.map(consumer => ({
    consumer, data: readMarketDataForConsumer(response.marketData!, {
      rightsPolicyId: "g1-license", requiresDisplay: true, interval: "1day",
    }),
  }));
  assert.deepEqual(reads.map(x => x.consumer), [...consumers]);
  for (const x of reads) assert.strictEqual(x.data, response.marketData);
  // Switching the two optional Labs off does not trigger fresh market-data calls.
  assert.deepEqual(reads.slice(0, 2).map(x => x.consumer), ["Investing Core", "Trading Core"]);
  assert.equal(quoteCalls, 1);
  assert.equal(readMarketDataForConsumer(response.marketData, {
    rightsPolicyId: "other-license", requiresDisplay: true, interval: "1day",
  }), null);
  assert.equal(readMarketDataForConsumer(response.marketData, {
    rightsPolicyId: "g1-license", requiresDisplay: true, interval: "1min",
  }), null); // a daily quote is not suitable for a trading intraday request
  assert.equal(readMarketDataForConsumer({ ...response.marketData, rights: { ...response.marketData.rights, display: false } }, {
    rightsPolicyId: "g1-license", requiresDisplay: true, interval: "1day",
  }), null);
});

test("G1 denied display rights stop the price request and return no price", async () => {
  let quoteCalls = 0;
  const result = await discoverMarketDataPreview({
    connector: catalog(), query: { ticker: "AAPL", marketMic: "XNGS" },
    price: {
      env, quotaRemaining: 1, estimatedCredits: 1,
      rights: { policyId: "no-display", query: true, display: false, retentionUntil: null },
      transport: async () => { quoteCalls++; throw new Error("PRICE_FETCH_MUST_NOT_RUN"); },
    },
  });
  assert.equal(result.status, "ROUTING_BLOCKED");
  assert.equal(result.marketData, null);
  assert.equal(result.close, null);
  assert.equal(quoteCalls, 0);
});
