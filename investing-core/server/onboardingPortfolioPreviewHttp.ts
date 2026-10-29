import { z } from "zod";
import type { Pool } from "pg";
import { actorSchema } from "../contracts";
import { onboardingInputSchema } from "../r2/onboardingPortfolio";
import {
  isOnboardingPortfolioReady,
  makeOnboardingPortfolioPool,
  withOnboardingPortfolioFromClerk,
} from "./onboardingPortfolioFromClerk";
import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";

type Env = Readonly<Record<string, string | undefined>>;
type Actor = z.infer<typeof actorSchema>;
type PoolLike = Pick<Pool, "connect"> & { end?: () => Promise<void> };
type PoolFactory = (env: Env) => PoolLike;
type ActorProvider = () => Promise<Actor>;
const accountId = z.string().uuid();
const ref = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);
const common = { accountId };
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("UPSERT_REVISION"), ...common, input: onboardingInputSchema, revisionId: ref, idempotencyKey: ref }).strict(),
  z.object({ operation: z.literal("APPLY_INITIAL_REVISION"), ...common, revisionId: ref }).strict(),
  z.object({ operation: z.literal("APPLY_CORRECTION"), ...common, input: onboardingInputSchema, revisionId: ref, idempotencyKey: ref }).strict(),
  z.object({ operation: z.literal("ABANDON_REVISION"), ...common, revisionId: ref }).strict(),
]);
const MAX_BODY_BYTES = 128 * 1024;
const headers = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex,nofollow,noarchive",
});
const json = (status: number, body: unknown): Response => Response.json(body, { status, headers });

async function boundedJson(req: Request): Promise<unknown> {
  if (!req.body) throw new Error("INVALID_INPUT");
  const reader = req.body.getReader();
  let count = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!count) throw new Error("INVALID_INPUT");
  const bytes = new Uint8Array(count);
  let pos = 0;
  for (const part of parts) { bytes.set(part, pos); pos += part.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

/** Fail-closed: no Clerk call, SQL connection or body parsing when the preview gate is off. */
export async function handleOnboardingPortfolioPreviewPost(
  request: Request,
  env: Env,
  actorProvider: ActorProvider = requireVerifiedClerkActor,
  poolFactory: PoolFactory = makeOnboardingPortfolioPool,
): Promise<Response> {
  if (!isOnboardingPortfolioReady(env)) return json(404, { error: "NOT_FOUND" });
  let url: URL;
  try { url = new URL(request.url); } catch { return json(400, { error: "INVALID_REQUEST" }); }
  if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (url.pathname !== "/api/investing/portfolio/onboarding" ||
      url.search !== "" || url.hash !== "" || request.url.endsWith("?")) {
    return json(400, { error: "INVALID_REQUEST" });
  }
  if (request.headers.get("origin") !== url.origin ||
      request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return json(403, { error: "BLOCKED" });
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return json(413, { error: "PAYLOAD_TOO_LARGE" });
  }
  let raw: unknown;
  try { raw = await boundedJson(request); }
  catch (error) {
    const oversized = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    return json(oversized ? 413 : 400, { error: oversized ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT" });
  }
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: "INVALID_INPUT" });

  let actor: Actor;
  try {
    actor = actorSchema.parse(await actorProvider());
  } catch (error) {
    return json(error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 503,
      { error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "AUTH_UNAVAILABLE" });
  }
  let pool: PoolLike | undefined;
  try {
    pool = poolFactory(env);
    const command = parsed.data;
    const payload = await withOnboardingPortfolioFromClerk(pool, async (service) => {
      switch (command.operation) {
        case "UPSERT_REVISION": {
          const revision = await service.upsertRevision(command.accountId, command.input, command);
          return { state: revision.lifecycle.status, accountId: revision.accountId,
            revisionId: revision.revisionId, verification: revision.capital.verification };
        }
        case "APPLY_INITIAL_REVISION": {
          const portfolio = await service.createOrRecoverPortfolio(command.accountId, command.revisionId);
          return { state: "APPLIED", accountId: portfolio.accountId,
            portfolioId: portfolio.portfolioId, currentRevisionId: portfolio.currentRevisionId, version: portfolio.version };
        }
        case "APPLY_CORRECTION": {
          const portfolio = await service.applyCorrection(command.accountId, command.input, command);
          return { state: "APPLIED", accountId: portfolio.accountId,
            portfolioId: portfolio.portfolioId, currentRevisionId: portfolio.currentRevisionId, version: portfolio.version };
        }
        case "ABANDON_REVISION": {
          const revision = await service.abandonRevision(command.accountId, command.revisionId);
          return { state: revision.lifecycle.status, accountId: revision.accountId, revisionId: revision.revisionId };
        }
      }
    }, async () => actor);
    return json(200, { ...payload, financialMovementsCreated: false });
  } catch (error) {
    if (error instanceof Error) {
      const code = error.message;
      if (code === "UNAUTHENTICATED") return json(401, { error: "UNAUTHENTICATED" });
      if (["ACCOUNT_NOT_OWNED", "PORTFOLIO_NOT_FOUND", "REVISION_NOT_FOUND", "REVISION_OWNERSHIP_MISMATCH"].includes(code))
        return json(404, { error: "NOT_FOUND" });
      if (["IDEMPOTENCY_CONFLICT", "PORTFOLIO_ALREADY_EXISTS", "INVALID_REVISION_STATE", "NO_APPLIED_REVISION", "STALE_REVISION"].includes(code))
        return json(409, { error: "CONFLICT" });
    }
    // Never serialize SQL, DSNs, session identifiers or server-side exceptions.
    return json(503, { error: "ONBOARDING_UNAVAILABLE" });
  } finally {
    await pool?.end?.().catch(() => undefined);
  }
}
