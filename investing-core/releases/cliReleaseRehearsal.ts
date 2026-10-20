import assert from "node:assert/strict";
import { Client } from "pg";
import { recoveredProductionHistorySnapshot, RECOVERED_BASELINE_SQL_MD5 } from "./productionHistorySnapshot";
import {
  assertFirstInvestingReleaseApplied,
  assertFirstInvestingReleasePredecessor,
  type MigrationVersionName,
} from "./releaseHistoryGate";

/**
 * CI-ONLY rehearsal helper. Never supply remote/staging/production DB URLs.
 * Supabase CLI will connect to this same isolated, fixed-name local PG17 DB.
 */
const command = process.argv[2];
const raw = process.env.INVESTING_RELEASE_CLI_DB_URL ?? "";
let parsed: URL;
try {
  parsed = new URL(raw);
} catch {
  throw new Error("BLOCKED: missing isolated CI PostgreSQL 17 URL");
}
assert.equal(process.env.CI, "true", "CI-only database rehearsal");
assert.equal(parsed.protocol, "postgresql:", "Postgres URL required");
assert.equal(parsed.hostname, "127.0.0.1", "DENIED external database host");
assert.equal(parsed.port, "5432", "DENIED external port");
assert.equal(parsed.pathname, "/syntrake_cli_rehearsal", "DENIED other database");
assert.equal(parsed.username, "postgres", "DENIED other role");
assert.equal(parsed.search, "", "DENIED query override");
assert.equal(parsed.hash, "", "DENIED URL fragment");
assert.ok(command === "seed" || command === "verify", "explicit seed/verify required");

const db = new Client({ connectionString: raw, connectionTimeoutMillis: 4_000 });

async function queryHistory(): Promise<MigrationVersionName[]> {
  const r = await db.query<MigrationVersionName>(
    "select version,name from supabase_migrations.schema_migrations order by version"
  );
  return r.rows;
}

async function main() {
  await db.connect();
  try {
    const v = await db.query<{ version: string }>(
      "select current_setting('server_version') as version"
    );
    assert.match(v.rows[0].version, /^17\./, "exact PG17 required");
    if (command === "seed") {
      await db.query("create role anon noinherit");
      await db.query("create role authenticated noinherit");
      await db.query("create schema auth");
      await db.query(
        `create function auth.jwt() returns jsonb language sql stable
          as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$`
      );
      await db.query("grant usage on schema auth to authenticated");
      await db.query("grant execute on function auth.jwt() to authenticated");
      await db.query("create schema supabase_migrations");
      await db.query(`create table supabase_migrations.schema_migrations (
        version text primary key, statements text[], name text
      )`);
      const snapshot = await recoveredProductionHistorySnapshot();
      await db.query(
        "insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)",
        [snapshot.version, snapshot.name, snapshot.statements]
      );
      const recovered = await db.query<{ sql_md5: string; statement_count: number }>(
        `select md5(array_to_string(statements,E'\\n')) as sql_md5,
          cardinality(statements)::int as statement_count
          from supabase_migrations.schema_migrations where version='20261017191056'`
      );
      assert.equal(recovered.rows[0].statement_count, 32);
      assert.equal(recovered.rows[0].sql_md5, RECOVERED_BASELINE_SQL_MD5);
      assertFirstInvestingReleasePredecessor(await queryHistory());
      assert.equal((await db.query(
        "select count(*)::int as count from pg_namespace where nspname='investing'"
      )).rows[0].count, 0);
      process.stdout.write("ISOLATED_PG17_CLI_BASELINE_READY\n");
    } else {
      assertFirstInvestingReleaseApplied(await queryHistory());
      const baseline = await db.query<{ sql_md5: string; statements: number }>(
        `select md5(array_to_string(statements,E'\\n')) as sql_md5,
        cardinality(statements)::int as statements
        from supabase_migrations.schema_migrations where version='20261017191056'`
      );
      assert.equal(baseline.rows[0].statements, 32);
      assert.equal(baseline.rows[0].sql_md5, RECOVERED_BASELINE_SQL_MD5);
      const shape = await db.query<{
        tables: number; accounts: number; writer: boolean;
        grant_select: boolean; grant_insert: boolean;
        ledger_select: boolean; member_select: boolean;
      }>(`select
        (select count(*)::int from pg_tables where schemaname='investing') as tables,
        (select count(*)::int from investing.investment_accounts) as accounts,
        exists(select 1 from pg_roles where rolname in ('investing_contribution_writer','investing_writer_runtime')) as writer,
        has_table_privilege('authenticated','investing.investment_accounts','SELECT') as grant_select,
        has_table_privilege('authenticated','investing.investment_accounts','INSERT') as grant_insert,
        has_table_privilege('authenticated','investing.ledger_transactions','SELECT') as ledger_select,
        has_table_privilege('authenticated','investing.account_memberships','SELECT') as member_select`);
      const row = shape.rows[0];
      assert.deepEqual(row, {
        tables: 9, accounts: 0, writer: false,
        grant_select: true, grant_insert: false,
        ledger_select: false, member_select: true
      });
      process.stdout.write("ISOLATED_CLI_RELEASE_APPLY_PASS\n");
    }
  } finally {
    await db.end();
  }
}
void main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : "unknown";
  process.stderr.write("ISOLATED_CLI_RELEASE_BLOCKED " + reason + "\n");
  process.exitCode = 1;
});
