/**
 * Fail-closed deployment gate for the read-only Clerk A/B rehearsal.
 * This is NOT authorization: Clerk must derive the actor server-side,
 * and Supabase must validate the signed token and enforce RLS.
 *
 * The endpoint must never be active in a production deployment or an
 * unrelated preview branch, even if public Supabase config is supplied.
 */
export const INVESTING_R0A_AB_PREVIEW_REF = "zkqgpejlkgootkvkebhd" as const;
export const INVESTING_R0A_AB_PREVIEW_BRANCH =
  "candidate/investing-r0a-clerk-ab-read-rehearsal-20261018" as const;

type Environment = Readonly<Record<string, string | undefined>>;

export function isInvestingR0aClerkAbReadRehearsalEnabled(env: Environment): boolean {
  return (
    env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === INVESTING_R0A_AB_PREVIEW_BRANCH &&
    env.INVESTING_R0A_AB_READ_MODE === "rehearsal" &&
    env.INVESTING_R0A_AB_READ_PROJECT_REF === INVESTING_R0A_AB_PREVIEW_REF &&
    env.NEXT_PUBLIC_SUPABASE_URL ===
      `https://${INVESTING_R0A_AB_PREVIEW_REF}.supabase.co` &&
    /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    )
  );
}
