import assert from "node:assert/strict";
import test from "node:test";
import { createOnboardingService, type OnboardingRevision, type PortfolioRecord, type PortfolioRepository, type Transaction } from "../r2/onboardingPortfolio";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const actor = { userId: "user-a", sessionId: "session-a" };
const input = { declaredCapital: { currency: "EUR", amountMinor: "100000" }, objectives: [{ id: "objective-00000001", name: "Retirement", targetMinor: null, currency: "EUR", targetDate: null }], horizon: "LONG", riskTolerance: "MEDIUM", riskCapacity: "LOW", liquidity: { currency: "EUR", minimumMinor: null, needsWithinDays: null }, restrictions: ["No leveraged products"], plannedContributions: [{ id: "contribution-000001", currency: "EUR", amountMinor: "50000", dueDate: "2027-01-01" }] };

function repo(options: { verified?: boolean; failAfterRevision?: boolean } = {}): PortfolioRepository & { revisions: OnboardingRevision[]; portfolios: PortfolioRecord[] } {
  const state = { revisions: [] as OnboardingRevision[], portfolios: [] as PortfolioRecord[] };
  const accounts = [{ id: A, ownerUserId: actor.userId }, { id: B, ownerUserId: "user-b" }];
  const base = (snap: any): Transaction => ({
    async resolveOwnedAccount(id) { return accounts.find((x) => x.id === id) ?? null; },
    async getRevisionByIdempotency(accountId, userId, key) { return snap.revisions.find((x: OnboardingRevision) => x.accountId === accountId && x.actorUserId === userId && x.idempotencyKey === key) ?? null; },
    async getPortfolio(accountId, userId) { return snap.portfolios.find((x: PortfolioRecord) => x.accountId === accountId && x.ownerUserId === userId) ?? null; },
    async getVerifiedCapital() { return options.verified ? { currency: "EUR", amountMinor: "90000", asOf: "2026-10-25T10:00:00.000Z", source: "BANK_CONFIRMED", evidenceReference: "bank-proof-00000001" } : null; },
    async appendRevision(value) { snap.revisions.push(value); if (options.failAfterRevision) throw new Error("simulated failure"); },
    async insertPortfolio(value) { snap.portfolios.push(value); },
    async updatePortfolio(version, value) { const index = snap.portfolios.findIndex((x: PortfolioRecord) => x.portfolioId === value.portfolioId && x.version === version); if (index < 0) return false; snap.portfolios[index] = value; return true; },
  });
  return {
    ...state,
    async transaction(work) {
      const snapshot = structuredClone(state);
      try { const result = await work(base(snapshot)); state.revisions = snapshot.revisions; state.portfolios = snapshot.portfolios; return result; } catch (error) { throw error; }
    },
  };
}

test("F41-01: client cannot submit verified capital; authorized source is the only verifier", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.upsertRevision(A, { ...input, verifiedCapital: { currency: "EUR", amountMinor: "1" } }, { revisionId: "revision-00000001", idempotencyKey: "onboarding-000001", createdAt: "2026-10-25T10:00:00.000Z" }));
  const unverified = await service.upsertRevision(A, input, { revisionId: "revision-00000002", idempotencyKey: "onboarding-000002", createdAt: "2026-10-25T10:00:00.000Z" });
  assert.equal(unverified.capital.verification, "UNVERIFIED"); assert.equal(unverified.capital.verifiedCapital, null);
  const verified = await createOnboardingService(repo({ verified: true }), async () => actor).upsertRevision(A, input, { revisionId: "revision-00000003", idempotencyKey: "onboarding-000003", createdAt: "2026-10-25T10:00:00.000Z" });
  assert.equal(verified.capital.verification, "VERIFIED_AUTHORIZED_SOURCE"); assert.equal(verified.capital.verifiedCapital?.source, "BANK_CONFIRMED");
});

test("F41-02/F41-04: actor is server-resolved and cross-tenant or ambiguous accounts fail closed", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.upsertRevision(B, input, { revisionId: "revision-00000004", idempotencyKey: "onboarding-000004", createdAt: "2026-10-25T10:00:00.000Z" }), /ACCOUNT_NOT_OWNED/);
  await assert.rejects(service.upsertRevision("not-a-uuid", input, { revisionId: "revision-00000005", idempotencyKey: "onboarding-000005", createdAt: "2026-10-25T10:00:00.000Z" }));
  await assert.rejects(createOnboardingService(r, async () => ({ userId: "user-b", sessionId: "session-b" })).upsertRevision(A, input, { revisionId: "revision-00000006", idempotencyKey: "onboarding-000006", createdAt: "2026-10-25T10:00:00.000Z" }), /ACCOUNT_NOT_OWNED/);
});

test("F41-03: transaction rollback prevents orphan revision and stale concurrent correction", async () => {
  const failed = repo({ failAfterRevision: true }); const service = createOnboardingService(failed, async () => actor);
  await assert.rejects(service.upsertRevision(A, input, { revisionId: "revision-00000007", idempotencyKey: "onboarding-000007", createdAt: "2026-10-25T10:00:00.000Z" }));
  assert.equal(failed.revisions.length, 0);
  const r = repo(); const s = createOnboardingService(r, async () => actor);
  const first = await s.upsertRevision(A, input, { revisionId: "revision-00000008", idempotencyKey: "onboarding-000008", createdAt: "2026-10-25T10:00:00.000Z" });
  await s.createOrRecoverPortfolio(A, first, { portfolioId: P, name: "Long-term" });
  const correction = await s.upsertRevision(A, { ...input, restrictions: ["No crypto"] }, { revisionId: "revision-00000009", idempotencyKey: "onboarding-000009", createdAt: "2026-10-25T12:00:00.000Z" });
  await r.transaction(async (tx) => { const current = await tx.getPortfolio(A, actor.userId); return tx.updatePortfolio(1, { ...current!, currentRevisionId: correction.revisionId, revisionIds: [first.revisionId, correction.revisionId], version: 2 }); });
  const stale = await r.transaction(async (tx) => { const current = await tx.getPortfolio(A, actor.userId); return tx.updatePortfolio(1, { ...current!, currentRevisionId: correction.revisionId, revisionIds: [first.revisionId, correction.revisionId], version: 2 }); });
  assert.equal(stale, false);
});

test("F41-05/F41-06: ISO currency, UUID, dates, exact integer money and deterministic replay are enforced", async () => {
  const r = repo(); const s = createOnboardingService(r, async () => actor);
  await assert.rejects(s.upsertRevision(A, { ...input, declaredCapital: { currency: "ZZZ", amountMinor: "100" } }, { revisionId: "revision-00000011", idempotencyKey: "onboarding-000011", createdAt: "2026-10-25T10:00:00.000Z" }));
  await assert.rejects(s.upsertRevision(A, { ...input, declaredCapital: { currency: "EUR", amountMinor: "1.2" } }, { revisionId: "revision-00000012", idempotencyKey: "onboarding-000012", createdAt: "2026-10-25T10:00:00.000Z" }));
  await assert.rejects(s.upsertRevision(A, { ...input, objectives: [{ ...input.objectives[0], targetDate: "2026-02-31" }] }, { revisionId: "revision-00000013", idempotencyKey: "onboarding-000013", createdAt: "2026-10-25T10:00:00.000Z" }));
  const one = await s.upsertRevision(A, input, { revisionId: "revision-00000014", idempotencyKey: "onboarding-000014", createdAt: "2026-10-25T10:00:00.000Z" });
  const two = await s.upsertRevision(A, input, { revisionId: "different-000000", idempotencyKey: "onboarding-000014", createdAt: "2026-10-25T11:00:00.000Z" });
  assert.deepEqual(two, one);
});

