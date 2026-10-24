import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Client} from "pg";

test("R2-G candidate: dormant import runtime, no bypass, SET-only membership, guarded replay",async t=>{
  const url=process.env.INVESTING_PG17_R2G_ROLE_URL;
  assert.ok(url&&url.startsWith("postgresql://postgres:postgres@127.0.0.1:5432/")&&
    url.endsWith("/syntrake_r2g_role_ci"),"ONLY disposable isolated PG17");
  const admin=new Client({connectionString:url});
  await admin.connect();
  try{
    const version=(await admin.query<{v:string}>(
      "SELECT current_setting('server_version') v")).rows[0].v;
    assert.match(version,/^17\./);
    await admin.query("CREATE ROLE anon NOINHERIT");
    await admin.query("CREATE ROLE authenticated NOINHERIT");
    await admin.query("CREATE SCHEMA auth");
    await admin.query("CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$"+
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
    const sql=await readFile(new URL(
      "../../supabase/release-candidates/20261024205500_r2_preview_import_runtime_nologin.sql",
      import.meta.url),"utf8");

    await t.test("missing declared coverage blocks without creating role",async()=>{
      await admin.query("BEGIN");
      await admin.query(
        "ALTER TABLE investing.portfolio_import_snapshots DROP COLUMN reported_cash_coverage");
      await assert.rejects(admin.query(sql),/PREVIEW_COVERAGE_UPGRADE_NOT_PROVEN/);
      await admin.query("ROLLBACK");
      const check=await admin.query<{exists:boolean}>(
        "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE "+
        "rolname='investing_import_preview_runtime') AS exists");
      assert.equal(check.rows[0].exists,false);
    });

    await t.test("exact approved-style PG17 candidate creates NOLOGIN with SET, not inherited grants",async()=>{
      await admin.query(sql);
      const result=await admin.query<{
        rolcanlogin:boolean;rolbypassrls:boolean;rolsuper:boolean;
        rolinherit:boolean;membership_set:boolean;membership_inherit:boolean;
        membership_admin:boolean;
      }>(
        "SELECT r.rolcanlogin,r.rolbypassrls,r.rolsuper,r.rolinherit,"+
        "m.set_option membership_set,m.inherit_option membership_inherit,"+
        "m.admin_option membership_admin "+
        "FROM pg_roles r JOIN pg_auth_members m ON m.member=r.oid "+
        "JOIN pg_roles g ON g.oid=m.roleid "+
        "WHERE r.rolname='investing_import_preview_runtime' "+
        "AND g.rolname='investing_import_writer'");
      assert.deepEqual(result.rows,[{
        rolcanlogin:false,rolbypassrls:false,rolsuper:false,
        rolinherit:false,membership_set:true,membership_inherit:false,
        membership_admin:false,
      }]);
      const privileges=await admin.query<{priv:boolean;owner:boolean}>(
        "SELECT has_table_privilege('investing_import_preview_runtime',"+
        "'investing.portfolio_import_snapshots','INSERT') priv,"+
        "has_table_privilege('investing_import_preview_runtime',"+
        "'investing.ledger_transactions','INSERT') owner");
      assert.deepEqual(privileges.rows,[{priv:false,owner:false}]);
    });

    await t.test("manual activation ONLY simulated in CI: login must SET ROLE, cannot post ledger",async()=>{
      // NO REMOTE action. CI-only dummy credential to demonstrate capability.
      await admin.query(
        "ALTER ROLE investing_import_preview_runtime LOGIN "+
        "PASSWORD 'CI_only_disposable_password_12345'");
      const client=new Client({connectionString:
        "postgresql://investing_import_preview_runtime:CI_only_disposable_password_12345"+
        "@127.0.0.1:5432/syntrake_r2g_role_ci"});
      await client.connect();
      try{
        const noInherited=await client.query<{has_import:boolean;has_ledger:boolean}>(
          "SELECT has_table_privilege(current_user,"+
          "'investing.portfolio_import_snapshots','INSERT') AS has_import,"+
          "has_table_privilege(current_user,"+
          "'investing.ledger_transactions','INSERT') AS has_ledger");
        assert.deepEqual(noInherited.rows,[{has_import:false,has_ledger:false}]);
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE investing_import_writer");
        const actor=await client.query<{current_role:string;original_login:string;has_import:boolean;has_ledger:boolean}>(
          "SELECT current_user current_role, session_user original_login,"+
          "has_table_privilege(current_user,'investing.portfolio_import_snapshots','INSERT') has_import,"+
          "has_table_privilege(current_user,'investing.ledger_transactions','INSERT') has_ledger");
        assert.deepEqual(actor.rows,[{
          current_role:"investing_import_writer",
          original_login:"investing_import_preview_runtime",
          has_import:true,has_ledger:false,
        }]);
        await client.query("ROLLBACK");
        const after=await client.query<{role:string}>("SELECT current_user role");
        assert.equal(after.rows[0].role,"investing_import_preview_runtime");
      }finally{await client.end();}
      // Revert the simulated login to restore candidate's literal NOLOGIN state.
      await admin.query("ALTER ROLE investing_import_preview_runtime NOLOGIN PASSWORD NULL");
    });

    await t.test("reapplying candidate fails rather than silently changing role or lineage",async()=>{
      await assert.rejects(admin.query(sql),/IMPORT_RUNTIME_ROLE_EXISTS_RECONCILE_FIRST/);
      await admin.query("ROLLBACK");
      const after=await admin.query<{rolcanlogin:boolean}>(
        "SELECT rolcanlogin FROM pg_roles WHERE rolname='investing_import_preview_runtime'");
      assert.deepEqual(after.rows,[{rolcanlogin:false}]);
    });
    const end=await admin.query<{tx:string;entries:string}>(
      "SELECT (SELECT count(*)::text FROM investing.ledger_transactions) tx,"+
      "(SELECT count(*)::text FROM investing.ledger_entries) entries");
    assert.deepEqual(end.rows,[{tx:"0",entries:"0"}]);
  }finally{await admin.end();}
});
