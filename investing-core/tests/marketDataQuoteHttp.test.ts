import test from "node:test";
import assert from "node:assert/strict";
import { handleInvestingSelectionQuote } from "../marketDataQuoteHttp";
import { MarketDataError } from "../../market-data-core/identity";
import type { DynamicMarketQuote } from "../../market-data-core/dynamicMarketGateway";

const url="https://syntrake.example/api/investing/market-data";
const token="a".repeat(80);
const actor=async()=>({userId:"clerk-test",sessionId:"session-test"});
const response:DynamicMarketQuote={
 status:"AVAILABLE", symbol:"AAPL", name:"Apple Inc", mic:"XNGS",
 kind:"EQUITY", currency:"USD", price:"100.25", marketDate:"2026-11-09",
 observedAt:"2026-11-09T19:00:00Z",provider:"TWELVE_DATA",
 interval:"1day",priceType:"DAILY_CLOSE",source:"MEMORY_CACHE",providerCalls:0,
};
function request(body:unknown,origin="https://syntrake.example"):Request {
 return new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
}

test("Investing HTTP delegates verified selected instrument to Market Core",async()=>{
 let calls=0;
 const res=await handleInvestingSelectionQuote(request({token}),actor,{
  quoteToken:async(t)=>{calls++;assert.equal(t,token);return response;},
 });
 assert.equal(res.status,200);
 assert.equal(calls,1);
 assert.deepEqual(await res.json(),response);
 assert.equal(res.headers.get("Cache-Control"),"private, no-store, max-age=0");
});

test("unauthenticated client cannot trigger provider calls",async()=>{
 let calls=0;
 const res=await handleInvestingSelectionQuote(request({token}),async()=>{throw new Error("UNAUTHENTICATED");},{
  quoteToken:async()=>{calls++;return response;}
 });
 assert.equal(res.status,401);assert.equal(calls,0);
});

test("cross-origin client cannot trigger provider calls",async()=>{
 let calls=0;
 const res=await handleInvestingSelectionQuote(request({token},"https://evil.example"),actor,{
  quoteToken:async()=>{calls++;return response;}
 });
 assert.equal(res.status,403);assert.equal(calls,0);
});

test("unverified user-supplied symbol cannot bypass signed selection token",async()=>{
 let calls=0;
 const res=await handleInvestingSelectionQuote(request({symbol:"AAPL"}),actor,{
  quoteToken:async()=>{calls++;return response;}
 });
 assert.equal(res.status,400);assert.equal(calls,0);
});

test("provider failure is redacted without exposing secrets or inventing quote",async()=>{
 const res=await handleInvestingSelectionQuote(request({token}),actor,{
  quoteToken:async()=>{throw new MarketDataError("PROVIDER_UNAVAILABLE");}
 });
 assert.equal(res.status,502);
 assert.deepEqual(await res.json(),{error:"PROVIDER_UNAVAILABLE"});
});
