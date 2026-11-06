import test from "node:test";
import assert from "node:assert/strict";
import { isG3PreviewProviderReady, isR3AProviderReady } from "../gate";
import { fetchDailySeries } from "../twelveData";
import { instrumentIdentity, MarketDataError } from "../identity";

const SHA = "f".repeat(40);
const key = "G3_PREVIEW_TEST_KEY_OFFLINE_ONLY_123";
const env = Object.freeze({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3e-integrated-rehearsal-20261106",
  VERCEL_GIT_COMMIT_SHA: SHA,
  SYNTRAKE_G3_APPROVED_SHA: SHA,
  SYNTRAKE_G3_PROVIDER_ENABLED: "enabled",
  SYNTRAKE_G3_LICENSE_SCOPE: "internal-non-display",
  SYNTRAKE_TWELVE_DATA_API_KEY: key,
});
const instrument = instrumentIdentity({ kind: "EQUITY", symbol: "AAPL", mic: "XNAS", currency: "USD" });

test("G3 provider gate fails closed in Production, wrong branch/SHA, unverified rights and absent key", () => {
  assert.equal(isG3PreviewProviderReady(env), true);
  const missing: ReadonlyArray<Readonly<Record<string, string | undefined>>> = [
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL_GIT_COMMIT_REF: "main" }, { VERCEL_GIT_COMMIT_REF: "feat/other" },
    { VERCEL_GIT_COMMIT_SHA: "e".repeat(40) },
    { SYNTRAKE_G3_APPROVED_SHA: undefined }, { SYNTRAKE_G3_APPROVED_SHA: "e".repeat(40) },
    { SYNTRAKE_G3_PROVIDER_ENABLED: "disabled" },
    { SYNTRAKE_G3_LICENSE_SCOPE: undefined },
    { SYNTRAKE_G3_LICENSE_SCOPE: "commercial-display" },
    { SYNTRAKE_TWELVE_DATA_API_KEY: undefined }, { SYNTRAKE_TWELVE_DATA_API_KEY: "weak" },
  ];
  for (const delta of missing) {
    assert.equal(isG3PreviewProviderReady({ ...env, ...delta }), false, JSON.stringify(delta));
  }
  assert.equal(isG3PreviewProviderReady({}), false);
  assert.equal(isR3AProviderReady(env), false, "R3A old branch must remain separately gated");
});

test("G3 refuses HTTP before opt-in and executes exactly one injected provider call after approval", async () => {
  let count = 0;
  const transport = async (url: string, init: RequestInit) => {
    count++;
    assert.equal(new URL(url).host, "api.twelvedata.com");
    assert.equal(new URL(url).searchParams.has("apikey"), false);
    assert.equal(new Headers(init.headers).get("Authorization"), "apikey " + key);
    return new Response(JSON.stringify({
      status: "ok",
      meta: { symbol: "AAPL", interval: "1day", currency: "USD",
        exchange_timezone: "America/New_York", mic_code: "XNAS", type: "Common Stock" },
      values: [{ datetime: "2026-11-05", open: "100.00", high: "110.00", low: "90.00", close: "105.00", volume: "10" }],
    }), { status: 200 });
  };
  await assert.rejects(
    fetchDailySeries({ env: { ...env, SYNTRAKE_G3_LICENSE_SCOPE: undefined }, instrument, outputSize: 1, transport }),
    (error: unknown) => error instanceof MarketDataError && error.code === "DISABLED"
  );
  assert.equal(count, 0, "an unapproved G3 call cannot reach the provider");
  const result = await fetchDailySeries({ env, instrument, outputSize: 1, transport,
    clock: () => new Date("2026-11-06T15:00:00Z"),
    rights: { policyId: "test-internal-non-display", display: false, retentionUntil: null } });
  assert.equal(count, 1);
  assert.equal(result.provider, "TWELVE_DATA");
  assert.equal(result.envelope.rights.display, false);
  assert.equal(result.candles[0]?.close, "105.00");
  assert.equal(result.latency, "NOT_VERIFIED", "a daily candle must never be labelled realtime");
});
