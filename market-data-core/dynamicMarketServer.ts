import { createDynamicMarketGateway } from "./dynamicMarketGateway";
import { createPostgresSharedMarketCache, isSharedMarketCacheConfigured } from "./pgSharedMarketCache";

/** One Market Core instance shared by browser API and internal consumers. */
const env = process.env;
if (env.G3G_SHARED_CACHE_MODE === "enabled" && !isSharedMarketCacheConfigured(env)) {
  throw new Error("MARKET_CACHE_CONFIGURATION_INCOMPLETE");
}
const sharedCache = isSharedMarketCacheConfigured(env)
  ? createPostgresSharedMarketCache({ env })
  : null;
const marketCore = createDynamicMarketGateway({
  env,
  ...(sharedCache !== null ? { sharedCache } : {}),
});

export function getDynamicMarketCore(): typeof marketCore {
  return marketCore;
}
