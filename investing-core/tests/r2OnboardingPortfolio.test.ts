import assert from "node:assert/strict";
import test from "node:test";
import { assertRevisionTransition, createOnboardingService, type LifecycleTransition, type OnboardingRevision, type PortfolioRecord, type PortfolioRepository, type RevisionLifecycle, type Transaction } from "../r2/onboardingPortfolio";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const actor = { userId: "user-a", sessionId: "session-a" };
const request = (n: string) => ({ revisionId: "revision-" + n.padStart(8, "0"), idempotencyKey: "onboarding-" + n.padStart(8, "0") });
const input = { declaredCapital: { currency: "EUR", amountMinor: "100000" }, objectives: [{ id: "objective-00000001", name: "Retirement", targetMinor: null, currency: "EUR", targetDate: null }], horizon: "LONG", riskTolerance: "MEDIUM", riskCapacity: "LOW", liquidity: { currency: "EUR", minimumMinor: null, needsWithinDays: null }, restrictions: ["No leveraged products"], plannedContributions: [{ id: "contribution-000001", currency: "EUR", amountMinor: "50000", dueDate: "2027-01-01" }] };

type TestRepo = PortfolioRepository & { readonly revisions: readonly OnboardingRevision[]; readonly portfolios: readonly PortfolioRecord[]; readonly transitions: readonly LifecycleTransition[]; seedStructural(accountId?: string, portfolioId?: string, ownerUserId?: string): void; failNextUpdate(): void; enableOverlap(): void; };
function repo(options: { verified?: boolean; malformed?: boolean } = {}): TestRepo {
  const state = { revisions: [] as OnboardingRevision[], portfolios: [] as PortfolioRecord[], transitions: [] as LifecycleTransition[] };
  let epoch = 0; let failUpdate = false; let arrivals = 0; let release!: () => void; let overlapEnabled = false; let gate: Promise<void> | null = null;
  const accounts = [{ id: A, ownerUserId: actor.userId }, { id: B, ownerUserId: "user-b" }, { id: C, ownerUserId: actor.userId }];
  const base = (snap: { revisions: OnboardingRevision[]; portfolios: PortfolioRecord[]; transitions: LifecycleTransition[] }): Transaction => ({
    async resolveOwnedAccount(id) { return accounts.find((x) => x.id === id) ?? null; },
    async getRevision(accountId, userId, revision) { return snap.revisions.find((x) => x.accountId === accountId && x.actorUserId === userId && x.revisionId === revision) ?? null; },
    async getRevisionByIdempotency(accountId, userId, key) { return snap.revisions.find((x) => x.accountId === accountId && x.actorUserId === userId && x.idempotencyKey === key) ?? null; },
    async getPortfolio(accountId, userId) { return snap.portfolios.find((x) => x.accountId === accountId && x.ownerUserId === userId) ?? null; },
    async getVerifiedCapital() { return options.malformed ? { currency: "EUR", amountMinor: "90000", asOf: "bad", source: "BANK_CONFIRMED", evidenceReference: "short" } : options.verified ? { currency: "EUR", amountMinor: "90000", asOf: "2026-10-25T10:00:00.000Z", source: "BANK_CONFIRMED", evidenceReference: "bank-proof-00000001" } : null; },
    async appendRevision(value) { snap.revisions.push(value); },
    async transitionRevision(accountId, revision, userId, expected: RevisionLifecycle, next: RevisionLifecycle) {
      const index = snap.revisions.findIndex((x) => x.accountId === accountId && x.revisionId === revision && x.actorUserId === userId);
      if (index < 0) throw new Error("REVISION_NOT_FOUND");
      const current = snap.revisions[index]; assertRevisionTransition(expected, next);
      if (current.lifecycle.status !== expected) throw new Error("INVALID_REVISION_TRANSITION");
      const occurredAt = new Date().toISOString();
      const updated = { ...current, lifecycle: { status: next, changedAt: occurredAt, changedBy: userId } };
      const transition = { accountId, revisionId: revision, actorUserId: userId, from: expected, to: next, occurredAt };
      snap.revisions[index] = updated; snap.transitions.push(transition); return { revision: updated, transition };
    },
    async updatePortfolio(version, expectedRevisionId, value) {
      if (failUpdate) { failUpdate = false; return false; }
      const index = snap.portfolios.findIndex((x) => x.portfolioId === value.portfolioId && x.version === version && x.currentRevisionId === expectedRevisionId);
      if (index < 0) return false; snap.portfolios[index] = value; return true;
    },
  });
  const result = { seedStructural(accountId = A, portfolioId = P, ownerUserId = actor.userId) { state.portfolios.push({ portfolioId, accountId, ownerUserId, name: "R2-C2 portfolio", currentRevisionId: null, revisionIds: [], version: 0 }); }, failNextUpdate() { failUpdate = true; }, enableOverlap() { overlapEnabled = true; gate = new Promise<void>((resolve) => { release = resolve; }); }, async transaction<T>(work: (tx: Transaction) => Promise<T>) {
    const baseEpoch = epoch; const snapshot = structuredClone(state); const value = await work(base(snapshot));
    if (overlapEnabled && gate) { arrivals += 1; if (arrivals === 2) release(); await gate; }
    if (baseEpoch !== epoch) throw new Error("SERIALIZATION_CONFLICT");
    state.revisions = snapshot.revisions; state.portfolios = snapshot.portfolios; state.transitions = snapshot.transitions; epoch += 1; return value;
  } } as TestRepo;
  Object.defineProperties(result, { revisions: { enumerable: true, get: () => state.revisions }, portfolios: { enumerable: true, get: () => state.portfolios }, transitions: { enumerable: true, get: () => state.transitions } });
  return result;
}

async function draft(service: ReturnType<typeof createOnboardingService>, n: string) {
  return service.upsertRevision(A, input, request(n));
}
async function seeded(service: ReturnType<typeof createOnboardingService>, r: TestRepo) {
  const first = await draft(service, "1");
  r.seedStructural(); await service.createOrRecoverPortfolio(A, first.revisionId);
  assert.equal(r.revisions[0].lifecycle.status, "APPLIED");
  return first;
}

test("F41-09: onboarding creates a recoverable PENDING draft without active financial state", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  const revision = await draft(service, "2");
  assert.equal(revision.lifecycle.status, "PENDING"); assert.equal(r.portfolios.length, 0);
  assert.equal(revision.capital.verification, "UNVERIFIED"); assert.equal(revision.capital.verifiedCapital, null);
});

test("F41-09: interrupted draft recovers and promotes atomically", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const revision = await draft(service, "3");
  r.seedStructural(); const portfolio = await service.createOrRecoverPortfolio(A, revision.revisionId);
  assert.equal(portfolio.currentRevisionId, revision.revisionId); assert.equal(r.revisions[0].lifecycle.status, "APPLIED");
  assert.deepEqual(portfolio.revisionIds, [revision.revisionId]);
});

test("F41-09: existing R2-C2 portfolio recovers and promotes atomically", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const revision = await draft(service, "4");
  r.seedStructural(); r.failNextUpdate();
  await assert.rejects(service.createOrRecoverPortfolio(A, revision.revisionId), /STALE_REVISION/);
  assert.equal(r.portfolios[0].currentRevisionId, null); assert.equal(r.revisions[0].lifecycle.status, "PENDING");
  const recovered = await service.createOrRecoverPortfolio(A, revision.revisionId);
  assert.equal(recovered.currentRevisionId, revision.revisionId); assert.equal(r.revisions[0].lifecycle.status, "APPLIED");
});

test("F41-09: two drafts require explicit selection and never imply a portfolio", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const left = await draft(service, "5"); const right = await draft(service, "6");
  assert.equal(r.portfolios.length, 0);
  r.seedStructural(); await service.createOrRecoverPortfolio(A, left.revisionId);
  await assert.rejects(service.createOrRecoverPortfolio(A, right.revisionId), /PORTFOLIO_ALREADY_EXISTS/);
  assert.equal(r.portfolios[0].currentRevisionId, left.revisionId); assert.equal(r.revisions.find((x) => x.revisionId === right.revisionId)?.lifecycle.status, "PENDING");
});

test("F41-10: transitions are account-scoped even when revision IDs collide", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  const sharedA = await service.upsertRevision(A, input, { revisionId: "revision-shared-0001", idempotencyKey: "onboarding-shared-a1" });
  const sharedC = await service.upsertRevision(C, input, { revisionId: "revision-shared-0001", idempotencyKey: "onboarding-shared-c1" });
  const onlyC = await service.upsertRevision(C, input, { revisionId: "revision-only-c0001", idempotencyKey: "onboarding-only-c1" });
  await assert.rejects(service.abandonRevision(A, onlyC.revisionId), /REVISION_NOT_FOUND/);
  r.seedStructural(C, P, actor.userId); await service.createOrRecoverPortfolio(C, sharedC.revisionId);
  await service.abandonRevision(A, sharedA.revisionId);
  assert.equal(r.revisions.find((x) => x.accountId === A && x.revisionId === sharedA.revisionId)?.lifecycle.status, "ABANDONED");
  assert.equal(r.revisions.find((x) => x.accountId === C && x.revisionId === sharedC.revisionId)?.lifecycle.status, "APPLIED");
  assert.equal(r.portfolios.find((x) => x.accountId === C)?.currentRevisionId, sharedC.revisionId);
});

test("F41-03/F41-09: correction promotion is atomic and preserves lifecycle history", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const first = await seeded(service, r);
  r.failNextUpdate();
  await assert.rejects(service.applyCorrection(A, { ...input, restrictions: ["No crypto"] }, request("7")), /STALE_REVISION/);
  assert.equal(r.revisions.length, 1); assert.equal(r.transitions.length, 1); assert.equal(r.revisions[0].lifecycle.status, "APPLIED"); assert.equal(r.portfolios[0].currentRevisionId, first.revisionId);
  const corrected = await service.applyCorrection(A, { ...input, restrictions: ["No crypto"] }, request("7"));
  assert.equal(r.revisions.length, 2); assert.equal(r.revisions[0].lifecycle.status, "SUPERSEDED"); assert.equal(r.revisions[1].lifecycle.status, "APPLIED");
  assert.deepEqual(r.transitions.map((x) => [x.accountId, x.from, x.to]), [[A, "PENDING", "APPLIED"], [A, "PENDING", "APPLIED"], [A, "APPLIED", "SUPERSEDED"]]);
  const replay = await service.applyCorrection(A, { ...input, restrictions: ["No crypto"] }, request("7"));
  assert.deepEqual(replay, corrected);
  await assert.rejects(service.applyCorrection(A, { ...input, restrictions: ["Different"] }, request("7")), /IDEMPOTENCY_CONFLICT/);
});

test("F41-11: lifecycle history is append-only and reconstructs each state change", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const first = await seeded(service, r);
  const corrected = await service.applyCorrection(A, { ...input, restrictions: ["History"] }, request("20"));
  assert.equal(corrected.currentRevisionId, r.revisions[1].revisionId);
  assert.equal(r.transitions.length, 3);
  assert.deepEqual(r.transitions.map((x) => ({ accountId: x.accountId, revisionId: x.revisionId, actor: x.actorUserId, from: x.from, to: x.to })), [
    { accountId: A, revisionId: first.revisionId, actor: actor.userId, from: "PENDING", to: "APPLIED" },
    { accountId: A, revisionId: r.revisions[1].revisionId, actor: actor.userId, from: "PENDING", to: "APPLIED" },
    { accountId: A, revisionId: first.revisionId, actor: actor.userId, from: "APPLIED", to: "SUPERSEDED" },
  ]);
});

test("F41-09: stale draft cannot replace a later applied revision", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const first = await seeded(service, r);
  const stale = await draft(service, "8"); const newer = await service.applyCorrection(A, { ...input, restrictions: ["Newer"] }, request("9"));
  assert.equal(r.portfolios[0].currentRevisionId, newer.currentRevisionId);
  await assert.rejects(service.applyCorrection(A, input, request("8")), /STALE_REVISION/);
  assert.equal(r.portfolios[0].currentRevisionId, newer.currentRevisionId); assert.equal(r.revisions.find((x) => x.revisionId === stale.revisionId)?.lifecycle.status, "PENDING");
  assert.equal(first.lifecycle.status, "PENDING");
});

test("F41-08/F41-09: overlapping corrections have one winner and one rollback", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); await seeded(service, r); r.enableOverlap();
  const results = await Promise.allSettled([
    service.applyCorrection(A, { ...input, restrictions: ["Left"] }, request("10")),
    service.applyCorrection(A, { ...input, restrictions: ["Right"] }, request("11")),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1); assert.equal(results.filter((x) => x.status === "rejected").length, 1);
  assert.equal(r.revisions.length, 2); assert.equal(r.revisions.filter((x) => x.lifecycle.status === "APPLIED").length, 1); assert.equal(r.portfolios[0].revisionIds.length, 2);
});

test("F41-09: only explicit authorized PENDING abandonment is allowed", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const pending = await draft(service, "12");
  const abandoned = await service.abandonRevision(A, pending.revisionId);
  assert.equal(abandoned.lifecycle.status, "ABANDONED");
  r.seedStructural(); await assert.rejects(service.createOrRecoverPortfolio(A, pending.revisionId), /INVALID_REVISION_STATE/);
  await assert.rejects(service.abandonRevision(A, pending.revisionId), /INVALID_REVISION_TRANSITION/);
  const revisionCount = r.revisions.length;
  await assert.rejects(service.applyCorrection(A, input, request("12")), /NO_APPLIED_REVISION/);
  assert.equal(r.revisions.length, revisionCount);
  assertRevisionTransition("PENDING", "APPLIED");
  assertRevisionTransition("APPLIED", "SUPERSEDED");
  assertRevisionTransition("PENDING", "ABANDONED");
  for (const [from, to] of [["ABANDONED", "APPLIED"], ["SUPERSEDED", "APPLIED"], ["APPLIED", "ABANDONED"]] as const) assert.throws(() => assertRevisionTransition(from, to), /INVALID_REVISION_TRANSITION/);
});

test("F41-09: correction requires the structural R2-C2 portfolio", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await draft(service, "12-no-portfolio");
  await assert.rejects(service.applyCorrection(A, input, request("13-no-portfolio")), /PORTFOLIO_NOT_FOUND/);
  assert.equal(r.revisions.length, 1);
});

test("F41-01/F41-02/F41-04/F41-05: source, authorization and strict input remain fail-closed", async () => {
  const r = repo({ malformed: true }); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.upsertRevision(B, input, request("13")), /ACCOUNT_NOT_OWNED/);
  await assert.rejects(service.upsertRevision(A, { ...input, verifiedCapital: { currency: "EUR", amountMinor: "1" } }, request("14")));
  await assert.rejects(service.upsertRevision(A, { ...input, objectives: [{ ...input.objectives[0], unknown: true }] }, request("15")));
  await assert.rejects(service.upsertRevision(A, { ...input, declaredCapital: { currency: "EUR", amountMinor: "1.2" } }, request("16")));
  await assert.rejects(service.upsertRevision(A, { ...input, objectives: [{ ...input.objectives[0], targetDate: "2026-02-31" }] }, request("17")));
  await assert.rejects(service.upsertRevision("not-a-uuid", input, request("18")));
});

