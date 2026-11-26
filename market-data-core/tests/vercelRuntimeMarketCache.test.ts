import test from "node:test";
import assert from "node:assert/strict";
import { createVercelRuntimeMarketCache, MARKET_SHARED_CACHE_TTL_SECONDS } from "../vercelRuntimeMarketCache";
import { createDynamicMarketGateway } from "../dynamicMarketGateway";

const sha = "a".repeat(40);
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_SHA: sha,
  SYNTRAKE_MARKET_APPROVED_SHA: sha,
  SYNTRAKE_MARKET_MODE: "on-demand",
  SYNTRAKE_MARKET_VISIBILITY: "authenticated",
  SYNTRAKE_MARKET_PERSISTENCE: "disabled",
  SYNTRAKE_MARKET_SHARED_CACHE: "enabled",
  SYNTRAKE_TWELVE_DATA_API_KEY: "fake_test_0123456789abcdefghijklmnopqrstuvwxyz",
};
const h = "f".repeat(64);
const now = new Date("2026-11-10T12:00:00.000Z");
function storage() {
  const entries = new Map<string, unknown>();
  const writes: { key: string; ttl: number }[] = [];
  const client = {
    async get(key: string): Promise<unknown> { return entries.get(key) ?? null; },
    async set(key: string, value: unknown, options: { ttl: number }): Promise<void> {
      writes.push({ key, ttl: options.ttl }); entries.set(key, value);
    },
  };
  return { entries, writes, client };
}

test("shared Runtime Cache is SHA-scoped and expires after 30 seconds even if backend returns stale data", async () => {
  const s = storage();
  let t = now.getTime();
  const first = createVercelRuntimeMarketCache({ env, client: s.client, clock: () => new Date(t) });
  const second = createVercelRuntimeMarketCache({ env, client: s.client, clock: () => new Date(t) });
  await first.write(h, "DAILY_QUOTE", { price: "123.45" });
  assert.deepEqual(await second.read(h, "DAILY_QUOTE"), { price: "123.45" });
  assert.deepEqual(s.writes.map(x => x.ttl), [MARKET_SHARED_CACHE_TTL_SECONDS]);
  assert.equal(await second.read(h, "DAILY_HISTORY"), null);
  assert.ok(s.writes[0].key.includes(sha));
  t += MARKET_SHARED_CACHE_TTL_SECONDS * 1000;
  assert.equal(await second.read(h, "DAILY_QUOTE"), null);
  await assert.rejects(() => first.read("not-a-key", "DAILY_QUOTE"), /INVALID_CACHE_KEY/);
});

test("production shared cache cannot turn on under other environments or long-term persistence", () => {
  for (const change of [
    { SYNTRAKE_MARKET_SHARED_CACHE: "disabled" },
    { SYNTRAKE_MARKET_PERSISTENCE: "enabled" },
    { SYNTRAKE_MARKET_APPROVED_SHA: "b".repeat(40) },
    { VERCEL_ENV: "development" },
  ]) {
    assert.throws(() => createVercelRuntimeMarketCache({
      env: { ...env, ...change }, client: storage().client,
    }), /MARKET_SHARED_CACHE_DISABLED/);
  }
});

test("different server instances reuse exact same real-provider-shaped quote and history", async () => {
  const store = storage();
  let timeSeriesCalls = 0;
  const transport = async (url: string): Promise<Response> => {
    const request = new URL(url);
    if (request.pathname === "/symbol_search") {
      return Response.json({ status: "ok", data: [{
        symbol: "MSFT", instrument_name: "Microsoft Corporation",
        mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock",
      }] });
    }
    assert.equal(request.pathname, "/time_series");
    timeSeriesCalls++;
    return Response.json({
      status: "ok",
      meta: {
        symbol: "MSFT", interval: "1day", currency: "USD",
        type: "Common Stock", exchange_timezone: "America/New_York", mic_code: "XNGS",
      },
      values: [{datetime: "2026-11-09", open:"99", high:"105", low:"95", close:"104", volume:"900"}],
    });
  };
  const clock = () => now;
  const a = createDynamicMarketGateway({
    env, transport, clock,
    sharedCache: createVercelRuntimeMarketCache({ env, clock, client: store.client }),
  });
  const b = createDynamicMarketGateway({
    env, transport, clock,
    sharedCache: createVercelRuntimeMarketCache({ env, clock, client: store.client }),
  });
  const selected = (await a.discover("Microsoft"))[0];
  const quoteA = await a.quoteToken(selected.token);
  const quoteB = await b.quoteToken(selected.token);
  assert.equal(quoteA.source, "PROVIDER");
  assert.equal(quoteB.source, "SHARED_CACHE");
  assert.equal(quoteB.providerCalls, 0);
  assert.equal(quoteB.price, "104");
  assert.equal(timeSeriesCalls, 1);

  const historyA = await a.historyToken(selected.token, "2026-11-04", "2026-11-10");
  const historyB = await b.historyToken(selected.token, "2026-11-04", "2026-11-10");
  assert.equal(historyA.source, "PROVIDER");
  assert.equal(historyB.source, "SHARED_CACHE");
  assert.equal(historyB.providerCalls, 0);
  assert.equal(historyB.candles.length, 1);
  assert.equal(timeSeriesCalls, 2);
});

test("Runtime Cache outage is a cache miss; supplier output remains the only source", async () => {
  const offline = {
    async get(_key: string): Promise<unknown> { throw new Error("CACHE_OFFLINE"); },
    async set(_key: string, _value: unknown, _opts: {ttl:number}): Promise<void> { throw new Error("CACHE_OFFLINE"); },
  };
  const c = createVercelRuntimeMarketCache({ env, client: offline, clock: () => now });
  assert.equal(await c.read(h, "DAILY_QUOTE"), null);
  await c.write(h, "DAILY_QUOTE", { price: "123" });
});
