import test from "node:test";
import assert from "node:assert/strict";
import { instrumentIdentity, type AliasResolution } from "../identity";
import { createOnDemandMarketDataGateway, type MarketDataDemand } from "../onDemandMarketData";
import { createOnDemandTwelveDataSource, type AuthorizedTwelveDataContext } from "../onDemandTwelveData";
import type { MarketDataResult } from "../contracts";

const instrumentId = "b2000000-0000-4000-8000-000000000001";
const listingId = "b2000000-0000-4000-8000-000000000002";
const policyId = "SYNTHETIC_OFFLINE_PROVIDER_ONLY";
const sha = "a".repeat(40);
const now = new Date("2026-11-06T16:00:00Z");
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3g-preview-hosted-worker-20261108",
  VERCEL_GIT_COMMIT_SHA: sha,
  SYNTRAKE_G3_APPROVED_SHA: sha,
  SYNTRAKE_G3_PROVIDER_ENABLED: "enabled",
  SYNTRAKE_G3_LICENSE_SCOPE: "internal-non-display",
  SYNTRAKE_TWELVE_DATA_API_KEY: "OFFLINE_FIXTURE_KEY_NO_EXTERNAL_HTTP",
};
const hint = instrumentIdentity({ kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD" });
const instrument = { ...hint, instrumentId, listingId, key: "instrument:" + instrumentId + ":listing:" + listingId };
const demand: MarketDataDemand = {
  instrument, rightsPolicyId: policyId, requiresDisplay: false,
  interval: "1day", adjustment: "none", maxAgeMs: 300000,
};
const alias: AliasResolution = {
  status: "EXACT", instrumentId, listingId,
  alias: { provider: "TWELVE_DATA", providerReference: "AAPL", instrumentId, listingId, validFrom: "1980-01-01", validTo: null },
};
const context: AuthorizedTwelveDataContext = {
  alias, asOfMarketDate: "2026-11-06", policyId, queryAllowed: true,
  displayAllowed: false, cacheAllowed: true,
  retentionUntil: "2026-11-08T00:00:00Z", creditReserved: true, purgeVerified: true,
};
const response = () => new Response(JSON.stringify({
  status: "ok",
  meta: { symbol: "AAPL", interval: "1day", currency: "USD",
    exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNGS" },
  values: [{ datetime: "2026-11-06", open: "105.00", high: "107.00", low: "104.00", close: "106.75", volume: "1000" }],
}), { status: 200 });

test("real Twelve Data adapter with OFFLINE HTTP: request -> validated price -> cache -> second consumer", async () => {
  let httpCalls = 0, authorizations = 0, writes = 0;
  let cached: MarketDataResult | null = null;
  const source = createOnDemandTwelveDataSource({
    env, clock: () => now,
    authorize: async () => { authorizations++; return context; },
    transport: async (url, init) => {
      httpCalls++;
      const parsed = new URL(url);
      assert.equal(parsed.host, "api.twelvedata.com");
      assert.equal(parsed.searchParams.get("symbol"), "AAPL");
      assert.equal(parsed.searchParams.get("mic_code"), "XNGS");
      assert.equal(parsed.searchParams.has("apikey"), false);
      assert.equal(new Headers(init.headers).get("Authorization"), "apikey " + env.SYNTRAKE_TWELVE_DATA_API_KEY);
      return response();
    },
  });
  const gateway = createOnDemandMarketDataGateway({
    readCached: async () => cached,
    fetchAuthorized: source,
    storeAuthorized: async (_demand, result) => { writes++; cached = result; },
    clock: () => now,
  });
  const investingInternal = await gateway.request(demand);
  assert.equal(investingInternal.source, "PROVIDER");
  assert.equal(investingInternal.status, "STALE", "Provider does not prove realtime freshness");
  assert.equal(investingInternal.data?.price, "106.75");
  assert.equal(investingInternal.data?.rights.display, false);
  assert.equal(investingInternal.data?.instrument.listingId, listingId);

  const tradingInternal = await gateway.request(demand);
  assert.equal(tradingInternal.source, "CACHE");
  assert.equal(tradingInternal.data?.price, "106.75");
  assert.equal(httpCalls, 1);
  assert.equal(authorizations, 1);
  assert.equal(writes, 1);
});

test("G3 internal non-display scope blocks browser price before authorization or supplier HTTP", async () => {
  let calls = 0;
  const source = createOnDemandTwelveDataSource({
    env, authorize: async () => { calls++; return context; },
    transport: async () => { calls++; return response(); }, clock: () => now,
  });
  const result = await source({ ...demand, requiresDisplay: true });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("disabled operator gate and missing credit reservation make zero provider requests", async () => {
  let count = 0;
  const disabled = createOnDemandTwelveDataSource({
    env: { ...env, SYNTRAKE_G3_PROVIDER_ENABLED: "disabled" },
    authorize: async () => { count++; return context; },
    transport: async () => { count++; return response(); },
  });
  await assert.rejects(disabled(demand), /DISABLED/);
  assert.equal(count, 0);

  const unreserved = createOnDemandTwelveDataSource({
    env, authorize: async () => ({ ...context, creditReserved: false }),
    transport: async () => { count++; return response(); }, clock: () => now,
  });
  assert.equal(await unreserved(demand), null);
  assert.equal(count, 0);
});

test("cache rights and purge evidence are independent from query permission", async () => {
  const source = createOnDemandTwelveDataSource({
    env, authorize: async () => ({ ...context, purgeVerified: false }),
    transport: async () => response(), clock: () => now,
  });
  const value = await source(demand);
  assert.equal(value?.data.price, "106.75");
  assert.equal(value?.storageAllowed, false);
});
