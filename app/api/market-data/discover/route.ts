import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { createDynamicMarketGateway, classifyDynamicMarketError } from "@/market-data-core/dynamicMarketGateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
const market = createDynamicMarketGateway({ env: process.env });

export async function GET(request: Request): Promise<Response> {
  try {
    await requireVerifiedClerkActor();
  } catch {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (url.searchParams.size !== 1 || typeof q !== "string") {
    return Response.json({ error: "INVALID_MARKET_REQUEST" }, { status: 400, headers });
  }
  try {
    const candidates = await market.discover(q);
    return Response.json({ status: candidates.length ? "AVAILABLE" : "UNAVAILABLE", candidates }, { headers });
  } catch (error) {
    const failure = classifyDynamicMarketError(error);
    return Response.json({ error: failure.error }, { status: failure.status, headers });
  }
}
