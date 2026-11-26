import test from "node:test";
import assert from "node:assert/strict";
import { createDynamicMarketGateway } from "../dynamicMarketGateway";

const SHA = "f".repeat(40);
const env = {
  VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA,
  SYNTRAKE_MARKET_APPROVED_SHA: SHA, SYNTRAKE_MARKET_MODE: "on-demand",
  SYNTRAKE_MARKET_VISIBILITY: "authenticated", SYNTRAKE_MARKET_PERSISTENCE: "disabled",
  SYNTRAKE_TWELVE_DATA_API_KEY: "fake_test_0123456789abcdefghijklmnopqrstuvwxyz",
};
function transportWith(counters: { searches: number; prices: number }) {
  return async (url: string, options: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.twelvedata.com");
    assert.equal(options.headers && (options.headers as Record<string, string>).Authorization,
      "apikey " + env.SYNTRAKE_TWELVE_DATA_API_KEY);
    const term = parsed.searchParams.get("symbol");
    if (parsed.pathname === "/symbol_search") {
      counters.searches++;
      assert.ok(term);
      const rows = term === "Microsoft" ? [
        {symbol:"MSFT",instrument_name:"Microsoft Corporation",exchange:"Nasdaq Global Select Market",mic_code:"XNGS",exchange_timezone:"America/New_York",currency:"USD",instrument_type:"Common Stock",country:"United States"},
        {symbol:"MSFT",instrument_name:"Microsoft Corporation",exchange:"NASDAQ",mic_code:"XNAS",exchange_timezone:"America/New_York",currency:"USD",instrument_type:"Common Stock",country:"United States"},
      ] : [
        {symbol:"TSLA",instrument_name:"Tesla Inc",exchange:"NASDAQ",mic_code:"XNGS",exchange_timezone:"America/New_York",currency:"USD",instrument_type:"Common Stock",country:"United States"},
      ];
      return Response.json({status:"ok",data:rows});
    }
    if (parsed.pathname === "/time_series") {
      counters.prices++;
      assert.equal(parsed.searchParams.get("interval"), "1day");
      assert.equal(parsed.searchParams.get("outputsize"), "1");
      assert.equal(parsed.searchParams.get("adjust"), "none");
      return Response.json({status:"ok",meta:{
        symbol: term, interval:"1day", currency:"USD", exchange_timezone:"America/New_York",
        type:"Common Stock", mic_code:parsed.searchParams.get("mic_code"),
      },values:[{datetime:"2026-11-06",open:"100",high:"105",low:"99",close:"104",volume:"125000"}]});
    }
    throw new Error("UNEXPECTED_API_ENDPOINT");
  };
}

test("name discovery supports many candidates, explicit selection, provider quote, then cache", async () => {
  const counters={searches:0,prices:0};
  const market=createDynamicMarketGateway({
    env, transport:transportWith(counters),
    clock:()=>new Date("2026-11-09T12:00:00Z"),
  });
  const candidates=await market.discover("Microsoft");
  assert.equal(candidates.length,2);
  assert.equal(counters.searches,1);
  assert.equal(counters.prices,0);
  assert.equal(candidates[0].name,"Microsoft Corporation");
  assert.equal(candidates[0].symbol,"MSFT");
  assert.equal(candidates[0].mic,"XNGS");
  const first=await market.quoteToken(candidates[0].token);
  assert.equal(first.status,"AVAILABLE");
  assert.equal(first.price,"104");
  assert.equal(first.marketDate,"2026-11-06");
  assert.equal(first.priceType,"DAILY_CLOSE");
  assert.equal(first.provider,"TWELVE_DATA");
  assert.equal(first.source,"PROVIDER");
  assert.equal(counters.prices,1);
  const second=await market.quoteToken(candidates[0].token);
  assert.equal(second.source,"MEMORY_CACHE");
  assert.equal(second.providerCalls,0);
  assert.equal(counters.prices,1);
});

test("no hard-coded stock universe; another company resolves from provider response", async()=>{
  const counters={searches:0,prices:0};
  const market=createDynamicMarketGateway({
    env, transport:transportWith(counters), clock:()=>new Date("2026-11-09T12:00:00Z"),
  });
  const hits=await market.discover("Tesla");
  assert.equal(hits[0].symbol,"TSLA");
  const quote=await market.quoteToken(hits[0].token);
  assert.equal(quote.symbol,"TSLA");
  assert.equal(counters.prices,1);
});

test("tampered selection cannot trigger a Twelve Data price request", async()=>{
  const counters={searches:0,prices:0};
  const market=createDynamicMarketGateway({
    env, transport:transportWith(counters), clock:()=>new Date("2026-11-09T12:00:00Z"),
  });
  const hits=await market.discover("Microsoft");
  const token=hits[0].token;
  await assert.rejects(market.quoteToken(token.slice(0,-1)+(token.endsWith("A")?"B":"A")));
  assert.equal(counters.prices,0);
});

test("disabled mode, SHA mismatch and persistence enablement refuse discovery before any request", async()=>{
  const counters={searches:0,prices:0};
  for(const change of [{SYNTRAKE_MARKET_MODE:"disabled"},{SYNTRAKE_MARKET_APPROVED_SHA:"0".repeat(40)},{SYNTRAKE_MARKET_PERSISTENCE:"enabled"}]){
    const market=createDynamicMarketGateway({env:{...env,...change},transport:transportWith(counters)});
    await assert.rejects(market.discover("Microsoft"));
  }
  assert.equal(counters.searches,0);
});
