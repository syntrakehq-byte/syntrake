import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

const PREVIEW_URL=process.env.INVESTING_PG17_R2C_URL;
test("R2-C Postgres17: signed-sub RLS actor A/B and append-only onboarding; financial Core untouched",async(t)=>{
 assert.ok(PREVIEW_URL,"disposable PG17 URL required; no skipped/mock tests");
 const db=new Client({connectionString:PREVIEW_URL});
 await db.connect();
 try{
  const version=await db.query<{v:string}>("select current_setting('server_version') v");
  assert.match(version.rows[0].v,/^17\./);
  await db.query("create role anon noinherit");
  await db.query("create role authenticated noinherit");
  await db.query("create schema auth");
  await db.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
  await db.query("grant usage on schema auth to authenticated");
  await db.query("grant execute on function auth.jwt() to authenticated");
  for(const path of [
   "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
   "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
   "../../supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql",
   "../../supabase/release-candidates/20261022210000_r2c_onboarding_intents.sql",
  ])await db.query(await readFile(new URL(path,import.meta.url),"utf8"));

  const base=await db.query<{accounts:number;ledgers:number;has_r2c:boolean;has_r2b:boolean}>(
   "select (select count(*)::int from investing.investment_accounts) accounts,"+
   "(select count(*)::int from investing.ledger_entries) ledgers,"+
   "(to_regclass('investing.onboarding_intents') is not null) has_r2c,"+
   "(to_regclass('investing.portfolio_import_snapshots') is not null) has_r2b");
  assert.deepEqual(base.rows[0],{accounts:0,ledgers:0,has_r2c:true,has_r2b:true});

  await t.test("new table FORCE RLS; browser can ONLY append its own intent, not financial account",async()=>{
   const flags=await db.query<{rls:boolean;force:boolean}>(
    "select relrowsecurity rls,relforcerowsecurity force from pg_class where oid='investing.onboarding_intents'::regclass");
   assert.deepEqual(flags.rows[0],{rls:true,force:true});
   const privileges=await db.query<{ar:boolean;ai:boolean;au:boolean;ad:boolean;anon:boolean;financial:boolean;importpriv:boolean}>(
    "select has_table_privilege('authenticated','investing.onboarding_intents','SELECT') ar,"+
    "has_table_privilege('authenticated','investing.onboarding_intents','INSERT') ai,"+
    "has_table_privilege('authenticated','investing.onboarding_intents','UPDATE') au,"+
    "has_table_privilege('authenticated','investing.onboarding_intents','DELETE') ad,"+
    "has_table_privilege('anon','investing.onboarding_intents','SELECT') anon,"+
    "has_table_privilege('authenticated','investing.investment_accounts','INSERT') financial,"+
    "has_table_privilege('authenticated','investing.portfolio_import_snapshots','INSERT') importpriv");
   assert.deepEqual(privileges.rows[0],
    {ar:true,ai:true,au:false,ad:false,anon:false,financial:false,importpriv:false});
  });

  const ins="insert into investing.onboarding_intents ("+
   "actor_user_id,idempotency_key,payload_sha256,pathway,import_source) "+
   "values ($1,$2,$3,'HAS_PORTFOLIO','MANUAL_ENTRY') on conflict do nothing returning id";
  const a="user_clerk_r2c_A",b="user_clerk_r2c_B";
  const hash="a".repeat(64),key="00000000-0000-4000-8000-000000000011";
  async function asActor(actor:string,fn:()=>Promise<void>){
   await db.query("begin");
   try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor})]);
    await fn();
   } finally {await db.query("commit");}
  }
  await t.test("A persisted append, idempotent replay; B cannot inspect or forge A",async()=>{
   await asActor(a,async()=>{
    const first=await db.query<{id:string}>(ins,[a,key,hash]);
    assert.equal(first.rows.length,1);
    const replay=await db.query(ins,[a,key,hash]);
    assert.equal(replay.rows.length,0);
    assert.equal((await db.query("select id from investing.onboarding_intents")).rowCount,1);
    await db.query("savepoint denied_insert_a");
    await assert.rejects(db.query(ins,[b,"00000000-0000-4000-8000-000000000012",hash]),/row-level security/);
    await db.query("rollback to savepoint denied_insert_a");
   });
   await asActor(b,async()=>{
    assert.equal((await db.query("select id from investing.onboarding_intents")).rowCount,0);
    await db.query("savepoint denied_insert_b");
    await assert.rejects(db.query(ins,[a,"00000000-0000-4000-8000-000000000013",hash]),/row-level security/);
    await db.query("rollback to savepoint denied_insert_b");
    const record=await db.query(ins,[b,"00000000-0000-4000-8000-000000000014",hash]);
    assert.equal(record.rowCount,1);
    assert.equal((await db.query("select id from investing.onboarding_intents")).rowCount,1);
   });
   await asActor(a,async()=>{
    assert.equal((await db.query("select id from investing.onboarding_intents")).rowCount,1);
    await db.query("savepoint denied_mutate_a");
    await assert.rejects(db.query("update investing.onboarding_intents set pathway='NEEDS_PORTFOLIO' where actor_user_id=$1",[a]),/permission denied/);
    await db.query("rollback to savepoint denied_mutate_a");
   });
  });
  await t.test("missing JWT and anon cannot read, write or infer user financial state",async()=>{
   await asActor("unrecognized",async()=>{
    assert.equal((await db.query("select id from investing.onboarding_intents")).rowCount,0);
   });
   await db.query("set role anon");
   try{await assert.rejects(db.query("select id from investing.onboarding_intents"),/permission denied/);}
   finally{await db.query("reset role");}
   const last=await db.query<{onboarding:number;ledger:number;accounts:number;trading:number}>(
    "select (select count(*)::int from investing.onboarding_intents) onboarding,"+
    "(select count(*)::int from investing.ledger_entries) ledger,"+
    "(select count(*)::int from investing.investment_accounts) accounts,"+
    "(select count(*)::int from pg_namespace where nspname='trading') trading");
   assert.deepEqual(last.rows[0],{onboarding:2,ledger:0,accounts:0,trading:0});
  });
 }finally{await db.end();}
});
