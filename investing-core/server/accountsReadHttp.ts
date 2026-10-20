import { InvestingReadBlocked, type InvestingReadResult } from "./supabaseReadTransport";

/**
 * R1: HTTP-safe, read-only adapter for existing Clerk -> Supabase RLS reader.
 * Does not accept user/account IDs, bearer tokens, tenant names or filters
 * from the browser. The production route binds load() to server-side Clerk
 * auth(); injecting load here is exclusively for deterministic negative tests.
 */
type Config = Readonly<Record<string, string | undefined>>;

export const R1_PREVIEW_BRANCH = "candidate/investing-r1b-accounts-ui-20261020" as const;
export const R1_RELEASE_CANDIDATE_BRANCH = "candidate/investing-r1-production-readonly-release-20261020" as const;
export const R1_PREVIEW_SUPABASE_PROJECT_REF = "zkqgpejlkgootkvkebhd" as const;
export const R1_PRODUCTION_SUPABASE_PROJECT_REF = "vbazzxqyuqcrmjytaboc" as const;

function publishableKeyOnly(env: Config): boolean {
  return /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  );
}

/**
 * Runtime-disabled production gate. A production build becomes readable ONLY
 * after a separately approved operator supplies both an exact 40-hex deploy
 * SHA and the explicit prod-only enable flag, for the intended Supabase
 * production ref. All values are server environment, never query parameters.
 * This gate does not itself prove Supabase has an applied schema or valid
 * third-party Clerk JWT configuration: those require separate release proof.
 */
export function isR1AccountReadEnabled(env: Config): boolean {
  if (!publishableKeyOnly(env)) return false;

  if (env.VERCEL_ENV === "preview") {
    return (
      (env.VERCEL_GIT_COMMIT_REF === R1_PREVIEW_BRANCH ||
        env.VERCEL_GIT_COMMIT_REF === R1_RELEASE_CANDIDATE_BRANCH) &&
      env.INVESTING_R1_ACCOUNTS_READ_MODE === "enabled" &&
      env.INVESTING_R1_SUPABASE_PROJECT_REF === R1_PREVIEW_SUPABASE_PROJECT_REF &&
      env.NEXT_PUBLIC_SUPABASE_URL === `https://${R1_PREVIEW_SUPABASE_PROJECT_REF}.supabase.co`
    );
  }

  if (env.VERCEL_ENV === "production") {
    const approvedSHA = env.INVESTING_R1_PRODUCTION_APPROVED_SHA ?? "";
    return (
      env.VERCEL_GIT_COMMIT_REF === "main" &&
      env.INVESTING_R1_PRODUCTION_READ_MODE === "enabled" &&
      /^[a-f0-9]{40}$/.test(approvedSHA) &&
      env.VERCEL_GIT_COMMIT_SHA === approvedSHA &&
      env.INVESTING_R1_SUPABASE_PROJECT_REF === R1_PRODUCTION_SUPABASE_PROJECT_REF &&
      env.NEXT_PUBLIC_SUPABASE_URL === `https://${R1_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`
    );
  }
  return false;
}

export const accountReadHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: accountReadHeaders });
}

export async function handleR1AccountsRead(
  requestUrl: string,
  env: Config,
  load: () => Promise<InvestingReadResult>,
): Promise<Response> {
  // Disabled-by-default, including if the project ref/publishable key drift.
  if (!isR1AccountReadEnabled(env)) return json(404, { error: "NOT_FOUND" });

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return json(400, { error: "INVALID_REQUEST" });
  }
  if (url.pathname !== "/api/investing/accounts" || url.search !== "" || url.hash !== "" || requestUrl.endsWith("?")) {
    // No per-user, tenant, account, portfolio or selection query is accepted.
    return json(400, { error: "INVALID_REQUEST" });
  }

  try {
    const result = await load();
    // Never return actorId, Clerk session/token, SQL config, cash or balances.
    return json(200, {
      state: result.state,
      accounts: result.accounts,
      source: "SUPABASE_RLS_READ",
      financialState: "NOT_INCLUDED",
    });
  } catch (error: unknown) {
    if (error instanceof InvestingReadBlocked) {
      if (error.code === "UNAUTHENTICATED") {
        return json(401, { error: "UNAUTHENTICATED" });
      }
      if (error.code === "READ_UNAUTHORIZED") {
        return json(403, { error: "BLOCKED" });
      }
    }
    // Missing token, configuration/schema, transport failures or malformed
    // upstream results never become [] or a synthetic EUR 0 state.
    return json(503, { error: "READ_UNAVAILABLE" });
  }
}
