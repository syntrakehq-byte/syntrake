import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import { recordUserReportedContribution, ContributionBlocked } from "../server/recordUserReportedContribution";

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
    const ownerGuardMigration=await readFile(new URL("../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",import.meta.url),"utf8");
    await admin.query(ownerGuardMigration);

    // Execute the real versioned least-privilege SQL capability contract.
    // NOLOGIN and no connection/credentials are provisioned in this CI DB.
    const writerCapabilityMigration=await readFile(
      new URL("../../supabase/migrations/20261018074500_investing_contribution_writer_capability.sql",import.meta.url),
      "utf8",
    );
    await admin.query(writerCapabilityMigration);
    // Real PostgreSQL login identities for permission tests. The CI-only
    // passwords are random per run, never logged, never remotely provisioned.
    // A superuser-owned connection CANNOT prove SET ROLE authorization.
    const writerSecret=randomBytes(24).toString("hex");
    const deniedSecret=randomBytes(24).toString("hex");
    await admin.query("create role investing_ci_writer_login login noinherit nobypassrls password '"+writerSecret+"'");
    await admin.query("grant investing_contribution_writer to investing_ci_writer_login");
    await admin.query("create role investing_ci_denied_login login noinherit nobypassrls password '"+deniedSecret+"'");
    const writerUrl=new URL(DB_URL!);
    writerUrl.username="investing_ci_writer_login";
    writerUrl.password=writerSecret;
    const deniedUrl=new URL(DB_URL!);
    deniedUrl.username="investing_ci_denied_login";
    deniedUrl.password=deniedSecret;

    const tables=await admin.query<{n:string}>("select count(*)::text n from pg_tables where schemaname='investing'");
    assert.equal(Number(tables.rows[0].n),9);

    await admin.query("begin");
    try {
      await admin.query("insert into investing.identity_accounts(user_id) values ('clerk_user_a'),('clerk_user_b')");
      await admin.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ($1,'clerk_user_a','A','EUR'),($2,'clerk_user_b','B','EUR')",[A,B]);
      await admin.query("insert into investing.portfolios(investment_account_id,name) values ($1,'Portfolio A'),($2,'Portfolio B')",[A,B]);
      await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,'clerk_user_a','owner'),($2,'clerk_user_b','owner')",[A,B]);
      await admin.query("insert into investing.ledger_accounts(id,investment_account_id,code,currency) values ($1,$5,'cash','EUR'),($2,$5,'external_clearing','EUR'),($3,$6,'cash','EUR'),($4,$6,'external_clearing','EUR')",[CASH_A,CLEAR_A,CASH_B,CLEAR_B,A,B]);
      await admin.query("commit");
    } catch(error) {
      await admin.query("rollback");
      throw error;
    }

    await t.test("deferred canonical owner/member integrity rejects inconsistent privileged writes", async () => {
      async function rejectedCommit(work: () => Promise<unknown>): Promise<void> {
        await admin.query("begin");
        try {
          await work();
          await assert.rejects(admin.query("commit"),/canonical owner membership invariant violated/);
        } finally {
          await admin.query("rollback");
        }
      }

      const strayAccount="00000000-0000-4000-8000-000000000099";
      await rejectedCommit(async () => {
        await admin.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ($1,'clerk_user_a','Orphan','EUR')",[strayAccount]);
      });
      await rejectedCommit(async () => {
        await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,'clerk_user_b','owner')",[A]);
      });
      await rejectedCommit(async () => {
        await admin.query("update investing.account_memberships set role='viewer' where investment_account_id=$1 and user_id='clerk_user_a'",[A]);
      });
      await rejectedCommit(async () => {
        await admin.query("delete from investing.account_memberships where investment_account_id=$1 and user_id='clerk_user_a'",[A]);
      });
      await rejectedCommit(async () => {
        await admin.query("update investing.investment_accounts set owner_user_id='clerk_user_b' where id=$1",[A]);
      });
      await rejectedCommit(async () => {
        // Moving an owner's membership to another account as a viewer
        // must still validate the account it was removed from.
        await admin.query("update investing.account_memberships set investment_account_id=$1, role='viewer' where investment_account_id=$2 and user_id='clerk_user_a'",[B,A]);
      });

      // Legitimate viewer membership remains permitted, but cannot become
      // a second owner. No tenant fixture rows persist after this rollback.
      await admin.query("begin");
      try {
        await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,'clerk_user_b','viewer')",[A]);
        await admin.query("set constraints all immediate");
      } finally {
        await admin.query("rollback");
      }
      const accounts=await admin.query<{n:number}>("select count(*)::int n from investing.investment_accounts");
      const members=await admin.query<{n:number}>("select count(*)::int n from investing.account_memberships");
      assert.equal(accounts.rows[0].n,2);
      assert.equal(members.rows[0].n,2);
      const privileges=await admin.query<{allowed:boolean}>("select has_function_privilege('authenticated','investing.assert_canonical_owner_membership()','EXECUTE') as allowed");
      assert.equal(privileges.rows[0].allowed,false);
    });

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

    await t.test("missing JWT subject and anon role cannot read Investing tables",async()=>{
      await admin.query("set role anon");
      try {
        await assert.rejects(admin.query("select id from investing.investment_accounts"),/permission denied/);
      } finally {
        await admin.query("reset role");
      }

      await admin.query("set role authenticated");
      try {
        // No JWT at all: the policy MUST NOT infer a user from a query parameter.
        assert.equal((await admin.query("select id from investing.investment_accounts")).rowCount,0);
        await admin.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role:"authenticated" })]);
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

    await t.test("ledger refuses fractional or oversized minor units at SQL boundary", async () => {
      await admin.query("begin");
      try {
        await reserve(admin,"clerk_user_a",A,"precision-denial-00001");
        const tx=await header(admin,"clerk_user_a",A,"precision-denial-00001");
        await assert.rejects(entry(admin,tx,A,CASH_A,"debit","1.5"),/check constraint/);
      } finally {
        await admin.query("rollback");
      }

      await admin.query("begin");
      try {
        await reserve(admin,"clerk_user_a",A,"overflow-denial-00001");
        const tx=await header(admin,"clerk_user_a",A,"overflow-denial-00001");
        await assert.rejects(entry(admin,tx,A,CASH_A,"debit",(10n ** 38n).toString()),/check constraint/);
      } finally {
        await admin.query("rollback");
      }
    });

    await t.test("server transaction: owner-only user-reported contribution, replay and conflicting keys", async () => {
      const pool = new Pool({ connectionString: writerUrl.toString(), max: 5 });
      const actorA = { userId: "clerk_user_a", sessionId: "synthetic_clerk_session_a" };
      const actorB = { userId: "clerk_user_b", sessionId: "synthetic_clerk_session_b" };
      const contribution = {
        accountId: A,
        idempotencyKey: "declared-cash-0000001",
        currency: "EUR",
        amountMinor: 123n,
        externalReference: "fixture-bank-deposit-0001",
      };
      try {
        const before = await admin.query<{n:number}>("select count(*)::int as n from investing.ledger_transactions where investment_account_id=$1", [A]);
        const created = await recordUserReportedContribution(pool, actorA, contribution);
        assert.equal(created.evidenceStatus, "USER_REPORTED");
        assert.equal(created.amountMinor, "123");
        assert.equal(created.externalReference, contribution.externalReference);
        const replay = await recordUserReportedContribution(pool, actorA, contribution);
        assert.deepEqual(replay, created);
        const after = await admin.query<{n:number}>("select count(*)::int as n from investing.ledger_transactions where investment_account_id=$1", [A]);
        assert.equal(after.rows[0].n, before.rows[0].n + 1);
        const recorded = await admin.query<{provenance:{verifiedByBroker:boolean,kind:string};status:string}>("select provenance,status from investing.ledger_transactions where id=$1",[created.transactionId]);
        assert.equal(recorded.rows[0].status,"posted");
        assert.equal(recorded.rows[0].provenance.kind,"USER_REPORTED");
        assert.equal(recorded.rows[0].provenance.verifiedByBroker,false);
        await assert.rejects(
          recordUserReportedContribution(pool, actorA, { ...contribution, amountMinor: 999n }),
          (e: unknown) => e instanceof ContributionBlocked && e.code==="IDEMPOTENCY_CONFLICT",
        );
        await assert.rejects(
          recordUserReportedContribution(pool, actorA, {...contribution, idempotencyKey:"declared-cash-0000002"}),
          (e: unknown) => e instanceof ContributionBlocked && e.code==="EXTERNAL_REFERENCE_CONFLICT",
        );
        await assert.rejects(
          recordUserReportedContribution(pool, actorB, { ...contribution, idempotencyKey:"unauthorized-b-00001" }),
          (e: unknown) => e instanceof ContributionBlocked && e.code==="ACCOUNT_NOT_AUTHORIZED",
        );
        await assert.rejects(
          recordUserReportedContribution(pool, actorA, { ...contribution, idempotencyKey:"missing-subledger-001",currency:"GBP", externalReference:"other-ref-001" }),
          (e: unknown) => e instanceof ContributionBlocked && e.code==="ACCOUNT_NOT_READY",
        );
        await assert.rejects(
          recordUserReportedContribution(pool, actorA, { ...contribution, idempotencyKey:"invalid-currency-001", currency:"ZZZ", externalReference:"other-ref-002" }),
        );
        assert.equal((await admin.query("select * from investing.ledger_integrity_issues()")).rowCount,0);
      } finally {
        await pool.end();
      }
    });

    await t.test("NOLOGIN non-bypass restricted writer: atomic replay, cross-tenant denial, zero account UPDATE privilege", async () => {
      const roles=await admin.query<{rolcanlogin:boolean;rolbypassrls:boolean}>("select rolcanlogin,rolbypassrls from pg_roles where rolname='investing_contribution_writer'");
      assert.equal(roles.rowCount,1);
      assert.equal(roles.rows[0].rolcanlogin,false);
      assert.equal(roles.rows[0].rolbypassrls,false);
      const acl=await admin.query<{can_update:boolean;can_delete:boolean;can_insert:boolean;can_read:boolean}>(
        "select has_table_privilege('investing_contribution_writer','investing.investment_accounts','UPDATE') can_update,has_table_privilege('investing_contribution_writer','investing.investment_accounts','DELETE') can_delete,has_table_privilege('investing_contribution_writer','investing.investment_accounts','INSERT') can_insert,has_table_privilege('investing_contribution_writer','investing.investment_accounts','SELECT') can_read",
      );
      assert.equal(acl.rows[0].can_update,false);
      assert.equal(acl.rows[0].can_delete,false);
      assert.equal(acl.rows[0].can_insert,false);
      assert.equal(acl.rows[0].can_read,true);

      const restrictedPool=new Pool({connectionString:writerUrl.toString(),max:5});
      const restrictedDB=restrictedPool;
      const input={
        accountId:A,
        idempotencyKey:"restricted-actor-key-00001",
        currency:"EUR",
        amountMinor:200n,
        externalReference:"restricted-user-reported-0001",
      };
      const actorA={userId:"clerk_user_a",sessionId:"synthetic_test_restricted_a"};
      const actorB={userId:"clerk_user_b",sessionId:"synthetic_test_restricted_b"};
      try {
        const [first,replay]=await Promise.all([
          recordUserReportedContribution(restrictedDB,actorA,input),
          recordUserReportedContribution(restrictedDB,actorA,input),
        ]);
        assert.equal(first.transactionId,replay.transactionId);
        assert.equal(first.evidenceStatus,"USER_REPORTED");
        await assert.rejects(
          recordUserReportedContribution(restrictedDB,actorB,{...input,idempotencyKey:"restricted-denial-b-00001",externalReference:"restricted-denial-b-0001"}),
          (error:unknown)=>error instanceof ContributionBlocked && error.code==="ACCOUNT_NOT_AUTHORIZED",
        );
        await admin.query("set role investing_contribution_writer");
        try {
          const unscoped=await admin.query<{id:string}>("select id from investing.investment_accounts");
          assert.equal(unscoped.rowCount,0, "no actor GUC must see zero financial accounts");
          await assert.rejects(
            admin.query("insert into investing.operation_idempotency_keys(investment_account_id,user_id,key,request_hash) values ($1,'clerk_user_a','missing-actor-context-0001',$2)",[A,HASH_A]),
            /row-level security policy/,
          );
          await assert.rejects(
            admin.query("update investing.investment_accounts set name='forbidden' where id=$1",[A]),
            /permission denied/,
          );
          await assert.rejects(
            admin.query("delete from investing.ledger_entries"),
            /permission denied/,
          );
        } finally {
          await admin.query("reset role");
        }
        const count=await admin.query<{n:number}>(
          "select count(*)::int n from investing.ledger_transactions where investment_account_id=$1 and idempotency_key=$2",[A,input.idempotencyKey],
        );
        assert.equal(count.rows[0].n,1);
        assert.equal((await admin.query("select * from investing.ledger_integrity_issues()")).rowCount,0);
      } finally {
        await restrictedPool.end();
      }
    });

    await t.test("writer role: no authority without explicit role membership, no cross-tenant SQL access", async () => {
      const deniedPool=new Pool({connectionString:deniedUrl.toString(),max:1});
      const deniedDB=deniedPool;
      const actor={userId:"clerk_user_a",sessionId:"synthetic_denied_session"};
      const input={
        accountId:A,
        idempotencyKey:"role-assumption-denied-001",
        currency:"EUR",
        amountMinor:1n,
        externalReference:"role-assumption-denied-ref",
      };
      try {
        await assert.rejects(
          recordUserReportedContribution(deniedDB,actor,input),
          (e:unknown)=>e instanceof ContributionBlocked && e.code==="WRITER_NOT_CONFIGURED",
        );
      } finally {
        await deniedPool.end();
      }

      await admin.query("set role investing_contribution_writer");
      try {
        await admin.query("begin");
        await admin.query("select set_config('syntrake.actor_user_id','clerk_user_a',true)");
        const owned=await admin.query<{id:string}>("select id from investing.investment_accounts order by id");
        assert.deepEqual(owned.rows.map(r=>r.id),[A]);
        const otherAccount=await admin.query<{id:string}>("select id from investing.investment_accounts where id=$1",[B]);
        assert.equal(otherAccount.rowCount,0);
        await assert.rejects(
          admin.query("insert into investing.operation_idempotency_keys(investment_account_id,user_id,key,request_hash) values ($1,'clerk_user_a','deny-other-tenant-000001',$2)",[B,HASH_A]),
          /row-level security policy/,
        );
        await admin.query("rollback");
      } finally {
        await admin.query("rollback");
        await admin.query("reset role");
      }
      const absent=await admin.query<{n:number}>(
        "select count(*)::int n from investing.operation_idempotency_keys where investment_account_id=$1 and key='deny-other-tenant-000001'",[B],
      );
      assert.equal(absent.rows[0].n,0);
    });

    await t.test("single reused login connection never leaks SQL role or RLS actor across A/B transactions", async () => {
      // A single physical PG session is reused intentionally, including after
      // a denial. The previous Clerk actor and SET LOCAL ROLE must never
      // survive COMMIT/ROLLBACK on that pooled session.
      const pool=new Pool({connectionString:writerUrl.toString(),max:1});
      const actorA={userId:"clerk_user_a",sessionId:"synthetic_reuse_a"};
      const actorB={userId:"clerk_user_b",sessionId:"synthetic_reuse_b"};
      const declarationA={
        accountId:A,idempotencyKey:"reuse-pool-a-00000001",
        currency:"EUR",amountMinor:123n,externalReference:"reuse-pool-a-ref-0001",
      };
      const declarationB={
        accountId:B,idempotencyKey:"reuse-pool-b-00000001",
        currency:"EUR",amountMinor:456n,externalReference:"reuse-pool-b-ref-0001",
      };
      async function assertUnscopedPool() {
        const lease=await pool.connect();
        try {
          const q=await lease.query<{role:string;actor:string|null}>(
            "select current_user as role, nullif(current_setting('syntrake.actor_user_id',true),'') as actor",
          );
          assert.equal(q.rows[0]?.role,"investing_ci_writer_login");
          assert.equal(q.rows[0]?.actor,null);
          await assert.rejects(
            lease.query("select id from investing.investment_accounts"),
            /permission denied/,
          );
        } finally {
          lease.release();
        }
      }
      try {
        const first=await recordUserReportedContribution(pool,actorA,declarationA);
        assert.equal(first.evidenceStatus,"USER_REPORTED");
        await assertUnscopedPool();

        // Any client-supplied identity fields must be ignored, not treated
        // as proof that B may write to account A.
        await assert.rejects(
          recordUserReportedContribution(pool,actorB,{
            ...declarationA,
            idempotencyKey:"reuse-pool-spoof-00001",
            externalReference:"reuse-pool-spoof-ref-0001",
            userId:actorA.userId,
            sessionId:actorA.sessionId,
            actor:actorA,
          }),
          (e:unknown)=>e instanceof ContributionBlocked && e.code==="ACCOUNT_NOT_AUTHORIZED",
        );
        await assertUnscopedPool();

        const second=await recordUserReportedContribution(pool,actorB,declarationB);
        assert.equal(second.evidenceStatus,"USER_REPORTED");
        await assertUnscopedPool();
        const replay=await recordUserReportedContribution(pool,actorB,declarationB);
        assert.deepEqual(replay,second);
        await assertUnscopedPool();

        const own=await admin.query<{investment_account_id:string,n:number}>(
          "select investment_account_id,count(*)::int n from investing.ledger_transactions where id = any($1::uuid[]) group by investment_account_id",
          [[first.transactionId,second.transactionId]],
        );
        assert.deepEqual(
          own.rows.map(r=>[r.investment_account_id,r.n]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
          [[A,1],[B,1]],
        );
        const spoof=await admin.query<{n:number}>(
          "select count(*)::int n from investing.operation_idempotency_keys where key='reuse-pool-spoof-00001'",
        );
        assert.equal(spoof.rows[0].n,0);
        assert.equal((await admin.query("select * from investing.ledger_integrity_issues()")).rowCount,0);
      } finally {
        await pool.end();
      }
    });

    await t.test("invalid declaration fails before database access and creates no journal", async () => {
      const unreachable={
        connect:async ():Promise<never>=>{throw new Error("DATABASE_MUST_NOT_BE_ACCESSED");},
      };
      const actor={userId:"clerk_user_a",sessionId:"synthetic_invalid_input"};
      const bad={
        accountId:A,idempotencyKey:"invalid-form-00000001",
        currency:"EUR",amountMinor:"100",
        externalReference:"invalid-form-ref-0001",
      };
      await assert.rejects(
        recordUserReportedContribution(unreachable,actor,bad),
        (e:unknown)=>e instanceof Error && e.message!=="DATABASE_MUST_NOT_BE_ACCESSED",
      );
      await assert.rejects(
        recordUserReportedContribution(unreachable,actor,{...bad,amountMinor:-1n}),
        (e:unknown)=>e instanceof Error && e.message!=="DATABASE_MUST_NOT_BE_ACCESSED",
      );
    });

    await t.test("writer lock contention times out and rolls back without financial rows", async () => {
      const lockHolder=new Client({connectionString:writerUrl.toString()});
      const waitingPool=new Pool({connectionString:writerUrl.toString(),max:1});
      const idemKey="timeout-rollback-00001";
      await lockHolder.connect();
      try {
        await lockHolder.query("begin");
        await lockHolder.query("set local role investing_contribution_writer");
        await lockHolder.query(
          "select pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::text, 20261018))",
          [A],
        );
        await assert.rejects(
          recordUserReportedContribution(waitingPool,
            {userId:"clerk_user_a",sessionId:"synthetic_timeout_session"},
            {accountId:A,idempotencyKey:idemKey,currency:"EUR",amountMinor:42n,
              externalReference:"timeout-rollback-ref-0001"},
          ),
          (error:unknown)=>typeof error==="object" && error!==null
            && "code" in error && error.code==="55P03",
        );
      } finally {
        await lockHolder.query("rollback");
        await Promise.allSettled([lockHolder.end(),waitingPool.end()]);
      }
      const observed=await admin.query<{n:number}>(
        "select count(*)::int n from investing.operation_idempotency_keys where investment_account_id=$1 and key=$2",
        [A,idemKey],
      );
      assert.equal(observed.rows[0].n,0);
      assert.equal((await admin.query(
        "select count(*)::int n from investing.ledger_transactions where investment_account_id=$1 and idempotency_key=$2",
        [A,idemKey],
      )).rows[0].n,0);
    });

    await t.test("owner guard coordinates membership revocation with writer advisory lock", async () => {
      const ownerWriter=new Client({connectionString:DB_URL});
      const membershipAdmin=new Client({connectionString:DB_URL});
      await Promise.all([ownerWriter.connect(),membershipAdmin.connect()]);
      try {
        await ownerWriter.query("begin");
        await ownerWriter.query(
          "select pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::text, 20261018))",
          [A],
        );
        await membershipAdmin.query("begin");
        await membershipAdmin.query(
          "update investing.account_memberships set role='viewer' where investment_account_id=$1 and user_id='clerk_user_a'",
          [A],
        );
        const unavailable=await membershipAdmin.query<{locked:boolean}>(
          "select pg_try_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::text, 20261018)) as locked",
          [A],
        );
        assert.equal(unavailable.rows[0].locked,false);
        // The deferred guard must wait for this transaction-scoped writer
        // lock and then reject the invalid owner state at COMMIT.
        const denied=assert.rejects(
          membershipAdmin.query("commit"),
          /canonical owner membership invariant violated/,
        );
        await ownerWriter.query("commit");
        await denied;
        await membershipAdmin.query("rollback");
        const stillValid=await admin.query<{role:string}>(
          "select role from investing.account_memberships where investment_account_id=$1 and user_id='clerk_user_a'",
          [A],
        );
        assert.equal(stillValid.rows[0].role,"owner");
      } finally {
        await Promise.allSettled([ownerWriter.query("rollback"),membershipAdmin.query("rollback")]);
        await Promise.allSettled([ownerWriter.end(),membershipAdmin.end()]);
      }
    });

    await t.test("server transaction concurrent same-key replay is exactly once", async () => {
      const pool = new Pool({ connectionString: writerUrl.toString(), max: 5 });
      const actor = { userId: "clerk_user_a", sessionId: "synthetic_clerk_session_a" };
      const input = {
        accountId: A,
        idempotencyKey: "parallel-cash-0000001",
        currency: "EUR",
        amountMinor: 987n,
        externalReference: "fixture-parallel-0001",
      };
      try {
        const [a,b] = await Promise.all([
          recordUserReportedContribution(pool, actor, input),
          recordUserReportedContribution(pool, actor, input),
        ]);
        assert.equal(a.transactionId,b.transactionId);
        const count = await admin.query<{n:number}>(
          "select count(*)::int n from investing.ledger_transactions where investment_account_id=$1 and idempotency_user_id=$2 and idempotency_key=$3",
          [A,actor.userId,input.idempotencyKey],
        );
        assert.equal(count.rows[0].n,1);
        assert.equal((await admin.query("select * from investing.ledger_integrity_issues()")).rowCount,0);
      } finally {
        await pool.end();
      }
    });
  } finally {
    await admin.end();
  }
});
