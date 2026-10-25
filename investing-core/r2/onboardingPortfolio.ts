import { z } from "zod";
import { currencyCode } from "../domain/money";

const currency = currencyCode;
const id = z.string().uuid();
const revisionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,37}$/);

export const onboardingInputSchema = z.object({
  declaredCapital: z.object({ currency, amountMinor: positiveMinor }).nullable(),
  objectives: z.array(z.object({ id: revisionId, name: z.string().trim().min(1).max(120), targetMinor: positiveMinor.nullable(), currency, targetDate: z.string().date().nullable() })).min(1).max(20),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG", "OPEN"]),
  riskTolerance: z.enum(["LOW", "MEDIUM", "HIGH", "UNSPECIFIED"]),
  riskCapacity: z.enum(["LOW", "MEDIUM", "HIGH", "UNSPECIFIED"]),
  liquidity: z.object({ currency, minimumMinor: positiveMinor.nullable(), needsWithinDays: z.number().int().nonnegative().max(36500).nullable() }),
  restrictions: z.array(z.string().trim().min(1).max(160)).max(100),
  plannedContributions: z.array(z.object({ id: revisionId, currency, amountMinor: positiveMinor, dueDate: z.string().date() })).max(500),
}).strict();

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export type AuthenticatedActor = Readonly<{ userId: string; sessionId: string }>;
export type AccountCandidate = Readonly<{ id: string; ownerUserId: string; name: string }>;
export type OwnedAccount = Readonly<{ id: string; ownerUserId: string }>;
/** Produced by an authorized server-side source; never parsed from API input. */
export type VerifiedCapital = Readonly<{
  currency: z.infer<typeof currencyCode>; amountMinor: string; asOf: string;
  source: "BROKER_CONFIRMED" | "BANK_CONFIRMED"; evidenceReference: string;
}>;
export type CapitalState = Readonly<{
  declaredCapital: OnboardingInput["declaredCapital"];
  verifiedCapital: VerifiedCapital | null;
  verification: "UNVERIFIED" | "VERIFIED_AUTHORIZED_SOURCE";
}>;
export type OnboardingRevision = Readonly<{
  revisionId: string;
  idempotencyKey: string;
  actorUserId: string;
  accountId: string;
  input: OnboardingInput;
  capital: CapitalState;
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
  version: number;
}>;

export type Transaction = Readonly<{
  resolveOwnedAccount(accountId: string): Promise<OwnedAccount | null>;
  getRevisionByIdempotency(accountId: string, actorUserId: string, key: string): Promise<OnboardingRevision | null>;
  getPortfolio(accountId: string, actorUserId: string): Promise<PortfolioRecord | null>;
  getVerifiedCapital(accountId: string, actorUserId: string): Promise<VerifiedCapital | null>;
  appendRevision(revision: OnboardingRevision): Promise<void>;
  insertPortfolio(portfolio: PortfolioRecord): Promise<void>;
  updatePortfolio(expectedVersion: number, portfolio: PortfolioRecord): Promise<boolean>;
}>;
/** Implementations must map this to BEGIN/COMMIT/ROLLBACK and row locks in PostgreSQL. */
export type PortfolioRepository = Readonly<{ transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> }>;
export type ActorResolver = () => Promise<AuthenticatedActor>;

function validActor(actor: AuthenticatedActor): AuthenticatedActor {
  if (!actor.userId.trim() || !actor.sessionId.trim()) throw new Error("UNAUTHENTICATED");
  return actor;
}

/** Browser supplies only accountId; Clerk actor and ownership are server-resolved inside the transaction. */
export function createOnboardingService(repo: PortfolioRepository, resolveActor: ActorResolver) {
  async function owned(tx: Transaction, accountId: string, actor: AuthenticatedActor): Promise<OwnedAccount> {
    const account = await tx.resolveOwnedAccount(id.parse(accountId));
    if (!account || account.ownerUserId !== actor.userId) throw new Error("ACCOUNT_NOT_OWNED");
    return account;
  }
  async function upsertRevision(accountId: string, input: unknown, request: Readonly<{ revisionId: string; idempotencyKey: string; createdAt: string }>): Promise<OnboardingRevision> {
    const actor = validActor(await resolveActor()); const parsed = onboardingInputSchema.parse(input); const key = idempotencyKey.parse(request.idempotencyKey);
    return repo.transaction(async (tx) => {
      await owned(tx, accountId, actor);
      const existing = await tx.getRevisionByIdempotency(accountId, actor.userId, key);
      if (existing) { if (JSON.stringify(existing.input) !== JSON.stringify(parsed)) throw new Error("IDEMPOTENCY_CONFLICT"); return existing; }
      const verified = await tx.getVerifiedCapital(accountId, actor.userId);
      const capital: CapitalState = verified ? { declaredCapital: parsed.declaredCapital, verifiedCapital: verified, verification: "VERIFIED_AUTHORIZED_SOURCE" } : { declaredCapital: parsed.declaredCapital, verifiedCapital: null, verification: "UNVERIFIED" };
      const current = await tx.getPortfolio(accountId, actor.userId);
      const revision: OnboardingRevision = { revisionId: revisionId.parse(request.revisionId), idempotencyKey: key, actorUserId: actor.userId, accountId, input: parsed, capital, provenance: "USER_DECLARED", createdAt: new Date(request.createdAt).toISOString(), supersedes: current?.currentRevisionId ?? null };
      await tx.appendRevision(revision); return revision;
    });
  }
  return {
    upsertRevision,
    async createOrRecoverPortfolio(accountId: string, revision: OnboardingRevision, portfolio: Readonly<{ portfolioId: string; name: string }>) {
      const actor = validActor(await resolveActor());
      return repo.transaction(async (tx) => {
        await owned(tx, accountId, actor); if (revision.actorUserId !== actor.userId || revision.accountId !== accountId) throw new Error("REVISION_OWNERSHIP_MISMATCH");
        const existing = await tx.getPortfolio(accountId, actor.userId); if (existing) return existing;
        const result: PortfolioRecord = { portfolioId: id.parse(portfolio.portfolioId), accountId, ownerUserId: actor.userId, name: portfolio.name.trim() || "Investing portfolio", currentRevisionId: revision.revisionId, revisionIds: [revision.revisionId], version: 1 };
        await tx.insertPortfolio(result); return result;
      });
    },
    async applyCorrection(accountId: string, input: unknown, request: Readonly<{ revisionId: string; idempotencyKey: string; createdAt: string }>) {
      const revision = await upsertRevision(accountId, input, request); const actor = validActor(await resolveActor());
      return repo.transaction(async (tx) => {
        await owned(tx, accountId, actor); const current = await tx.getPortfolio(accountId, actor.userId); if (!current) throw new Error("PORTFOLIO_NOT_FOUND");
        if (current.revisionIds.includes(revision.revisionId)) return current;
        const next = { ...current, currentRevisionId: revision.revisionId, revisionIds: [...current.revisionIds, revision.revisionId], version: current.version + 1 };
        if (!await tx.updatePortfolio(current.version, next)) throw new Error("STALE_REVISION"); return next;
      });
    },
  };
}

