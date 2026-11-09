import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { classifyDynamicMarketError } from "@/market-data-core/dynamicMarketGateway";
import { getDynamicMarketCore } from "@/market-data-core/dynamicMarketServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
const market = getDynamicMarketCore();

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || url.search !== "") {
    return Response.json({ error: "ORIGIN_REJECTED" }, { status: 403, headers });
  }
  try {
    await requireVerifiedClerkActor();
  } catch {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1200) throw new Error("TOO_LARGE");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "INVALID_MARKET_REQUEST" }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof (body as { token?: unknown }).token !== "string") {
    return Response.json({ error: "INVALID_MARKET_REQUEST" }, { status: 400, headers });
  }
  try {
    const quote = await market.quoteToken((body as {token: string}).token);
    return Response.json(quote, { headers });
  } catch (error) {
    const failure = classifyDynamicMarketError(error);
    return Response.json({ error: failure.error }, { status: failure.status, headers });
  }
}
