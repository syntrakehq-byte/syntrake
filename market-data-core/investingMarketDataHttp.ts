import { Client } from "pg";
import { instrumentIdentity } from "./identity";
import { historicalRowsToResult, type HistoricalMarketDataRequest, type MarketDataResult } from "./contracts";
import { serveInvestingMarketData, type InvestingMarketDataResponse } from "./investingOperationalService";
import type { InvestingDiscoveryQuote } from "./discoveryMarketDataInvesting";
import type { Actor } from "../investing-core/contracts";

export type InvestingMarketDataHttpRequest = Readonly<{
  listingId: string;
  startDate: string;
  endDate: string;
  asOf: string;
  interval: "1day";
  adjustment: "none";
}>;

type Env = Readonly<Record<string, string | undefined>>;
type Authenticate = () => Promise<Actor>;
type Load = (request: InvestingMarketDataHttpRequest, actor: Actor) => Promise<InvestingMarketDataResponse>;

export const marketDataHttpHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: marketDataHttpHeaders });
}

function enabled(env: Env): boolean {
  return env.VERCEL_ENV === "preview" &&
    env.MARKET_DATA_G3C_MODE === "enabled" &&
    /^[a-f0-9]{40}$/.test(env.MARKET_DATA_G3C_APPROVED_SHA ?? "") &&
    env.MARKET_DATA_G3C_APPROVED_SHA === env.VERCEL_GIT_COMMIT_SHA;
}

function validUuid(value: string): boolean { return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value); }
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function validAsOf(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)); }

function parseRequest(requestUrl: string): InvestingMarketDataHttpRequest {
  const url = new URL(requestUrl);
  if (url.pathname !== "/api/investing/market-data" || url.hash) throw new Error("INVALID_REQUEST");
  const allowed = new Set(["listingId", "startDate", "endDate", "asOf", "interval", "adjustment"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error("INVALID_REQUEST");
  const listingId = url.searchParams.get("listingId");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const asOf = url.searchParams.get("asOf");
  const interval = url.searchParams.get("interval");
  const adjustment = url.searchParams.get("adjustment");
  if (!listingId || !startDate || !endDate || !asOf || interval !== "1day" || adjustment !== "none" ||
      !validUuid(listingId) || !validDay(startDate) || !validDay(endDate) || startDate > endDate || !validAsOf(asOf) ||
      new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime() > 366 * 86400000) throw new Error("INVALID_REQUEST");
  return { listingId, startDate, endDate, asOf, interval, adjustment };
}

function publicResult(request: InvestingMarketDataHttpRequest, result: InvestingMarketDataResponse): unknown {
  const base = { status: result.status, listingId: request.listingId };
  if (["LICENSE_BLOCKED", "UNAVAILABLE", "STALE", "PARTIAL", "AMBIGUOUS", "REFRESH_REQUIRED"].includes(result.status)) return base;
  return {
    ...base,
    current: result.current,
    history: result.history,
  };
}

export async function handleInvestingMarketDataRead(
  requestUrl: string,
  env: Env,
  authenticate: Authenticate,
  load: Load,
): Promise<Response> {
  if (!enabled(env)) return json(404, { error: "NOT_FOUND" });
  let request: InvestingMarketDataHttpRequest;
  try { request = parseRequest(requestUrl); } catch { return json(400, { error: "INVALID_REQUEST" }); }
  let actor: Actor;
  try { actor = await authenticate(); } catch (error: unknown) {
    return json(error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403, { error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "BLOCKED" });
  }
  try { return json(200, publicResult(request, await load(request, actor))); }
  catch { return json(503, { error: "READ_UNAVAILABLE" }); }
}

export async function loadInvestingMarketDataFromPostgres(request: InvestingMarketDataHttpRequest, _actor: Actor, env: Env = process.env): Promise<InvestingMarketDataResponse> {
  const connectionString = env.MARKET_DATA_READER_DATABASE_URL;
  if (!connectionString) throw new Error("INVALID_CONFIGURATION");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SET ROLE market_core_reader");
    const rows = (await client.query("SELECT * FROM market_core.read_market_history($1,$2::date,$3::date,$4::timestamptz,$5,$6)", [request.listingId, request.startDate, request.endDate, request.asOf, request.interval, request.adjustment])).rows;
    const historicalRequest: HistoricalMarketDataRequest = request;
    const historical = historicalRowsToResult(historicalRequest, rows);
    const listing = (await client.query("SELECT l.listing_id,l.instrument_id,l.mic,l.ticker,l.trading_currency::text AS trading_currency,i.asset_class,p.provider_key FROM market_core.listings l JOIN market_core.instruments i ON i.instrument_id=l.instrument_id LEFT JOIN LATERAL (SELECT provider_id FROM market_core.market_observations WHERE listing_id=l.listing_id ORDER BY created_at DESC LIMIT 1) o ON true LEFT JOIN market_core.providers p ON p.provider_id=o.provider_id WHERE l.listing_id=$1", [request.listingId])).rows[0];
    if (!listing || !historical.instrumentId || !historical.currency || !historical.providerId || !listing.provider_key) return { status: "UNAVAILABLE", discovery: { status: "UNRESOLVED", candidates: [], resolutions: [], routing: null, providerKey: null, listingRef: request.listingId, close: null, marketData: null, identityVerified: false, reason: "Persisted identity is incomplete." }, current: null, history: historical, refreshed: false, source: "NONE", reason: "Persisted identity is incomplete." };
    const point = historical.points[historical.points.length - 1];
    const identity = instrumentIdentity({ kind: listing.asset_class, symbol: listing.ticker, mic: listing.mic, currency: listing.trading_currency });
    const current = historical.status === "AVAILABLE" && point?.close !== null && point?.revisionId !== null && point?.asKnownAt !== null ? {
      instrument: { ...identity, instrumentId: listing.instrument_id, listingId: listing.listing_id }, listingRef: listing.listing_id, sourceRefs: [{ provider: listing.provider_key, originalSourceId: point.sourceRevision ?? "persisted", requestId: null, sourceDocumentUri: null }], revisionId: point.revisionId, price: point.close, currency: historical.currency, marketDate: point.marketDate, asOf: point.asKnownAt, quality: { coverage: "FULL" as const, freshness: "KNOWN" as const }, rights: { policyId: historical.rightsPolicyId!, display: true, retentionUntil: null }, interval: "1day" as const, adjustment: "none" as const,
    } satisfies MarketDataResult : null;
    const discovery: InvestingDiscoveryQuote = { status: current ? "READY" : "UNRESOLVED", candidates: [], resolutions: [], routing: null, providerKey: listing.provider_key, listingRef: listing.listing_id, close: current?.price ?? null, marketData: current, identityVerified: current !== null, reason: current ? "Persisted canonical result." : "No permitted persisted result." };
    return serveInvestingMarketData({ discovery, historical: request, requiresDisplay: true, rightsPolicyId: historical.rightsPolicyId ?? "", readCurrent: async () => current, readHistory: async () => historical, refresh: null });
  } finally { await client.end(); }
}
