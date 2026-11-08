import test from "node:test";
import assert from "node:assert/strict";
import { instrumentIdentity } from "../identity";
import { createSharedMarketGateway, isSharedMarketDataPreviewEnabled, resolveSharedMarketDemand } from "../sharedMarketServer";
import type { MarketDataDemand } from "../onDemandMarketData";
import type { MarketDataResult } from "../contracts";
import type { Client } from "pg";

const sha = "a".repeat(40);
const listingId = "c3000000-0000-4000-8000-000000000002";
const instrumentId = "c3000000-0000-4000-8000-000000000001";
const policyId = "c3000000-0000-4000-8000-000000000003";
const env = Object.freeze({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3g-preview-hosted-worker-20261108",
  VERCEL_GIT_COMMIT_SHA: sha,
  G3G_APPROVED_SHA: sha,
  G3G_ON_DEMAND_MODE: "enabled",
  G3G_WORKER_MODE: "disabled",
  SYNTRAKE_G3_PROVIDER_ENABLED: "disabled",
  G3G_ON_DEMAND_RIGHTS_POLICY_ID: policyId,
});
const actor = { userId: "user_test", sessionId: "session_test" };
const registry = {
  listing_id: listingId, instrument_id: instrumentId, ticker: "AAPL",
  mic: "XNGS", trading_currency: "USD", asset_class: "EQUITY",
  rights_policy_id: policyId, display_allowed: true, cache_allowed: true,
  retention_until: null,
};
const identity = { ...instrumentIdentity({kind:"EQUITY",symbol:"AAPL",mic:"XNGS",currency:"USD"}),
  key:"instrument:"+instrumentId+":listing:"+listingId, instrumentId, listingId };
const demand: MarketDataDemand = {
  instrument: identity, rightsPolicyId: policyId, requiresDisplay: true,
  interval: "1day", adjustment: "none", maxAgeMs: 300000,
};
const now = new Date("2026-11-06T16:00:00Z");
const data: MarketDataResult = {
  instrument: identity, listingRef: listingId, sourceRefs: [
    { provider:"SYNTHETIC_FIXTURE_ONLY",originalSourceId:"fixture:c3",requestId:null,sourceDocumentUri:null },
  ],
  revisionId:"synthetic-fixture",price:"106.00",currency:"USD",marketDate:"2026-11-06",
  asOf:"2026-11-06T15:59:00Z",interval:"1day",adjustment:"none",
  quality:{coverage:"FULL",freshness:"KNOWN"},
  rights:{policyId,display:true,retentionUntil:null},
};

test("shared market endpoint accepts only exact Preview SHA and on-demand mode, never Production", () => {
  assert.equal(isSharedMarketDataPreviewEnabled(env), true);
  for (const changes of [
    {VERCEL_ENV:"production"},{VERCEL_GIT_COMMIT_REF:"main"},
    {G3G_APPROVED_SHA:"b".repeat(40)},{G3G_ON_DEMAND_MODE:"disabled"},
    {G3G_WORKER_MODE:"enabled"},{VERCEL_GIT_COMMIT_SHA:undefined},
  ]) assert.equal(isSharedMarketDataPreviewEnabled({...env,...changes}),false);
});

test("a single server registry lookup resolves the verified listing and licensed policy", async () => {
  let calls = 0;
  const withClient = async <T>(_env: typeof env, operation:(client:Client)=>Promise<T>):Promise<T> => {
    const fake = {query:async (_sql:string, values:unknown[])=>{
      calls++;
      assert.deepEqual(values,[listingId,policyId]);
      return {rows:[registry]};
    }} as unknown as Client;
    return operation(fake);
  };
  const result = await resolveSharedMarketDemand(listingId,actor,env,withClient);
  assert.equal(calls,1);
  assert.equal(result?.instrument.key, identity.key);
  assert.equal(result?.rightsPolicyId,policyId);
  assert.equal(result?.requiresDisplay,true);
});

test("missing or expired registry rights fail closed before any provider request",async()=>{
  let lookedUp = 0;
  const withClient = async <T>(_env: typeof env, operation:(client:Client)=>Promise<T>):Promise<T> =>
    operation({query:async()=>{
      lookedUp++;
      return {rows:[{...registry,display_allowed:false}]};
    }} as unknown as Client);
  assert.equal(await resolveSharedMarketDemand(listingId,actor,env,withClient),null);
  assert.equal(lookedUp,1);
  assert.equal(await resolveSharedMarketDemand("malicious",actor,env,withClient),null);
  assert.equal(lookedUp,1);
  assert.equal(await resolveSharedMarketDemand(listingId,actor,{...env,G3G_ON_DEMAND_MODE:"disabled"},withClient),null);
  assert.equal(lookedUp,1);
});

test("the shared server gateway answers from validated cache without a provider call",async()=>{
  let sources=0;
  const gateway=createSharedMarketGateway(actor,env,{
    readCached:async()=>data,fetchAuthorized:async()=>{sources++;return null;},
    clock:()=>now,
  });
  const result=await gateway.request(demand);
  assert.equal(result.status,"AVAILABLE");
  assert.equal(result.source,"CACHE");
  assert.equal(result.data?.price,"106.00");
  assert.equal(sources,0);
});

test("the unapproved source fails closed on cache miss: no fake fallback price",async()=>{
  const gateway=createSharedMarketGateway(actor,env,{
    readCached:async()=>null,clock:()=>now,
  });
  const result=await gateway.request(demand);
  assert.deepEqual(result,{status:"UNAVAILABLE",source:"NONE",data:null});
});
