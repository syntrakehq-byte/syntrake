import { MarketDataError } from "./identity";

type Env = Readonly<Record<string, string | undefined>>;
const ALLOWED_PREVIEW_BRANCH = "feat/r3-market-data-core-20261030";
const SHA = /^[a-f0-9]{40}$/;
/** This first slice is deliberately Preview-only; Production never triggers provider calls. */
export function isR3AProviderReady(env: Env): boolean {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === ALLOWED_PREVIEW_BRANCH &&
    env.SYNTRAKE_R3_PROVIDER_ENABLED === "enabled" &&
    !!sha && SHA.test(sha) && env.SYNTRAKE_R3_PREVIEW_APPROVED_SHA === sha &&
    typeof env.SYNTRAKE_TWELVE_DATA_API_KEY === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/.test(env.SYNTRAKE_TWELVE_DATA_API_KEY);
}

/** R3-A can be tested with injected HTTP, but without explicit Preview operator opt-in no request occurs. */
export function requireR3AProviderReady(env: Env): string {
  if (!isR3AProviderReady(env)) throw new MarketDataError("DISABLED");
  return env.SYNTRAKE_TWELVE_DATA_API_KEY!;
}

/** Explicit, branch-and-SHA pinned G3 Preview worker call gate.
 * No provider calls without a separately attested internal, non-display
 * test scope and an operator-provided credential.
 */
export function isG3PreviewProviderReady(env: Env): boolean {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return env.VERCEL_ENV === "preview" &&
    (env.VERCEL_GIT_COMMIT_REF === "feat/g3e-integrated-rehearsal-20261106" ||
     env.VERCEL_GIT_COMMIT_REF === "feat/g3g-preview-hosted-worker-20261108") &&
    env.SYNTRAKE_G3_PROVIDER_ENABLED === "enabled" &&
    env.SYNTRAKE_G3_LICENSE_SCOPE === "internal-non-display" &&
    !!sha && SHA.test(sha) && env.SYNTRAKE_G3_APPROVED_SHA === sha &&
    typeof env.SYNTRAKE_TWELVE_DATA_API_KEY === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/.test(env.SYNTRAKE_TWELVE_DATA_API_KEY);
}

/** Shared provider authorization. Both G3 consumers reuse this single gate. */
export function requirePreviewMarketProviderReady(env: Env): string {
  if (!isR3AProviderReady(env) && !isG3PreviewProviderReady(env)) {
    throw new MarketDataError("DISABLED");
  }
  return env.SYNTRAKE_TWELVE_DATA_API_KEY!;
}

/** Explicit operator gate for the one-shot R3-E1 rehearsal; closed by default. */
export function isR3E1RealCallReady(env: Env, checkoutSha?: string): boolean {
  const approvedSha = env.SYNTRAKE_R3E1_APPROVED_SHA;
  return env.VERCEL_ENV === "preview" &&
    env.SYNTRAKE_R3E1_REAL_CALL_ENABLED === "confirm-once" &&
    !!approvedSha && SHA.test(approvedSha) && checkoutSha === approvedSha &&
    env.SYNTRAKE_R3E1_APPROVED_ENV === "preview" &&
    typeof env.SYNTRAKE_TWELVE_DATA_API_KEY === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/.test(env.SYNTRAKE_TWELVE_DATA_API_KEY);
}

export function requireR3E1RealCallReady(env: Env, checkoutSha: string): string {
  if (!isR3E1RealCallReady(env, checkoutSha)) throw new MarketDataError("DISABLED");
  return env.SYNTRAKE_TWELVE_DATA_API_KEY!;
}
