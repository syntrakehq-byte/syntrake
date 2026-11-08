import test from "node:test";
import assert from "node:assert/strict";
import { instrumentIdentity, MarketDataError } from "../identity";
import { createOnDemandMarketDataGateway, type MarketDataDemand } from "../onDemandMarketData";
import { handleOnDemandMarketDataHttp } from "../onDemandMarketDataHttp";
import type { MarketDataResult } from "../contracts";

const instrumentId = "a1000000-0000-4000-8000-000000000001";
const listingId = "a1000000-0000-4000-8000-000000000002";
const identity = {
  ...instrumentIdentity({ kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD" }),
  key: "instrument:" + instrumentId + ":listing:" + listingId,
  instrumentId, listingId,
};
const stamp = "2026-11-06T15:30:00Z";
const now = new Date("2026-11-06T15:31:00Z");
const demand: MarketDataDemand = {
  instrument: identity, rightsPolicyId: "SYNTHETIC_FIXTURE_ONLY",
  requiresDisplay: true, interval: "1day", adjustment: "none", maxAgeMs: 300000,
};
const synthetic: MarketDataResult = {
  instrument: identity, listingRef: listingId,
  sourceRefs: [{ provider: "SYNTHETIC_TEST_ONLY", originalSourceId: "offline-test-aapl-20261106", requestId: null, sourceDocumentUri: null }],
  revisionId: "synthetic-not-market-quote",
  price: "105.25", currency: "USD", marketDate: "2026-11-06", asOf: stamp,
  interval: "1day", adjustment: "none",
  quality: { coverage: "FULL", freshness: "KNOWN" },
  rights: { policyId: demand.rightsPolicyId, display: true, retentionUntil: "2026-11-07T00:00:00Z" },
};
const actor = { userId: "test_actor", sessionId: "test_session" };
const url = "https://preview.invalid/api/market-data?listingId=" + listingId;
function build(input: { storageAllowed?: boolean; data?: MarketDataResult; clock?: () => Date; fail?: boolean } = {}) {
  let cached: MarketDataResult | null = null;
  let fetchCalls = 0, cacheWrites = 0;
  const gateway = createOnDemandMarketDataGateway({
    readCached: async () => cached,
    fetchAuthorized: async () => {
      fetchCalls++;
      if (input.fail) throw new MarketDataError("DISABLED");
      return { data: input.data ?? synthetic, storageAllowed: input.storageAllowed ?? true };
    },
    storeAuthorized: async (_demand, data) => { cacheWrites++; cached = data; },
    clock: input.clock ?? (() => now),
  });
  return { gateway, get fetchCalls() { return fetchCalls; }, get cacheWrites() { return cacheWrites; },
    setCache: (data: MarketDataResult) => { cached = data; } };
}

test("simple proof: Investing requests AAPL -> supplier, Trading requests AAPL -> same cached quote", async () => {
  const state = build();
  const investing = await state.gateway.request(demand);
  assert.equal(investing.status, "AVAILABLE");
  assert.equal(investing.source, "PROVIDER");
  assert.equal(investing.data?.price, "105.25");
  assert.equal(state.fetchCalls, 1);
  const trading = await state.gateway.request(demand);
  assert.equal(trading.status, "AVAILABLE");
  assert.equal(trading.source, "CACHE");
  assert.strictEqual(trading.data, investing.data);
  assert.equal(state.fetchCalls, 1, "No second market-source call");
  assert.equal(state.cacheWrites, 1, "One stored authorized observation only");
});

test("simultaneous consumers share one supplier request and one storage operation", async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let calls = 0, writes = 0;
  const gateway = createOnDemandMarketDataGateway({
    readCached: async () => null,
    fetchAuthorized: async () => { calls++; await wait; return { data: synthetic, storageAllowed: true }; },
    storeAuthorized: async () => { writes++; },
    clock: () => now,
  });
  const a = gateway.request(demand);
  const b = gateway.request(demand);
  await new Promise<void>(resolve => setImmediate(resolve));
  release();
  const [first, second] = await Promise.all([a,b]);
  assert.equal(first.status, "AVAILABLE");
  assert.equal(second.status, "AVAILABLE");
  assert.equal(calls, 1);
  assert.equal(writes, 1);
});

test("stale cached quote refreshes on demand, not on a timer", async () => {
  const state = build({ clock: () => new Date("2026-11-06T16:01:00Z") });
  state.setCache({ ...synthetic, asOf: "2026-11-06T15:00:00Z" });
  const res = await state.gateway.request(demand);
  assert.equal(res.source, "PROVIDER");
  assert.equal(state.fetchCalls, 1);
});

test("non-display rights never leak prices to a display consumer", async () => {
  const blocked = { ...synthetic, rights: { ...synthetic.rights, display: false } };
  const state = build({ data: blocked });
  const result = await state.gateway.request(demand);
  assert.equal(result.status, "LICENSE_BLOCKED");
  assert.equal(result.data, null);
  assert.equal(state.cacheWrites, 0);
  assert.equal(state.fetchCalls, 1);
  state.setCache(blocked);
  const second = await state.gateway.request(demand);
  assert.equal(second.status, "LICENSE_BLOCKED");
  assert.equal(state.fetchCalls, 1, "Blocked cache must not silently cause another billable fetch");
});

test("no persistence without verified storage rights, disabled source never fabricates price", async () => {
  const noStorage = build({ storageAllowed: false });
  assert.equal((await noStorage.gateway.request(demand)).status, "AVAILABLE");
  assert.equal((await noStorage.gateway.request(demand)).source, "PROVIDER");
  assert.equal(noStorage.fetchCalls, 2);
  assert.equal(noStorage.cacheWrites, 0);

  const disabled = build({ fail: true });
  const result = await disabled.gateway.request(demand);
  assert.deepEqual(result, { status: "UNAVAILABLE", source: "NONE", data: null });
  assert.equal(disabled.cacheWrites, 0);
});

test("unknown freshness is explicitly STALE, never labelled a real-time quote", async () => {
  const state = build({ data: { ...synthetic, quality: { coverage: "FULL", freshness: "UNKNOWN" } } });
  const first = await state.gateway.request(demand);
  assert.equal(first.status, "STALE");
  assert.equal(first.data?.quality.freshness, "UNKNOWN");
  const second = await state.gateway.request(demand);
  assert.equal(second.status, "STALE");
  assert.equal(second.source, "CACHE");
  assert.equal(state.fetchCalls, 1);
});

test("wrong listing/provider rights, future observations or bad precision are blocked", async () => {
  for (const value of [
    { ...synthetic, listingRef: "a1000000-0000-4000-8000-000000000099" },
    { ...synthetic, instrument: { ...identity, symbol: "MSFT" } },
    { ...synthetic, rights: { ...synthetic.rights, policyId: "ANOTHER_POLICY" } },
    { ...synthetic, rights: { ...synthetic.rights, retentionUntil: "2020-01-01T00:00:00Z" } },
    { ...synthetic, price: "NaN" },
    { ...synthetic, price: "0" },
    { ...synthetic, asOf: "2027-01-01T00:00:00Z" },
    { ...synthetic, quality: { coverage: "PARTIAL" as const, freshness: "KNOWN" as const } },
  ]) {
    const state = build({ data: value });
    const response = await state.gateway.request(demand);
    assert.equal(response.data, null);
    assert.equal(state.cacheWrites, 0);
  }
});

test("authenticated shared HTTP returns supplier quote first, cache quote second, without actor exposure", async () => {
  const state = build();
  const handler = () => handleOnDemandMarketDataHttp(new Request(url), {
    authenticate: async () => actor,
    resolve: async () => demand,
    request: state.gateway.request,
  });
  const first = await handler();
  assert.equal(first.status, 200);
  const data1 = await first.json();
  assert.equal(data1.price, "105.25");
  assert.equal(data1.source, "PROVIDER");
  assert.equal(data1.symbol, "AAPL");
  assert.equal(data1.mic, "XNGS");
  const second = await handler();
  const data2 = await second.json();
  assert.equal(data2.source, "CACHE");
  assert.equal(data2.price, data1.price);
  assert.equal(state.fetchCalls, 1);
  assert.equal(JSON.stringify(data2).includes(actor.userId), false);
  assert.equal(second.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("HTTP refuses unauthenticated, invalid and non-display requests without fetching", async () => {
  const state = build();
  const auth = async () => { throw new Error("UNAUTHENTICATED"); };
  assert.equal((await handleOnDemandMarketDataHttp(new Request(url), {
    authenticate: auth, resolve: async () => demand, request: state.gateway.request,
  })).status, 401);
  for (const invalidUrl of [url + "&other=x", url + "&listingId=" + listingId,
    url.replace("listingId=", "symbol="), "https://preview.invalid/api/not-market?listingId=" + listingId]) {
    assert.equal((await handleOnDemandMarketDataHttp(new Request(invalidUrl), {
      authenticate: async () => actor, resolve: async () => demand, request: state.gateway.request,
    })).status, 400);
  }
  const nonDisplay = await handleOnDemandMarketDataHttp(new Request(url), {
    authenticate: async () => actor,
    resolve: async () => ({ ...demand, requiresDisplay: false }),
    request: state.gateway.request,
  });
  assert.equal(nonDisplay.status, 403);
  assert.equal(state.fetchCalls, 0);
});
