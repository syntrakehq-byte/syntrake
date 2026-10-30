import { MarketDataError } from "./identity";

type Env = Readonly<Record<string, string | undefined>>;
const SHA = /^[a-f0-9]{40}$/;
const ALLOWED_PREVIEW_BRANCH = "feat/r3-market-data-core-20261030";
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
