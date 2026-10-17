import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const DB_URL = process.env.INVESTING_PG17_URL;
const A = "00000000-0000-4000-8000-000000000011";
const B = "00000000-0000-4000-8000-000000000012";
const CASH_A = "00000000-0000-4000-8000-000000000021";
const CLEAR_A = "00000000-0000-4000-8000-000000000022";
const CASH_B = "00000000-0000-4000-8000-000000000023";
const CLEAR_B = "00000000-0000-4000-8000-000000000024";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** ONLY isolated CI fixtures. No financial event is attributed to an actual user. */
async function reserve(db: Client, user: string, account: string, key: string, hash = HASH_A) {
  await db.query(
    "insert into investing.operation_idempotency_keys(investment_account_id,user_id,key,request_hash) values ($1,$2,$3,$4)",
    [account,user,key,hash],
  );
}
async function header(db: Client, user: string, account: string, key: string) {
  const res = await db.query<{ id: string }>(
    "insert into investing.ledger_transactions(investment_account_id,idempotency_user_id,idempotency_key,provenance) values ($1,$2,$3,$4) returning id",
    [account,user,key,{source:"synthetic_pg17_fixture"}],
  );
  return res.rows[0].id;
}
async function entry(db: Client, tx: string, account: string, ledger: string, direction: "debit" | "credit", amount = "100", currency = "EUR") {
  await db.query(
    "insert into investing.ledger_entries(transaction_id,investment_account_id,ledger_account_id,direction,currency,amount_minor) values ($1,$2,$3,$4,$5,$6)",
    [tx,account,ledger,direction,currency,amount],
  );
}
async function finalize(db: Client, tx: string) {
  await db.query("update investing.ledger_transactions set status='posted' where id=$1", [tx]);
}
async function abortOnCommit(db: Client, key: string, posts: {ledger:string; direction:"debit"|"credit"; amount?:string}[]) {
  await db.query("begin");
  await reserve(db,"clerk_user_a",A,key);
  const tx=await header(db,"clerk_user_a",A,key);
  for(const p of posts) await entry(db,tx,A,p.ledger,p.direction,p.amount);
  await finalize(db,tx);
  await assert.rejects(db.query("commit"), /journal .*empty, single-account, or unbalanced/);
  await db.query("rollback");
  const none=await db.query("select id from investing.ledger_transactions where id=$1",[tx]);
  assert.equal(none.rowCount,0);
}

test("PostgreSQL 17 isolated ledger/ownership/integrity contract", async (t) => {
  assert.ok(DB_URL, "INVESTING_PG17_URL required: no skipped or mocked PG17 tests");
  const admin=new Client({connectionString:DB_URL});
  await admin.connect();
  try {
    await admin.query("create role anon noinherit");
    await admin.query("create role authenticated noinherit");
    await admin.query("create schema auth");
    await admin.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$");
    await admin.query("grant usage on schema auth to authenticated");
    await admin.query("grant execute on function auth.jwt() to authenticated");
    const version=await admin.query<{v:string}>("select current_setting('server_version') as v");
    assert.match(version.rows[0].v, /^17\./);
    const migration=await readFile(new URL("../../supabase/migrations/20261017160000_investing_core_foundation.sql",import.meta.url),"utf8");
    await admin.query(migration);
    const tables=await admin.query<{n:string}>("select count(*)::text n from pg_tables where schemaname='investing'");
    assert.equal(Number(tables.rows[0].n),9);

    await admin.query("insert into investing.identity_accounts(user_id) values ('clerk_user_a'),('clerk_user_b')");
    await admin.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ($1,'clerk_user_a','A','EUR'),($2,'clerk_user_b','B','EUR')",[A,B]);
    await admin.query("insert into investing.portfolios(investment_account_id,name) values ($1,'Portfolio A'),($2,'Portfolio B')",[A,B]);
    await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,'clerk_user_a','owner'),($2,'clerk_user_b','owner')",[A,B]);
    await admin.query("insert into investing.ledger_accounts(id,investment_account_id,code,currency) values ($1,$5,'cash','EUR'),($2,$5,'external_clearing','EUR'),($3,$6,'cash','EUR'),($4,$6,'external_clearing','EUR')",[CASH_A,CLEAR_A,CASH_B,CLEAR_B,A,B]);

    await t.test("verified PG17, currency metadata and rejection of unsupported ISO-looking codes",async()=>{
      const currencies=await admin.query("select code,minor_digits from investing.supported_currencies order by code");
      assert.equal(currencies.rowCount,6);
      assert.equal(currencies.rows.find(r=>r.code==="JPY")?.minor_digits,0);
      assert.equal(currencies.rows.find(r=>r.code==="KWD")?.minor_digits,3);
      await assert.rejects(admin.query("insert into investing.investment_accounts(owner_user_id,name,base_currency) values ('clerk_user_a','Invalid','ZZZ')"),/foreign key/);
    });

    await t.test("RLS under restricted role isolates A/B, hides journals and forbids writes",async()=>{
      await admin.query("set role authenticated");
      try {
        await admin.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify({sub:"clerk_user_a"})]);
        const visibleA=await admin.query<{id:string}>("select id from investing.investment_accounts");
        assert.deepEqual(visibleA.rows.map(r=>r.id),[A]);
        assert.equal((await admin.query("select id from investing.portfolios")).rowCount,1);
        assert.equal((await admin.query("select id from investing.ledger_accounts")).rowCount,2);
        assert.equal((await admin.query("select user_id from investing.identity_accounts")).rowCount,1);
        await assert.rejects(admin.query("insert into investing.ledger_transactions(investment_account_id,idempotency_user_id,idempotency_key,provenance) values ('00000000-0000-4000-8000-000000000011','clerk_user_a','bad-raw-write-000001','{}')"),/permission denied/);
        await assert.rejects(admin.query("delete from investing.ledger_entries"),/permission denied/);
        await admin.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify({sub:"clerk_user_b"})]);
        const visibleB=await admin.query<{id:string}>("select id from investing.investment_accounts");
        assert.deepEqual(visibleB.rows.map(r=>r.id),[B]);
        assert.equal((await admin.query("select id from investing.ledger_accounts")).rowCount,2);
        await admin.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify({sub:"not-a-member"})]);
        assert.equal((await admin.query("select id from investing.investment_accounts")).rowCount,0);
      } finally {
        await admin.query("reset role");
        await admin.query("reset request.jwt.claims");
      }
    });

    await t.test("one atomic posted journal, internal cash/clearing accounts, and reconciliation",async()=>{
      await admin.query("begin");
      await reserve(admin,"clerk_user_a",A,"successful-post-0001");
      const tx=await header(admin,"clerk_user_a",A,"successful-post-0001");
      await entry(admin,tx,A,CASH_A,"debit");
      await entry(admin,tx,A,CLEAR_A,"credit");
      await finalize(admin,tx);
      await admin.query("commit");
      const posted=await admin.query<{status:string}>("select status from investing.ledger_transactions where id=$1",[tx]);
      assert.equal(posted.rows[0].status,"posted");
      const issues=await admin.query("select * from investing.ledger_integrity_issues()");
      assert.equal(issues.rowCount,0);
      await assert.rejects(entry(admin,tx,A,CASH_A,"credit"),/draft journal/);
      await assert.rejects(admin.query("update investing.ledger_entries set amount_minor=1 where transaction_id=$1",[tx]),/immutable/);
      await assert.rejects(admin.query("delete from investing.ledger_entries where transaction_id=$1",[tx]),/immutable/);
      await assert.rejects(admin.query("update investing.ledger_transactions set provenance='{}' where id=$1",[tx]),/only finalize/);
      await assert.rejects(admin.query("delete from investing.ledger_transactions where id=$1",[tx]),/immutable/);
      await assert.rejects(admin.query("update investing.ledger_accounts set code='equity' where id=$1",[CASH_A]),/immutable/);
      await assert.rejects(admin.query("update investing.operation_idempotency_keys set request_hash=$1 where investment_account_id=$2 and key='successful-post-0001'",[HASH_B,A]),/immutable/);
      await assert.rejects(admin.query("delete from investing.operation_idempotency_keys where investment_account_id=$1 and key='successful-post-0001'",[A]),/immutable/);

      await admin.query("set role authenticated");
      try {
        await admin.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify({sub:"clerk_user_a"})]);
        assert.equal((await admin.query("select id from investing.ledger_transactions")).rowCount,1);
        assert.equal((await admin.query("select id from investing.ledger_entries")).rowCount,2);
        await admin.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify({sub:"clerk_user_b"})]);
        assert.equal((await admin.query("select id from investing.ledger_transactions")).rowCount,0);
        assert.equal((await admin.query("select id from investing.ledger_entries")).rowCount,0);
      } finally {
        await admin.query("reset role");
        await admin.query("reset request.jwt.claims");
      }
    });

    await t.test("deferred COMMIT rejects empty, single-subaccount and unbalanced journals; rollback is atomic",async()=>{
      await abortOnCommit(admin,"empty-journal-00001",[]);
      await abortOnCommit(admin,"single-account-0001",[
        {ledger:CASH_A,direction:"debit"},
        {ledger:CASH_A,direction:"credit"},
      ]);
      await abortOnCommit(admin,"unbalanced-journal01",[
        {ledger:CASH_A,direction:"debit",amount:"101"},
        {ledger:CLEAR_A,direction:"credit",amount:"100"},
      ]);
      const count=await admin.query("select count(*)::int as n from investing.operation_idempotency_keys");
      assert.equal(count.rows[0].n,1);
    });

    await t.test("cross-tenant and currency-mismatched journal entries are rejected by composite foreign keys",async()=>{
      await admin.query("begin");
      await reserve(admin,"clerk_user_a",A,"tenant-denial-00001");
      const tx=await header(admin,"clerk_user_a",A,"tenant-denial-00001");
      await assert.rejects(entry(admin,tx,A,CASH_B,"debit"),/foreign key/);
      await admin.query("rollback");

      await admin.query("begin");
      await reserve(admin,"clerk_user_a",A,"currency-denial-0001");
      const tx2=await header(admin,"clerk_user_a",A,"currency-denial-0001");
      await assert.rejects(entry(admin,tx2,A,CASH_A,"debit","100","USD"),/foreign key/);
      await admin.query("rollback");
    });

    await t.test("concurrent same-key reservations serialize; only one posted journal",async()=>{
      const left=new Client({connectionString:DB_URL});
      const right=new Client({connectionString:DB_URL});
      await Promise.all([left.connect(),right.connect()]);
      try {
        await left.query("begin");
        await right.query("begin");
        await reserve(left,"clerk_user_a",A,"concurrent-key-00001");
        const losingInsert=right.query(
          "insert into investing.operation_idempotency_keys(investment_account_id,user_id,key,request_hash) values ($1,'clerk_user_a','concurrent-key-00001',$2) on conflict do nothing returning key",
          [A,HASH_B],
        );
        const tx=await header(left,"clerk_user_a",A,"concurrent-key-00001");
        await entry(left,tx,A,CASH_A,"debit","77");
        await entry(left,tx,A,CLEAR_A,"credit","77");
        await finalize(left,tx);
        await left.query("commit");
        const duplicate=await losingInsert;
        assert.equal(duplicate.rowCount,0);
        const original=await right.query<{request_hash:string}>("select request_hash from investing.operation_idempotency_keys where investment_account_id=$1 and user_id='clerk_user_a' and key='concurrent-key-00001'",[A]);
        assert.equal(original.rows[0].request_hash,HASH_A);
        assert.notEqual(original.rows[0].request_hash,HASH_B);
        await right.query("rollback");
        const txCount=await admin.query("select count(*)::int n from investing.ledger_transactions where investment_account_id=$1 and idempotency_key='concurrent-key-00001'",[A]);
        assert.equal(txCount.rows[0].n,1);
      } finally {
        await Promise.allSettled([left.query("rollback"),right.query("rollback")]);
        await Promise.allSettled([left.end(),right.end()]);
      }
    });

    await t.test("independent reconciliation detects tampered/unposted journal in an isolated rollback",async()=>{
      assert.equal((await admin.query("select * from investing.ledger_integrity_issues()")).rowCount,0);
      await admin.query("begin");
      try {
        await admin.query("alter table investing.ledger_transactions disable trigger user");
        await reserve(admin,"clerk_user_a",A,"corrupt-fixture-0001");
        await header(admin,"clerk_user_a",A,"corrupt-fixture-0001");
        const issues=await admin.query<{issue:string}>("select issue from investing.ledger_integrity_issues()");
        assert.ok(issues.rows.some(r=>r.issue==="NOT_POSTED"));
        assert.ok(issues.rows.some(r=>r.issue==="TOO_FEW_ENTRIES"));
      } finally {
        await admin.query("rollback");
      }
      assert.equal((await admin.query("select * from investing.ledger_integrity_issues()")).rowCount,0);
    });
  } finally {
    await admin.end();
  }
});
