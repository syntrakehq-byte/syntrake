import assert from "node:assert/strict";
import test from "node:test";
import { applyCorrection, createOrRecoverPortfolio, selectOwnedAccount, upsertOnboardingRevision, type OnboardingRevision, type PortfolioRecord, type PortfolioRepository } from "../r2/onboardingPortfolio";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const input = { declaredCapital: { currency: "EUR", amountMinor: "100000" }, verifiedCapital: null, objectives: [{ id: "objective-00000001", name: "Retirement", targetMinor: null, currency: "EUR", targetDate: null }], horizon: "LONG" as const, riskTolerance: "MEDIUM" as const, riskCapacity: "LOW" as const, liquidity: { currency: "EUR", minimumMinor: null, needsWithinDays: null }, restrictions: ["No leveraged products"], plannedContributions: [{ id: "contribution-000001", currency: "EUR", amountMinor: "50000", dueDate: "2027-01-01" }] };

function repo(): PortfolioRepository & { revisions: OnboardingRevision[]; portfolios: PortfolioRecord[] } {
  const state = { revisions: [] as OnboardingRevision[], portfolios: [] as PortfolioRecord[] };
  return {
    ...state,
    async findAccountsForActor(userId) { return [{ id: A, ownerUserId: userId, name: "Primary" }, { id: B, ownerUserId: "user-b", name: "Other" }]; },
    async getRevisionByIdempotency(accountId, actorUserId, key) { return state.revisions.find((x) => x.accountId === accountId && x.actorUserId === actorUserId && x.idempotencyKey === key) ?? null; },
    async getPortfolio(accountId, actorUserId) { return state.portfolios.find((x) => x.accountId === accountId && x.ownerUserId === actorUserId) ?? null; },
    async appendRevision(value) { state.revisions.push(value); },
    async savePortfolio(value) { const i = state.portfolios.findIndex((x) => x.portfolioId === value.portfolioId); if (i < 0) state.portfolios.push(value); else state.portfolios[i] = value; },
  };
}

test("BL2 preserves declared capital, unavailable verified capital, risk dimensions and planned contributions", async () => {
  const r = repo(); const ownership = selectOwnedAccount(await r.findAccountsForActor("user-a"), "user-a");
  const revision = await upsertOnboardingRevision(r, ownership, input, { revisionId: "revision-00000001", idempotencyKey: "onboarding-000001", createdAt: "2026-10-25T10:00:00.000Z" });
  assert.equal(revision.provenance, "USER_DECLARED"); assert.equal(revision.input.verifiedCapital, null); assert.equal(revision.input.riskTolerance, "MEDIUM"); assert.equal(revision.input.riskCapacity, "LOW"); assert.equal(revision.input.plannedContributions[0].amountMinor, "50000");
});

test("BL3 rejects browser account IDs that are not server-owned and requires explicit selection", async () => {
  const r = repo(); const accounts = await r.findAccountsForActor("user-a");
  assert.throws(() => selectOwnedAccount(accounts, "user-a", B), /ACCOUNT_NOT_OWNED/);
  assert.throws(() => selectOwnedAccount([{ id: A, ownerUserId: "user-a", name: "A" }, { id: P, ownerUserId: "user-a", name: "B" }], "user-a"), /ACCOUNT_SELECTION_REQUIRED/);
});

test("idempotent replay is deterministic and a changed payload conflicts", async () => {
  const r = repo(); const ownership = { actorUserId: "user-a", accountId: A };
  const first = await upsertOnboardingRevision(r, ownership, input, { revisionId: "revision-00000002", idempotencyKey: "onboarding-000002", createdAt: "2026-10-25T10:00:00.000Z" });
  assert.equal(await upsertOnboardingRevision(r, ownership, input, { revisionId: "different-000000", idempotencyKey: "onboarding-000002", createdAt: "2026-10-25T11:00:00.000Z" }), first);
  await assert.rejects(upsertOnboardingRevision(r, ownership, { ...input, horizon: "SHORT" }, { revisionId: "revision-0000003", idempotencyKey: "onboarding-000002", createdAt: "2026-10-25T11:00:00.000Z" }), /IDEMPOTENCY_CONFLICT/);
});

test("portfolio creation/recovery and corrections retain full revision history", async () => {
  const r = repo(); const ownership = { actorUserId: "user-a", accountId: A };
  const first = await upsertOnboardingRevision(r, ownership, input, { revisionId: "revision-00000004", idempotencyKey: "onboarding-000004", createdAt: "2026-10-25T10:00:00.000Z" });
  const created = await createOrRecoverPortfolio(r, ownership, first, { portfolioId: P, name: "Long-term" });
  assert.deepEqual(await createOrRecoverPortfolio(r, ownership, first, { portfolioId: "44444444-4444-4444-8444-444444444444", name: "Wrong retry" }), created);
  const corrected = await applyCorrection(r, ownership, { ...input, restrictions: ["No leveraged products", "No crypto"] }, { revisionId: "revision-00000005", idempotencyKey: "onboarding-000005", createdAt: "2026-10-25T12:00:00.000Z" });
  assert.deepEqual(corrected.revisionIds, ["revision-00000004", "revision-00000005"]); assert.equal(corrected.currentRevisionId, "revision-00000005");
});

