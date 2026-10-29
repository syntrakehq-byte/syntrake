import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {Client} from "pg";

test("real historic R2-B1 schema: two finalized legacy imports survive coverage upgrade",async()=>{
 const url=process.env.INVESTING_PG17_R2G_HISTORICAL_URL;
 assert.equal(url,"postgresql://postgres:postgres@127.0.0.1:5432/syntrake_r2g_history_ci");
 const db=new Client({connectionString:url});
 await db.connect();
 try{
   assert.match((await db.query<{v:string}>("SELECT current_setting('server_version') v")).rows[0].v,/^17\./);
   await db.query("CREATE ROLE anon NOINHERIT");
   await db.query("CREATE ROLE authenticated NOINHERIT");
   await db.query("CREATE SCHEMA auth");
   await db.query("CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ "+
     "SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
   await db.query("GRANT USAGE ON SCHEMA auth TO authenticated");
   await db.query("GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated");
   for(const path of [
     "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
     "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
     "./fixtures/r2b-legacy-20261022-actual-table-contract.sql",
   ])await db.query(await readFile(new URL(path,import.meta.url),"utf8"));

   const columns=await db.query<{n:string}>(
     "SELECT count(*)::text n FROM information_schema.columns "+
     "WHERE table_schema='investing' AND table_name='portfolio_import_snapshots' "+
     "AND column_name IN ('reported_cash_coverage','reported_position_coverage')");
   assert.equal(columns.rows[0].n,"0");

   const a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",b="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
   const pa="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",pb="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
   const userA="user_r2g_historic_a",userB="user_r2g_historic_b";
   await db.query("BEGIN");
   await db.query("INSERT INTO investing.identity_accounts(user_id) VALUES ($1),($2)",[userA,userB]);
   await db.query("INSERT INTO investing.investment_accounts(id,owner_user_id,name,base_currency) "+
     "VALUES ($1,$2,'A','EUR'),($3,$4,'B','EUR')",[a,userA,b,userB]);
   await db.query("INSERT INTO investing.account_memberships(investment_account_id,user_id,role) "+
     "VALUES ($1,$2,'owner'),($3,$4,'owner')",[a,userA,b,userB]);
   await db.query("INSERT INTO investing.portfolios(id,investment_account_id,name) "+
     "VALUES ($1,$2,'A'),($3,$4,'B')",[pa,a,pb,b]);
   const ids:string[]=[];
   for(const [account,portfolio,user,source,cash,position] of [
     [a,pa,userA,"historic-A",1,0],[b,pb,userB,"historic-B",0,1],
   ] as const){
     const row=await db.query<{id:string}>(
       "INSERT INTO investing.portfolio_import_snapshots "+
       "(investment_account_id,portfolio_id,actor_user_id,idempotency_key,payload_sha256,"+
       "import_schema_version,expected_cash_rows,expected_position_rows,expected_planned_rows,"+
       "declared_portfolio_name,declared_base_currency,source_kind,source_reference,source_as_of) "+
       "VALUES ($1,$2,$3,$4,$5,'R2_IMPORT_DRAFT_V1',$6,$7,0,"+
       "'Historic','EUR','MANUAL_ENTRY',$8,'2026-10-20T18:00:00Z') RETURNING id",
       [account,portfolio,user,"historic-idem-"+source+"-0001","a".repeat(64),cash,position,"historic-source-"+source]);
     ids.push(row.rows[0].id);
   }
   await db.query("INSERT INTO investing.portfolio_import_cash "+
     "(snapshot_id,investment_account_id,portfolio_id,currency,reported_amount_minor) "+
     "VALUES ($1,$2,$3,'EUR',12345)",[ids[0],a,pa]);
   await db.query("INSERT INTO investing.portfolio_import_positions "+
     "(snapshot_id,investment_account_id,portfolio_id,isin,mic,quote_currency,quantity_atoms) "+
     "VALUES ($1,$2,$3,'US0378331005','XNAS','USD',1000000000001)",[ids[1],b,pb]);
   await db.query("UPDATE investing.portfolio_import_snapshots "+
     "SET snapshot_status='finalized' WHERE id=ANY($1::uuid[])",[ids]);
   await db.query("COMMIT");

   const fingerprint=async()=>{
     const res=await db.query<{v:string}>("SELECT encode(sha256(convert_to("+
       "coalesce(jsonb_agg(to_jsonb(s)-'reported_cash_coverage'-"+
       "'reported_position_coverage' ORDER BY s.id),'[]'::jsonb)::text,'UTF8')),'hex') v "+
       "FROM investing.portfolio_import_snapshots s");
     return res.rows[0].v;
   };
   const initial=await fingerprint();
   const upgrade=await readFile(new URL(
     "../../supabase/release-candidates/20261024190500_r2_preview_import_coverage_forward_compat.sql",
      import.meta.url),"utf8");
   await db.query(upgrade);
   assert.equal(await fingerprint(),initial,"no historical financial field changed");
   const rows=await db.query<{cash:string|null;positions:string|null}>(
     "SELECT reported_cash_coverage cash,reported_position_coverage positions "+
     "FROM investing.portfolio_import_snapshots ORDER BY id");
   assert.deepEqual(rows.rows,[{cash:null,positions:null},{cash:null,positions:null}]);
   await assert.rejects(db.query("INSERT INTO investing.portfolio_import_snapshots "+
     "(investment_account_id,portfolio_id,actor_user_id,idempotency_key,payload_sha256,"+
     "import_schema_version,expected_cash_rows,expected_position_rows,expected_planned_rows,"+
     "declared_portfolio_name,declared_base_currency,source_kind,source_reference,source_as_of) "+
     "VALUES ($1,$2,$3,'historic-missing-new-0001',$4,'R2_IMPORT_DRAFT_V1',"+
     "1,0,0,'Bad','EUR','MANUAL_ENTRY','missing-new-coverage','2026-10-23T18:00:00Z')",
     [a,pa,userA,"b".repeat(64)]),/portfolio_import_new_coverage_required/);
   assert.equal(await fingerprint(),initial);
   const totals=await db.query<{count:string;ledger:string}>("SELECT "+
     "(SELECT count(*)::text FROM investing.portfolio_import_snapshots) count,"+
     "(SELECT count(*)::text FROM investing.ledger_transactions) ledger");
   assert.deepEqual(totals.rows[0],{count:"2",ledger:"0"});
 }finally{await db.end();}
});
