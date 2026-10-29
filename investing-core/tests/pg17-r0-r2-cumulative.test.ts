import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { initializeFirstInvestingPortfolio } from "../server/initializeFirstPortfolio";
import { savePortfolioImport, PortfolioImportBlocked } from "../server/savePortfolioImport";
import { readOwnPortfolioImport, PortfolioImportReadBlocked } from "../server/readOwnPortfolioImport";
import { createOnboardingService } from "../r2/onboardingPortfolio";
import { createPostgresPortfolioRepository } from "../server/postgresPortfolioRepository";

/**
 * One isolated PG17 database with the actual R0/R1 first-readonly SQL and ALL
 * FOUR subsequent R2 SQL candidates. Synthetic test actors: NOT a real Clerk
 * A/B rehearsal and NOT a copy of Production data or migration registry.
 */
const FIXED = "postgresql://postgres:postgres@127.0.0.1:5432/syntrake_r0_r2_cumulative_ci";
const A = { userId: "user_cumulative_ci_a", sessionId: "ci-a" };
const B = { userId: "user_cumulative_ci_b", sessionId: "ci-b" };
const initKeyA = "00000000-0000-4000-8000-000000000a01";
const initKeyB = "00000000-0000-4000-8000-000000000b01";
const input = (name: string) => ({
  declaredCapital: null,
  objectives: [{ id: "objective-cumulative-0001", name, targetMinor: null, currency: "EUR", targetDate: null }],
  horizon: "LONG", riskTolerance: "MEDIUM", riskCapacity: "MEDIUM",
  liquidity: { currency: "EUR", minimumMinor: null, needsWithinDays: null },
  restrictions: [], plannedContributions: [],
});
const importDeclaration = {
  schemaVersion: "R2_IMPORT_DRAFT_V1" as const,
  source: "MANUAL_ENTRY" as const,
  sourceReference: "cumulative-declaration-20261029",
  asOf: "2026-10-29T12:00:00.000Z",
  portfolioName: "Declared Portfolio",
  baseCurrency: "EUR",
  reportedCoverage: { cash: "PARTIAL" as const, positions: "NOT_REPORTED" as const },
  cashBalances: [{ currency: "EUR", amountMinor: "4321" }],
  positions: [],
  plannedContributions: [],
};

test("R0→R2 cumulative PG17: exact candidate SQL, role isolation, owner A/B, import and ledger truth", async () => {
  assert.equal(process.env.CI, "true", "CI-only, never against a remote project");
  assert.equal(process.env.INVESTING_PG17_R0_R2_CUMULATIVE_URL, FIXED, "strict loopback disposable PG17");
  const db = new Client({ connectionString: FIXED });
  await db.connect();
  const pools: Pool[] = [];
  try {
    assert.match((await db.query<{ v: string }>("select current_setting('server_version') as v")).rows[0].v, /^17\./);

    // Only synthetic Supabase role and JWT context — no real Clerk signing.
    await db.query("create role anon noinherit");
    await db.query("create role authenticated noinherit");
    await db.query("create schema auth");
    await db.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
    await db.query("grant usage on schema auth to authenticated");
    await db.query("grant execute on function auth.jwt() to authenticated");

    const sqlFiles = [
      "../../supabase/release-candidates/20261020180000_investing_first_readonly_release.sql",
      "../../supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql",
      "../../supabase/release-candidates/20261022210000_r2c_onboarding_intents.sql",
      "../../supabase/release-candidates/20261023063000_r2c2_first_portfolio.sql",
      "../../supabase/release-candidates/20261029201005_r2_bl2bl3_canonical.sql",
    ];
    for (const path of sqlFiles) {
      const sql = await readFile(new URL(path, import.meta.url), "utf8");
      assert.ok(sql.length > 1000, "missing release SQL: " + path);
      await db.query(sql);
      process.stdout.write("CUMULATIVE_CANDIDATE_SQL_APPLIED " + path + "\n");
    }

    const counts = await db.query<{ tables: number; rls: number; forced: number }>(`
      select count(*)::int as tables,
             count(*) filter (where c.relrowsecurity)::int as rls,
             count(*) filter (where c.relforcerowsecurity)::int as forced
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='investing' and c.relkind='r'`);
    assert.equal(counts.rows[0].tables, 19);
    assert.equal(counts.rows[0].rls, 19);
    assert.equal(counts.rows[0].forced, 18); // Supported currencies is global readonly.
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from investing.ledger_transactions")).rows[0].n, 0);

    // Real NOINHERIT logins and transaction-scoped SET ROLE for each capability.
    const roleMatrix = [
      ["ci_cumulative_first", "investing_initial_provisioner"],
      ["ci_cumulative_revisions", "investing_bl2bl3_runtime"],
      ["ci_cumulative_import", "investing_import_writer"],
    ] as const;
    for (const [login, capability] of roleMatrix) {
      await db.query(`create role ${login} login noinherit nosuperuser nobypassrls password 'CI_isolated_only_20261029'`);
      await db.query(`grant ${capability} to ${login} with inherit false, set true, admin false`);
      const result = await db.query<{ login: boolean; bypass: boolean; inherited: boolean; allowed_set: boolean }>(
        `select r.rolcanlogin login, r.rolbypassrls bypass,
                m.inherit_option inherited,m.set_option allowed_set
         from pg_roles r join pg_auth_members m on m.member=r.oid
         where r.rolname=$1 and m.roleid=$2::regrole`, [login, capability]);
      assert.deepEqual(result.rows, [{ login: true, bypass: false, inherited: false, allowed_set: true }]);
    }
    const pool = (login: string) => {
      const url = new URL(FIXED); url.username = login; url.password = "CI_isolated_only_20261029";
      const p = new Pool({ connectionString: url.toString(), max: 2 }); pools.push(p); return p;
    };
    const first = pool("ci_cumulative_first");
    const revisions = pool("ci_cumulative_revisions");
    const imports = pool("ci_cumulative_import");

    // Identity context emulates auth.jwt() with PG authenticated role.
    for (const [actor, key] of [[A, initKeyA], [B, initKeyB]] as const) {
      await db.query("begin");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor.userId, role: "authenticated" })]);
        const result = await db.query(
          "insert into investing.onboarding_intents (actor_user_id,idempotency_key,payload_sha256,pathway,objective,horizon_years,loss_capacity) values ($1,$2,repeat('a',64),'NEEDS_PORTFOLIO','WEALTH_GROWTH',15,'MEDIUM') returning id",
          [actor.userId, key]);
        assert.equal(result.rowCount, 1);
        await db.query("commit");
      } catch (error) { await db.query("rollback"); throw error; }
    }

    // A/B cannot see each other's signed claims under RLS.
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: A.userId, role: "authenticated" })]);
      const visible = await db.query<{ actor_user_id: string }>("select actor_user_id from investing.onboarding_intents");
      assert.deepEqual(visible.rows.map(x=>x.actor_user_id), [A.userId]);
    } finally { await db.query("rollback"); }

    const cmd = (key: string) => ({
      idempotencyKey: key, accountName: "Cumulative Account", portfolioName: "Cumulative Portfolio",
      baseCurrency: "EUR" as const,
    });
    const accountA = await initializeFirstInvestingPortfolio(first, A, cmd(initKeyA));
    const accountB = await initializeFirstInvestingPortfolio(first, B, cmd(initKeyB));
    assert.equal(accountA.state, "STRUCTURE_CREATED_UNFUNDED");
    assert.equal(accountB.state, "STRUCTURE_CREATED_UNFUNDED");
    assert.notEqual(accountA.accountId, accountB.accountId);
    assert.notEqual(accountA.portfolioId, accountB.portfolioId);
    assert.deepEqual(await initializeFirstInvestingPortfolio(first, A, cmd(initKeyA)), accountA);

    const a = createOnboardingService(createPostgresPortfolioRepository(revisions, A.userId), async () => A);
    const b = createOnboardingService(createPostgresPortfolioRepository(revisions, B.userId), async () => B);
    const draftA = await a.upsertRevision(accountA.accountId, input("A initial"), {
      revisionId: "cumulative-A-revision-00001", idempotencyKey: "cumulative-A-upsert-00001",
    });
    const firstAppliedA = await a.createOrRecoverPortfolio(accountA.accountId, draftA.revisionId);
    assert.equal(firstAppliedA.version, 1);
    assert.deepEqual(await a.createOrRecoverPortfolio(accountA.accountId, draftA.revisionId), firstAppliedA);
    const draftB = await b.upsertRevision(accountB.accountId, input("B initial"), {
      revisionId: "cumulative-B-revision-00001", idempotencyKey: "cumulative-B-upsert-00001",
    });
    assert.equal((await b.createOrRecoverPortfolio(accountB.accountId, draftB.revisionId)).version, 1);
    const correctionRequest = { revisionId: "cumulative-A-revision-00002", idempotencyKey: "cumulative-A-correct-00002" };
    assert.equal((await a.applyCorrection(accountA.accountId, input("A corrected"), correctionRequest)).version, 2);
    assert.equal((await a.applyCorrection(accountA.accountId, input("A corrected"), correctionRequest)).version, 2);
    await assert.rejects(b.upsertRevision(accountA.accountId, input("stolen"), {
      revisionId: "cumulative-cross-rev-00001", idempotencyKey: "cumulative-cross-idem-001",
    }), /ACCOUNT_NOT_OWNED/);

    // User-declared import only. The 4th independent NOINHERIT writer cannot post cash.
    const importCommand = {
      portfolioId: accountA.portfolioId,
      idempotencyKey: "cumulative-import-000001",
      declaration: importDeclaration,
    };
    const saved = await savePortfolioImport(imports, A, importCommand);
    assert.equal(saved.kind, "UNVERIFIED_IMPORT");
    assert.equal(saved.ledgerChanged, false);
    assert.deepEqual(await savePortfolioImport(imports, A, importCommand), saved);
    const readback = await readOwnPortfolioImport(imports, A, {
      portfolioId: accountA.portfolioId, snapshotId: saved.snapshotId,
    });
    assert.equal(readback.reportedCoverage.cash, "PARTIAL");
    assert.equal(readback.reportedCoverage.positions, "NOT_REPORTED");
    assert.equal(readback.cashBalances[0]?.minor, 4321n);
    assert.equal(readback.verifiedCash, "UNAVAILABLE");
    assert.equal(readback.valuation, "UNAVAILABLE");
    await assert.rejects(readOwnPortfolioImport(imports, B, {
      portfolioId: accountA.portfolioId, snapshotId: saved.snapshotId,
    }), (e: unknown) => e instanceof PortfolioImportReadBlocked && e.code === "NOT_AUTHORIZED");
    await assert.rejects(savePortfolioImport(imports, B, {
      ...importCommand, idempotencyKey: "cumulative-cross-import-01",
    }), (e: unknown) => e instanceof PortfolioImportBlocked && e.code === "NOT_AUTHORIZED");

    const audit = await db.query<{
      owners: string; portfolios: string; subledgers: string;
      revisions: string; imports: string; txs: string; entries: string;
    }>(`select
      (select count(distinct user_id)::text from investing.initial_portfolio_receipts) owners,
      (select count(*)::text from investing.portfolios) portfolios,
      (select count(*)::text from investing.ledger_accounts) subledgers,
      (select count(*)::text from investing.onboarding_revisions) revisions,
      (select count(*)::text from investing.portfolio_import_snapshots) imports,
      (select count(*)::text from investing.ledger_transactions) txs,
      (select count(*)::text from investing.ledger_entries) entries`);
    assert.deepEqual(audit.rows, [{
      owners: "2", portfolios: "2", subledgers: "12", revisions: "3",
      imports: "1", txs: "0", entries: "0",
    }]);
    process.stdout.write("R0_R2_CUMULATIVE_ISOLATED_PG17_PASS\n");
  } finally {
    await Promise.allSettled(pools.map(p => p.end()));
    await db.end();
  }
});
