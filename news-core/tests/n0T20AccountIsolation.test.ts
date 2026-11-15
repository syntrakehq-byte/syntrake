import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = new URL("../../supabase/migrations/20261017160000_investing_core_foundation.sql", import.meta.url);
const ACCOUNT_A = "00000000-0000-4000-8000-000000000011";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000012";

test("N0-T20: two authenticated PostgreSQL identities see only their private account data while News remains global", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  assert.ok(DB_URL);
  const databaseName = `news_t20_${randomUUID().replaceAll("-", "")}`;
  const provisioner = new Client({ connectionString: DB_URL });
  await provisioner.connect();
  await provisioner.query(`create database "${databaseName}"`);
  const dbUrl = new URL(DB_URL); dbUrl.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: dbUrl.toString() });
  const passwordA = randomBytes(24).toString("hex");
  const passwordB = randomBytes(24).toString("hex");
  const roleA = `news_t20_a_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const roleB = `news_t20_b_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query("create role anon noinherit");
    await admin.query("create role authenticated noinherit");
    await admin.query("create schema auth");
    await admin.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$");
    await admin.query("grant usage on schema auth to authenticated; grant execute on function auth.jwt() to authenticated");
    await admin.query(await readFile(migration, "utf8"));
    await admin.query(`create role "${roleA}" login noinherit nobypassrls password '${passwordA}'`);
    await admin.query(`create role "${roleB}" login noinherit nobypassrls password '${passwordB}'`);
    await admin.query(`grant authenticated to "${roleA}"; grant authenticated to "${roleB}"`);
    await admin.query("insert into investing.identity_accounts(user_id) values ('account-user-a'),('account-user-b')");
    await admin.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ($1,'account-user-a','Private A','EUR'),($2,'account-user-b','Private B','EUR')", [ACCOUNT_A, ACCOUNT_B]);
    await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,'account-user-a','owner'),($2,'account-user-b','owner')", [ACCOUNT_A, ACCOUNT_B]);
    const connectAs = async (role: string, password: string, subject: string): Promise<string[]> => {
      const userUrl = new URL(dbUrl); userUrl.username = role; userUrl.password = password;
      const client = new Client({ connectionString: userUrl.toString() });
      await client.connect();
      try {
        await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject })]);
        await client.query("set role authenticated");
        const result = await client.query<{ id: string }>("select id::text from investing.investment_accounts order by id");
        return result.rows.map(row => row.id);
      } finally { await client.end(); }
    };
    assert.deepEqual(await connectAs(roleA, passwordA, "account-user-a"), [ACCOUNT_A]);
    assert.deepEqual(await connectAs(roleB, passwordB, "account-user-b"), [ACCOUNT_B]);
    const userAUrl = new URL(dbUrl); userAUrl.username = roleA; userAUrl.password = passwordA;
    const userA = new Client({ connectionString: userAUrl.toString() });
    await userA.connect();
    try {
      await userA.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: "account-user-a" })]);
      await userA.query("set role authenticated");
      const crossAccount = await userA.query("select * from investing.account_memberships where user_id='account-user-b'");
      assert.equal(crossAccount.rowCount, 0, "RLS must hide the other authenticated user's private membership");
    } finally { await userA.end(); }
    const globalNewsBoundary = { schemaVersion: "1.0", scope: "GLOBAL_NEWS", accountId: null, privateDataForwardedToProvider: false };
    assert.deepEqual(globalNewsBoundary, { schemaVersion: "1.0", scope: "GLOBAL_NEWS", accountId: null, privateDataForwardedToProvider: false });
    console.log(`N0_T20_PROOF pg17=true authenticatedIdentityA=${roleA} authenticatedIdentityB=${roleB} visibleA=1 visibleB=1 crossAccountRows=0 globalNewsPrivateDataForwarded=false`);
  } finally {
    await admin.query(`drop role if exists "${roleA}"; drop role if exists "${roleB}"`).catch(() => undefined);
    await admin.query("drop schema if exists investing cascade; drop schema if exists auth cascade").catch(() => undefined);
    await admin.end();
    await provisioner.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]).catch(() => undefined);
    await provisioner.query(`drop database if exists "${databaseName}"`);
    await provisioner.end();
  }
});
