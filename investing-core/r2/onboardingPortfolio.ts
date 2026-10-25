import { z } from "zod";

const currency = z.string().regex(/^[A-Z]{3}$/);
const id = z.string().uuid();
const revisionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,37}$/);

export const onboardingInputSchema = z.object({
  declaredCapital: z.object({ currency, amountMinor: positiveMinor }).nullable(),
  verifiedCapital: z.object({ currency, amountMinor: positiveMinor, asOf: z.string().datetime({ offset: true }) }).nullable(),
  objectives: z.array(z.object({ id: revisionId, name: z.string().trim().min(1).max(120), targetMinor: positiveMinor.nullable(), currency, targetDate: z.string().date().nullable() })).min(1).max(20),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG", "OPEN"]),
  riskTolerance: z.enum(["LOW", "MEDIUM", "HIGH", "UNSPECIFIED"]),
  riskCapacity: z.enum(["LOW", "MEDIUM", "HIGH", "UNSPECIFIED"]),
  liquidity: z.object({ currency, minimumMinor: positiveMinor.nullable(), needsWithinDays: z.number().int().nonnegative().max(36500).nullable() }),
  restrictions: z.array(z.string().trim().min(1).max(160)).max(100),
  plannedContributions: z.array(z.object({ id: revisionId, currency, amountMinor: positiveMinor, dueDate: z.string().date() })).max(500),
}).strict();

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export type Ownership = Readonly<{ actorUserId: string; accountId: string }>;
export type AccountCandidate = Readonly<{ id: string; ownerUserId: string; name: string }>;
export type OnboardingRevision = Readonly<{
  revisionId: string;
  idempotencyKey: string;
  actorUserId: string;
  accountId: string;
  input: OnboardingInput;
  provenance: "USER_DECLARED";
  createdAt: string;
  supersedes: string | null;
}>;
export type PortfolioRecord = Readonly<{
  portfolioId: string;
  accountId: string;
  ownerUserId: string;
  name: string;
  currentRevisionId: string;
  revisionIds: readonly string[];
}>;

export type PortfolioRepository = Readonly<{
  findAccountsForActor(actorUserId: string): Promise<readonly AccountCandidate[]>;
  getRevisionByIdempotency(accountId: string, actorUserId: string, key: string): Promise<OnboardingRevision | null>;
  getPortfolio(accountId: string, actorUserId: string): Promise<PortfolioRecord | null>;
  appendRevision(revision: OnboardingRevision): Promise<void>;
  savePortfolio(portfolio: PortfolioRecord): Promise<void>;
}>;

export function selectOwnedAccount(accounts: readonly AccountCandidate[], actorUserId: string, requestedAccountId?: string): Ownership {
  if (!actorUserId) throw new Error("UNAUTHENTICATED");
  const owned = accounts.filter((account) => account.ownerUserId === actorUserId);
  if (requestedAccountId) {
    if (!id.safeParse(requestedAccountId).success) throw new Error("INVALID_ACCOUNT_ID");
    const match = owned.find((account) => account.id === requestedAccountId);
    if (!match) throw new Error("ACCOUNT_NOT_OWNED");
    return { actorUserId, accountId: match.id };
  }
  if (owned.length !== 1) throw new Error(owned.length === 0 ? "NO_OWNED_ACCOUNT" : "ACCOUNT_SELECTION_REQUIRED");
  return { actorUserId, accountId: owned[0].id };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function upsertOnboardingRevision(
  repo: PortfolioRepository,
  ownership: Ownership,
  input: unknown,
  request: Readonly<{ revisionId: string; idempotencyKey: string; createdAt: string }>,
): Promise<OnboardingRevision> {
  if (!ownership.actorUserId || !id.safeParse(ownership.accountId).success) throw new Error("INVALID_OWNERSHIP");
  const parsed = onboardingInputSchema.parse(input);
  const key = idempotencyKey.parse(request.idempotencyKey);
  const existing = await repo.getRevisionByIdempotency(ownership.accountId, ownership.actorUserId, key);
  if (existing) {
    if (!sameJson(existing.input, parsed)) throw new Error("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  const current = await repo.getPortfolio(ownership.accountId, ownership.actorUserId);
  const revision: OnboardingRevision = {
    revisionId: revisionId.parse(request.revisionId),
    idempotencyKey: key,
    actorUserId: ownership.actorUserId,
    accountId: ownership.accountId,
    input: parsed,
    provenance: "USER_DECLARED",
    createdAt: new Date(request.createdAt).toISOString(),
    supersedes: current?.currentRevisionId ?? null,
  };
  await repo.appendRevision(revision);
  return revision;
}

export async function createOrRecoverPortfolio(
  repo: PortfolioRepository,
  ownership: Ownership,
  revision: OnboardingRevision,
  portfolio: Readonly<{ portfolioId: string; name: string }>,
): Promise<PortfolioRecord> {
  if (revision.actorUserId !== ownership.actorUserId || revision.accountId !== ownership.accountId) throw new Error("REVISION_OWNERSHIP_MISMATCH");
  const existing = await repo.getPortfolio(ownership.accountId, ownership.actorUserId);
  if (existing) return existing;
  const result: PortfolioRecord = {
    portfolioId: id.parse(portfolio.portfolioId),
    accountId: ownership.accountId,
    ownerUserId: ownership.actorUserId,
    name: portfolio.name.trim() || "Investing portfolio",
    currentRevisionId: revision.revisionId,
    revisionIds: [revision.revisionId],
  };
  await repo.savePortfolio(result);
  return result;
}

export async function applyCorrection(
  repo: PortfolioRepository,
  ownership: Ownership,
  input: unknown,
  request: Readonly<{ revisionId: string; idempotencyKey: string; createdAt: string }>,
): Promise<PortfolioRecord> {
  const revision = await upsertOnboardingRevision(repo, ownership, input, request);
  const current = await repo.getPortfolio(ownership.accountId, ownership.actorUserId);
  if (!current) throw new Error("PORTFOLIO_NOT_FOUND");
  if (current.revisionIds.includes(revision.revisionId)) return current;
  const next = { ...current, currentRevisionId: revision.revisionId, revisionIds: [...current.revisionIds, revision.revisionId] };
  await repo.savePortfolio(next);
  return next;
}

