import test from "node:test";
import assert from "node:assert/strict";
import { canonicalIdentity, resolveProviderAlias } from "../identity";
import { runTwelveDataRealOnce } from "../realTwelveDataOnce";
import { fetchDailySeries } from "../twelveData";

const base = { VERCEL_ENV:"preview", VERCEL_GIT_COMMIT_SHA:"b".repeat(40), SYNTRAKE_R3E1_REAL_CALL_ENABLED:"confirm-once", SYNTRAKE_R3E1_APPROVED_SHA:"b".repeat(40), SYNTRAKE_R3E1_APPROVED_ENV:"preview", SYNTRAKE_TWELVE_DATA_API_KEY:"offline-key-123456" };
const checkoutSha = "b".repeat(40);
const instrument = canonicalIdentity({ instrument:{instrumentId:"91000000-0000-0000-0000-000000000001",issuerId:"91000000-0000-0000-0000-000000000002",kind:"EQUITY",denominationCurrency:"USD"}, listing:{listingId:"91000000-0000-0000-0000-000000000003",instrumentId:"91000000-0000-0000-0000-000000000001",mic:"XNAS",tradingCurrency:"USD",ticker:"AAPL",validFrom:"1980-12-12",validTo:null} });
const alias = resolveProviderAlias("TWELVE_DATA","AAPL","2026-01-01",[{provider:"TWELVE_DATA",providerReference:"AAPL",instrumentId:"91000000-0000-0000-0000-000000000001",listingId:"91000000-0000-0000-0000-000000000003",validFrom:"1980-12-12",validTo:null}]);
test("R3-E1 gate is closed by default and rejects wrong SHA/env/credentials", async () => {
  for (const env of [{}, {...base, VERCEL_ENV:"production"}, {...base, SYNTRAKE_R3E1_APPROVED_SHA:"c".repeat(40)}, {...base, SYNTRAKE_TWELVE_DATA_API_KEY:"short"}]) {
    await assert.rejects(runTwelveDataRealOnce({env,checkoutSha,instrument,sourceAlias:alias,asOf:"2026-01-01"}), /DISABLED/);
  }
});
test("R3-E1 validates simulated response, headers and makes one transport call", async () => {
  let calls=0;
  const result = await runTwelveDataRealOnce({ checkoutSha, env:base, instrument, sourceAlias:alias, asOf:"2026-01-01", transport: async (_url: string, init: RequestInit) => { calls++; assert.match(String(new Headers(init.headers).get("authorization")), /^apikey /); return new Response(JSON.stringify({status:"ok",meta:{symbol:"AAPL",interval:"1day",currency:"USD",exchange_timezone:"America/New_York",type:"Common Stock",mic_code:"XNAS"},values:[{datetime:"2026-01-01",open:"100",high:"110",low:"90",close:"105.5",volume:"10"}]}),{status:200,headers:{"x-ratelimit-remaining":"99","x-ratelimit-used":"1"}}); } });
  assert.equal(result.series.candles[0].close,"105.5");
  assert.deepEqual(result.usage,{remaining:"99",used:"1"});
  assert.equal(calls,1);
  await assert.rejects(runTwelveDataRealOnce({checkoutSha,env:base,instrument,sourceAlias:alias,asOf:"2026-01-01",transport:async()=>{calls++;return new Response();}}),/INVALID_REQUEST/);
});

test("R3-E1 rejects a mismatched checkout and generic fetch has no E1 authorization path", async () => {
  let calls = 0;
  await assert.rejects(runTwelveDataRealOnce({checkoutSha:"c".repeat(40),env:base,instrument,sourceAlias:alias,asOf:"2026-01-01",transport:async()=>{calls++;return new Response();}}), /DISABLED/);
  await assert.rejects(fetchDailySeries({env:base,instrument,sourceAlias:alias,asOf:"2026-01-01",outputSize:1,transport:async()=>{calls++;return new Response();}}), /DISABLED/);
  assert.equal(calls,0);
});

test("R3-E1 simulated 401/403/429/timeout are sanitized and never retried", async () => {
  const legacyReady = {...base,SYNTRAKE_R3E1_REAL_CALL_ENABLED:undefined,VERCEL_GIT_COMMIT_REF:"feat/r3-market-data-core-20261030",SYNTRAKE_R3_PROVIDER_ENABLED:"enabled",SYNTRAKE_R3_PREVIEW_APPROVED_SHA:base.VERCEL_GIT_COMMIT_SHA};
  for (const response of [new Response("",{status:401}),new Response("",{status:403}),new Response("",{status:429})]) {
    let calls=0;
    await assert.rejects(fetchDailySeries({env:legacyReady,instrument,sourceAlias:alias,asOf:"2026-01-01",outputSize:1,transport:async()=>{calls++;return response;}}));
    assert.equal(calls,1);
  }
  let calls=0;
  await assert.rejects(fetchDailySeries({env:legacyReady,instrument,sourceAlias:alias,asOf:"2026-01-01",outputSize:1,transport:async()=>{calls++;throw new Error("secret-key");}}),/PROVIDER_UNAVAILABLE/);
  assert.equal(calls,1);
});

test("R3-E1 sanitizes adversarial credit headers to null", async () => {
  const legacyReady = {...base,SYNTRAKE_R3E1_REAL_CALL_ENABLED:undefined,VERCEL_GIT_COMMIT_REF:"feat/r3-market-data-core-20261030",SYNTRAKE_R3_PROVIDER_ENABLED:"enabled",SYNTRAKE_R3_PREVIEW_APPROVED_SHA:base.VERCEL_GIT_COMMIT_SHA};
  let usage;
  await fetchDailySeries({env:legacyReady,instrument,sourceAlias:alias,asOf:"2026-01-01",outputSize:1,onResponseHeaders: h => { usage = h; },transport:async()=>new Response(JSON.stringify({status:"ok",meta:{symbol:"AAPL",interval:"1day",currency:"USD",exchange_timezone:"America/New_York",type:"Common Stock",mic_code:"XNAS"},values:[{datetime:"2026-01-01",open:"100",high:"110",low:"90",close:"105.5",volume:"1"}]}),{status:200,headers:{"x-ratelimit-remaining":"<script>","x-ratelimit-used":"999999999999999999"}})});
  assert.deepEqual(usage,{remaining:null,used:null});
});
