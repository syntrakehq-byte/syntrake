import assert from "node:assert/strict";
import { Client } from "pg";
import { verifyR2ProductionBundle } from "./verifyR2ProductionBundle";

/** CLI migration verification on one hard-coded local disposable PG17 DB only. */
const fixed = "postgresql://postgres:postgres@127.0.0.1:5432/syntrake_cli_rehearsal";
async function verify() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.INVESTING_RELEASE_CLI_DB_URL, fixed, "never use remote URLs");
  const files = await verifyR2ProductionBundle();
  const db = new Client({ connectionString: fixed });
  await db.connect();
  try {
    assert.match((await db.query<{v:string}>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    const names = await db.query<{version:string;name:string}>(
      "select version,name from supabase_migrations.schema_migrations order by version");
    assert.equal(names.rows.length, 6, "R0/R1 predecessor plus exactly 4 R2 migrations");
    assert.deepEqual(names.rows.slice(0,2), [
      { version: "20261017191056", name: "remote_schema" },
      { version: "20261020180000", name: "investing_first_readonly_release" },
    ]);
    assert.deepEqual(names.rows.slice(2).map(x=>x.name), files.map(f=>f.name));
    assert.deepEqual(names.rows.slice(2,5).map(x=>x.version), files.slice(0,3).map(x=>x.version));
    assert.ok(names.rows[5].version > names.rows[4].version);
    const tables = await db.query<{total:number;forced:number;enabled:number}>(`
      select count(*)::int total,
      count(*) filter (where c.relrowsecurity)::int enabled,
      count(*) filter (where c.relforcerowsecurity)::int forced
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='investing' and c.relkind='r'`);
    assert.deepEqual(tables.rows,[{total:19,enabled:19,forced:18}]);
    const roles = await db.query<{name:string;login:boolean;superuser:boolean;bypass:boolean}>(
      "select rolname name,rolcanlogin login,rolsuper superuser,rolbypassrls bypass from pg_roles where rolname in ('investing_import_writer','investing_initial_provisioner','investing_bl2bl3_runtime','investing_bl2bl3_owner') order by rolname");
    assert.equal(roles.rows.length, 4);
    assert.ok(roles.rows.every(r=>!r.login && !r.superuser && !r.bypass));
    const security = await db.query<{public_rpc:boolean;all_financial:number}>(`
      select exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid
          where n.nspname='investing' and p.prosecdef
            and has_function_privilege('authenticated',p.oid,'EXECUTE')) public_rpc,
        ((select count(*) from investing.ledger_transactions) +
         (select count(*) from investing.ledger_entries))::int all_financial`);
    assert.deepEqual(security.rows,[{public_rpc:false,all_financial:0}]);
    process.stdout.write("R0_R2_CLI_APPLY_REPLAYABLE_PG17_PASS\n");
  } finally { await db.end(); }
}
if (process.argv[2] === "verify") {
  verify().catch(e=>{process.stderr.write("R0_R2_CLI_BLOCKED " + (e instanceof Error?e.message:"unknown") + "\n");process.exitCode=1;});
}
