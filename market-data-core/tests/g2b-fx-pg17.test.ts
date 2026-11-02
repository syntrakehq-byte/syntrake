import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { fxHistoryFromRows, convertWithFx } from "../fx";

const client = new Client({ host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres",
  connectionTimeoutMillis: 3000 });
const ids = {
  provider:"00000000-0000-0000-0000-000000000201",
  rights:"00000000-0000-0000-0000-000000000202",
  fxInstrument:"00000000-0000-0000-0000-000000000203",
  fxListing:"00000000-0000-0000-0000-000000000204",
  observation:"00000000-0000-0000-0000-000000000205",
  revisionOld:"00000000-0000-0000-0000-000000000206",
  revisionNew:"00000000-0000-0000-0000-000000000207",
};
const sql = async (file: string) => client.query(await readFile(resolve(process.cwd(), file), "utf8"));
const request = (asOf = "2026-01-04T23:00:00Z") => ({
  baseCurrency:"EUR", quoteCurrency:"USD", startDate:"2026-01-01",
  endDate:"2026-01-31", asOf, ratePolicy:"DIRECT_DAILY_CLOSE" as const,
});
const query = "SELECT * FROM market_core.read_fx_history('EUR','USD',DATE '2026-01-01',DATE '2026-01-31',$1)";
const reverse = "SELECT * FROM market_core.read_fx_history('USD','EUR',DATE '2026-01-01',DATE '2026-01-31',$1)";

let connected = false;
before(async () => {
  await client.connect();
  connected = true;
  assert.match((await client.query("SELECT current_setting('server_version') version")).rows[0].version,/^17\./);
  for (const file of [
    "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql",
    "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql",
    "supabase/release-candidates/20261102090000_g2a_universal_historical_api.sql",
    "supabase/release-candidates/20261102120000_g2b_directed_fx_candidate.sql",
  ]) await sql(file);
  await client.query("INSERT INTO market_core.providers VALUES ($1,'FX_TEST','ACTIVE')",[ids.provider]);
  await client.query("INSERT INTO market_core.license_policies VALUES ($1,'fx-fixture',true,true,NULL)",[ids.rights]);
  await client.query("INSERT INTO market_core.instruments (instrument_id,issuer_id,asset_class,denomination_currency) VALUES ($1,NULL,'FX','USD')",[ids.fxInstrument]);
  await client.query("INSERT INTO market_core.listings (listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from,valid_to) VALUES ($1,$2,NULL,NULL,'USD','EURUSD','2020-01-01',NULL)",[ids.fxListing,ids.fxInstrument]);
  await client.query("INSERT INTO market_core.fx_pairs (listing_id,base_currency,quote_currency) VALUES ($1,'EUR','USD')",[ids.fxListing]);
  await client.query("INSERT INTO market_core.market_observations VALUES ($1,$2,$3,$4,'1day','2026-01-02','UTC','none','2026-01-03Z')",[ids.observation,ids.fxListing,ids.provider,ids.rights]);
  await client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,first_seen_at,ingested_at,as_known_at,quality_flags) VALUES ($1,$2,$3,repeat('a',64),1.1,1.3,1.0,1.12,'2026-01-03Z','2026-01-03Z','2026-01-03Z',ARRAY['FX_VERIFIED']),($4,$2,$3,repeat('b',64),1.1,1.3,1.0,1.20,'2026-01-05Z','2026-01-05Z','2026-01-05Z',ARRAY['FX_CORRECTED'])",[ids.revisionOld,ids.observation,ids.fxListing,ids.revisionNew]);
});
after(async () => {
  if (connected) {
    await client.query("DROP SCHEMA IF EXISTS market_core CASCADE");
    for(const r of ["market_core_reader","market_core_ingest","market_core_catalog_ingest","market_core_catalog_reader","market_core_registry_reviewer","anon","authenticated"]){
      await client.query("DROP ROLE IF EXISTS "+r);
    }
    await client.end();
  }
});
test("G2-B directs EUR/USD explicitly, PIT chooses known revision, no inverse implicit",async()=>{
  const oldRows=(await client.query(query,["2026-01-04T23:00:00Z"])).rows;
  const old=fxHistoryFromRows(request(),oldRows);
  assert.equal(old.status,"AVAILABLE");
  assert.equal(old.listingId,ids.fxListing);
  assert.equal(old.providerId,ids.provider);
  assert.equal(old.points[0].revisionId,ids.revisionOld);
  assert.equal(old.points[0].close,"1.120000000000");
  const newer=fxHistoryFromRows(request("2026-01-06T00:00:00Z"),(await client.query(query,["2026-01-06T00:00:00Z"])).rows);
  assert.equal(newer.points[0].revisionId,ids.revisionNew);
  assert.equal(newer.points[0].close,"1.200000000000");
  const inverse=(await client.query(reverse,["2026-01-06T00:00:00Z"])).rows;
  assert.equal(inverse.length,0);
  assert.equal(fxHistoryFromRows({...request(),baseCurrency:"USD",quoteCurrency:"EUR"},inverse).status,"UNAVAILABLE");
  assert.throws(()=>convertWithFx({history:newer,amount:"2",fromCurrency:"USD",toCurrency:"EUR",marketDate:"2026-01-02",asOf:newer.request.asOf}),/INVALID_PROVIDER_RESPONSE/);
});

test("G2-B exact decimal multiplication without rounding, no future rates or holiday fallback",async()=>{
  const history=fxHistoryFromRows(request(),(await client.query(query,["2026-01-04T23:00:00Z"])).rows);
  const input={history,amount:"0.96",fromCurrency:"EUR",toCurrency:"USD",marketDate:"2026-01-02",asOf:history.request.asOf};
  const result=convertWithFx(input);
  assert.equal(result.status,"AVAILABLE");
  assert.equal(result.convertedAmount,"1.0752");
  assert.equal(result.rate,"1.120000000000");
  assert.equal(result.revisionId,ids.revisionOld);
  assert.equal(convertWithFx({...input,amount:"-1000000000000000000.01"}).convertedAmount,"-1120000000000000000.0112");
  const noDay=convertWithFx({...input,marketDate:"2026-01-03"});
  assert.equal(noDay.status,"UNAVAILABLE");
  assert.equal(noDay.convertedAmount,null);
  assert.equal(noDay.rate,null);
  assert.throws(()=>convertWithFx({...input,asOf:"2026-01-02T00:00:00Z"}),/INVALID_PROVIDER_RESPONSE/);
  assert.throws(()=>convertWithFx({...input,amount:"1e5"}),/INVALID_PROVIDER_RESPONSE/);
  assert.throws(()=>convertWithFx({...input,amount:"NaN"}),/INVALID_PROVIDER_RESPONSE/);
});

test("G2-B immutable pair binding and provenance checks",async()=>{
  await assert.rejects(client.query("INSERT INTO market_core.fx_pairs (listing_id,base_currency,quote_currency) VALUES ($1,'USD','EUR')",[ids.fxListing]));
  const rows=(await client.query(query,["2026-01-04T23:00:00Z"])).rows;
  assert.throws(()=>fxHistoryFromRows(request(),[{...rows[0],fx_base_currency:"USD"}]),/INVALID_PROVIDER_RESPONSE/);
  assert.throws(()=>fxHistoryFromRows(request(),[{...rows[0],currency:"EUR"}]),/INVALID_PROVIDER_RESPONSE/);
  assert.throws(()=>fxHistoryFromRows(request(),[{...rows[0],as_known_at:new Date("2026-01-07T00:00:00Z")}]),/INVALID_PROVIDER_RESPONSE/);
  assert.throws(()=>fxHistoryFromRows(request(),[{...rows[0],provider_id:"fake"}]),/INVALID_PROVIDER_RESPONSE/);
});

test("G2-B license is checked at read time, source metadata masked; no client role access",async()=>{
  await client.query("UPDATE market_core.license_policies SET display_allowed=false WHERE rights_policy_id=$1",[ids.rights]);
  let rows=(await client.query(query,["2026-01-04T23:00:00Z"])).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].close_value,null);
  assert.equal(rows[0].source_revision,null);
  assert.equal(rows[0].status,"LICENSE_BLOCKED");
  const history=fxHistoryFromRows(request(),rows);
  assert.equal(convertWithFx({history,amount:"10",fromCurrency:"EUR",toCurrency:"USD",marketDate:"2026-01-02",asOf:history.request.asOf}).convertedAmount,null);
  await client.query("UPDATE market_core.license_policies SET display_allowed=true,retention_until=CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE rights_policy_id=$1",[ids.rights]);
  rows=(await client.query(query,["2026-01-04T23:00:00Z"])).rows;
  assert.equal(rows[0].status,"LICENSE_BLOCKED");
  await client.query("SET ROLE market_core_reader");
  try {
    const readerRows=(await client.query(query,["2026-01-04T23:00:00Z"])).rows;
    assert.equal(readerRows[0].status,"LICENSE_BLOCKED");
  } finally { await client.query("RESET ROLE"); }
  for(const role of ["anon","authenticated"]){
    await client.query("SET ROLE "+role);
    try { await assert.rejects(client.query(query,["2026-01-04T23:00:00Z"])); }
    finally { await client.query("RESET ROLE"); }
  }
});
