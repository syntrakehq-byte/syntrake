import { createDynamicMarketGateway } from "./dynamicMarketGateway";

/**
 * One source of truth for the Preview market service. In-memory cache is
 * best-effort per warm server instance, never a substitute for a shared
 * durable cache across Vercel instances.
 */
const marketCore = createDynamicMarketGateway({ env: process.env });
export function getDynamicMarketCore(): typeof marketCore {
  return marketCore;
}
