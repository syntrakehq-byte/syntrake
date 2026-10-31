import test from "node:test";
import assert from "node:assert/strict";
import { instrumentIdentity, MarketDataError } from "../identity";
import { isR3AProviderReady } from "../gate";
import { decideRefresh } from "../refreshPolicy";
import { fetchDailySeries } from "../twelveData";

const SHA = "a".repeat(40);
const approved = {
  VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/r3-market-data-core-20261030",
  VERCEL_GIT_COMMIT_SHA: SHA, SYNTRAKE_R3_PREVIEW_APPROVED_SHA: SHA,
  SYNTRAKE_R3_PROVIDER_ENABLED: "enabled", SYNTRAKE_TWELVE_DATA_API_KEY: "PRIVATE_TEST_ONLY_123456789",
};
const aapl = instrumentIdentity({ kind: "EQUITY", symbol: "AAPL", mic: "XNAS", currency: "USD" });
const meta = {
  symbol: "AAPL", interval: "1day", currency: "USD", exchange_timezone: "America/New_York",
  exchange: "NASDAQ", mic_code: "XNAS", type: "Common Stock",
};
const values = [
  { datetime: "2026-10-29", open: "120.01", high: "125.09", low: "119.99", close: "124.00", volume: "421002" },
  { datetime: "2026-10-28", open: "118.01", high: "121.00", low: "117.50", close: "120.01", volume: "522000" },
];
const ok = (body: unknown) => new Response(JSON.stringify(body), {status:200, headers:{"Content-Type":"application/json"}});
const captured: string[] = [];
const transport = async (url: string, opts: RequestInit) => {
  captured.push(url);
  assert.equal(opts.method, "GET");
  assert.equal(opts.cache, "no-store");
  assert.equal(opts.redirect, "error");
  return ok({status:"ok",meta,values});
};
function failure(action: () => unknown, code: string) {
  assert.throws(action, (e: unknown) => e instanceof MarketDataError && e.code === code);
}
async function asyncFailure(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (e: unknown) => e instanceof MarketDataError && e.code === code);
}

test("instrument identity is exchange+type+currency+symbol scoped, FX direction explicit", () => {
  const other = instrumentIdentity({kind:"EQUITY", symbol:"AAPL", mic:"XETR", currency:"EUR"});
  assert.notEqual(aapl.key, other.key);
  assert.equal(instrumentIdentity({kind:"ETF",symbol:"SPY",mic:"ARCX",currency:"USD"}).kind,"ETF");
  assert.equal(instrumentIdentity({kind:"FX",symbol:"EUR/USD",currency:"USD"}).key,"FX:FX:EUR/USD:USD");
  assert.notEqual(instrumentIdentity({kind:"FX",symbol:"USD/EUR",currency:"EUR"}).key,
    instrumentIdentity({kind:"FX",symbol:"EUR/USD",currency:"USD"}).key);
  for(const v of [
    {kind:"EQUITY",symbol:"AAPL",currency:"USD"},
    {kind:"EQUITY",symbol:"AAPL",mic:"XNAS",currency:"USD",id:"client-created"},
    {kind:"EQUITY",symbol:"AAPL&apikey=BAD",mic:"XNAS",currency:"USD"},
    {kind:"EQUITY",symbol:"aapl",mic:"XNAS",currency:"USD"},
    {kind:"FX",symbol:"EUR/USD",currency:"EUR"},
    {kind:"FX",symbol:"EUR/USD",mic:"XNAS",currency:"USD"},
    {kind:"FX",symbol:"EUR/EUR",currency:"EUR"},
  ]) failure(()=>instrumentIdentity(v),"INVALID_INSTRUMENT");
});

test("R3A preview gate is exact SHA, branch and opt-in; NEVER production", () => {
  assert.equal(isR3AProviderReady(approved),true);
  for(const delta of [
    {VERCEL_ENV:"production"},{VERCEL_ENV:"development"},{VERCEL_ENV:undefined},
    {VERCEL_GIT_COMMIT_REF:"main"},{VERCEL_GIT_COMMIT_REF:"feat/r3-other"},
    {VERCEL_GIT_COMMIT_SHA:"b".repeat(40)},
    {SYNTRAKE_R3_PREVIEW_APPROVED_SHA:undefined},
    {SYNTRAKE_R3_PROVIDER_ENABLED:"disabled"},
    {SYNTRAKE_TWELVE_DATA_API_KEY:undefined},
    {SYNTRAKE_TWELVE_DATA_API_KEY:"short"},
  ]) assert.equal(isR3AProviderReady({...approved,...delta}),false,JSON.stringify(delta));
  assert.equal(isR3AProviderReady({}),false);
});

test("no provider call without exact R3 authorization; invalid client identity fails before HTTP",async()=>{
  let count=0;
  const fetcher=async()=>{count++;return ok({status:"ok",meta,values});};
  await asyncFailure(()=>fetchDailySeries({env:{},instrument:aapl,outputSize:2,transport:fetcher}),"DISABLED");
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:{...aapl,key:"client-overridden"},outputSize:2,transport:fetcher}),"INVALID_REQUEST");
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:1001,transport:fetcher}),"INVALID_REQUEST");
  assert.equal(count,0);
});

test("daily candles have exact string price, exchange date, UTC ingestion time; no implied realtime or valuation",async()=>{
  captured.length=0;
  const out=await fetchDailySeries({env:approved,instrument:aapl,outputSize:2,transport,clock:()=>new Date("2026-10-30T19:05:01Z")});
  assert.equal(out.instrument.key,aapl.key);
  assert.equal(out.candles.length,2);
  assert.deepEqual(out.candles.map(x=>x.marketDate),["2026-10-28","2026-10-29"]);
  assert.equal(out.candles[1].close,"124.00");
  assert.equal(out.candles[0].volume,"522000");
  assert.equal(out.observedAtUtc,"2026-10-30T19:05:01.000Z");
  assert.equal(out.exchangeTimezone,"America/New_York");
  assert.equal(out.latency,"NOT_VERIFIED");
  assert.equal(out.adjustment,"none");
  assert.equal(out.evidence,"PROVIDER_RESPONSE");
  assert.equal(Object.prototype.hasOwnProperty.call(out,"portfolioValue"),false);
  assert.equal(captured.length,1);
  const u=new URL(captured[0]);
  assert.equal(u.origin,"https://api.twelvedata.com");
  assert.equal(u.pathname,"/time_series");
  assert.equal(u.searchParams.get("symbol"),"AAPL");
  assert.equal(u.searchParams.get("mic_code"),"XNAS");
  assert.equal(u.searchParams.get("interval"),"1day");
  assert.equal(u.searchParams.get("adjust"),"none");
  assert.equal(u.searchParams.has("apikey"),false);
});

test("malformed and inconsistent provider data fail closed, never use last good/zeros",async()=>{
  const candidates: unknown[] = [
    {}, {status:"error",code:400,message:"bad"}, {status:"ok",meta,values:[]},
    {status:"ok",meta:{...meta,symbol:"AAPL2"},values},
    {status:"ok",meta:{...meta,interval:"1min"},values},
    {status:"ok",meta:{...meta,mic_code:"XNYS"},values},
    {status:"ok",meta:{...meta,currency:"EUR"},values},
    {status:"ok",meta:{...meta,type:"ETF"},values},
    {status:"ok",meta:{...meta,exchange_timezone:"Unknown/Unknown"},values},
    {status:"ok",meta,values:[values[0],values[0]]},
    {status:"ok",meta,values:[values[1],values[0]]},
    {status:"ok",meta,values:[{...values[0],datetime:"2026-02-30"}]},
    {status:"ok",meta,values:[{...values[0],close:"NaN"}]},
    {status:"ok",meta,values:[{...values[0],close:"124e5"}]},
    {status:"ok",meta,values:[{...values[0],close:"0.00"}]},
    {status:"ok",meta,values:[{...values[0],high:"100"}]},
    {status:"ok",meta,values:[{...values[0],low:"130"}]},
    {status:"ok",meta,values:[{...values[0],volume:"-15"}]},
  ];
  for(let i=0;i<candidates.length;i++){
    const current=candidates[i];
    await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:2,
      transport:async()=>ok(current)}), i===1?"PROVIDER_REJECTED":"INVALID_PROVIDER_RESPONSE");
  }
});

test("provider HTTP errors and 200-encoded rate limits are sanitized, no automatic retry",async()=>{
  const statuses=[401,403,429,500,503];
  let calls=0;
  for(const status of statuses){
    const req=()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:2,transport:async()=>{
      calls++; return new Response("provider SECRET api key?",{status,headers:{"retry-after":"25"}});
    }});
    await assert.rejects(req,e=>{
      if(!(e instanceof MarketDataError))return false;
      assert.equal(e.code,status===429?"RATE_LIMITED":status===401||status===403?"PROVIDER_REJECTED":"PROVIDER_UNAVAILABLE");
      assert.ok(!e.message.includes(approved.SYNTRAKE_TWELVE_DATA_API_KEY!));
      if(status===429) assert.equal(e.retryAfterSeconds,25);
      return true;
    });
  }
  assert.equal(calls,statuses.length);
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:2,transport:async()=>ok({status:"error",code:429,message:"Quota reached"})}),"RATE_LIMITED");
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:2,transport:async()=>ok({status:"error",code:"429",message:"Quota reached"})}),"RATE_LIMITED");
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:1,transport}),"INVALID_PROVIDER_RESPONSE");
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:2,transport:async()=>{throw new Error("SECRET TEST KEY");}}),"PROVIDER_UNAVAILABLE");
  await asyncFailure(()=>fetchDailySeries({env:approved,instrument:aapl,outputSize:2,transport:async()=>new Response("not-json",{status:200})}),"INVALID_PROVIDER_RESPONSE");
});

test("FX base and quote stay explicit, with no financial conversion or false volume",async()=>{
  const fx=instrumentIdentity({kind:"FX",symbol:"EUR/USD",currency:"USD"});
  const response={status:"ok",meta:{symbol:"EUR/USD",interval:"1day",currency:"USD",exchange_timezone:"UTC",type:"Physical Currency"},values:[{
    datetime:"2026-10-29",open:"1.10",high:"1.12",low:"1.09",close:"1.11",
  }]};
  const out=await fetchDailySeries({env:approved,instrument:fx,outputSize:1,transport:async(u)=>{
    assert.equal(new URL(u).searchParams.has("mic_code"),false);return ok(response);
  }});
  assert.equal(out.candles[0].volume,null);
  assert.equal(out.instrument.symbol,"EUR/USD");
});

test("refresh is pure and conservative; durable reserve is a separate R3-B gate",()=>{
  const p={enabled:true,nowMs:100_000,lastIngestMs:null,maxAgeMs:60_000,retryNotBeforeMs:null,remainingCredits:1,costCredits:1};
  assert.deepEqual(decideRefresh(p),{state:"FETCH",costCredits:1});
  assert.equal(decideRefresh({...p,enabled:false}).state,"DISABLED");
  assert.equal(decideRefresh({...p,remainingCredits:0}).state,"BUDGET_EXHAUSTED");
  assert.equal(decideRefresh({...p,retryNotBeforeMs:200_000}).state,"BACKOFF");
  assert.equal(decideRefresh({...p,lastIngestMs:99_999}).state,"FRESH");
  assert.equal(decideRefresh({...p,lastIngestMs:40_000}).state,"FETCH");
  failure(()=>decideRefresh({...p,remainingCredits:-1}),"INVALID_REQUEST");
  failure(()=>decideRefresh({...p,lastIngestMs:200_000}),"INVALID_REQUEST");
});
