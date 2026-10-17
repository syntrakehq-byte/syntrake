import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("PG17 integration is explicit and never silently mocked", async (t) => {
  const url = process.env.INVESTING_PG17_URL;
  if (!url) {
    t.skip("Set INVESTING_PG17_URL to run real PostgreSQL 17 integration tests");
    return;
  }
  const pg = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("create role anon noinherit");
    await client.query("create role authenticated noinherit");
    await client.query("create schema if not exists auth");
    await client.query("create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$");
    const version = await client.query<{ version: string }>("select version() as version");
    assert.match(version.rows[0].version, /PostgreSQL 17/);
    const migration = await readFile(new URL("../../supabase/migrations/20261017160000_investing_core_foundation.sql", import.meta.url), "utf8");
    await client.query(migration);
    const tables = await client.query<{ count: string }>("select count(*)::text as count from pg_tables where schemaname = 'investing'");
    assert.equal(tables.rows[0].count, "7");
    const account = "00000000-0000-4000-8000-000000000011";
    const portfolio = "00000000-0000-4000-8000-000000000012";
    await client.query("insert into investing.identity_accounts(user_id) values ('clerk_user_a'), ('clerk_user_b')");
    await client.query("insert into investing.investment_accounts(id, owner_user_id, name, base_currency) values ($1, 'clerk_user_a', 'A', 'EUR')", [account]);
    await client.query("insert into investing.portfolios(id, investment_account_id, name) values ($1, $2, 'A portfolio')", [portfolio, account]);
    await client.query("insert into investing.account_memberships(investment_account_id, user_id, role) values ($1, 'clerk_user_a', 'owner')", [account]);
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims', '{\"sub\":\"clerk_user_a\"}', false)");
    const own = await client.query("select id from investing.investment_accounts");
    assert.equal(own.rowCount, 1);
    await client.query("select set_config('request.jwt.claims', '{\"sub\":\"clerk_user_b\"}', false)");
    const other = await client.query("select id from investing.investment_accounts");
    assert.equal(other.rowCount, 0);
    await client.query("reset role");

    await assert.rejects(async () => {
      await client.query("begin");
      await client.query("insert into investing.ledger_transactions(idempotency_user_id, idempotency_key, provenance) values ('clerk_user_a', 'rollback-1', '{}'::jsonb)");
      const tx = await client.query<{ id: string }>("select id from investing.ledger_transactions where idempotency_key = 'rollback-1'");
      await client.query("insert into investing.ledger_entries(transaction_id, account_id, direction, currency, amount_minor) values ($1, $2, 'debit', 'EUR', 100)", [tx.rows[0].id, account]);
      await client.query("commit");
    });
    await client.query("rollback");
    const rolledBack = await client.query("select 1 from investing.ledger_transactions where idempotency_key = 'rollback-1'");
    assert.equal(rolledBack.rowCount, 0);

    const good = await client.query<{ id: string }>("insert into investing.ledger_transactions(idempotency_user_id, idempotency_key, provenance) values ('clerk_user_a', 'commit-1', '{}'::jsonb) returning id");
    await client.query("insert into investing.ledger_entries(transaction_id, account_id, direction, currency, amount_minor) values ($1, $2, 'debit', 'EUR', 100), ($1, $3, 'credit', 'EUR', 100)", [good.rows[0].id, account, account]);
    await client.query("set role authenticated");
    await assert.rejects(client.query("delete from investing.ledger_entries"), /permission denied/);
    await client.query("reset role");
    await assert.rejects(client.query("insert into investing.operation_idempotency_keys(user_id, key, request_hash) values ('clerk_user_a', 'same-key-00000000', 'a'), ('clerk_user_a', 'same-key-00000000', 'a')"), /duplicate key/);
  } finally {
    await client.end();
  }
});
