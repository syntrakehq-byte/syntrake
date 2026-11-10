import { MarketDataError } from "./identity";

type Env = Readonly<Record<string,string|undefined>>;
const SHA=/^[a-f0-9]{40}$/;
const OWNER=/^user_[A-Za-z0-9_-]{8,128}$/;
const APIKEY=/^[A-Za-z0-9_-]{16,128}$/;

/** Owner-only personal Market Core; provider responses are not persisted. */
export function isPersonalMarketReady(env: Env): boolean {
  const sha=env.VERCEL_GIT_COMMIT_SHA;
  return (env.VERCEL_ENV==="production" || env.VERCEL_ENV==="preview") &&
    env.SYNTRAKE_MARKET_MODE==="personal" &&
    env.SYNTRAKE_MARKET_VISIBILITY==="owner-only" &&
    env.SYNTRAKE_MARKET_PERSISTENCE==="disabled" &&
    typeof sha==="string" && SHA.test(sha) &&
    env.SYNTRAKE_MARKET_APPROVED_SHA===sha &&
    OWNER.test(env.SYNTRAKE_MARKET_OWNER_USER_ID??"") &&
    APIKEY.test(env.SYNTRAKE_TWELVE_DATA_API_KEY??"");
}

export function requirePersonalMarketReady(env: Env, pinnedSha: string): string {
  if (!isPersonalMarketReady(env) || pinnedSha !== env.VERCEL_GIT_COMMIT_SHA)
    throw new MarketDataError("DISABLED");
  return env.SYNTRAKE_TWELVE_DATA_API_KEY!;
}
