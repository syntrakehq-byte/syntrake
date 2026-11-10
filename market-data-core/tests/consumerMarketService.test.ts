import test from "node:test";
import assert from "node:assert/strict";
import { readInvestingPortfolioMarketPrices } from "../../investing-core/marketDataBridge";
import { readMarketDataForCoreConsumer, type MarketConsumerInstrument } from "../consumerMarketService";
import type { DynamicMarketQuote } from "../dynamicMarketGateway";

const stock = (symbol: string): MarketConsumerInstrument =>
  ({ kind:"EQUITY", symbol, mic:"XNGS", currency:"USD", name:symbol+" Corp" });
const result = (s: MarketConsumerInstrument): DynamicMarketQuote => ({
  status:"AVAILABLE", symbol:s.symbol, name:s.name, mic:s.mic,
  currency:s.currency, kind:s.kind, price:"100.12",
  marketDate:"2026-11-09", observedAt:"2026-11-09T19:00:00Z",
  provider:"TWELVE_DATA", interval:"1day", priceType:"DAILY_CLOSE",
  source:"PROVIDER", providerCalls:1,
});

test("Investing requests an owned portfolio batch through Market Core; duplicates do not cause extra reads", async()=>{
  const counts: string[]=[];
  const core={readInstrument: async (s:MarketConsumerInstrument)=>{
    counts.push(s.symbol);
    return result(s);
  }};
  const response=await readInvestingPortfolioMarketPrices([stock("AAPL"),stock("MSFT"),stock("AAPL")],core);
  assert.equal(response.consumer,"INVESTING");
  assert.equal(response.status,"AVAILABLE");
  assert.deepEqual(counts,["AAPL","MSFT"]);
  assert.deepEqual(response.results.map(x=>x.data?.price),["100.12","100.12","100.12"]);
});

test("Trading reuses the same provider-neutral reader with daily data, not a different Twelve Data connection",async()=>{
  const calls:string[]=[];
  const core={readInstrument:async(s:MarketConsumerInstrument)=>{calls.push(s.symbol);return result(s);}};
  const answer=await readMarketDataForCoreConsumer({consumer:"TRADING",interval:"1day",instruments:[stock("NVDA")]},core);
  assert.equal(answer.status,"AVAILABLE");
  assert.deepEqual(calls,["NVDA"]);
  assert.equal(answer.results[0].data?.priceType,"DAILY_CLOSE");
});

test("requesting an intraday interval fails before ANY price call",async()=>{
  let calls=0;
  const core={readInstrument:async(s:MarketConsumerInstrument)=>{calls++;return result(s);}};
  await assert.rejects(
    readMarketDataForCoreConsumer({consumer:"TRADING",interval:"1min",instruments:[stock("AAPL")]},core),
    /MARKET_CONSUMER_REQUEST_UNSUPPORTED/,
  );
  assert.equal(calls,0);
});

test("invalid identity in a batch prevents ALL network calls",async()=>{
  let calls=0;
  const core={readInstrument:async(s:MarketConsumerInstrument)=>{calls++;return result(s);}};
  await assert.rejects(readInvestingPortfolioMarketPrices([
    stock("AAPL"),{...stock("MSFT"),mic:"invalid"}
  ],core));
  assert.equal(calls,0);
});

test("one failed instrument returns PARTIAL without invented prices, other holdings stay available",async()=>{
  const core={readInstrument:async(s:MarketConsumerInstrument)=>{
    if(s.symbol==="MSFT")throw new Error("private provider failure");
    return result(s);
  }};
  const answer=await readInvestingPortfolioMarketPrices([stock("AAPL"),stock("MSFT")],core);
  assert.equal(answer.status,"PARTIAL");
  assert.equal(answer.results[0].data?.price,"100.12");
  assert.equal(answer.results[1].status,"UNAVAILABLE");
  assert.equal(answer.results[1].data,null);
  assert.equal(JSON.stringify(answer).includes("private provider failure"),false);
});
