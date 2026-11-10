import { createDynamicMarketGateway } from "./dynamicMarketGateway";
import { createVercelRuntimeMarketCache } from "./vercelRuntimeMarketCache";

// A single Market Core for browser and service-to-service consumers.
// The optional Vercel cache is shared across function instances, with a strict
// 30-second expiry. No market data is persisted into Supabase.
const sharedCache = process.env.SYNTRAKE_MARKET_SHARED_CACHE === "enabled"
  ? createVercelRuntimeMarketCache({ env: process.env })
  : undefined;
const core = createDynamicMarketGateway({
  env: process.env,
  ...(sharedCache ? { sharedCache } : {}),
});
export function getDynamicMarketCore(): typeof core { return core; }
