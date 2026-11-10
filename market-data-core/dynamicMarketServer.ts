import { createDynamicMarketGateway } from "./dynamicMarketGateway";

/** Single owner-only, on-demand gateway. No background jobs or DB writes. */
const core = createDynamicMarketGateway({env:process.env});
export function getDynamicMarketCore(): typeof core { return core; }
