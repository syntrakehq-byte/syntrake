import test from "node:test";
import assert from "node:assert/strict";
import { handleInternalMarketRequest } from "../internalMarketRequest";
import type { DynamicMarketCandidate, DynamicMarketQuote, DynamicMarketHistory } from "../dynamicMarketGateway";

const SHA = "f".repeat(40);
const TOKEN = "a".repeat(64);
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3g-preview-hosted-worker-20261108",
  VERCEL_GIT_COMMIT_SHA: SHA,
  G3G_DEPLOYMENT_REF: "feat/g3g-preview-hosted-worker-20261108",
  G3G_DEPLOYMENT_SHA: SHA,
  G3G_APPROVED_SHA: SHA,
  G3G_EXECUTOR_TOKEN: TOKEN,
};
const candidate: DynamicMarketCandidate = {
  name: "Any Instrument",symbol:"TEST",mic:"XNGS",currency:"USD",
  kind:"EQUITY",token:"signed-selection-token",
};
const quote: DynamicMarketQuote = {
  status:"AVAILABLE",name:"Any Instrument",symbol:"TEST",mic:"XNGS",
  currency:"USD",kind:"EQUITY",price:"100.2",marketDate:"2026-11-09",
  observedAt:"2026-11-09T20:00:00Z",provider:"TWELVE_DATA",
  interval:"1day",priceType:"DAILY_CLOSE",source:"PROVIDER",providerCalls:1,
};
const history: DynamicMarketHistory = {
  status:"AVAILABLE",name:"Any Instrument",symbol:"TEST",mic:"XNGS",
  currency:"USD",kind:"EQUITY",interval:"1day",adjustment:"none",
  startDate:"2026-11-01",endDate:"2026-11-09",observedAt:"2026-11-09T20:00:00Z",
  candles:[{marketDate:"2026-11-06",open:"99",high:"101",low:"98",close:"100.2",volume:"500"}],
  provider:"TWELVE_DATA",source:"PROVIDER",providerCalls:1,
};
function request(body:unknown, bearer=TOKEN):Request{
  return new Request("https://preview.syntrake.example/api/internal/market-data",{
    method:"POST",headers:{"Authorization":"Bearer "+bearer},
    body:JSON.stringify(body),
  });
}
test("unauthenticated service and Production are rejected before ANY Market Core work",async()=>{
  let calls=0;
  const core={
    discover:async()=>{calls++;return[candidate];},
    quoteToken:async()=>{calls++;return quote;},
    historyToken:async()=>{calls++;return history;},
  };
  assert.equal((await handleInternalMarketRequest(request({action:"DISCOVER",query:"Any"},"invalid"),env,core)).status,404);
  assert.equal((await handleInternalMarketRequest(request({action:"DISCOVER",query:"Any"}),{...env,VERCEL_ENV:"production"},core)).status,404);
  assert.equal((await handleInternalMarketRequest(request({action:"DISCOVER",query:"Any"}),{...env,G3G_APPROVED_SHA:"0".repeat(40)},core)).status,404);
  assert.equal(calls,0);
});
test("an internal consumer discovers and selects a market instrument without Clerk",async()=>{
  const received:string[]=[];
  const core={
    discover:async(s:string)=>{received.push("DISCOVER:"+s);return[candidate];},
    quoteToken:async(t:string)=>{received.push("QUOTE:"+t);return quote;},
    historyToken:async(t:string,start:string,end:string)=>{
      received.push("HISTORY:"+t+":"+start+":"+end);return history;
    },
  };
  const found=await handleInternalMarketRequest(request({action:"DISCOVER",query:"Any"}),env,core);
  assert.equal(found.status,200);
  assert.equal((await found.json()).candidates[0].symbol,"TEST");
  const priced=await handleInternalMarketRequest(request({action:"QUOTE",token:candidate.token}),env,core);
  assert.equal(priced.status,200);
  assert.equal((await priced.json()).price,"100.2");
  const bars=await handleInternalMarketRequest(request({action:"HISTORY",token:candidate.token,startDate:"2026-11-01",endDate:"2026-11-09"}),env,core);
  assert.equal(bars.status,200);
  assert.equal((await bars.json()).candles.length,1);
  assert.deepEqual(received,[
    "DISCOVER:Any","QUOTE:signed-selection-token",
    "HISTORY:signed-selection-token:2026-11-01:2026-11-09",
  ]);
});
test("arbitrary asset identifiers and extra fields are rejected before the provider",async()=>{
  let calls=0;
  const core={
    discover:async()=>{calls++;return[candidate];},
    quoteToken:async()=>{calls++;return quote;},
    historyToken:async()=>{calls++;return history;},
  };
  for(const body of [
    {action:"QUOTE",symbol:"AAPL"}, {action:"DISCOVER",query:"Microsoft",force:true},
    {action:"HISTORY",token:"x",startDate:"2026-11-01"},
    {action:"AUTOTRADE",token:"x"},
  ]){
    const res=await handleInternalMarketRequest(request(body),env,core);
    assert.equal(res.status,400);
  }
  assert.equal(calls,0);
});
