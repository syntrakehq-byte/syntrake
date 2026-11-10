import test from "node:test";
import assert from "node:assert/strict";
import { createDynamicMarketGateway } from "../dynamicMarketGateway";
import { fetchPersonalReleaseDailySeries } from "../twelveData";

const SHA = "f".repeat(40);
const env = {
  VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA,
  SYNTRAKE_MARKET_APPROVED_SHA: SHA, SYNTRAKE_MARKET_MODE: "personal",
  SYNTRAKE_MARKET_VISIBILITY: "owner-only", SYNTRAKE_MARKET_PERSISTENCE: "disabled",
  SYNTRAKE_MARKET_OWNER_USER_ID: "user_test_owner_123",
  SYNTRAKE_TWELVE_DATA_API_KEY: "fake_test_0123456789abcdefghijklmnopqrstuvwxyz",
};
test("Market Core discovers a generic equity and uses the existing provider validator for historical bars",async()=>{
  let searches=0,historyCalls=0;
  const transport=async(url:string, options:RequestInit):Promise<Response>=>{
    const u=new URL(url);
    assert.equal(u.origin,"https://api.twelvedata.com");
    assert.equal((options.headers as Record<string,string>).Authorization,
      "apikey "+env.SYNTRAKE_TWELVE_DATA_API_KEY);
    if(u.pathname==="/symbol_search"){
      searches++;
      return Response.json({status:"ok",data:[{
        symbol:"NVDA",instrument_name:"NVIDIA Corp",mic_code:"XNGS",
        instrument_type:"Common Stock",currency:"USD",
      }]});
    }
    if(u.pathname==="/time_series"){
      historyCalls++;
      assert.equal(u.searchParams.get("start_date"),"2026-11-02");
      assert.equal(u.searchParams.get("end_date"),"2026-11-09");
      assert.equal(u.searchParams.get("interval"),"1day");
      assert.equal(u.searchParams.get("outputsize"),"1000");
      return Response.json({status:"ok",meta:{
        symbol:"NVDA",interval:"1day",currency:"USD",
        type:"Common Stock",exchange_timezone:"America/New_York",mic_code:"XNGS",
      },values:[
        {datetime:"2026-11-06",open:"4",high:"6",low:"3",close:"5",volume:"22"},
        {datetime:"2026-11-05",open:"3",high:"5",low:"2",close:"4",volume:"19"},
      ]});
    }
    throw new Error("UNEXPECTED_ENDPOINT");
  };
  const service=createDynamicMarketGateway({
    env,transport,clock:()=>new Date("2026-11-09T21:00:00Z"),
  });
  const found=await service.discover("NVIDIA");
  assert.equal(found.length,1);
  assert.equal(found[0].symbol,"NVDA");
  const first=await service.historyToken(found[0].token,"2026-11-02","2026-11-09");
  assert.equal(first.status,"AVAILABLE");
  assert.equal(first.candles.length,2);
  assert.deepEqual(first.candles.map(x=>x.marketDate),["2026-11-05","2026-11-06"]);
  assert.equal(first.candles[0].close,"4");
  assert.equal(first.interval,"1day");
  assert.equal(first.adjustment,"none");
  assert.equal(first.providerCalls,1);
  const cached=await service.historyToken(found[0].token,"2026-11-02","2026-11-09");
  assert.equal(cached.source,"MEMORY_CACHE");
  assert.equal(cached.providerCalls,0);
  assert.equal(historyCalls,1);
  assert.equal(searches,1);
});

test("historical range of >366 calendar days is split into bounded exchange-date queries",async()=>{
  let priceCalls=0;
  const transport=async(url:string):Promise<Response>=>{
    const u=new URL(url);
    if(u.pathname==="/symbol_search"){
      return Response.json({status:"ok",data:[{
        symbol:"MSFT",instrument_name:"Microsoft Corporation",mic_code:"XNGS",
        instrument_type:"Common Stock",currency:"USD",
      }]});
    }
    priceCalls++;
    const begin=u.searchParams.get("start_date")!;
    const end=u.searchParams.get("end_date")!;
    assert.ok(begin<=end);
    const age=Date.parse(end+"T00:00:00Z")-Date.parse(begin+"T00:00:00Z");
    assert.ok(age<=365*86400000);
    const date=begin;
    return Response.json({status:"ok",meta:{
      symbol:"MSFT",interval:"1day",currency:"USD",
      type:"Common Stock",exchange_timezone:"America/New_York",mic_code:"XNGS",
    },values:[{datetime:date,open:"1",high:"1",low:"1",close:"1",volume:"1"}]});
  };
  const service=createDynamicMarketGateway({env,transport,clock:()=>new Date("2026-11-09T12:00:00Z")});
  const found=await service.discover("Microsoft");
  const response=await service.historyToken(found[0].token,"2025-01-01","2026-10-01");
  assert.equal(response.status,"AVAILABLE");
  assert.equal(priceCalls,2);
  assert.equal(response.providerCalls,2);
  assert.ok(response.candles[0].marketDate<response.candles[1].marketDate);
});

test("out-of-range provider bars, invalid range and future data are rejected",async()=>{
  let priceCalls=0;
  const transport=async(url:string):Promise<Response>=>{
    const u=new URL(url);
    if(u.pathname==="/symbol_search"){
      return Response.json({status:"ok",data:[{
        symbol:"AAPL",instrument_name:"Apple Inc",mic_code:"XNGS",
        instrument_type:"Common Stock",currency:"USD",
      }]});
    }
    priceCalls++;
    return Response.json({status:"ok",meta:{
      symbol:"AAPL",interval:"1day",currency:"USD",
      type:"Common Stock",exchange_timezone:"America/New_York",mic_code:"XNGS",
    },values:[{datetime:"2026-10-01",open:"1",high:"1",low:"1",close:"1",volume:"1"}]});
  };
  const core=createDynamicMarketGateway({env,transport,clock:()=>new Date("2026-11-09T12:00:00Z")});
  const hit=(await core.discover("Apple"))[0];
  await assert.rejects(core.historyToken(hit.token,"2027-01-01","2027-01-31"));
  await assert.rejects(core.historyToken(hit.token,"2026-11-09","2026-11-01"));
  await assert.rejects(core.historyToken(hit.token,"2026-11-04","2026-11-09"));
  assert.equal(priceCalls,1);
});

test("currency pair uses explicit direction and daily FX history, not an inferred reverse quote",async()=>{
  let calls=0;
  const transport=async(url:string):Promise<Response>=>{
    const u=new URL(url);
    if(u.pathname==="/forex_pairs") {
      assert.equal(u.searchParams.get("symbol"),"EUR/USD");
      return Response.json({status:"ok",count:1,data:[{
        symbol:"EUR/USD",currency_group:"Major",
        currency_base:"Euro",currency_quote:"US Dollar",
      }]});
    }
    calls++;
    assert.equal(u.searchParams.get("symbol"),"EUR/USD");
    assert.equal(u.searchParams.get("mic_code"),null);
    return Response.json({status:"ok",meta:{
      symbol:"EUR/USD",interval:"1day",currency:"USD",
      exchange_timezone:"UTC",type:"Physical Currency",
    },values:[{datetime:"2026-11-06",open:"1.1",high:"1.2",low:"1.0",close:"1.15"}]});
  };
  const core=createDynamicMarketGateway({env,transport,clock:()=>new Date("2026-11-09T12:00:00Z")});
  const found=await core.discover("EUR/USD");
  assert.equal(found[0].kind,"FX");
  const history=await core.historyToken(found[0].token,"2026-11-02","2026-11-09");
  assert.equal(history.candles[0].close,"1.15");
  assert.equal(history.candles[0].volume,null);
  assert.equal(history.currency,"USD");
  assert.equal(calls,1);
});

test("FX daily history accepts provider base/quote/omitted metadata only, never third currency",async()=>{
  for(const metaCurrency of ["EUR","USD",null,undefined,"JPY"] as const){
    const transport=async(url:string):Promise<Response>=>{
      const u=new URL(url);
      if(u.pathname==="/forex_pairs"){
        return Response.json({status:"ok",data:[{
          symbol:"EUR/USD",currency_base:"Euro",currency_quote:"US Dollar",currency_group:"Major",
        }]});
      }
      assert.equal(u.pathname,"/time_series");
      assert.equal(u.searchParams.get("symbol"),"EUR/USD");
      return Response.json({status:"ok",meta:{
        symbol:"EUR/USD",interval:"1day",currency:metaCurrency,
        type:"Physical Currency",exchange_timezone:"UTC",
      },values:[{datetime:"2026-11-06",open:"1.10",high:"1.16",low:"1.09",close:"1.15"}]});
    };
    const core=createDynamicMarketGateway({env,transport,clock:()=>new Date("2026-11-09T12:00:00Z")});
    const selected=(await core.discover("EUR/USD"))[0];
    assert.ok(selected);
    if(metaCurrency==="JPY"){
      await assert.rejects(core.historyToken(selected.token,"2026-11-04","2026-11-09"),/INVALID_PROVIDER_RESPONSE/);
    } else {
      const h=await core.historyToken(selected.token,"2026-11-04","2026-11-09");
      assert.equal(h.status,"AVAILABLE");
      assert.equal(h.currency,"USD"); // quote currency from the validated pair, not the base metadata
      assert.equal(h.candles[0].close,"1.15");
    }
  }
});

test("FX daily candles use documented UTC only when timezone metadata is absent",async()=>{
  for(const timezone of [undefined,null,"UTC","Invalid/Timezone"] as const){
    const transport=async(url:string):Promise<Response>=>{
      const u=new URL(url);
      if(u.pathname==="/forex_pairs") return Response.json({status:"ok",data:[{
        symbol:"GBP/CHF",currency_base:"Pound Sterling",currency_quote:"Swiss Franc",currency_group:"Minor",
      }]});
      return Response.json({status:"ok",meta:{
        symbol:"GBP/CHF",interval:"1day",currency:"GBP",type:"Physical Currency",
        exchange_timezone:timezone,
      },values:[{datetime:"2026-11-06",open:"1.10",high:"1.16",low:"1.09",close:"1.15"}]});
    };
    const core=createDynamicMarketGateway({env,transport,clock:()=>new Date("2026-11-09T12:00:00Z")});
    const item=(await core.discover("GBP/CHF"))[0];
    assert.ok(item);
    if(timezone==="Invalid/Timezone"){
      await assert.rejects(core.historyToken(item.token,"2026-11-04","2026-11-09"),/INVALID_PROVIDER_RESPONSE/);
    } else {
      const h=await core.historyToken(item.token,"2026-11-04","2026-11-09");
      assert.equal(h.status,"AVAILABLE");
      assert.equal(h.currency,"CHF");
      assert.equal(h.candles[0].marketDate,"2026-11-06");
    }
  }
});
