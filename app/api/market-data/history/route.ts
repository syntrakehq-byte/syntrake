import { requirePersonalMarketActor } from "@/market-data-core/requirePersonalMarketActor";
import { classifyDynamicMarketError } from "@/market-data-core/dynamicMarketGateway";
import { getDynamicMarketCore } from "@/market-data-core/dynamicMarketServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

/** Market Core owns provider history; the browser only supplies a signed selection. */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/market-data/history" ||
      url.search !== "" || request.headers.get("origin") !== url.origin) {
    return Response.json({ error: "ORIGIN_REJECTED" }, { status: 403, headers });
  }
  try {
    await requirePersonalMarketActor();
  } catch {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1500) throw new Error("TOO_LARGE");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "INVALID_MARKET_REQUEST" }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "INVALID_MARKET_REQUEST" }, { status: 400, headers });
  }
  const requestData = body as Record<string, unknown>;
  if (Object.keys(requestData).length !== 3 ||
      typeof requestData.token !== "string" ||
      typeof requestData.startDate !== "string" ||
      typeof requestData.endDate !== "string") {
    return Response.json({ error: "INVALID_MARKET_REQUEST" }, { status: 400, headers });
  }
  try {
    const history = await getDynamicMarketCore().historyToken(
      requestData.token, requestData.startDate, requestData.endDate,
    );
    return Response.json(history, { headers });
  } catch (error) {
    const failure = classifyDynamicMarketError(error);
    return Response.json({ error: failure.error }, { status: failure.status, headers });
  }
}
