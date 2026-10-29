import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Client,Pool} from "pg";
import {assertPreviewImportCatalogReady,PreviewImportCatalogBlocked}
 from "../server/verifyPreviewImportCatalog";

test("R2 Preview catalog guard: absent RPC, signed-off RPC retirement, hash/ACL drift (PG17)",async t=>{
  const url=process.env.INVESTING_PG17_R2_SECURITY_URL;
  assert.ok(url?.includes("127.0.0.1"),
    "ONLY disposable local PG17; NEVER Production/remote Supabase");
  const admin=new Client({connectionString:url});
  const pool=new Pool({connectionString:url,max:2});
  await admin.connect();
  try{
    const version=(await admin.query<{v:string}>(
      "SELECT current_setting('server_version') AS v")).rows[0].v;
    assert.match(version,/^17\./);
    await admin.query("CREATE ROLE anon NOINHERIT");
    await admin.query("CREATE ROLE authenticated NOINHERIT");
    await admin.query("CREATE SCHEMA auth");
    await admin.query("CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ "+
      "SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
    await admin.query("GRANT USAGE ON SCHEMA auth TO authenticated");
    await admin.query("GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated");
    for(const file of [
      "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
      "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
      "../../supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql",
    ]){
      await admin.query(await readFile(new URL(file,import.meta.url),"utf8"));
    }
    await t.test("current private import schema passes preflight without exposure",async()=>{
      await assert.doesNotReject(assertPreviewImportCatalogReady(pool));
    });
    await admin.query("CREATE ROLE investing_initial_provisioner NOLOGIN");
    // %ROWTYPE is referenced in the historical PL/pgSQL declaration, but the
    // privileged function is NEVER executed in these isolated security tests.
    await admin.query(
      "CREATE TABLE investing.initial_portfolio_receipts ("+
      "user_id text, idempotency_key uuid,request_sha256 text,"+
      "account_id uuid,portfolio_id uuid)");
    const fixture=await readFile(new URL(
      "./fixtures/r2-preview-legacy-privileged-provision-function.sql",import.meta.url),"utf8");
    await admin.query(fixture);
    await admin.query("ALTER FUNCTION investing.provision_first_portfolio(uuid,text,text,text) "+
      "OWNER TO investing_initial_provisioner");
    await admin.query("REVOKE EXECUTE ON FUNCTION "+
      "investing.provision_first_portfolio(uuid,text,text,text) FROM PUBLIC");
    await admin.query("GRANT EXECUTE ON FUNCTION "+
      "investing.provision_first_portfolio(uuid,text,text,text) TO authenticated");
    const pgsha=await admin.query<{hash:string}>(
      "SELECT encode(sha256(convert_to(pg_get_functiondef("+
      "'investing.provision_first_portfolio(uuid,text,text,text)'::regprocedure),"+
      "'UTF8')),'hex') AS hash");
    assert.equal(pgsha.rows[0].hash,
      "563ca89cf9cde2b75530de84d9ef60655f842e83ad78dc784ca34747651889b7",
      "CI fixture must match live Preview function definition before test");

    await t.test("historical authenticated-executable definer RPC blocks import",async()=>{
      await assert.rejects(assertPreviewImportCatalogReady(pool),
        (e:unknown)=>e instanceof PreviewImportCatalogBlocked);
      const grant=await admin.query<{v:boolean}>(
        "SELECT has_function_privilege('authenticated',"+
        "'investing.provision_first_portfolio(uuid,text,text,text)','EXECUTE') AS v");
      assert.equal(grant.rows[0].v,true);
    });

    const migration=await readFile(new URL(
      "../../supabase/release-candidates/20261024194500_r2_preview_revoke_legacy_provision_rpc.sql",
      import.meta.url),"utf8");
    await t.test("changed search_path causes precondition failure, leaves grant unchanged",async()=>{
      await admin.query("ALTER FUNCTION investing.provision_first_portfolio(uuid,text,text,text) "+
        "SET search_path TO pg_catalog, public");
      await assert.rejects(admin.query(migration),/PREVIEW_RPC_DEFINITION_ACL_DRIFT/);
      await admin.query("ROLLBACK");
      const privileges=await admin.query<{v:boolean}>(
        "SELECT has_function_privilege('authenticated',"+
        "'investing.provision_first_portfolio(uuid,text,text,text)','EXECUTE') AS v");
      assert.equal(privileges.rows[0].v,true);
      await admin.query("ALTER FUNCTION investing.provision_first_portfolio(uuid,text,text,text) "+
        "SET search_path TO pg_catalog, investing");
    });
    await t.test("exact known old function can be retired without data changes",async()=>{
      await admin.query(migration);
      const status=await admin.query<{has_grant:boolean;hash:string}>(
        "SELECT has_function_privilege('authenticated',"+
        "'investing.provision_first_portfolio(uuid,text,text,text)','EXECUTE') has_grant,"+
        "encode(sha256(convert_to(pg_get_functiondef("+
        "'investing.provision_first_portfolio(uuid,text,text,text)'::regprocedure),"+
        "'UTF8')),'hex') hash");
      assert.equal(status.rows[0].has_grant,false);
      assert.equal(status.rows[0].hash,
        "563ca89cf9cde2b75530de84d9ef60655f842e83ad78dc784ca34747651889b7");
      await assert.doesNotReject(assertPreviewImportCatalogReady(pool));
    });
    await t.test("second migration run fails rather than rewriting lineage",async()=>{
      await assert.rejects(admin.query(migration),/PREVIEW_RPC_DEFINITION_ACL_DRIFT/);
      await admin.query("ROLLBACK");
      await assert.doesNotReject(assertPreviewImportCatalogReady(pool));
    });
    const ledger=await admin.query<{entries:string;tx:string}>(
      "SELECT (SELECT count(*)::text FROM investing.ledger_entries) entries,"+
      "(SELECT count(*)::text FROM investing.ledger_transactions) tx");
    assert.deepEqual(ledger.rows[0],{entries:"0",tx:"0"});
  }finally{await pool.end();await admin.end();}
});
