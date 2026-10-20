import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

/**
 * First Investing release rehearsal. Only the immutable foundation + canonical
 * owner guard may be introduced into a pristine PG17 database.
 * This test never connects to Supabase: CI provisions a disposable local PG17.
 *
 * Deliberately EXCLUDES the contribution-writer capability and the Preview-only
 * runtime LOGIN: those are separate future financial-authority decisions.
 */
test("PG17 first-release read-only migrations stay fail-closed", async (t) => {
  const url = process.env.INVESTING_PG17_READONLY_URL;
  assert.ok(url, "isolated INVESTING_PG17_READONLY_URL is required; no skipped/mocked test");
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const v = await db.query<{ version: string }>("select current_setting('server_version') as version");
    assert.match(v.rows[0].version, /^17\./);

    // Reproduce only required Supabase auth primitives inside disposable CI PG.
    await db.query("create role anon noinherit");
    await db.query("create role authenticated noinherit");
    await db.query("create schema auth");
    await db.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$");
    await db.query("grant usage on schema auth to authenticated");
    await db.query("grant execute on function auth.jwt() to authenticated");

    const foundation = await readFile(new URL(
      "../../supabase/migrations/20261017160000_investing_core_foundation.sql", import.meta.url,
    ), "utf8");
    const ownerGuard = await readFile(new URL(
      "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql", import.meta.url,
    ), "utf8");
    const releaseSQL = await readFile(new URL(
      "../../supabase/release-candidates/20261020180000_investing_first_readonly_release.sql",
      import.meta.url,
    ), "utf8");

    // No silently invented or modified DDL inside the consolidated release.
    const foundationCopy = releaseSQL.split("-- BEGIN EXACT FOUNDATION SQL\n")[1]
      ?.split("\n-- END EXACT FOUNDATION SQL")[0];
    const ownerCopy = releaseSQL.split("-- BEGIN EXACT OWNER GUARD SQL\n")[1]
      ?.split("\n-- END EXACT OWNER GUARD SQL")[0];
    assert.equal(foundationCopy, foundation.trimEnd(), "release foundation differs from accepted source");
    assert.equal(ownerCopy, ownerGuard.trimEnd(), "release owner guard differs from accepted source");
    assert.match(releaseSQL, /REVOKE SELECT ON[\s\S]*investing\.ledger_transactions[\s\S]*FROM authenticated;/);
    assert.equal(releaseSQL.includes("CREATE ROLE investing_contribution_writer"), false);
    assert.equal(releaseSQL.includes("CREATE ROLE investing_writer_runtime"), false);
    await db.query(releaseSQL);

    await t.test("exact schema shape, no writer capability or runtime login", async () => {
      const tables = await db.query<{ count: number }>(
        "select count(*)::int as count from pg_tables where schemaname='investing'"
      );
      assert.equal(tables.rows[0].count, 9);
      const roles = await db.query<{ role: string }>(
        "select rolname as role from pg_roles where rolname in ('investing_contribution_writer','investing_writer_runtime')"
      );
      assert.deepEqual(roles.rows, []);
      const policies = await db.query<{ name: string; rls: boolean; force_rls: boolean }>(
        "select c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls " +
        "from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
        "where n.nspname='investing' and c.relkind='r' order by c.relname"
      );
      assert.equal(policies.rowCount, 9);
      assert.ok(policies.rows.every((row) => row.rls), "RLS required on all 9 financial tables");
      assert.ok(policies.rows.filter((row) => row.name!=="supported_currencies").every((row) => row.force_rls));
    });

    await t.test("anonymous and authenticated cannot write any financial table", async () => {
      const privileges = await db.query<{
        auth_read: boolean; auth_insert: boolean; anon_read: boolean;
        member_insert: boolean; writer_rpc: boolean; guard_rpc: boolean;
        ledger_read: boolean; portfolio_read: boolean; identity_read: boolean;
        subledger_read: boolean; entry_read: boolean; member_read: boolean;
      }>(
        "select " +
        "has_table_privilege('authenticated','investing.investment_accounts','SELECT') as auth_read," +
        "has_table_privilege('authenticated','investing.investment_accounts','INSERT') as auth_insert," +
        "has_table_privilege('anon','investing.investment_accounts','SELECT') as anon_read," +
        "has_table_privilege('authenticated','investing.account_memberships','INSERT') as member_insert," +
        "has_table_privilege('authenticated','investing.account_memberships','SELECT') as member_read," +
        "has_table_privilege('authenticated','investing.ledger_transactions','SELECT') as ledger_read," +
        "has_table_privilege('authenticated','investing.portfolios','SELECT') as portfolio_read," +
        "has_table_privilege('authenticated','investing.identity_accounts','SELECT') as identity_read," +
        "has_table_privilege('authenticated','investing.ledger_accounts','SELECT') as subledger_read," +
        "has_table_privilege('authenticated','investing.ledger_entries','SELECT') as entry_read," +
        "has_function_privilege('authenticated','investing.ledger_integrity_issues()','EXECUTE') as writer_rpc," +
        "has_function_privilege('authenticated','investing.assert_canonical_owner_membership()','EXECUTE') as guard_rpc"
      );
      assert.deepEqual(privileges.rows[0], {
        auth_read: true, auth_insert: false, anon_read: false,
        member_insert: false, writer_rpc: false, guard_rpc: false,
        member_read: true, ledger_read: false, portfolio_read: false,
        identity_read: false, subledger_read: false, entry_read: false,
      });
    });

    // Privileged CI-only synthetic provisioning. Production cannot use this
    // as a substitute for authenticated server-side onboarding authority.
    await db.query("begin");
    await db.query("insert into investing.identity_accounts(user_id) values ('clerk_ci_a'),('clerk_ci_c')");
    await db.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ('00000000-0000-4000-8000-000000000011','clerk_ci_a','CI A','EUR'),('00000000-0000-4000-8000-000000000013','clerk_ci_c','CI C','EUR')");
    await db.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ('00000000-0000-4000-8000-000000000011','clerk_ci_a','owner'),('00000000-0000-4000-8000-000000000013','clerk_ci_c','owner')");
    await db.query("commit");

    await t.test("signed-JWT subject RLS isolation modeled under restricted database role", async () => {
      await db.query("set role authenticated");
      try {
        for (const [sub, expected] of [
          ["clerk_ci_a", "00000000-0000-4000-8000-000000000011"],
          ["clerk_ci_c", "00000000-0000-4000-8000-000000000013"],
        ] as const) {
          await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub })]);
          const account = await db.query<{ id: string }>("select id from investing.investment_accounts");
          assert.deepEqual(account.rows.map((row) => row.id), [expected]);
          const memberships = await db.query<{user_id:string}>("select user_id from investing.account_memberships");
          assert.deepEqual(memberships.rows.map((row) => row.user_id), [sub]);
        }
        for (const claims of [{ sub: "clerk_non_owner" }, { role: "authenticated" }, {}]) {
          await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
          assert.equal((await db.query("select id from investing.investment_accounts")).rowCount, 0);
        }
        await assert.rejects(
          db.query("insert into investing.identity_accounts(user_id) values ('forged')"),
          /permission denied/
        );
      } finally {
        await db.query("reset role");
        await db.query("reset request.jwt.claims");
      }
    });

    await t.test("owner membership invariant blocks orphaned accounts at COMMIT", async () => {
      await db.query("begin");
      try {
        await db.query(
          "insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ('00000000-0000-4000-8000-000000000077','clerk_ci_a','Orphan','EUR')"
        );
        await assert.rejects(db.query("commit"), /canonical owner membership invariant violated/);
      } finally {
        await db.query("rollback");
      }
      assert.equal((await db.query("select id from investing.investment_accounts")).rowCount, 2);
    });
  } finally {
    await db.end();
  }
});
