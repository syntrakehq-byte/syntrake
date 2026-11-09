import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { createDynamicMarketGateway } from "../dynamicMarketGateway";
import { createPostgresSharedMarketCache, isSharedMarketCacheConfigured } from "../pgSharedMarketCache";

const sha="f".repeat(40);
const env = {
  VERCEL_ENV:"preview",
  G3G_DEPLOYMENT_REF:"feat/g3g-preview-hosted-worker-20261108",
  G3G_DEPLOYMENT_SHA:sha,
  G3G_APPROVED_SHA:sha,
  G3G_WORKER_MODE:"disabled",
  G3G_SHARED_CACHE_MODE:"enabled",
  G3G_SHARED_CACHE_RIGHTS_POLICY_ID:"c3000000-0000-4000-8000-000000000003",
  MARKET_DATA_READER_DATABASE_URL:"postgres://unused",
  G3G_INGEST_DATABASE_URL:"postgres://unused",
  MARKET_DATA_READER_CA_PEM:"-----BEGIN CERTIFICATE-----",
  VERCEL_GIT_COMMIT_REF:"feat/g3g-preview-hosted-worker-20261108",
  VERCEL_GIT_COMMIT_SHA:sha,
  SYNTRAKE_G3_PROVIDER_ENABLED:"disabled",
  SYNTRAKE_R3E1_APPROVED_SHA:sha,
  SYNTRAKE_R3E1_APPROVED_ENV:"preview",
  SYNTRAKE_R3E1_REAL_CALL_ENABLED:"confirm-once",
  SYNTRAKE_R3E1_REHEARSAL_LICENSE_CONFIRMED:"confirm-query-no-display",
  SYNTRAKE_TWELVE_DATA_API_KEY:"fake_test_0123456789abcdefghijklmnopqrstuvwxyz",
};
const key="a".repeat(64);

test("shared cache fails closed unless Preview, writer and policy are configured",()=>{
  assert.equal(isSharedMarketCacheConfigured(env),true);
  for(const changes of [
    {VERCEL_ENV:"production"},
    {G3G_APPROVED_SHA:"0".repeat(40)},
    {G3G_SHARED_CACHE_MODE:"disabled"},
    {G3G_INGEST_DATABASE_URL:undefined},
    {G3G_SHARED_CACHE_RIGHTS_POLICY_ID:"not-a-uuid"},
    {G3G_WORKER_MODE:"enabled"},
  ]) {
    const invalid={...env,...changes};
    assert.equal(isSharedMarketCacheConfigured(invalid),false);
    assert.throws(()=>createPostgresSharedMarketCache({env:invalid}),/SHARED_CACHE_NOT_CONFIGURED/);
  }
});

test("cache PostgreSQL reader and writer use distinct locked roles and bind all values",async()=>{
  const roles:string[]=[];
  let saved:unknown=null;
  const mk=(kind:"reader"|"ingest"):Client=>({
    connect:async()=>{},
    end:async()=>{},
    query:async(sql:string,values?:unknown[])=>{
      if(sql.startsWith("SET ROLE")) {roles.push(kind+":"+sql);return{rows:[],rowCount:0};}
      if(sql.startsWith("DELETE")) return {rows:[],rowCount:0};
      if(sql.startsWith("INSERT")) {
        assert.equal(kind,"ingest");
        assert.deepEqual(values?.slice(0,3),[key,"DAILY_QUOTE",env.G3G_SHARED_CACHE_RIGHTS_POLICY_ID]);
        saved=JSON.parse(values?.[3] as string);
        return {rows:[{cache_key:key}],rowCount:1};
      }
      assert.equal(kind,"reader");
      assert.ok(sql.includes("lp.cache_allowed=true"));
      assert.deepEqual(values,[key,"DAILY_QUOTE",env.G3G_SHARED_CACHE_RIGHTS_POLICY_ID]);
      return {rows:saved===null?[]:[{payload:saved}],rowCount:saved===null?0:1};
    }
  }) as unknown as Client;
  const cache=createPostgresSharedMarketCache({env,clientFactory:(_env,kind)=>mk(kind)});
  assert.equal(await cache.read(key,"DAILY_QUOTE"),null);
  await cache.write(key,"DAILY_QUOTE",{status:"AVAILABLE",price:"100.25"});
  assert.deepEqual(await cache.read(key,"DAILY_QUOTE"),{status:"AVAILABLE",price:"100.25"});
  assert.deepEqual(roles,[
    "reader:SET ROLE market_core_reader",
    "ingest:SET ROLE market_core_cache",
    "reader:SET ROLE market_core_reader",
  ]);
  await assert.rejects(cache.read("not-a-hash","DAILY_QUOTE"),/INVALID_KEY/);
});

test("two independent Market Core instances reuse the same validated quote and history",async()=>{
  const stored=new Map<string,unknown>();
  const cache={
    read:async(key:string)=>stored.get(key)??null,
    write:async(key:string,_kind:string,v:unknown)=>{stored.set(key,v);},
  };
  const counts={discover:0,quote:0,history:0};
  const transport=async(url:string):Promise<Response>=>{
    const u=new URL(url);
    if(u.pathname==="/symbol_search"){
      counts.discover++;
      return Response.json({status:"ok",data:[{symbol:"MSFT",instrument_name:"Microsoft Corporation",mic_code:"XNGS",instrument_type:"Common Stock",currency:"USD"}]});
    }
    if(u.searchParams.get("start_date")) counts.history++; else counts.quote++;
    return Response.json({status:"ok",meta:{symbol:"MSFT",interval:"1day",currency:"USD",type:"Common Stock",exchange_timezone:"America/New_York",mic_code:"XNGS"},values:[
      {datetime:"2026-11-06",open:"100",high:"106",low:"99",close:"105",volume:"120"}
    ]});
  };
  const make=()=>createDynamicMarketGateway({env,transport,sharedCache:cache,clock:()=>new Date("2026-11-09T19:00:00Z")});
  const one=make();
  const hits=await one.discover("Microsoft");
  assert.equal(hits[0].symbol,"MSFT");
  const first=await one.quoteToken(hits[0].token);
  assert.equal(first.source,"PROVIDER");
  const second=await make().quoteToken(hits[0].token);
  assert.equal(second.source,"SHARED_CACHE");
  assert.equal(second.providerCalls,0);
  assert.equal(second.price,first.price);
  assert.equal(counts.quote,1);
  const history=await one.historyToken(hits[0].token,"2026-11-02","2026-11-09");
  assert.equal(history.source,"PROVIDER");
  const reused=await make().historyToken(hits[0].token,"2026-11-02","2026-11-09");
  assert.equal(reused.source,"SHARED_CACHE");
  assert.equal(reused.providerCalls,0);
  assert.equal(reused.candles[0].close,"105");
  assert.equal(counts.history,1);
  assert.equal(stored.size,2);
});

test("corrupt shared cache is ignored and never returned as a financial price",async()=>{
  let network=0;
  const cache={
    read:async()=>({status:"AVAILABLE",price:"99999",provider:"UNKNOWN",marketDate:"evil"}),
    write:async()=>{},
  };
  const transport=async(url:string):Promise<Response>=>{
    const u=new URL(url);
    if(u.pathname==="/symbol_search") return Response.json({status:"ok",data:[{
      symbol:"AAPL",instrument_name:"Apple Inc",mic_code:"XNGS",instrument_type:"Common Stock",currency:"USD",
    }]});
    network++;
    return Response.json({status:"ok",meta:{
      symbol:"AAPL",interval:"1day",currency:"USD",type:"Common Stock",exchange_timezone:"America/New_York",mic_code:"XNGS",
    },values:[{datetime:"2026-11-06",open:"10",high:"12",low:"9",close:"11",volume:"1"}]});
  };
  const core=createDynamicMarketGateway({env,transport,sharedCache:cache,clock:()=>new Date("2026-11-09T19:00:00Z")});
  const found=await core.discover("Apple");
  const quote=await core.quoteToken(found[0].token);
  assert.equal(quote.price,"11");
  assert.equal(quote.source,"PROVIDER");
  assert.equal(network,1);
});
