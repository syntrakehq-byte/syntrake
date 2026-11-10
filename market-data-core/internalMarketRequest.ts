import { createHash, timingSafeEqual } from "node:crypto";
import { classifyDynamicMarketError, type DynamicMarketCandidate, type DynamicMarketQuote, type DynamicMarketHistory } from "./dynamicMarketGateway";
import { isG3HostedPreviewReady } from "./g3HostedPreviewExecutor";

type Env = Readonly<Record<string, string | undefined>>;
type MarketCore = Readonly<{
  discover(query: string): Promise<readonly DynamicMarketCandidate[]>;
  quoteToken(token: string): Promise<DynamicMarketQuote>;
  historyToken(token: string, startDate: string, endDate: string): Promise<DynamicMarketHistory>;
}>;
const privateHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});
function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: privateHeaders });
}
function authorized(raw: string | null, secret: string | undefined): boolean {
  if (!secret || !/^[A-Za-z0-9_-]{48,256}$/.test(secret)) return false;
  const match = /^Bearer ([A-Za-z0-9_-]{48,256})$/.exec(raw ?? "");
  if (!match) return false;
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(actual, expected);
}

/**
 * The same Market Core is callable by an authorized internal service even
 * without a Clerk browser session. No worker, timer, autonomous trading or
 * independent provider client is created here.
 *
 * Two-step instrument selection is deliberate: ambiguous issuer/listing
 * candidates are returned for explicit selection, never guessed.
 */
export async function handleInternalMarketRequest(
  request: Request,
  env: Env,
  market: MarketCore,
): Promise<Response> {
  let url: URL;
  try { url = new URL(request.url); } catch { return json(404, { error: "NOT_FOUND" }); }
  if (request.method !== "POST" ||
      url.pathname !== "/api/internal/market-data" || url.search !== "" ||
      url.hash !== "" || !isG3HostedPreviewReady(env) ||
      !authorized(request.headers.get("authorization"), env.G3G_EXECUTOR_TOKEN)) {
    return json(404, { error: "NOT_FOUND" });
  }
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 1800) return json(400, { error: "INVALID_MARKET_REQUEST" });
    payload = JSON.parse(text);
  } catch {
    return json(400, { error: "INVALID_MARKET_REQUEST" });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { error: "INVALID_MARKET_REQUEST" });
  }
  const fields = payload as Record<string, unknown>;
  const keys = Object.keys(fields).sort().join(",");
  try {
    if (fields.action === "DISCOVER" && keys === "action,query" &&
        typeof fields.query === "string") {
      const candidates = await market.discover(fields.query);
      return json(200, { status: candidates.length ? "AVAILABLE" : "UNAVAILABLE", candidates });
    }
    if (fields.action === "RESOLVE_QUOTE" && keys === "action,query" &&
        typeof fields.query === "string") {
      const candidates = await market.discover(fields.query);
      if (candidates.length === 0) return json(200, { status: "UNAVAILABLE", candidates: [] });
      if (candidates.length > 1) return json(200, { status: "AMBIGUOUS", candidates });
      return json(200, await market.quoteToken(candidates[0].token));
    }

    if (fields.action === "QUOTE" && keys === "action,token" &&
        typeof fields.token === "string") {
      return json(200, await market.quoteToken(fields.token));
    }
    if (fields.action === "HISTORY" && keys === "action,endDate,startDate,token" &&
        typeof fields.token === "string" &&
        typeof fields.startDate === "string" &&
        typeof fields.endDate === "string") {
      return json(200, await market.historyToken(fields.token, fields.startDate, fields.endDate));
    }
  } catch (error) {
    const failure = classifyDynamicMarketError(error);
    return json(failure.status, { error: failure.error });
  }
  return json(400, { error: "INVALID_MARKET_REQUEST" });
}
