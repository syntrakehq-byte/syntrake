import assert from "node:assert/strict";
import { createRequire } from "node:module";
const projectRequire = createRequire(new URL("../../package.json", import.meta.url));
const { Pool } = projectRequire("pg") as typeof import("pg");
import { initializeFirstInvestingPortfolio } from "../../investing-core/server/initializeFirstPortfolio.ts";
import { createOnboardingService } from "../../investing-core/r2/onboardingPortfolio.ts";
import { createPostgresPortfolioRepository } from "../../investing-core/server/postgresPortfolioRepository.ts";

const pool = new Pool({ max: 6 });
const A = { userId: "user_pg6_a", sessionId: "session-a" };
const B = { userId: "user_pg6_b", sessionId: "session-b" };
const input = { declaredCapital: { currency: "EUR", amountMinor: "100000" }, objectives: [{ id: "objective-00000001", name: "Retirement", targetMinor: null, currency: "EUR", targetDate: null }], horizon: "LONG", riskTolerance: "MEDIUM", riskCapacity: "LOW", liquidity: { currency: "EUR", minimumMinor: null, needsWithinDays: null }, restrictions: ["No leveraged products"], plannedContributions: [{ id: "contribution-000001", currency: "EUR", amountMinor: "50000", dueDate: "2027-01-01" }] };
async function expectSqlState(client: any, operation: () => Promise<unknown>, code: string) {
  await client.query("savepoint assertion");
  try { await assert.rejects(operation(), (error: any) => error?.code === code); }
  finally { await client.query("rollback to savepoint assertion"); }
}
async function expectCommitSqlState(client: any, code: string) {
  await assert.rejects(client.query("commit"), (error: any) => error?.code === code);
}
async function addIntent(userId: string, key: string) { await pool.query("insert into investing.onboarding_intents(actor_user_id,idempotency_key,payload_sha256,pathway,objective,horizon_years,loss_capacity) values ($1,$2,$3,'NEEDS_PORTFOLIO','RETIREMENT',30,'LOW')", [userId, key, "a".repeat(64)]); }
async function main() {
  await addIntent(A.userId, "00000000-0000-4000-8000-0000000000a1"); await addIntent(B.userId, "00000000-0000-4000-8000-0000000000b1");
  const rA = await initializeFirstInvestingPortfolio(pool, A, { idempotencyKey: "00000000-0000-4000-8000-0000000000a1", accountName: "Account A", portfolioName: "Portfolio A", baseCurrency: "EUR" });
  const rB = await initializeFirstInvestingPortfolio(pool, B, { idempotencyKey: "00000000-0000-4000-8000-0000000000b1", accountName: "Account B", portfolioName: "Portfolio B", baseCurrency: "EUR" });
  assert.deepEqual(await initializeFirstInvestingPortfolio(pool, A, { idempotencyKey: "00000000-0000-4000-8000-0000000000a1", accountName: "Account A", portfolioName: "Portfolio A", baseCurrency: "EUR" }), rA);
  const sa = createOnboardingService(createPostgresPortfolioRepository(pool, A.userId), async () => A);
  const sb = createOnboardingService(createPostgresPortfolioRepository(pool, B.userId), async () => B);
  const first = await sa.upsertRevision(rA.accountId, input, { revisionId: "revision-pg6-00000001", idempotencyKey: "onboarding-pg6-00000001" });
  const firstApplied = await sa.createOrRecoverPortfolio(rA.accountId, first.revisionId); assert.equal(firstApplied.version, 1);
  const security = await pool.connect();
  try {
    await security.query("begin"); await security.query("set local role investing_bl2bl3_runtime");
    await security.query("select set_config('syntrake.actor_user_id',$1,true)", [A.userId]);
    await expectSqlState(security, () => security.query("insert into investing.onboarding_revisions(account_id,revision_id,actor_user_id,idempotency_key,input_payload,declared_capital,verification_status,status,status_changed_by) values ($1,$2,$3,$4,'{}','{}','UNVERIFIED','PENDING',$3)", [rB.accountId, "revision-pg6-direct-cross", A.userId, "onboarding-pg6-direct-cross"]), "42501");
    await expectSqlState(security, () => security.query("select investing.transition_onboarding_revision($1,$2,$3,'PENDING','APPLIED')", [rA.accountId, first.revisionId, A.userId]), "P0001");
    await expectSqlState(security, () => security.query("select investing.update_onboarding_projection($1,$2,$3,1,$3,99)", [rA.accountId, rA.portfolioId, first.revisionId]), "P0001");
    await security.query("rollback");
  } finally { security.release(); }
  const directCrossCount = await pool.query("select count(*)::int as count from investing.onboarding_revisions where revision_id=$1", ["revision-pg6-direct-cross"]);
  assert.equal(directCrossCount.rows[0].count, 0);
  const replay = await sa.upsertRevision(rA.accountId, input, { revisionId: "revision-pg6-replay01", idempotencyKey: "onboarding-pg6-00000001" }); assert.equal(replay.revisionId, first.revisionId);
  const correctionInput = { ...input, restrictions: ["No crypto"] };
  const correction = await sa.applyCorrection(rA.accountId, correctionInput, { revisionId: "revision-pg6-00000002", idempotencyKey: "onboarding-pg6-00000002" }); assert.equal(correction.version, 2);
  const correctionReplay = await sa.applyCorrection(rA.accountId, correctionInput, { revisionId: "revision-pg6-replay02", idempotencyKey: "onboarding-pg6-00000002" }); assert.equal(correctionReplay.version, 2);
  const pending = await sa.upsertRevision(rA.accountId, { ...input, restrictions: ["Abandon"] }, { revisionId: "revision-pg6-00000003", idempotencyKey: "onboarding-pg6-00000003" }); assert.equal((await sa.abandonRevision(rA.accountId, pending.revisionId)).lifecycle.status, "ABANDONED");
  const poolA = new Pool({ max: 1 }); const poolB = new Pool({ max: 1 });
  const ca = createOnboardingService(createPostgresPortfolioRepository(poolA, A.userId), async () => A);
  const cb = createOnboardingService(createPostgresPortfolioRepository(poolB, A.userId), async () => A);
  const sameKey = await Promise.all([
    ca.upsertRevision(rA.accountId, { ...input, restrictions: ["Concurrent same key"] }, { revisionId: "revision-pg6-concurrent01", idempotencyKey: "onboarding-pg6-concurrent01" }),
    cb.upsertRevision(rA.accountId, { ...input, restrictions: ["Concurrent same key"] }, { revisionId: "revision-pg6-concurrent02", idempotencyKey: "onboarding-pg6-concurrent01" }),
  ]);
  assert.equal(sameKey[0].revisionId, sameKey[1].revisionId);
  const concurrentCorrections = await Promise.all([
    ca.applyCorrection(rA.accountId, { ...input, restrictions: ["Concurrent correction A"] }, { revisionId: "revision-pg6-concurrent03", idempotencyKey: "onboarding-pg6-concurrent03" }),
    cb.applyCorrection(rA.accountId, { ...input, restrictions: ["Concurrent correction B"] }, { revisionId: "revision-pg6-concurrent04", idempotencyKey: "onboarding-pg6-concurrent04" }),
  ]);
  assert.deepEqual(new Set(concurrentCorrections.map((result) => result.version)), new Set([3, 4]));
  const independentAccounts = await Promise.all([
    ca.upsertRevision(rA.accountId, { ...input, restrictions: ["Independent A"] }, { revisionId: "revision-pg6-independent01", idempotencyKey: "onboarding-pg6-independent01" }),
    sb.upsertRevision(rB.accountId, { ...input, restrictions: ["Independent B"] }, { revisionId: "revision-pg6-independent02", idempotencyKey: "onboarding-pg6-independent02" }),
  ]);
  assert.notEqual(independentAccounts[0].accountId, independentAccounts[1].accountId);
  const bSecond = await sb.upsertRevision(rB.accountId, { ...input, restrictions: ["Independent B second"] }, { revisionId: "revision-pg6-independent03", idempotencyKey: "onboarding-pg6-independent03" });
  const current = await pool.query("select current_revision_id, version from investing.onboarding_projections where portfolio_id=$1", [rA.portfolioId]);
  const integrity = await pool.connect();
  try {
    await integrity.query("begin"); await integrity.query("set local role investing_bl2bl3_runtime"); await integrity.query("select set_config('syntrake.actor_user_id',$1,true)", [A.userId]);
    await expectSqlState(integrity, () => integrity.query("select investing.update_onboarding_projection($1,$2,$3,$4,$3,$5)", [rA.accountId, rA.portfolioId, current.rows[0].current_revision_id, current.rows[0].version, Number(current.rows[0].version)+1]), "P0001");
    await expectSqlState(integrity, () => integrity.query("select investing.update_onboarding_projection($1,$2,$3,$4,$5,$6)", [rA.accountId, rA.portfolioId, first.revisionId, current.rows[0].version, current.rows[0].current_revision_id, Number(current.rows[0].version)+1]), "P0001");
    await integrity.query("rollback");
  } finally { integrity.release(); }
  const appliedWithoutProjection = await pool.connect();
  try {
    await appliedWithoutProjection.query("begin"); await appliedWithoutProjection.query("set local role investing_bl2bl3_runtime"); await appliedWithoutProjection.query("select set_config('syntrake.actor_user_id',$1,true)", [B.userId]);
    await appliedWithoutProjection.query("select investing.transition_onboarding_revision($1,$2,$3,'PENDING','APPLIED')", [rB.accountId, independentAccounts[1].revisionId, B.userId]);
    await appliedWithoutProjection.query("select investing.transition_onboarding_revision($1,$2,$3,'PENDING','APPLIED')", [rB.accountId, bSecond.revisionId, B.userId]);
    await expectCommitSqlState(appliedWithoutProjection, "23514");
  } finally { appliedWithoutProjection.release(); }
  const bApplied = await pool.query("select count(*)::int as count from investing.onboarding_revisions where account_id=$1 and status='APPLIED'", [rB.accountId]);
  assert.equal(bApplied.rows[0].count, 0);
  const verified = await pool.connect();
  try {
    await verified.query("begin"); await verified.query("set local role investing_bl2bl3_runtime"); await verified.query("select set_config('syntrake.actor_user_id',$1,true)", [B.userId]);
    await expectSqlState(verified, () => verified.query("insert into investing.onboarding_revisions(account_id,revision_id,actor_user_id,idempotency_key,input_payload,declared_capital,verified_capital,verification_status,status,status_changed_by) values ($1,$2,$3,$4,'{}','{}','{\"source\":\"forged\"}','VERIFIED_AUTHORIZED_SOURCE','PENDING',$3)", [rB.accountId, "revision-pg6-forged-verified", B.userId, "onboarding-pg6-forged-verified"]), "42501");
    await verified.query("rollback");
  } finally { verified.release(); }
  await poolA.end(); await poolB.end();
  await assert.rejects(sa.upsertRevision(rB.accountId, input, { revisionId: "revision-pg6-cross0001", idempotencyKey: "onboarding-pg6-cross0001" }), /ACCOUNT_NOT_OWNED/);
  await assert.rejects(sb.upsertRevision(rA.accountId, input, { revisionId: "revision-pg6-cross0002", idempotencyKey: "onboarding-pg6-cross0002" }), /ACCOUNT_NOT_OWNED/);
  await assert.rejects(createPostgresPortfolioRepository(pool, A.userId).transaction(async (tx) => { await tx.appendRevision({ ...first, revisionId: "revision-pg6-rollback1", idempotencyKey: "onboarding-pg6-rollback1" }); throw new Error("ROLLBACK_PROBE"); }), /ROLLBACK_PROBE/);
  const post = await pool.query("select (select count(*)::int from investing.onboarding_events where account_id=$1) events,(select status from investing.onboarding_revisions where account_id=$1 and revision_id=$2) abandoned,(select version::int from investing.onboarding_projections where portfolio_id=$3) version,(select count(*)::int from investing.ledger_transactions where investment_account_id=$1) ledger", [rA.accountId, pending.revisionId, rA.portfolioId]);
  assert.equal(post.rows[0].events, 8); assert.equal(post.rows[0].abandoned, "ABANDONED"); assert.equal(post.rows[0].version, 4); assert.equal(post.rows[0].ledger, 0);
  const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role investing_bl2bl3_runtime"); await expectSqlState(c, () => c.query("update investing.onboarding_revisions set status='ABANDONED'"), "42501"); await expectSqlState(c, () => c.query("update investing.onboarding_events set to_status='FORGED'"), "42501"); await expectSqlState(c, () => c.query("update investing.onboarding_projections set version=999"), "42501"); await c.query("rollback"); } finally { c.release(); }
  const lockFirst = await pool.connect();
  const ownerAfterLock = await pool.connect();
  let ownerAfterLockDone = false;
  try {
    await lockFirst.query("begin"); await lockFirst.query("set local role investing_bl2bl3_runtime");
    await lockFirst.query("select set_config('syntrake.actor_user_id',$1,true)", [A.userId]);
    await lockFirst.query("select pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::uuid::text, 20261018))", [rA.accountId]);
    const ownerCommit = (async () => {
      await ownerAfterLock.query("begin");
      await ownerAfterLock.query("delete from investing.account_memberships where investment_account_id=$1 and user_id=$2 and role='owner'", [rA.accountId, A.userId]);
      await ownerAfterLock.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,$2,'owner')", [rA.accountId, B.userId]);
      await ownerAfterLock.query("update investing.investment_accounts set owner_user_id=$2 where id=$1", [rA.accountId, B.userId]);
      await ownerAfterLock.query("commit"); ownerAfterLockDone = true;
    })();
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(ownerAfterLockDone, false);
    await lockFirst.query("insert into investing.onboarding_revisions(account_id,revision_id,actor_user_id,idempotency_key,input_payload,declared_capital,verification_status,status,status_changed_by) values ($1,$2,$3,$4,'{}','{}','UNVERIFIED','PENDING',$3)", [rA.accountId, "revision-pg6-lock-first", A.userId, "onboarding-pg6-lock-first"]);
    await lockFirst.query("commit"); await ownerCommit;
  } finally { lockFirst.release(); ownerAfterLock.release(); }
  await assert.rejects(sa.upsertRevision(rA.accountId, { ...input, restrictions: ["Revoked"] }, { revisionId: "revision-pg6-revoked", idempotencyKey: "onboarding-pg6-revoked" }), /ACCOUNT_NOT_OWNED/);
  const oldEvents = await pool.connect(); try { await oldEvents.query("begin"); await oldEvents.query("set local role investing_bl2bl3_runtime"); await oldEvents.query("select set_config('syntrake.actor_user_id',$1,true)", [A.userId]); const hidden = await oldEvents.query("select count(*)::int as count from investing.onboarding_events where account_id=$1", [rA.accountId]); assert.equal(hidden.rows[0].count, 0); await oldEvents.query("rollback"); } finally { oldEvents.release(); }
  const ownerFirst = await pool.connect(); const bl2AfterOwner = await pool.connect();
  let bl2AfterOwnerDone = false;
  try {
    await ownerFirst.query("begin");
    await ownerFirst.query("select pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::uuid::text, 20261018))", [rB.accountId]);
    await ownerFirst.query("delete from investing.account_memberships where investment_account_id=$1 and user_id=$2 and role='owner'", [rB.accountId, B.userId]);
    await ownerFirst.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,$2,'owner')", [rB.accountId, A.userId]);
    await ownerFirst.query("update investing.investment_accounts set owner_user_id=$2 where id=$1", [rB.accountId, A.userId]);
    await bl2AfterOwner.query("begin"); await bl2AfterOwner.query("set local role investing_bl2bl3_runtime");
    await bl2AfterOwner.query("select set_config('syntrake.actor_user_id',$1,true)", [B.userId]);
    const bl2Wait = (async () => { await bl2AfterOwner.query("select pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::uuid::text, 20261018))", [rB.accountId]); bl2AfterOwnerDone = true; })();
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(bl2AfterOwnerDone, false);
    await ownerFirst.query("commit"); await bl2Wait;
    await expectSqlState(bl2AfterOwner, () => bl2AfterOwner.query("insert into investing.onboarding_revisions(account_id,revision_id,actor_user_id,idempotency_key,input_payload,declared_capital,verification_status,status,status_changed_by) values ($1,$2,$3,$4,'{}','{}','UNVERIFIED','PENDING',$3)", [rB.accountId, "revision-pg6-owner-first", B.userId, "onboarding-pg6-owner-first"]), "42501");
    await bl2AfterOwner.query("rollback");
  } finally { ownerFirst.release(); bl2AfterOwner.release(); }
  await assert.rejects(sa.upsertRevision(rA.accountId, { ...input, restrictions: ["Revoked"] }, { revisionId: "revision-pg6-revoked", idempotencyKey: "onboarding-pg6-revoked" }), /ACCOUNT_NOT_OWNED/);
  console.log("OWNERSHIP_CONCURRENCY_PASS", JSON.stringify({ accountA: rA.accountId, accountB: rB.accountId, portfolioA: rA.portfolioId }));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
