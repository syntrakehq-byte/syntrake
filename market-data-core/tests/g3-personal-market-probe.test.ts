import test from "node:test";
import assert from "node:assert/strict";
import { runPersonalMarketProbe } from "../personalMarketProbe";
import type { fetchDailySeriesR3E1Once } from "../twelveData";

const SHA = "1f419cf831a306ede9cdc42b5cb1efea619d307e";
const enabled = {
  VERCEL_ENV: "preview",
  G3G_DEPLOYMENT_REF: "feat/g3g-preview-hosted-worker-20261108",
  G3G_DEPLOYMENT_SHA: SHA,
  G3G_APPROVED_SHA: SHA,
  G3G_WORKER_MODE: "disabled",
  SYNTRAKE_G3_PROVIDER_ENABLED: "disabled",
  SYNTRAKE_R3E1_REHEARSAL_LICENSE_CONFIRMED: "confirm-query-no-display",
  SYNTRAKE_R3E1_APPROVED_SHA: SHA,
  SYNTRAKE_R3E1_REAL_CALL_ENABLED: "confirm-once",
};
type Fetch = typeof fetchDailySeriesR3E1Once;

test("G3 personal Preview probe refuses blocked modes before any provider call", async () => {
  let calls = 0;
  const fake = (async () => { calls++; throw new Error("NOT_EXPECTED"); }) as Fetch;
  await assert.rejects(runPersonalMarketProbe({ ...enabled, G3G_WORKER_MODE: "enabled" }, fake));
  await assert.rejects(runPersonalMarketProbe({ ...enabled, SYNTRAKE_R3E1_APPROVED_SHA: "0".repeat(40) }, fake));
  await assert.rejects(runPersonalMarketProbe({ ...enabled, VERCEL_ENV: "production" }, fake));
  assert.equal(calls, 0);
});

test("G3 personal Preview probe checks a single real-parser result without displaying or storing", async () => {
  let calls = 0;
  const fake = (async (input: Parameters<Fetch>[0]) => {
    calls++;
    assert.equal(input.outputSize, 1);
    assert.equal(input.instrument.symbol, "AAPL");
    assert.equal(input.instrument.mic, "XNGS");
    assert.equal(input.rights?.display, false);
    return {
      provider: "TWELVE_DATA",
      candles: [{marketDate:"2026-11-09",open:"1",high:"1",low:"1",close:"1",volume:"1"}],
    } as unknown as Awaited<ReturnType<Fetch>>;
  }) as Fetch;
  const result = await runPersonalMarketProbe(enabled, fake);
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: "PROVIDER_VALIDATED",
    provider: "TWELVE_DATA",
    symbol: "AAPL", mic: "XNGS", currency: "USD",
    marketDate: "2026-11-09", observationCount: 1, providerCalls: 1,
    persisted: false, displayed: false,
  });
});
