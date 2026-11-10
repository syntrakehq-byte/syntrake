import type { Actor } from "../investing-core/contracts";
import type { MarketDataDemand, OnDemandMarketDataResponse } from "./onDemandMarketData";

export type MarketDataHttpDependencies = Readonly<{
  authenticate: () => Promise<Actor>;
  /** Resolves identity and rights from server-side registry; never from query parameters. */
  resolve: (listingId: string, actor: Actor) => Promise<MarketDataDemand | null>;
  request: (demand: MarketDataDemand) => Promise<OnDemandMarketDataResponse>;
}>;

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const headers = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});
function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers });
}

/**
 * Single shared HTTP contract for authenticated Investing/Trading callers.
 * It makes exactly one consumer-neutral request. A browser only receives data
 * explicitly authorized for display, regardless of backend sharing rights.
 */
export async function handleOnDemandMarketDataHttp(
  request: Request, deps: MarketDataHttpDependencies,
): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
  let url: URL;
  try { url = new URL(request.url); }
  catch { return json(400, { error: "INVALID_REQUEST" }); }
  if (url.pathname !== "/api/market-data" || url.hash ||
      Array.from(url.searchParams.keys()).some(k => k !== "listingId") ||
      url.searchParams.getAll("listingId").length !== 1 ||
      !uuid.test(url.searchParams.get("listingId") ?? "")) {
    return json(400, { error: "INVALID_REQUEST" });
  }
  let actor: Actor;
  try { actor = await deps.authenticate(); }
  catch (error) {
    return error instanceof Error && error.message === "UNAUTHENTICATED"
      ? json(401, { error: "UNAUTHENTICATED" })
      : json(403, { error: "BLOCKED" });
  }
  try {
    const listingId = url.searchParams.get("listingId")!;
    const demand = await deps.resolve(listingId, actor);
    if (demand === null || demand.instrument.listingId !== listingId) {
      return json(404, { status: "UNAVAILABLE" });
    }
    if (!demand.requiresDisplay) return json(403, { status: "LICENSE_BLOCKED" });
    const result = await deps.request(demand);
    if (result.data === null) return json(200, { status: result.status });
    if (!result.data.rights.display ||
        result.data.rights.policyId !== demand.rightsPolicyId) {
      return json(200, { status: "LICENSE_BLOCKED" });
    }
    return json(200, {
      status: result.status,
      source: result.source,
      symbol: result.data.instrument.symbol,
      mic: result.data.instrument.mic,
      currency: result.data.currency,
      marketDate: result.data.marketDate,
      observedAt: result.data.asOf,
      interval: result.data.interval,
      freshness: result.data.quality.freshness,
      price: result.data.price,
    });
  } catch {
    return json(503, { error: "MARKET_DATA_UNAVAILABLE" });
  }
}
