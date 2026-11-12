import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

test("N4 non-administrative runtime identity cannot reach the factual writer", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const runtimeRole = `n4_runtime_${suffix}`;
  const password = `n4-password-${suffix}`;
  try {
    await admin.connect();
    const createRole = await admin.query<{ ddl: string }>("select format('create role %I login password %L nosuperuser nocreatedb nocreaterole inherit', $1::text, $2::text) ddl", [runtimeRole, password]);
    await admin.query(createRole.rows[0].ddl);
    await admin.query(`grant news_service to ${runtimeRole}`);
    const runtimeUrl = new URL(DB_URL as string);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = password;
    const runtime = new Client({ connectionString: runtimeUrl.toString() });
    try {
      await runtime.connect();
      assert.equal((await runtime.query("select current_user")).rows[0].current_user, runtimeRole);
      assert.equal((await runtime.query("select pg_has_role(current_user,'news_factual_writer','member')")).rows[0].pg_has_role, false);
      await assert.rejects(runtime.query("select * from news_core.fact_revisions"), /permission denied/);
      await assert.rejects(runtime.query("select * from news_core.finalize_fact_revision('not-authorized')"), /permission denied/);
    } finally { await runtime.end(); }
    const memberships = await admin.query<{ n: number }>("select count(*)::int n from pg_auth_members m join pg_roles granted on granted.oid=m.roleid where granted.rolname='news_factual_writer'");
    assert.equal(memberships.rows[0].n, 0, "no runtime role may inherit the factual writer capability");
  } finally {
    await admin.query(`drop role if exists ${runtimeRole}`).catch(() => undefined);
    await admin.end();
  }
});
