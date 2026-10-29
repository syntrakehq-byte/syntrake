import { createHash } from "node:crypto";
import type { Actor } from "../contracts";

type ServerEnv = Readonly<Record<string, string | undefined>>;
type LoadActor = () => Promise<Actor>;

export function isClerkABReadOnlyProbeEnabled(env: ServerEnv): boolean {
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !== "feat/bl2bl3-canonical-draft" ||
      env.SYNTRAKE_CLERK_AB_PROBE_ENABLED !== "enabled") return false;
  const approvedSha = env.SYNTRAKE_CLERK_AB_PROBE_APPROVED_SHA;
  return !!approvedSha && /^[a-f0-9]{40}$/.test(approvedSha) &&
    env.VERCEL_GIT_COMMIT_SHA === approvedSha;
}

const headers = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex,nofollow,noarchive",
  "Referrer-Policy": "no-referrer",
});
function reply(status: number, payload: unknown): Response {
  return Response.json(payload, { status, headers });
}

/**
 * Read-only, ephemeral diagnostic: verifies that the two separate browser
 * profiles hold distinct verified Clerk user IDs, without exposing IDs,
 * session tokens, email addresses, cookies, or any financial information.
 * Does not open a database connection.
 */
export async function handleClerkABIdentityProbe(
  request: Request,
  env: ServerEnv,
  loadActor: LoadActor,
): Promise<Response> {
  if (!isClerkABReadOnlyProbeEnabled(env))
    return reply(404, { error: "NOT_FOUND" });
  if (request.method !== "GET") return reply(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const url = new URL(request.url);
    if (url.pathname !== "/api/investing/rehearsal/clerk-identity" || url.search || url.hash)
      return reply(400, { error: "INVALID_REQUEST" });
  } catch {
    return reply(400, { error: "INVALID_REQUEST" });
  }
  try {
    const actor = await loadActor();
    if (!actor?.userId || !actor?.sessionId)
      return reply(401, { authenticated: false });
    const identityTag = createHash("sha256")
      .update("SYNTRAKE_CLERK_AB_READONLY_V1\u0000")
      .update(actor.userId, "utf8")
      .digest("hex").slice(0, 16);
    return reply(200, { authenticated: true, identityTag });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return reply(401, { authenticated: false });
    return reply(503, { error: "AUTH_UNAVAILABLE" });
  }
}
