import test from "node:test";
import assert from "node:assert/strict";
import {handleMachineMarketCore} from "../machineMarketCore";
import type { DynamicMarketQuote, DynamicMarketHistory, DynamicMarketCandidate } from "../dynamicMarketGateway";
import type { MarketConsumerInstrument } from "../consumerMarketService";

const sha="e".repeat(40),token="s".repeat(64);
const env={
  VERCEL_ENV:"preview",
  G3G_DEPLOYMENT_REF:"feat/g3g-preview-hosted-worker-20261108",
  G3G_DEPLOYMENT_SHA:sha,
  G3G_APPROVED_SHA:sha,
  G3G_WORKER_MODE:"disabled",
  G3G_INTERNAL_MARKET_MODE:"enabled",
  G3G_MARKET_INTERNAL_TOKEN:token,
};
const apple={kind:"EQUITY" as const,symbol:"AAPL",mic:"XNGS",currency:"USD",name:"Apple Inc."};
const q:DynamicMarketQuote={
  status:"AVAILABLE",...apple,price:"100.25",marketDate:"2026-11-09",
  observedAt:"2026-11-09T20:00:00Z",provider:"TWELVE_DATA",
  interval:"1day",priceType:"DAILY_CLOSE",source:"PROVIDER",providerCalls:1,
};
const h:DynamicMarketHistory={
  status:"AVAILABLE",...apple,startDate:"2026-11-01",endDate:"2026-11-09",
  observedAt:"2026-11-09T20:00:00Z",provider:"TWELVE_DATA",
  interval:"1day",adjustment:"none",source:"PROVIDER",providerCalls:1,
  candles:[{marketDate:"2026-11-06",open:"100",high:"102",low:"99",close:"101",volume:"100"}],
};
const candidate:DynamicMarketCandidate={...apple,token:"example-signed-selection"};
const calls={search:0,quotes:0,history:0};
const core={
  discover:async(term:string)=>{calls.search++;assert.equal(term,"Apple");return[candidate];},
  readInstrument:async(item:MarketConsumerInstrument)=>{calls.quotes++;assert.equal(item.symbol,"AAPL");return q;},
  readHistory:async(item:MarketConsumerInstrument,start:string,end:string)=>{
    calls.history++;assert.equal(item.symbol,"AAPL");assert.equal(start,"2026-11-01");assert.equal(end,"2026-11-09");return h;
  },
};
function request(body:unknown,secret=token):Request {
 return new Request("https://syntrake.example/api/internal/market-core",{
   method:"POST",headers:{authorization:"Bearer "+secret,"content-type":"application/json"},
   body:JSON.stringify(body),
 });
}

test("internal caller searches, reads batch and history without a Clerk session",async()=>{
  const search=await handleMachineMarketCore(request({operation:"discover",query:"Apple"}),env,core);
  assert.equal(search.status,200);
  assert.equal((await search.json()).candidates[0].symbol,"AAPL");
  const batch=await handleMachineMarketCore(request({
    operation:"quotes",consumer:"INVESTING",interval:"1day",instruments:[apple,apple],
  }),env,core);
  assert.equal(batch.status,200);
  const data=await batch.json();
  assert.equal(data.consumer,"INVESTING");
  assert.equal(data.status,"AVAILABLE");
  assert.equal(data.results.length,2);
  assert.equal(calls.quotes,1);
  const history=await handleMachineMarketCore(request({
    operation:"history",instrument:apple,startDate:"2026-11-01",endDate:"2026-11-09",
  }),env,core);
  assert.equal(history.status,200);
  assert.equal((await history.json()).candles[0].close,"101");
  assert.equal(calls.history,1);
  assert.equal(search.headers.get("cache-control"),"private, no-store, max-age=0");
});

test("invalid token, disabled mode and production reject BEFORE work",async()=>{
  const before=JSON.stringify(calls);
  for(const [overrides,secret] of [
    [{}, "invalid"],
    [{G3G_INTERNAL_MARKET_MODE:"disabled"},token],
    [{VERCEL_ENV:"production"},token],
    [{G3G_APPROVED_SHA:"0".repeat(40)},token],
    [{G3G_WORKER_MODE:"enabled"},token],
  ] as const) {
    const result=await handleMachineMarketCore(request({operation:"discover",query:"Apple"},secret),{
      ...env,...overrides,
    },core);
    assert.equal(result.status,404);
  }
  assert.equal(JSON.stringify(calls),before);
});

test("unknown operations and intraday series cannot call a provider",async()=>{
  const before=JSON.stringify(calls);
  const invalids=[
    {operation:"quotes",consumer:"TRADING",interval:"1min",instruments:[apple]},
    {operation:"quotes",consumer:"INVESTING",interval:"1day",instruments:[]},
    {operation:"history",instrument:{...apple,other:"spoof"},startDate:"2026-11-01",endDate:"2026-11-09"},
    {operation:"unknown"},
  ];
  for(const payload of invalids) {
    const r=await handleMachineMarketCore(request(payload),env,core);
    assert.equal(r.status,400);
  }
  assert.equal(JSON.stringify(calls),before);
});
