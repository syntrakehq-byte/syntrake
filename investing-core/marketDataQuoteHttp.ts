import { classifyDynamicMarketError } from "../market-data-core/dynamicMarketGateway";
import type { DynamicMarketQuote } from "../market-data-core/dynamicMarketGateway";

const responseHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});
function result(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

/**
 * Authenticated Investing price read; the caller passes the SAME provider-
 * neutral Market Core reader used by Market Data. No direct provider access.
 */
export async function handleInvestingSelectionQuote(
  request: Request,
  authenticate: () => Promise<{ userId: string; sessionId: string }>,
  marketCore: Readonly<{ quoteToken(token: string): Promise<DynamicMarketQuote> }>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/investing/market-data" ||
      url.search !== "" || request.headers.get("origin") !== url.origin) {
    return result(403, { error: "ORIGIN_REJECTED" });
  }
  try {
    const actor = await authenticate();
    if (!actor?.userId || !actor?.sessionId) {
      return result(401, { error: "UNAUTHENTICATED" });
    }
  } catch {
    return result(401, { error: "UNAUTHENTICATED" });
  }
  let raw: string;
  try { raw = await request.text(); }
  catch { return result(400, { error: "INVALID_MARKET_REQUEST" }); }
  if (raw.length > 1200) return result(400, { error: "INVALID_MARKET_REQUEST" });
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return result(400, { error: "INVALID_MARKET_REQUEST" }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return result(400, { error: "INVALID_MARKET_REQUEST" });
  }
  const object = payload as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || typeof object.token !== "string" ||
      object.token.length < 60 || object.token.length > 800) {
    return result(400, { error: "INVALID_MARKET_REQUEST" });
  }
  try {
    return result(200, await marketCore.quoteToken(object.token));
  } catch (error) {
    const failure = classifyDynamicMarketError(error);
    return result(failure.status, { error: failure.error });
  }
}
