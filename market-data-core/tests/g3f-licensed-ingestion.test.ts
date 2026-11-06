import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { createLicensedG3TwelveDataProvider, type StorageAttestation } from "../g3LicensedTwelveData";
import { readMarketDataForConsumer, type MarketDataResult } from "../contracts";

const sha = "b".repeat(40);
const now = new Date("2026-11-06T20:00:00Z");
const policy = "c2000000-0000-0000-0000-000000000002";
const listing = "c2000000-0000-0000-0000-000000000005";
const provider = "c2000000-0000-0000-0000-000000000001";
const instrument = "c2000000-0000-0000-0000-000000000004";
const issuer = "c2000000-0000-0000-0000-000000000003";
const claim = {
  job_id: "c2000000-0000-0000-0000-000000000007",
  demand_key: "b".repeat(64), listing_id: listing, provider_id: provider,
  rights_policy_id: policy, provider_key: "TWELVE_DATA",
  estimated_credits: "1", valid_from: "1980-12-12", valid_to: null,
};
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3e-integrated-rehearsal-20261106",
  VERCEL_GIT_COMMIT_SHA: sha,
  SYNTRAKE_G3_APPROVED_SHA: sha,
  SYNTRAKE_G3_PROVIDER_ENABLED: "enabled",
  SYNTRAKE_G3_LICENSE_SCOPE: "internal-non-display",
  SYNTRAKE_TWELVE_DATA_API_KEY: "OFFLINE_TEST_KEY_NO_NETWORK_123456",
};
const rights: StorageAttestation = {
  provider: "TWELVE_DATA", rightsPolicyId: policy, scope: "internal-non-display",
  evidenceReference: "twelvedata:contract:offline-fixture-only",
  retentionUntil: "2026-11-07T00:00:00Z",
  reviewedAt: "2026-11-06T19:00:00Z",
  purgeVerified: true,
};
const sourceRow = {
  instrument_id: instrument, issuer_id: issuer, asset_class: "EQUITY",
  denomination_currency: "USD", listing_id: listing, mic: "XNGS",
  trading_currency: "USD", ticker: "AAPL", listing_valid_from: "1980-12-12",
  listing_valid_to: null, provider_reference: "AAPL",
  alias_valid_from: "1980-12-12", alias_valid_to: null,
  cache_allowed: true, display_allowed: false, retention_until: "2026-11-07T00:00:00Z",
};
function readerFactory(rows: object[], stats: { opens: number; closes: number; queries: number }) {
  return async () => ({
    connect: async () => { stats.opens++; },
    query: async (sql: string, params?: unknown[]) => {
      stats.queries++;
      if (sql === "SET ROLE market_core_reader") return { rows: [] };
      assert.match(sql, /market_core\.provider_aliases/);
      assert.match(sql, /market_core\.license_policies/);
      assert.deepEqual(params, [provider, listing, policy, "2026-11-06"]);
      return { rows };
    },
    end: async () => { stats.closes++; },
  }) as unknown as Client;
}
function response() {
  return new Response(JSON.stringify({
    status: "ok",
    meta: { symbol: "AAPL", interval: "1day", currency: "USD",
      exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNGS" },
    values: [{ datetime: "2026-11-05", open: "100.00", high: "110.00",
      low: "90.00", close: "105.00", volume: "1000" }],
  }), { status: 200 });
}
const stats = () => ({ opens: 0, closes: 0, queries: 0 });

test("G3 F real provider fails closed before network without independent retention and purge evidence", async () => {
  for (const attestation of [
    null, { ...rights, purgeVerified: false as const },
    { ...rights, retentionUntil: "2026-11-05T00:00:00Z" },
    { ...rights, evidenceReference: "made-up" },
    { ...rights, rightsPolicyId: "d2000000-0000-0000-0000-000000000002" },
  ]) {
    const activity = stats();
    let calls = 0;
    const run = createLicensedG3TwelveDataProvider({
      env, attestation: attestation as StorageAttestation | null,
      readerFactory: readerFactory([sourceRow],activity), clock: () => now,
      transport: async () => { calls++; return response(); },
    });
    await assert.rejects(run(claim), /G3_STORAGE_RIGHTS_UNVERIFIED/);
    assert.equal(calls,0);assert.equal(activity.opens,0);
  }
});

test("G3 F disabled gate has zero queries and zero provider calls", async () => {
  const activity = stats();
  let calls = 0;
  const run = createLicensedG3TwelveDataProvider({
    env: { ...env, SYNTRAKE_G3_PROVIDER_ENABLED: "disabled" },
    attestation: rights, clock: () => now,
    readerFactory: readerFactory([sourceRow],activity),
    transport: async () => { calls++; return response(); },
  });
  await assert.rejects(run(claim),/G3_PROVIDER_DISABLED/);
  assert.equal(calls,0);assert.equal(activity.opens,0);
});

test("G3 F registry ambiguity, disabled cache, wrong retention and display permission deny provider before HTTP", async () => {
  for (const rows of [
    [], [sourceRow, sourceRow],
    [{ ...sourceRow, cache_allowed:false }],
    [{ ...sourceRow, display_allowed:true }],
    [{ ...sourceRow, retention_until:null }],
    [{ ...sourceRow, retention_until:"2026-12-01T00:00:00Z" }],
  ]) {
    let calls = 0;const activity=stats();
    const run=createLicensedG3TwelveDataProvider({
      env,attestation:rights,clock:()=>now,
      readerFactory:readerFactory(rows,activity),
      transport:async()=>{calls++;return response();},
    });
    await assert.rejects(run(claim),/G3_REGISTRY_NOT_EXACT|G3_STORAGE_RIGHTS_UNVERIFIED/);
    assert.equal(calls,0);
    assert.equal(activity.opens,1);
    assert.equal(activity.closes,1);
  }
});

test("G3 F feeds an internal Investing and Trading reader from one canonical, non-display observation",async()=>{
  let calls=0;const activity=stats();
  const run=createLicensedG3TwelveDataProvider({
    env,attestation:rights,clock:()=>now,
    readerFactory:readerFactory([sourceRow],activity),
    transport:async (url, init)=>{
      calls++;
      assert.equal(new URL(url).host, "api.twelvedata.com");
      assert.equal(new URL(url).searchParams.has("apikey"),false);
      assert.equal(new Headers(init.headers).get("Authorization"),"apikey "+env.SYNTRAKE_TWELVE_DATA_API_KEY);
      return response();
    },
  });
  const envelope=await run(claim) as {
    status:"AVAILABLE";value:readonly {marketDate:string;close:string}[];
    rights:{policyId:string;display:boolean;retentionUntil:string};
    sourceRefs:readonly {provider:string;originalSourceId:string;requestId:null;sourceDocumentUri:null}[];
    asKnownAt:string;revisionId:string;
  };
  assert.equal(calls,1);
  assert.equal(activity.opens,1);assert.equal(activity.closes,1);
  assert.equal(envelope.status,"AVAILABLE");
  assert.equal(envelope.value[0].close,"105.00");
  assert.equal(envelope.rights.policyId,policy);
  assert.equal(envelope.rights.display,false);
  assert.equal(envelope.rights.retentionUntil,rights.retentionUntil);
  const data: MarketDataResult = {
    instrument: { kind:"EQUITY",symbol:"AAPL",mic:"XNGS",currency:"USD",
      key:"instrument:"+instrument+":listing:"+listing,instrumentId:instrument,listingId:listing },
    listingRef:listing,revisionId:envelope.revisionId,price:envelope.value[0].close,
    sourceRefs:envelope.sourceRefs,currency:"USD",marketDate:envelope.value[0].marketDate,
    asOf:envelope.asKnownAt,quality:{coverage:"FULL",freshness:"UNKNOWN"},
    rights: {policyId:policy,display:false,retentionUntil:rights.retentionUntil},
    interval:"1day",adjustment:"none",
  };
  const investing=readMarketDataForConsumer(data,{rightsPolicyId:policy,requiresDisplay:false,interval:"1day"},now);
  const trading=readMarketDataForConsumer(data,{rightsPolicyId:policy,requiresDisplay:false,interval:"1day"},now);
  assert.strictEqual(investing,data);
  assert.strictEqual(trading,data);
  assert.strictEqual(investing,trading);
  assert.equal(calls,1,"Both cores use the same market-data payload; no second provider call");
  assert.equal(readMarketDataForConsumer(data,{rightsPolicyId:policy,requiresDisplay:true,interval:"1day"},now),null);
  assert.equal(readMarketDataForConsumer(data,{rightsPolicyId:policy,requiresDisplay:false,interval:"1min"},now),null);
  assert.equal(readMarketDataForConsumer(data,{rightsPolicyId:policy,requiresDisplay:false,interval:"1day"},new Date("2026-11-07T00:00:00Z")),null,"Neither core may use prices after license expiry");
});
