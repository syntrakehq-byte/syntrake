import { z } from "zod";
import { currencyCode } from "../domain/money";

const currency = currencyCode;
const uuid = z.string().uuid();
const revisionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const minor = z.string().regex(/^(?:0|[1-9][0-9]{0,37})$/);
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,37}$/);
const verifiedCapitalSchema = z.object({
  currency, amountMinor: minor, asOf: z.string().datetime({ offset: true }),
  source: z.enum(["BROKER_CONFIRMED", "BANK_CONFIRMED"]),
  evidenceReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
}).strict();

export const onboardingInputSchema = z.object({
  declaredCapital: z.object({ currency, amountMinor: minor }).strict().nullable(),
  objectives: z.array(z.object({
    id: revisionId, name: z.string().trim().min(1).max(120),
    targetMinor: minor.nullable(), currency, targetDate: z.string().date().nullable(),
  }).strict()).min(1).max(20),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG", "OPEN"]),
  riskTolerance: z.enum(["LOW", "MEDIUM", "HIGH", "UNSPECIFIED"]),
  riskCapacity: z.enum(["LOW", "MEDIUM", "HIGH", "UNSPECIFIED"]),
  liquidity: z.object({
    currency, minimumMinor: minor.nullable(),
    needsWithinDays: z.number().int().nonnegative().max(36500).nullable(),
  }).strict(),
  restrictions: z.array(z.string().trim().min(1).max(160)).max(100),
  plannedContributions: z.array(z.object({
    id: revisionId, currency, amountMinor: positiveMinor, dueDate: z.string().date(),
  }).strict()).max(500),
}).strict();

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export type AuthenticatedActor = Readonly<{ userId: string; sessionId: string }>;
export type OwnedAccount = Readonly<{ id: string; ownerUserId: string }>;
export type VerifiedCapital = z.infer<typeof verifiedCapitalSchema>;
export type RevisionLifecycle = "PENDING" | "APPLIED" | "SUPERSEDED" | "ABANDONED";
export type LifecycleTransition = Readonly<{
  accountId: string; revisionId: string; actorUserId: string;
  from: RevisionLifecycle; to: RevisionLifecycle; occurredAt: string;
}>;
export type CapitalState = Readonly<{
  declaredCapital: OnboardingInput["declaredCapital"];
  verifiedCapital: VerifiedCapital | null;
  verification: "UNVERIFIED" | "VERIFIED_AUTHORIZED_SOURCE";
}>;
export type OnboardingRevision = Readonly<{
  revisionId: string; idempotencyKey: string; actorUserId: string; accountId: string;
  input: OnboardingInput; capital: CapitalState; provenance: "USER_DECLARED";
  createdAt: string; supersedes: string | null;
  lifecycle: Readonly<{ status: RevisionLifecycle; changedAt: string; changedBy: string }>;
}>;
export type PortfolioRecord = Readonly<{
  portfolioId: string; accountId: string; ownerUserId: string; name: string;
  currentRevisionId: string | null; revisionIds: readonly string[]; version: number;
}>;

export type Transaction = Readonly<{
  resolveOwnedAccount(accountId: string): Promise<OwnedAccount | null>;
  getRevision(accountId: string, actorUserId: string, revisionId: string): Promise<OnboardingRevision | null>;
  getRevisionByIdempotency(accountId: string, actorUserId: string, key: string): Promise<OnboardingRevision | null>;
  getPortfolio(accountId: string, actorUserId: string): Promise<PortfolioRecord | null>;
  getVerifiedCapital(accountId: string, actorUserId: string): Promise<unknown>;
  appendRevision(revision: OnboardingRevision): Promise<void>;
  /** Atomically updates the current projection and appends one immutable transition event. */
  transitionRevision(accountId: string, revisionId: string, actorUserId: string, expected: RevisionLifecycle, next: RevisionLifecycle): Promise<{ revision: OnboardingRevision; transition: LifecycleTransition }>;
  updatePortfolio(expectedVersion: number, expectedRevisionId: string | null, portfolio: PortfolioRecord): Promise<boolean>;
}>;
/** Must map to PostgreSQL BEGIN/COMMIT/ROLLBACK plus account-row locking. */
export type PortfolioRepository = Readonly<{ transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> }>;
export type ActorResolver = () => Promise<AuthenticatedActor>;
type Request = Readonly<{ revisionId: string; idempotencyKey: string }>;

const allowedTransitions: Readonly<Record<RevisionLifecycle, readonly RevisionLifecycle[]>> = {
  PENDING: ["APPLIED", "ABANDONED"],
  APPLIED: ["SUPERSEDED"],
  SUPERSEDED: [],
  ABANDONED: [],
};

export function assertRevisionTransition(from: RevisionLifecycle, to: RevisionLifecycle): void {
  if (!allowedTransitions[from].includes(to)) throw new Error("INVALID_REVISION_TRANSITION");
}

function validActor(actor: AuthenticatedActor): AuthenticatedActor {
  if (!actor.userId.trim() || !actor.sessionId.trim()) throw new Error("UNAUTHENTICATED");
  return actor;
}
function verifiedCapital(raw: unknown): VerifiedCapital | null {
  if (raw === null) return null;
  return verifiedCapitalSchema.parse(raw);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createOnboardingService(repo: PortfolioRepository, resolveActor: ActorResolver) {
  async function owned(tx: Transaction, accountId: string, actor: AuthenticatedActor): Promise<OwnedAccount> {
    // Keep the validated UUID in its canonical string form for the PostgreSQL
    // adapter; uuid.parse() returns a byte array, which the pg driver binds as
    // text and makes PostgreSQL resolve uuid = text.
    const account = await tx.resolveOwnedAccount(accountId);
    if (!account || account.ownerUserId !== actor.userId) throw new Error("ACCOUNT_NOT_OWNED");
    return account;
  }
  async function createRevision(tx: Transaction, accountId: string, actor: AuthenticatedActor, parsed: OnboardingInput, request: Request, current: PortfolioRecord | null): Promise<OnboardingRevision> {
    const key = idempotencyKey.parse(request.idempotencyKey);
    const existing = await tx.getRevisionByIdempotency(accountId, actor.userId, key);
    if (existing) {
      if (canonicalJson(existing.input) !== canonicalJson(parsed)) throw new Error("IDEMPOTENCY_CONFLICT");
      if (existing.accountId !== accountId || existing.actorUserId !== actor.userId) throw new Error("REVISION_OWNERSHIP_MISMATCH");
      return existing;
    }
    const source = verifiedCapital(await tx.getVerifiedCapital(accountId, actor.userId));
    const now = new Date().toISOString();
    const revision: OnboardingRevision = {
      revisionId: revisionId.parse(request.revisionId), idempotencyKey: key,
      actorUserId: actor.userId, accountId, input: parsed,
      capital: source
        ? { declaredCapital: parsed.declaredCapital, verifiedCapital: source, verification: "VERIFIED_AUTHORIZED_SOURCE" }
        : { declaredCapital: parsed.declaredCapital, verifiedCapital: null, verification: "UNVERIFIED" },
      provenance: "USER_DECLARED", createdAt: now, supersedes: current?.currentRevisionId ?? null,
      lifecycle: { status: "PENDING", changedAt: now, changedBy: actor.userId },
    };
    await tx.appendRevision(revision);
    return revision;
  }
  async function upsertRevision(accountId: string, input: unknown, request: Request): Promise<OnboardingRevision> {
    const actor = validActor(await resolveActor()); const parsed = onboardingInputSchema.parse(input);
    return repo.transaction(async (tx) => {
      await owned(tx, accountId, actor);
      return createRevision(tx, accountId, actor, parsed, request, await tx.getPortfolio(accountId, actor.userId));
    });
  }
  return {
    upsertRevision,
    /**
     * R2-C2 owns structural portfolio creation. This operation only attaches
     * and applies the first revision to the already-existing canonical
     * portfolio; it never inserts a portfolio.
     */
    async createOrRecoverPortfolio(accountId: string, revisionIdToUse: string) {
      const actor = validActor(await resolveActor());
      return repo.transaction(async (tx) => {
        await owned(tx, accountId, actor);
        const canonical = await tx.getRevision(accountId, actor.userId, revisionId.parse(revisionIdToUse));
        if (!canonical) throw new Error("REVISION_NOT_FOUND");
        const existing = await tx.getPortfolio(accountId, actor.userId);
        if (!existing) throw new Error("PORTFOLIO_NOT_FOUND");
        if (existing.currentRevisionId === canonical.revisionId && canonical.lifecycle.status === "APPLIED") return existing;
        if (existing.currentRevisionId !== null) throw new Error("PORTFOLIO_ALREADY_EXISTS");
        if (canonical.lifecycle.status !== "PENDING" || canonical.supersedes !== null) throw new Error("INVALID_REVISION_STATE");
        const applied = await tx.transitionRevision(accountId, canonical.revisionId, actor.userId, "PENDING", "APPLIED");
        const result: PortfolioRecord = { ...existing, currentRevisionId: applied.revision.revisionId, revisionIds: [applied.revision.revisionId], version: 1 };
        if (!await tx.updatePortfolio(existing.version, null, result)) throw new Error("STALE_REVISION");
        return result;
      });
    },
    async applyCorrection(accountId: string, input: unknown, request: Request) {
      const actor = validActor(await resolveActor()); const parsed = onboardingInputSchema.parse(input);
      return repo.transaction(async (tx) => {
        await owned(tx, accountId, actor);
        const current = await tx.getPortfolio(accountId, actor.userId);
        if (!current) throw new Error("PORTFOLIO_NOT_FOUND");
        const currentRevisionId = current.currentRevisionId;
        if (!currentRevisionId) throw new Error("NO_APPLIED_REVISION");
        const revision = await createRevision(tx, accountId, actor, parsed, request, current);
        if (revision.lifecycle.status === "APPLIED" && currentRevisionId === revision.revisionId) return current;
        if (revision.lifecycle.status !== "PENDING" || revision.supersedes !== currentRevisionId) throw new Error("STALE_REVISION");
        const applied = await tx.transitionRevision(accountId, revision.revisionId, actor.userId, "PENDING", "APPLIED");
        const previous = await tx.transitionRevision(accountId, currentRevisionId, actor.userId, "APPLIED", "SUPERSEDED");
        if (previous.revision.revisionId !== currentRevisionId) throw new Error("STALE_REVISION");
        const next: PortfolioRecord = {
          ...current, currentRevisionId: applied.revision.revisionId,
          revisionIds: [...current.revisionIds, applied.revision.revisionId], version: current.version + 1,
        };
        if (!await tx.updatePortfolio(current.version, currentRevisionId, next)) throw new Error("STALE_REVISION");
        return next;
      });
    },
    async abandonRevision(accountId: string, revisionIdToAbandon: string): Promise<OnboardingRevision> {
      const actor = validActor(await resolveActor());
      return repo.transaction(async (tx) => {
        await owned(tx, accountId, actor);
        const revision = await tx.getRevision(accountId, actor.userId, revisionId.parse(revisionIdToAbandon));
        if (!revision) throw new Error("REVISION_NOT_FOUND");
        const result = await tx.transitionRevision(accountId, revision.revisionId, actor.userId, "PENDING", "ABANDONED");
        return result.revision;
      });
    },
  };
}

