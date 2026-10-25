import assert from "node:assert/strict";
import test from "node:test";
import { createOnboardingService, type OnboardingRevision, type PortfolioRecord, type PortfolioRepository, type Transaction } from "../r2/onboardingPortfolio";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const actor = { userId: "user-a", sessionId: "session-a" };
const request = (n: string) => ({ revisionId: "revision-" + n.padStart(8, "0"), idempotencyKey: "onboarding-" + n.padStart(8, "0") });
const input = { declaredCapital: { currency: "EUR", amountMinor: "100000" }, objectives: [{ id: "objective-00000001", name: "Retirement", targetMinor: null, currency: "EUR", targetDate: null }], horizon: "LONG", riskTolerance: "MEDIUM", riskCapacity: "LOW", liquidity: { currency: "EUR", minimumMinor: null, needsWithinDays: null }, restrictions: ["No leveraged products"], plannedContributions: [{ id: "contribution-000001", currency: "EUR", amountMinor: "50000", dueDate: "2027-01-01" }] };

type TestRepo = PortfolioRepository & { readonly revisions: readonly OnboardingRevision[]; readonly portfolios: readonly PortfolioRecord[]; setFailNextUpdate(): void; enableOverlap(): void; };
function repo(options: { verified?: boolean; malformed?: boolean; overlap?: boolean } = {}): TestRepo {
  const state = { revisions: [] as OnboardingRevision[], portfolios: [] as PortfolioRecord[] };
  let epoch = 0; let failNext = false; let arrivals = 0; let release!: () => void; let overlapEnabled = false; let gate: Promise<void> | null = null;
  const accounts = [{ id: A, ownerUserId: actor.userId }, { id: B, ownerUserId: "user-b" }];
  const base = (snap: { revisions: OnboardingRevision[]; portfolios: PortfolioRecord[] }): Transaction => ({
    async resolveOwnedAccount(id) { return accounts.find((x) => x.id === id) ?? null; },
    async getRevision(accountId, userId, revision) { return snap.revisions.find((x) => x.accountId === accountId && x.actorUserId === userId && x.revisionId === revision) ?? null; },
    async getRevisionByIdempotency(accountId, userId, key) { return snap.revisions.find((x) => x.accountId === accountId && x.actorUserId === userId && x.idempotencyKey === key) ?? null; },
    async getPortfolio(accountId, userId) { return snap.portfolios.find((x) => x.accountId === accountId && x.ownerUserId === userId) ?? null; },
    async getVerifiedCapital() { return options.malformed ? { currency: "EUR", amountMinor: "90000", asOf: "not-a-timestamp", source: "BANK_CONFIRMED", evidenceReference: "short" } : options.verified ? { currency: "EUR", amountMinor: "90000", asOf: "2026-10-25T10:00:00.000Z", source: "BANK_CONFIRMED", evidenceReference: "bank-proof-00000001" } : null; },
    async appendRevision(value) { snap.revisions.push(value); },
    async insertPortfolio(value) { snap.portfolios.push(value); },
    async updatePortfolio(version, expectedRevisionId, value) {
      if (failNext) { failNext = false; return false; }
      const index = snap.portfolios.findIndex((x) => x.portfolioId === value.portfolioId && x.version === version && x.currentRevisionId === expectedRevisionId);
      if (index < 0) return false; snap.portfolios[index] = value; return true;
    },
  });
  const result = { setFailNextUpdate() { failNext = true; }, enableOverlap() { overlapEnabled = true; gate = new Promise<void>((resolve) => { release = resolve; }); }, async transaction<T>(work: (tx: Transaction) => Promise<T>) {
    const baseEpoch = epoch; const snapshot = structuredClone(state);
    const value = await work(base(snapshot));
    if (overlapEnabled && gate) { arrivals += 1; if (arrivals === 2) release(); await gate; }
    if (baseEpoch !== epoch) throw new Error("SERIALIZATION_CONFLICT");
    state.revisions = snapshot.revisions; state.portfolios = snapshot.portfolios; epoch += 1; return value;
  } } as TestRepo;
  Object.defineProperties(result, { revisions: { enumerable: true, get: () => state.revisions }, portfolios: { enumerable: true, get: () => state.portfolios } });
  return result;
}

async function seeded(service: ReturnType<typeof createOnboardingService>, r: TestRepo) {
  const first = await service.upsertRevision(A, input, request("1"));
  await service.createOrRecoverPortfolio(A, first.revisionId, { portfolioId: P, name: "Long-term" });
  return first;
}

test("F41-01: client cannot submit verified capital; authorized source is runtime-validated", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.upsertRevision(A, { ...input, verifiedCapital: { currency: "EUR", amountMinor: "1" } }, request("2")));
  const unverified = await service.upsertRevision(A, input, request("3"));
  assert.equal(unverified.capital.verification, "UNVERIFIED"); assert.equal(unverified.capital.verifiedCapital, null);
  const verified = await createOnboardingService(repo({ verified: true }), async () => actor).upsertRevision(A, input, request("4"));
  assert.equal(verified.capital.verification, "VERIFIED_AUTHORIZED_SOURCE");
  const malformed = repo({ malformed: true }); const malformedService = createOnboardingService(malformed, async () => actor);
  await assert.rejects(malformedService.upsertRevision(A, input, request("5")));
});

test("F41-02/F41-04: actor is server-resolved and cross-tenant ownership fails closed", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.upsertRevision(B, input, request("6")), /ACCOUNT_NOT_OWNED/);
  await assert.rejects(service.upsertRevision("not-a-uuid", input, request("7")));
  await assert.rejects(createOnboardingService(r, async () => ({ userId: "user-b", sessionId: "session-b" })).upsertRevision(A, input, request("8")), /ACCOUNT_NOT_OWNED/);
});

test("F41-03: applyCorrection rolls back revision and portfolio together on update failure", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); const first = await seeded(service, r);
  r.setFailNextUpdate();
  await assert.rejects(service.applyCorrection(A, { ...input, restrictions: ["No crypto"] }, request("9")), /STALE_REVISION/);
  assert.equal(r.revisions.length, 1); assert.equal(r.portfolios[0].currentRevisionId, first.revisionId);
  const corrected = await service.applyCorrection(A, { ...input, restrictions: ["No crypto"] }, request("9"));
  assert.equal(r.revisions.length, 2); assert.equal(r.portfolios[0].currentRevisionId, corrected.currentRevisionId);
  const replay = await service.applyCorrection(A, { ...input, restrictions: ["No crypto"] }, request("9"));
  assert.deepEqual(replay, corrected);
  await assert.rejects(service.applyCorrection(A, { ...input, restrictions: ["Different"] }, request("9")), /IDEMPOTENCY_CONFLICT/);
});

test("F41-07: portfolio creation resolves canonical persisted revision and rejects fabricated/cross-account revisions", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.createOrRecoverPortfolio(A, "revision-99999999", { portfolioId: P, name: "Invalid" }), /REVISION_NOT_FOUND/);
  const first = await service.upsertRevision(A, input, request("10"));
  await assert.rejects(service.createOrRecoverPortfolio(B, first.revisionId, { portfolioId: P, name: "Cross" }), /ACCOUNT_NOT_OWNED/);
  const created = await service.createOrRecoverPortfolio(A, first.revisionId, { portfolioId: P, name: "Valid" });
  assert.equal(created.currentRevisionId, first.revisionId);
});

test("F41-08: overlapping corrections serialize with one winner and one rollback", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor); await seeded(service, r); r.enableOverlap();
  const left = service.applyCorrection(A, { ...input, restrictions: ["Left"] }, request("11"));
  const right = service.applyCorrection(A, { ...input, restrictions: ["Right"] }, request("12"));
  const results = await Promise.allSettled([left, right]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
  assert.equal(r.revisions.length, 2); assert.equal(r.portfolios[0].revisionIds.length, 2);
});

test("F41-05: nested unknown fields, unsupported currencies, invalid dates and non-integer money fail closed; zero is distinct from absent", async () => {
  const r = repo(); const service = createOnboardingService(r, async () => actor);
  await assert.rejects(service.upsertRevision(A, { ...input, declaredCapital: { currency: "ZZZ", amountMinor: "100" } }, request("13")));
  await assert.rejects(service.upsertRevision(A, { ...input, declaredCapital: { currency: "EUR", amountMinor: "1.2" } }, request("14")));
  await assert.rejects(service.upsertRevision(A, { ...input, objectives: [{ ...input.objectives[0], unknown: true }] }, request("15")));
  await assert.rejects(service.upsertRevision(A, { ...input, liquidity: { ...input.liquidity, unknown: true } }, request("16")));
  await assert.rejects(service.upsertRevision(A, { ...input, plannedContributions: [{ ...input.plannedContributions[0], unknown: true }] }, request("17")));
  await assert.rejects(service.upsertRevision(A, { ...input, objectives: [{ ...input.objectives[0], targetDate: "2026-02-31" }] }, request("18")));
  const zero = await service.upsertRevision(A, { ...input, declaredCapital: { currency: "EUR", amountMinor: "0" }, liquidity: { ...input.liquidity, minimumMinor: "0" } }, request("19"));
  assert.equal(zero.capital.declaredCapital?.amountMinor, "0"); assert.equal(zero.capital.verifiedCapital, null);
});

