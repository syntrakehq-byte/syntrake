import {
  inspectOwnExistingInvestingAccounts, ExistingAccountReadBlocked,
  type VerifiedClerkSession, type Transport,
} from "./existingAccountReview";

type Env = Readonly<Record<string, string | undefined>>;
type Load = () => Promise<VerifiedClerkSession>;
const responseHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});
function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: responseHeaders });
}
export async function handleExistingAccountReviewGet(
  request: Request, env: Env, load: Load, transport: Transport = fetch,
): Promise<Response> {
  // No write, no account creation and no financial valuation endpoints.
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !==
        "candidate/investing-r2c3-existing-account-read-20261024") {
    return json(404, { error: "NOT_FOUND" });
  }
  let path: URL;
  try { path = new URL(request.url); }
  catch { return json(400, { error: "INVALID_REQUEST" }); }
  if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (path.pathname !== "/api/investing/existing-account" ||
      path.search || path.hash || request.url.endsWith("?")) {
    return json(400, { error: "INVALID_REQUEST" });
  }
  let actor: VerifiedClerkSession;
  try { actor = await load(); }
  catch { return json(503, { error: "AUTH_UNAVAILABLE" }); }
  try {
    const existing = await inspectOwnExistingInvestingAccounts(env, actor, transport);
    return json(200, {
      state: existing ? "EXISTING_ACCOUNT_REVIEW_REQUIRED" : "NO_OWN_ACCOUNT_OBSERVED",
      existing,
      financialTruth: "UNAVAILABLE",
      financialWrites: false,
    });
  } catch (error) {
    if (error instanceof ExistingAccountReadBlocked) {
      if (error.code === "UNAUTHENTICATED") return json(401, { error: "UNAUTHENTICATED" });
      if (error.code === "NOT_AUTHORIZED") return json(403, { error: "BLOCKED" });
      if (error.code === "DISABLED") return json(404, { error: "NOT_FOUND" });
    }
    return json(503, { error: "READ_UNAVAILABLE" });
  }
}
