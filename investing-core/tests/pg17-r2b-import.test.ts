import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { savePortfolioImport, PortfolioImportBlocked } from "../server/savePortfolioImport";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const PORT_A = "00000000-0000-4000-8000-0000000000a2";
const PORT_B = "00000000-0000-4000-8000-0000000000b2";
const actorA = { userId: "clerk_ci_investing_a", sessionId: "ci-session-a" };
const actorB = { userId: "clerk_ci_investing_b", sessionId: "ci-session-b" };
const draft = () => ({
  schemaVersion: "R2_IMPORT_DRAFT_V1" as const,
  source: "MANUAL_ENTRY" as const,
  sourceReference: "ci-import-source-001",
  asOf: "2026-10-22T18:00:00.000Z",
  portfolioName: "Long term",
  baseCurrency: "EUR",
  cashBalances: [
    { currency: "USD", amountMinor: "9007199254740993" },
    { currency: "EUR", amountMinor: "32500" },
  ],
  positions: [
    { instrument: { isin: "US0378331005", mic: "XNAS", quoteCurrency: "USD" },
      quantity: "1.000000000001", reportedCostBasis: null },
  ],
  plannedContributions: [
    { currency: "EUR", amountMinor: "10000", dueDate: "2026-11-01" },
  ],
});

test("R2-B1 isolated PG17: owner A/B, immutable atomic import, negative capability", async () => {
  const url = process.env.INVESTING_PG17_R2B_URL;
  assert.ok(url, "isolated PG17 URL mandatory; never run on Production");
  const admin = new Client({ connectionString: url });
  await admin.connect();
  let pool: Pool | undefined;
  try {
    const version = await admin.query<{v:string}>("select current_setting('server_version') as v");
    assert.match(version.rows[0].v,/^17\./);
    await admin.query("create role anon noinherit");
    await admin.query("create role authenticated noinherit");
    await admin.query("create schema auth");
    await admin.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
    await admin.query("grant usage on schema auth to authenticated");
    await admin.query("grant execute on function auth.jwt() to authenticated");
    for (const path of [
      "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
      "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
      "../../supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql",
    ]) {
      const sql=await readFile(new URL(path,import.meta.url),"utf8");
      await admin.query(sql);
    }
    const tables=await admin.query<{name:string;enabled:boolean;forced:boolean}>(
      "select c.relname as name,c.relrowsecurity enabled,c.relforcerowsecurity forced "+
      "from pg_class c join pg_namespace n on n.oid=c.relnamespace "+
      "where n.nspname='investing' and c.relkind='r' order by c.relname");
    assert.equal(tables.rows.length,13);
    for(const row of tables.rows.filter(r=>r.name.startsWith("portfolio_import_"))) {
      assert.equal(row.enabled,true); assert.equal(row.forced,true);
    }
    const rights=await admin.query<{
      anonRead:boolean;authRead:boolean;authWrite:boolean;writerRead:boolean;
      writerInsert:boolean;writerDelete:boolean;writerLedger:boolean;writerAccount:boolean;
    }>(
      "select has_table_privilege('anon','investing.portfolio_import_snapshots','SELECT') \"anonRead\","+
      "has_table_privilege('authenticated','investing.portfolio_import_snapshots','SELECT') \"authRead\","+
      "has_table_privilege('authenticated','investing.portfolio_import_snapshots','INSERT') \"authWrite\","+
      "has_table_privilege('investing_import_writer','investing.portfolio_import_snapshots','SELECT') \"writerRead\","+
      "has_table_privilege('investing_import_writer','investing.portfolio_import_snapshots','INSERT') \"writerInsert\","+
      "has_table_privilege('investing_import_writer','investing.portfolio_import_snapshots','DELETE') \"writerDelete\","+
      "has_table_privilege('investing_import_writer','investing.ledger_entries','INSERT') \"writerLedger\","+
      "has_table_privilege('investing_import_writer','investing.investment_accounts','INSERT') \"writerAccount\"");
    assert.deepEqual(rights.rows[0],{
      anonRead:false,authRead:false,authWrite:false,writerRead:true,
      writerInsert:true,writerDelete:false,writerLedger:false,writerAccount:false,
    });
    const role=await admin.query<{can_login:boolean;bypass:boolean}>(
      "select rolcanlogin can_login,rolbypassrls bypass from pg_roles where rolname='investing_import_writer'");
    assert.deepEqual(role.rows[0],{can_login:false,bypass:false});

    // CI fixtures. This is an ISOLATED disposable database, never Supabase.
    await admin.query("BEGIN");
    await admin.query("insert into investing.identity_accounts(user_id) values ($1),($2)",[actorA.userId,actorB.userId]);
    await admin.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ($1,$2,'A','EUR'),($3,$4,'B','EUR')",[A,actorA.userId,B,actorB.userId]);
    await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')",[A,actorA.userId,B,actorB.userId]);
    await admin.query("insert into investing.portfolios(id,investment_account_id,name) values ($1,$2,'Long A'),($3,$4,'Long B')",[PORT_A,A,PORT_B,B]);
    await admin.query("COMMIT");
    await admin.query("create role investing_import_ci login noinherit password 'ci-isolated-test-only'");
    await admin.query("grant investing_import_writer to investing_import_ci with inherit false, set true");
    await admin.query("grant connect on database syntrake_test to investing_import_ci");
    const runtime=new URL(url);
    runtime.username="investing_import_ci"; runtime.password="ci-isolated-test-only";
    pool=new Pool({connectionString:runtime.toString(),max:3});
    const command={portfolioId:PORT_A,idempotencyKey:"import-idempotent-0001",declaration:draft()};
    const first=await savePortfolioImport(pool,actorA,command);
    assert.equal(first.kind,"UNVERIFIED_IMPORT");
    assert.equal(first.ledgerChanged,false);
    const replay=await savePortfolioImport(pool,actorA,command);
    assert.deepEqual(first,replay);
    const journalCount=await admin.query<{count:string}>("select count(*)::text as count from investing.ledger_transactions");
    assert.equal(journalCount.rows[0].count,"0");
    const snapshots=await admin.query<{id:string;declared_base_currency:string; evidence_status:string}>(
      "select id,declared_base_currency,evidence_status from investing.portfolio_import_snapshots");
    assert.equal(snapshots.rows.length,1);
    assert.equal(snapshots.rows[0].id,first.snapshotId);
    assert.equal(snapshots.rows[0].declared_base_currency.trim(),"EUR");
    assert.equal(snapshots.rows[0].evidence_status,"UNVERIFIED");
    const money=await admin.query<{currency:string;amount:string}>(
      "select currency,reported_amount_minor::text amount from investing.portfolio_import_cash order by currency");
    assert.deepEqual(money.rows.map(r=>[r.currency.trim(),r.amount]),[
      ["EUR","32500"],["USD","9007199254740993"],
    ]);
    const position=await admin.query<{atoms:string;reported_cost_minor:string|null}>(
      "select quantity_atoms::text atoms,reported_cost_minor::text from investing.portfolio_import_positions");
    assert.deepEqual(position.rows,[{atoms:"1000000000001",reported_cost_minor:null}]);
    const planned=await admin.query<{realized:boolean}>("select realized from investing.portfolio_import_planned_contributions");
    assert.deepEqual(planned.rows,[{realized:false}]);

    // Wrong owner; foreign tenant selector never establishes authority.
    await assert.rejects(
      savePortfolioImport(pool,actorB,{...command,idempotencyKey:"import-wrong-owner01"}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="NOT_AUTHORIZED");
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,declaration:{...draft(),cashBalances:[{currency:"EUR",amountMinor:"999"}]}}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="IDEMPOTENCY_CONFLICT");
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,idempotencyKey:"different-key-00001"}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="SOURCE_CONFLICT");
    await assert.rejects(
      savePortfolioImport(pool,{userId:null,sessionId:null},command),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="UNAUTHENTICATED");
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,declaration:{...draft(),actorId:actorB.userId}}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="INVALID_INPUT");

    const concurrent=await Promise.all([
      savePortfolioImport(pool,actorB,{portfolioId:PORT_B,idempotencyKey:"import-b-concurrent1",declaration:draft()}),
      savePortfolioImport(pool,actorB,{portfolioId:PORT_B,idempotencyKey:"import-b-concurrent1",declaration:draft()}),
    ]);
    assert.deepEqual(concurrent[0],concurrent[1]);
    const bRows=await admin.query<{count:string}>(
      "select count(*)::text as count from investing.portfolio_import_snapshots where portfolio_id=$1",[PORT_B]);
    assert.equal(bRows.rows[0].count,"1");
    await assert.rejects(admin.query(
      "update investing.portfolio_import_cash set reported_amount_minor=123 where snapshot_id=$1",
      [first.snapshotId]), /immutable/);
    await assert.rejects(admin.query(
      "delete from investing.portfolio_import_snapshots where id=$1",[first.snapshotId]),/immutable/);
  } finally {
    await pool?.end();
    await admin.end();
  }
});
