import { getDynamicMarketCore } from "@/market-data-core/dynamicMarketServer";
import { handleInternalMarketRequest } from "@/market-data-core/internalMarketRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private service-to-service API; does not rely on a user's browser session. */
export async function POST(request: Request): Promise<Response> {
  return handleInternalMarketRequest(request, process.env, getDynamicMarketCore());
}
