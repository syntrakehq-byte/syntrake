import { MarketDataError } from "./identity";

type Env = Readonly<Record<string,string|undefined>>;
const SHA=/^[a-f0-9]{40}$/;
const APIKEY=/^[A-Za-z0-9_-]{16,128}$/;

/** Multi-account Market Core gate. Consumer authentication is enforced at each route. */
export function isPersonalMarketReady(env: Env): boolean {
  const sha=env.VERCEL_GIT_COMMIT_SHA;
  return (env.VERCEL_ENV==="production" || env.VERCEL_ENV==="preview") &&
    env.SYNTRAKE_MARKET_MODE==="on-demand" &&
    env.SYNTRAKE_MARKET_VISIBILITY==="authenticated" &&
    env.SYNTRAKE_MARKET_PERSISTENCE==="disabled" &&
    typeof sha==="string" && SHA.test(sha) &&
    env.SYNTRAKE_MARKET_APPROVED_SHA===sha &&
    APIKEY.test(env.SYNTRAKE_TWELVE_DATA_API_KEY??"");
}

export function requirePersonalMarketReady(env: Env, pinnedSha: string): string {
  if (!isPersonalMarketReady(env) || pinnedSha !== env.VERCEL_GIT_COMMIT_SHA)
    throw new MarketDataError("DISABLED");
  return env.SYNTRAKE_TWELVE_DATA_API_KEY!;
}
