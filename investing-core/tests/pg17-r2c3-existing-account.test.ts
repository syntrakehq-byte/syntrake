import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

/**
 * Isolated PG17: the same base R0/R1 account and portfolio RLS used by
 * Supabase PostgREST. Signed Clerk token gateway verification is NOT tested.
 */
test("R2-C3 PG17: A/B existing accounts read-only RLS with no synthetic cash", async t => {
  const url=process.env.INVESTING_PG17_R2C3_URL;
  assert.ok(url && url.includes("127.0.0.1"),"isolated local PG17 required; Production forbidden");
  const db=new Client({connectionString:url});
  await db.connect();
  try {
    const version=(await db.query<{value:string}>(
      "SELECT current_setting('server_version') AS value")).rows[0].value;
    assert.match(version,/^17\./);
    await db.query("CREATE ROLE anon NOINHERIT");
    await db.query("CREATE ROLE authenticated NOINHERIT");
    await db.query("CREATE SCHEMA auth");
    await db.query("CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ "+
      "SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
    await db.query("GRANT USAGE ON SCHEMA auth TO authenticated");
    await db.query("GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated");
    for(const path of [
      "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
      "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
    ]) await db.query(await readFile(new URL(path,import.meta.url),"utf8"));

    const actorA="user_test_existing_A",actorB="user_test_existing_B";
    const a1="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const a2="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const b1="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const pA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    const pB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
    await db.query("BEGIN");
    try {
      await db.query("INSERT INTO investing.identity_accounts(user_id) VALUES ($1),($2)",
        [actorA,actorB]);
      await db.query("INSERT INTO investing.investment_accounts(id,owner_user_id,name,base_currency) "+
        "VALUES ($1,$2,'A-1','EUR'),($3,$2,'A-2','EUR'),($4,$5,'B-1','EUR')",
        [a1,actorA,a2,b1,actorB]);
      await db.query("INSERT INTO investing.account_memberships(investment_account_id,user_id,role) "+
        "VALUES ($1,$2,'owner'),($3,$2,'owner'),($4,$5,'owner')",
        [a1,actorA,a2,b1,actorB]);
      await db.query("INSERT INTO investing.portfolios(id,investment_account_id,name) "+
        "VALUES ($1,$2,'A-portfolio'),($3,$4,'B-portfolio')",[pA,a1,pB,b1]);
      await db.query("COMMIT");
    } catch(error){await db.query("ROLLBACK");throw error;}

    await t.test("RLS enabled and forced, anonymous actor has no table grants",async()=>{
      const res=await db.query<{table:string;rls:boolean;forced:boolean}>(
        "SELECT relname AS table,relrowsecurity AS rls,relforcerowsecurity AS forced "+
        "FROM pg_class WHERE oid IN "+
        "('investing.investment_accounts'::regclass,'investing.portfolios'::regclass)");
      assert.equal(res.rows.length,2);
      assert.ok(res.rows.every(x=>x.rls && x.forced));
      const acl=await db.query<{ai:boolean;au:boolean;ar:boolean;anon:boolean}>(
        "SELECT has_table_privilege('authenticated','investing.investment_accounts','INSERT') ai,"+
        "has_table_privilege('authenticated','investing.investment_accounts','UPDATE') au,"+
        "has_table_privilege('authenticated','investing.investment_accounts','SELECT') ar,"+
        "has_table_privilege('anon','investing.investment_accounts','SELECT') anon");
      assert.deepEqual(acl.rows[0],{ai:false,au:false,ar:true,anon:false});
    });
    async function readAs(actor:string) {
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL ROLE authenticated");
        await db.query("SELECT set_config('request.jwt.claims',$1,true)",
          [JSON.stringify({sub:actor})]);
        const accounts=await db.query<{id:string;owner_user_id:string}>(
          "SELECT id,owner_user_id FROM investing.investment_accounts ORDER BY id");
        const portfolios=await db.query<{id:string;investment_account_id:string}>(
          "SELECT id,investment_account_id FROM investing.portfolios ORDER BY id");
        await db.query("COMMIT");
        return {accounts:accounts.rows,portfolios:portfolios.rows};
      }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
    }
    await t.test("actor A sees exactly two own accounts; B cannot see A even knowing A IDs",async()=>{
      const a=await readAs(actorA);
      assert.deepEqual(a.accounts.map(x=>x.id),[a1,a2]);
      assert.deepEqual(a.portfolios.map(x=>x.id),[pA]);
      const b=await readAs(actorB);
      assert.deepEqual(b.accounts.map(x=>x.id),[b1]);
      assert.deepEqual(b.portfolios.map(x=>x.id),[pB]);
      const other=await readAs("user_no_financial_account");
      assert.deepEqual(other.accounts,[]);
      assert.deepEqual(other.portfolios,[]);
    });
    await t.test("authenticated cannot create accounts or financial movements",async()=>{
      await db.query("BEGIN");
      try{
        await db.query("SET LOCAL ROLE authenticated");
        await db.query("SELECT set_config('request.jwt.claims',$1,true)",
          [JSON.stringify({sub:actorA})]);
        await db.query("SAVEPOINT forbidden");
        await assert.rejects(db.query(
          "INSERT INTO investing.investment_accounts(owner_user_id,name,base_currency) "+
          "VALUES ($1,'FORGED','EUR')",[actorA]),/permission denied/);
        await db.query("ROLLBACK TO SAVEPOINT forbidden");
        const ledgers=await db.query<{count:string}>(
          "SELECT count(*)::text count FROM investing.ledger_transactions");
        assert.equal(ledgers.rows[0].count,"0");
        await db.query("ROLLBACK");
      }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
    });
  } finally {await db.end();}
});
