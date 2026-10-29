import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Client} from "pg";

test("R2 Preview legacy coverage migration preserves old unknown without backfill",async()=>{
 const url=process.env.INVESTING_PG17_R2_COVERAGE_URL;
 assert.ok(url && url.includes("127.0.0.1"),
   "only isolated disposable PG17 CI is permitted: NEVER Production/Preview");
 const db=new Client({connectionString:url});
 await db.connect();
 try{
  const version=(await db.query<{version:string}>(
    "SELECT current_setting('server_version') AS version")).rows[0].version;
  assert.match(version,/^17\./);
  await db.query("CREATE SCHEMA investing");
  await db.query("CREATE TABLE investing.portfolio_import_snapshots ("+
    "id bigint generated always as identity primary key,"+
    "expected_cash_rows integer not null,"+
    "expected_position_rows integer not null,"+
    "legacy_source text not null)");
  await db.query("INSERT INTO investing.portfolio_import_snapshots "+
    "(expected_cash_rows,expected_position_rows,legacy_source) VALUES "+
    "(0,1,'historic1'),(2,0,'historic2')");
  const script=await readFile(
    new URL("../../supabase/release-candidates/20261024190500_r2_preview_import_coverage_forward_compat.sql",
      import.meta.url),"utf8");
  await db.query(script);
  const old=await db.query<{reported_cash_coverage:string|null;reported_position_coverage:string|null}>(
    "SELECT reported_cash_coverage,reported_position_coverage FROM "+
    "investing.portfolio_import_snapshots WHERE legacy_source LIKE 'historic%' ORDER BY id");
  assert.deepEqual(old.rows,[
    {reported_cash_coverage:null,reported_position_coverage:null},
    {reported_cash_coverage:null,reported_position_coverage:null},
  ]);
  const validateState=await db.query<{convalidated:boolean}>(
    "SELECT convalidated FROM pg_constraint WHERE conrelid="+
    "'investing.portfolio_import_snapshots'::regclass AND "+
    "conname='portfolio_import_new_coverage_required'");
  assert.deepEqual(validateState.rows,[{convalidated:false}]);
  for(const [cash,positions,cashRows,positionRows] of [
    [null,null,0,1],
    ["NOT_REPORTED",null,0,1],
    ["NOT_REPORTED","PARTIAL",1,1],
    ["PARTIAL","NOT_REPORTED",0,0],
    ["BROKER_CONFIRMED","PARTIAL",0,1],
  ]){
    await assert.rejects(db.query(
      "INSERT INTO investing.portfolio_import_snapshots "+
      "(expected_cash_rows,expected_position_rows,legacy_source,reported_cash_coverage,reported_position_coverage) "+
      "VALUES ($1,$2,'bad-new-import',$3,$4)",
      [cashRows,positionRows,cash,positions]),/check constraint/);
  }
  await db.query("INSERT INTO investing.portfolio_import_snapshots "+
    "(expected_cash_rows,expected_position_rows,legacy_source,reported_cash_coverage,reported_position_coverage) "+
    "VALUES (0,1,'new-future', 'NOT_REPORTED','PARTIAL')");
  const count=await db.query<{n:string}>(
    "SELECT count(*)::text n FROM investing.portfolio_import_snapshots "+
    "WHERE legacy_source LIKE 'historic%' AND "+
    "reported_cash_coverage IS NULL AND reported_position_coverage IS NULL");
  assert.equal(count.rows[0].n,"2","historical snapshots must not acquire invented coverage");
  await assert.rejects(db.query(script),/already exist|already exist/i,
    "applying candidate twice must not silently repair migration history");
 }finally{await db.end();}
});
