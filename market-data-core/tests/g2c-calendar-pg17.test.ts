import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Client} from "pg";
import {historicalRowsToResult} from "../contracts";
import {tradingCalendarFromRows,assessHistoricalDailyClose} from "../marketQuality";

const client=new Client({host:process.env.PGHOST??"127.0.0.1",
  port:Number(process.env.PGPORT??5432),user:process.env.PGUSER??"postgres",
  password:process.env.PGPASSWORD??"postgres",database:process.env.PGDATABASE??"postgres",
  connectionTimeoutMillis:3000});
const ids={
  provider:"00000000-0000-0000-0000-000000000301",
  calProvider:"00000000-0000-0000-0000-000000000302",
  rights:"00000000-0000-0000-0000-000000000303",
  calRights:"00000000-0000-0000-0000-000000000304",
  issuer:"00000000-0000-0000-0000-000000000305",
  instrument:"00000000-0000-0000-0000-000000000306",
  listing:"00000000-0000-0000-0000-000000000307",
  observation:"00000000-0000-0000-0000-000000000308",
  rev:"00000000-0000-0000-0000-000000000309",
};
const cutoff="2026-01-04T23:00:00Z";
const req={listingId:ids.listing,providerId:ids.calProvider,
  startDate:"2026-01-01",endDate:"2026-01-04",asOf:cutoff};
const hreq={listingId:ids.listing,startDate:req.startDate,endDate:req.endDate,
  asOf:cutoff,interval:"1day" as const,adjustment:"none" as const};
const rights={marketPolicyId:ids.rights,calendarPolicyId:ids.calRights};
let connected=false;
async function migration(path:string){await client.query(await readFile(resolve(process.cwd(),path),"utf8"));}
const sessionSql="SELECT * FROM market_core.read_trading_calendar($1,$2,$3::date,$4::date,$5::timestamptz)";
const marketSql="SELECT * FROM market_core.read_market_history($1,$2::date,$3::date,$4::timestamptz,'1day','none')";
async function rawCalendar(asOf=cutoff,start=req.startDate,end=req.endDate){
 return (await client.query(sessionSql,[ids.listing,ids.calProvider,start,end,asOf])).rows;
}
async function rawMarket(asOf=cutoff,start=req.startDate,end=req.endDate){
 return (await client.query(marketSql,[ids.listing,start,end,asOf])).rows;
}
async function assess(asOf=cutoff,start=req.startDate,end=req.endDate){
 const [c,m]=await Promise.all([rawCalendar(asOf,start,end),rawMarket(asOf,start,end)]);
 const calendar=tradingCalendarFromRows({...req,startDate:start,endDate:end,asOf},c);
 const history=historicalRowsToResult({...hreq,startDate:start,endDate:end,asOf},m);
 return assessHistoricalDailyClose({historical:history,calendar,rights,closeGraceMinutes:30});
}
before(async()=>{
 await client.connect();connected=true;
 assert.match((await client.query("SELECT current_setting('server_version') version")).rows[0].version,/^17\./);
 for(const file of [
  "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql",
  "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql",
  "supabase/release-candidates/20261102090000_g2a_universal_historical_api.sql",
  "supabase/release-candidates/20261102120000_g2b_directed_fx_candidate.sql",
  "supabase/release-candidates/20261102130000_g2c_trading_calendar_candidate.sql",
 ])await migration(file);
 await client.query("INSERT INTO market_core.providers VALUES ($1,'G2C_MARKET','ACTIVE'),($2,'G2C_CALENDAR','ACTIVE')",[ids.provider,ids.calProvider]);
 await client.query("INSERT INTO market_core.license_policies VALUES ($1,'g2c-market',true,true,NULL),($2,'g2c-calendar',true,true,NULL)",[ids.rights,ids.calRights]);
 await client.query("INSERT INTO market_core.issuers VALUES ($1,'G2C Issuer')",[ids.issuer]);
 await client.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')",[ids.instrument,ids.issuer]);
 await client.query("INSERT INTO market_core.listings (listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from,valid_to) VALUES ($1,$2,'XNAS','OPERATING','USD','G2C','2020-01-01',NULL)",[ids.listing,ids.instrument]);
 await client.query("INSERT INTO market_core.market_observations VALUES ($1,$2,$3,$4,'1day','2026-01-02','America/New_York','none','2026-01-03Z')",[ids.observation,ids.listing,ids.provider,ids.rights]);
 await client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,first_seen_at,ingested_at,as_known_at,quality_flags) VALUES ($1,$2,$3,repeat('b',64),100,110,99,105,'2026-01-03Z','2026-01-03Z','2026-01-03Z',ARRAY[]::text[])",[ids.rev,ids.observation,ids.listing]);
 // Every closure is explicit source evidence, NOT a weekend/holiday algorithm.
 const sessions=[
  {day:"2026-01-01",state:"CLOSED",close:null,published:"2025-12-20T00:00:00Z",known:"2026-01-01T22:00:00Z"},
  {day:"2026-01-02",state:"OPEN",close:"2026-01-02T21:00:00Z",published:"2025-12-20T00:00:00Z",known:"2026-01-03T00:00:00Z"},
  {day:"2026-01-03",state:"CLOSED",close:null,published:"2025-12-20T00:00:00Z",known:"2026-01-03T22:00:00Z"},
  {day:"2026-01-04",state:"CLOSED",close:null,published:"2025-12-20T00:00:00Z",known:"2026-01-04T22:00:00Z"},
 ];
 const insertCalendar="INSERT INTO market_core.trading_calendar_revisions "+
   "(calendar_revision_id,listing_id,provider_id,rights_policy_id,market_date,"+
   "session_state,evidence_state,exchange_timezone,session_close_at,source_revision,"+
   "source_published_at,first_seen_at,ingested_at,as_known_at) "+
   "VALUES ($1,$2,$3,$4,$5,$6,'SOURCE_CONFIRMED','America/New_York',$7,"+
   "repeat($8,64),$9,$10,$10,$10)";
 for(let i=0;i<sessions.length;i++){
  const s=sessions[i],id="00000000-0000-0000-0000-00000000031"+String(i);
  await client.query(insertCalendar,
    [id,ids.listing,ids.calProvider,ids.calRights,s.day,s.state,s.close,["a","b","c","d"][i],s.published,s.known]);
 }
});
after(async()=>{
 if(connected){
  await client.query("DROP SCHEMA IF EXISTS market_core CASCADE");
  for(const r of ["market_core_calendar_ingest","market_core_reader","market_core_ingest",
   "market_core_catalog_ingest","market_core_catalog_reader","market_core_registry_reviewer","anon","authenticated"])
    await client.query("DROP ROLE IF EXISTS "+r);
  await client.end();
 }
});
test("G2-C calendar PIT proves coverage without implying realtime",async()=>{
 const result=await assess();
 assert.equal(result.state,"COMPLETE");
 assert.equal(result.coverage,"FULL");
 assert.equal(result.freshness,"DAILY_CLOSE_CURRENT");
 assert.equal(result.integrity,"NOT_EXTERNALLY_VERIFIED");
 assert.equal(result.dueSessions,1);
 assert.equal(result.coveredSessions,1);
 assert.equal(result.lastDueSessionDate,"2026-01-02");
 const rows=await rawCalendar();
 assert.equal(rows.length,4);
 const cal=tradingCalendarFromRows(req,rows);
 assert.equal(cal.status,"AVAILABLE");
 assert.equal(cal.sessions[1].closeAt,"2026-01-02T21:00:00.000Z");
 assert.equal(cal.sessions[2].state,"CLOSED");
});
test("G2-C absent calendar day is UNKNOWN, not presumed weekend closure",async()=>{
 const result=await assess(cutoff,"2026-01-01","2026-01-05");
 assert.equal(result.state,"CALENDAR_UNVERIFIED");
 assert.equal(result.coverage,"UNKNOWN");
 assert.equal(result.dueSessions,null);
 const history=historicalRowsToResult(hreq,await rawMarket());
 const calendar=tradingCalendarFromRows(req,[]);
 assert.equal(assessHistoricalDailyClose({historical:history,calendar,rights,closeGraceMinutes:30}).state,"CALENDAR_UNVERIFIED");
});
test("G2-C corrected short session cannot appear before PIT knowledge",async()=>{
 const sql="INSERT INTO market_core.trading_calendar_revisions "+
 "(calendar_revision_id,listing_id,provider_id,rights_policy_id,market_date,"+
 "session_state,evidence_state,exchange_timezone,session_close_at,source_revision,"+
 "source_published_at,first_seen_at,ingested_at,as_known_at) "+
 "VALUES ('00000000-0000-0000-0000-000000000315',$1,$2,$3,'2026-01-02',"+
 "'SHORT_SESSION','SOURCE_CONFIRMED','America/New_York','2026-01-02T18:00:00Z',"+
 "repeat('e',64),'2026-01-05Z','2026-01-05Z','2026-01-05Z','2026-01-05Z')";
 await client.query(sql,[ids.listing,ids.calProvider,ids.calRights]);
 const old=(await rawCalendar())[1];
 const newer=(await rawCalendar("2026-01-06T00:00:00Z"))[1];
 assert.equal(old.session_state,"OPEN");
 assert.equal(newer.session_state,"SHORT_SESSION");
 assert.equal(newer.session_close_at.toISOString(),"2026-01-02T18:00:00.000Z");
 assert.equal((await assess()).state,"COMPLETE");
 await assert.rejects(client.query("UPDATE market_core.trading_calendar_revisions SET session_state='CLOSED' WHERE calendar_revision_id='00000000-0000-0000-0000-000000000315'"));
 await assert.rejects(client.query("DELETE FROM market_core.trading_calendar_revisions WHERE calendar_revision_id='00000000-0000-0000-0000-000000000315'"));
});
test("G2-C licensing masks calendar revisions and client roles cannot access",async()=>{
 await client.query("UPDATE market_core.license_policies SET display_allowed=false WHERE rights_policy_id=$1",[ids.calRights]);
 const rows=await rawCalendar();
 assert.equal(rows[0].status,"LICENSE_BLOCKED");
 for(const key of ["session_state","evidence_state","exchange_timezone","session_close_at","calendar_revision_id","as_known_at","source_published_at","source_revision"])
  assert.equal(rows[0][key],null);
 const calendar=tradingCalendarFromRows(req,rows);
 assert.equal(calendar.status,"LICENSE_BLOCKED");
 const history=historicalRowsToResult(hreq,await rawMarket());
 const result=assessHistoricalDailyClose({historical:history,calendar,rights,closeGraceMinutes:30});
 assert.equal(result.state,"LICENSE_BLOCKED");
 assert.equal(result.lastAvailableSessionDate,null);
 await client.query("SET ROLE market_core_reader");
 try{assert.equal((await rawCalendar())[0].status,"LICENSE_BLOCKED");}
 finally{await client.query("RESET ROLE");}
 for(const role of ["anon","authenticated"]){
  await client.query("SET ROLE "+role);
  try{await assert.rejects(rawCalendar());}
  finally{await client.query("RESET ROLE");}
 }
 await client.query("UPDATE market_core.license_policies SET display_allowed=true,retention_until=CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE rights_policy_id=$1",[ids.calRights]);
 assert.equal((await rawCalendar())[0].status,"LICENSE_BLOCKED");
 await client.query("UPDATE market_core.license_policies SET retention_until=NULL WHERE rights_policy_id=$1",[ids.calRights]);
});
test("G2-C rejects invalid timezone, dates, provenance and mixed rights",async()=>{
 const source=await rawCalendar();
 for(const fields of [
  {session_state:"UNKNOWN"},{evidence_state:"FAKE"},{exchange_timezone:"Bad/Unknown"},
  {session_close_at:new Date("2026-01-03T21:00:00Z")},
  {calendar_revision_id:"nope"},{source_revision:"abc"},
  {as_known_at:new Date("2026-01-09T00:00:00Z")},{market_date:"2026-02-30"},
 ]){
  assert.throws(()=>tradingCalendarFromRows(req,[{...source[1],...fields}]),{code:"INVALID_PROVIDER_RESPONSE"});
 }
 assert.throws(()=>tradingCalendarFromRows(req,[source[1],source[1]]),{code:"INVALID_PROVIDER_RESPONSE"});
 assert.throws(()=>tradingCalendarFromRows(req,[source[0],{...source[1],rights_policy_id:ids.rights}]),{code:"INVALID_PROVIDER_RESPONSE"});
 const cal=tradingCalendarFromRows(req,source);
 const hist=historicalRowsToResult(hreq,await rawMarket());
 const result=assessHistoricalDailyClose({historical:hist,calendar:cal,
   rights:{...rights,calendarPolicyId:ids.rights},closeGraceMinutes:30});
 assert.equal(result.state,"LICENSE_BLOCKED");
 assert.equal(result.coverage,"UNKNOWN");
});

test("G2-C distinguishes missing close, no due session and calendar conflict",async()=>{
 const calendar=tradingCalendarFromRows(req,await rawCalendar());
 const missing=historicalRowsToResult(hreq,[]);
 const stale=assessHistoricalDailyClose({historical:missing,calendar,rights,closeGraceMinutes:30});
 assert.equal(stale.state,"STALE");
 assert.equal(stale.freshness,"DAILY_CLOSE_LAGGING");
 assert.equal(stale.dueSessions,1);
 assert.equal(stale.coveredSessions,0);
 const closedReq={...req,startDate:"2026-01-03"};
 const closedHist=historicalRowsToResult({...hreq,startDate:"2026-01-03"},[]);
 const closedCal=tradingCalendarFromRows(closedReq,await rawCalendar(cutoff,"2026-01-03","2026-01-04"));
 assert.equal(assessHistoricalDailyClose({historical:closedHist,calendar:closedCal,rights,closeGraceMinutes:30}).state,"NO_DUE_SESSIONS");
 const history=historicalRowsToResult(hreq,await rawMarket());
 const conflicting={
   ...calendar,
   sessions:calendar.sessions.map(s=>s.marketDate==="2026-01-02"?
    {...s,state:"CLOSED" as const,closeAt:null}:s),
 };
 assert.equal(assessHistoricalDailyClose({historical:history,calendar:conflicting,rights,closeGraceMinutes:30}).state,"CALENDAR_CONFLICT");
});
test("G2-C timezone uses IANA DST and scheduled due sessions cannot claim evidence",async()=>{
 const row=(await rawCalendar())[1];
 const request={...req,startDate:"2026-03-09",endDate:"2026-03-09",asOf:"2026-03-10T01:00:00Z"};
 const late={...row,market_date:"2026-03-09",as_known_at:new Date("2026-03-09T22:00:00Z"),
  source_published_at:new Date("2026-03-01T00:00:00Z"),
  session_close_at:new Date("2026-03-09T20:00:00Z")};
 assert.equal(tradingCalendarFromRows(request,[late]).sessions[0].closeAt,"2026-03-09T20:00:00.000Z");
 assert.throws(()=>tradingCalendarFromRows(request,[{...late,session_close_at:new Date("2026-03-09T02:00:00Z")}]),{code:"INVALID_PROVIDER_RESPONSE"});
 const scheduled={...row,evidence_state:"SCHEDULED"};
 const cal=tradingCalendarFromRows(req,[...(await rawCalendar()).map(r=>r.market_date.toISOString().slice(0,10)==="2026-01-02"?scheduled:r)]);
 const hist=historicalRowsToResult(hreq,await rawMarket());
 assert.equal(assessHistoricalDailyClose({historical:hist,calendar:cal,rights,closeGraceMinutes:30}).state,"CALENDAR_UNVERIFIED");
});
