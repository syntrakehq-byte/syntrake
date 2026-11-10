import test from "node:test";
import assert from "node:assert/strict";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { CatalogConnectorError } from "../catalogConnector";
import { classifyDynamicMarketError } from "../dynamicMarketGateway";

const source = {
  providerKey: "TWELVE_DATA", snapshotId: "test-forex-provider", snapshotVersion: "1",
  observedAt: "2026-11-10T18:00:00Z", licensePolicyId: "preview-private-direct",
  storageAllowed: false, sharingAllowed: false,
};
const env = { SYNTRAKE_TWELVE_DATA_API_KEY: "fake_test_key_forex_catalog_012345" };

function client(calls: string[]) {
  return createTwelveDataCatalogConnector({
    source, env, apiKeyEnv:"SYNTRAKE_TWELVE_DATA_API_KEY",
    readOnly:true, broadSearch:true,
    transport:async(url, init)=>{
      const u=new URL(url);
      assert.equal(u.origin,"https://api.twelvedata.com");
      assert.equal((init.headers as Record<string,string>).Authorization,
        "apikey "+env.SYNTRAKE_TWELVE_DATA_API_KEY);
      calls.push(u.pathname);
      const term=u.searchParams.get("symbol")!;
      if(u.pathname==="/forex_pairs"){
        const pair=term.toUpperCase();
        return Response.json({status:"ok",count:2,data:[
          {symbol:pair,currency_group:"Major",currency_base:"Base Currency",currency_quote:"Quote Currency"},
          {symbol:"JPY/GBP",currency_group:"Minor",currency_base:"Yen",currency_quote:"Pound"},
        ]});
      }
      if(u.pathname==="/symbol_search"){
        return Response.json({status:"ok",data:[{
          symbol:"TSLA",instrument_name:"Tesla Inc",instrument_type:"Common Stock",
          mic_code:"XNGS",currency:"USD",
        }]});
      }
      throw new Error("UNEXPECTED_PROVIDER_ENDPOINT");
    },
  });
}
test("any ISO currency pair resolves through forex_pairs, without fixed assets or inverse quotes",async()=>{
  const calls:string[]=[];
  const adapter=client(calls);
  for(const pair of ["EUR/USD","GBP/JPY","CHF/SEK"]){
    const result=await adapter.search({name:pair});
    assert.equal(result.candidates.length,1);
    const row=result.candidates[0];
    assert.equal(row.descriptiveAssetClass,"FX");
    assert.equal(row.listing?.ticker,pair);
    assert.equal(row.listing?.mic,null);
    assert.equal(row.listing?.tradingCurrency,pair.slice(4));
    assert.equal(row.providerReference.providerKey,"TWELVE_DATA");
  }
  assert.deepEqual(calls,["/forex_pairs","/forex_pairs","/forex_pairs"]);
});
test("provider lookup for foreign exchange preserves direction and avoids symbol_search schema",async()=>{
  const calls:string[]=[];
  const result=await client(calls).lookup("CAD/CHF");
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].listing?.ticker,"CAD/CHF");
  assert.deepEqual(calls,["/forex_pairs"]);
});
test("equity discovery still uses symbol_search",async()=>{
  const calls:string[]=[];
  const result=await client(calls).search({name:"Tesla"});
  assert.equal(result.candidates[0].descriptiveAssetClass,"EQUITY");
  assert.deepEqual(calls,["/symbol_search"]);
});

test("malformed provider FX catalog response is reported as provider error, not silent success",()=>{
  assert.deepEqual(classifyDynamicMarketError(new CatalogConnectorError("INVALID_PROVIDER_RESPONSE")),
    {status:502,error:"INVALID_PROVIDER_RESPONSE"});
  assert.deepEqual(classifyDynamicMarketError(new CatalogConnectorError("RATE_LIMITED",429)),
    {status:429,error:"RATE_LIMITED"});
});
