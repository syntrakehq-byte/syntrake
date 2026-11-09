import { createHmac, timingSafeEqual } from "node:crypto";
import { CatalogConnectorError } from "./catalogConnector";
import { createTwelveDataCatalogConnector } from "./twelveDataCatalog";
import { isR3E1RealCallReady } from "./gate";
import { isG3HostedPreviewReady } from "./g3HostedPreviewExecutor";
import { instrumentIdentity, MarketDataError, type InstrumentIdentity, type InstrumentKind } from "./identity";
import { fetchPersonalPreviewDailySeries, type DailySeries } from "./twelveData";

type Env = Readonly<Record<string, string | undefined>>;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type SeriesFetcher = typeof fetchPersonalPreviewDailySeries;
type Selected = Readonly<{
  symbol: string; mic: string | null; currency: string;
  kind: InstrumentKind; name: string; expires: number;
}>;
export type DynamicMarketCandidate = Readonly<{
  name: string; symbol: string; mic: string | null; currency: string;
  kind: InstrumentKind; token: string;
}>;
export type DynamicMarketQuote = Readonly<{
  status: "AVAILABLE"; symbol: string; name: string; mic: string | null;
  currency: string; kind: InstrumentKind; price: string; marketDate: string;
  observedAt: string; provider: "TWELVE_DATA"; interval: "1day";
  priceType: "DAILY_CLOSE"; source: "PROVIDER" | "MEMORY_CACHE";
  providerCalls: 0 | 1;
}>;

const TOKEN_TTL_MS = 10 * 60_000;
const QUOTE_TTL_MS = 60_000;
const MAX_CACHE_SIZE = 128;
const TOKEN_LIMIT = 800;

function keyForPreview(env: Env): { key: string; sha: string } {
  const sha = env.G3G_DEPLOYMENT_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (!isG3HostedPreviewReady(env) || env.G3G_WORKER_MODE !== "disabled" ||
      !isR3E1RealCallReady(env, sha) ||
      env.SYNTRAKE_R3E1_REHEARSAL_LICENSE_CONFIRMED !== "confirm-query-no-display" ||
      env.SYNTRAKE_G3_PROVIDER_ENABLED !== "disabled") {
    throw new MarketDataError("DISABLED");
  }
  return { key: env.SYNTRAKE_TWELVE_DATA_API_KEY!, sha };
}
function validSearchTerm(query: unknown): string {
  if (typeof query !== "string") throw new MarketDataError("INVALID_REQUEST");
  const term = query.trim();
  if (term.length < 2 || term.length > 64 || !/^[\p{L}\p{N} .&'/_-]+$/u.test(term)) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  return term;
}
function fromProvider(row: Readonly<{
  descriptiveName: string | null; descriptiveAssetClass: InstrumentKind | null;
  listing: { ticker: string; mic: string | null; tradingCurrency: string } | null;
}>): Omit<Selected, "expires"> | null {
  const listing = row.listing;
  if (!listing || !row.descriptiveName || !row.descriptiveAssetClass) return null;
  try {
    instrumentIdentity({
      kind: row.descriptiveAssetClass, symbol: listing.ticker,
      mic: listing.mic, currency: listing.tradingCurrency,
    });
  } catch { return null; }
  return {
    symbol: listing.ticker, mic: listing.mic, currency: listing.tradingCurrency,
    kind: row.descriptiveAssetClass, name: row.descriptiveName,
  };
}
function mac(payload: string, key: string, sha: string): string {
  return createHmac("sha256", key).update("syntrake-market-v1:" + sha + ":" + payload).digest("base64url");
}
function createSelection(item: Selected, key: string, sha: string): string {
  const payload = Buffer.from(JSON.stringify(item), "utf8").toString("base64url");
  return payload + "." + mac(payload, key, sha);
}
function readSelection(token: unknown, key: string, sha: string, now: number): Selected {
  if (typeof token !== "string" || token.length > TOKEN_LIMIT || token.length < 60) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw new MarketDataError("INVALID_REQUEST");
  const expected = Buffer.from(mac(parts[0], key, sha));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new MarketDataError("INVALID_REQUEST"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  const item = parsed as Record<string, unknown>;
  if (typeof item.expires !== "number" || !Number.isSafeInteger(item.expires) ||
      item.expires <= now || item.expires > now + TOKEN_TTL_MS ||
      typeof item.name !== "string" || item.name.length > 160 || !item.name.trim()) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  try {
    instrumentIdentity({
      kind: item.kind, symbol: item.symbol, mic: item.mic, currency: item.currency,
    });
  } catch { throw new MarketDataError("INVALID_REQUEST"); }
  return item as Selected;
}

/** Read-only provider discovery with no hard-coded universe or Supabase pre-registration. */
export function createDynamicMarketGateway(input: Readonly<{
  env: Env;
  transport?: Transport;
  fetchSeries?: SeriesFetcher;
  clock?: () => Date;
}>) {
  const cache = new Map<string, { quote: DynamicMarketQuote; until: number }>();
  const inflight = new Map<string, Promise<DynamicMarketQuote>>();
  const now = () => (input.clock ?? (() => new Date()))().getTime();

  async function discover(search: string): Promise<readonly DynamicMarketCandidate[]> {
    const term = validSearchTerm(search);
    const { key, sha } = keyForPreview(input.env);
    const source = {
      providerKey: "TWELVE_DATA",
      snapshotId: "on-demand-" + sha.slice(0, 12), snapshotVersion: "1",
      observedAt: new Date(now()).toISOString(),
      licensePolicyId: "preview-private-direct", storageAllowed: false, sharingAllowed: false,
    };
    const connector = createTwelveDataCatalogConnector({
      env: input.env, source,
      transport: input.transport ?? ((url, init) => fetch(url, {
        ...init, signal: AbortSignal.timeout(5500),
      })),
      apiKeyEnv: "SYNTRAKE_TWELVE_DATA_API_KEY",
      readOnly: true, broadSearch: true,
    });
    const matches = await connector.search({ name: term });
    const seen = new Set<string>();
    const output: DynamicMarketCandidate[] = [];
    for (const raw of matches.candidates) {
      const item = fromProvider(raw);
      if (!item) continue;
      const identity = [item.kind, item.symbol, item.mic, item.currency].join("|");
      if (seen.has(identity)) continue;
      seen.add(identity);
      output.push({
        ...item,
        token: createSelection({ ...item, expires: now() + TOKEN_TTL_MS }, key, sha),
      });
      if (output.length >= 20) break;
    }
    return output;
  }

  /**
   * Consumer-neutral Market Core read. The Investing server can call this
   * directly using a previously selected verified instrument identity.
   * No browser, portfolio writes, workers or scheduler are involved.
   */
  async function readInstrument(selected: Omit<Selected, "expires">): Promise<DynamicMarketQuote> {
    const { sha } = keyForPreview(input.env);
    let instrument: InstrumentIdentity;
    try {
      instrument = instrumentIdentity({
        kind: selected.kind, symbol: selected.symbol,
        mic: selected.mic, currency: selected.currency,
      });
    } catch { throw new MarketDataError("INVALID_REQUEST"); }
    const cacheKey = instrument.key;
    const timestamp = now();
    const existing = cache.get(cacheKey);
    if (existing && existing.until > timestamp) {
      return { ...existing.quote, source: "MEMORY_CACHE", providerCalls: 0 };
    }
    let pending = inflight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const series: DailySeries = await (input.fetchSeries ?? fetchPersonalPreviewDailySeries)({
          env: input.env, instrument, outputSize: 1, checkoutSha: sha,
          transport: input.transport,
          clock: input.clock,
          rights: { policyId: "preview-private-direct", display: true, retentionUntil: null },
        });
        const candle = series.candles.at(-1);
        if (!candle || series.provider !== "TWELVE_DATA" ||
            series.instrument.key !== instrument.key) {
          throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
        }
        const value: DynamicMarketQuote = {
          status: "AVAILABLE", symbol: selected.symbol, name: selected.name,
          mic: selected.mic, currency: selected.currency, kind: selected.kind,
          price: candle.close, marketDate: candle.marketDate,
          observedAt: series.observedAtUtc, provider: "TWELVE_DATA",
          interval: "1day", priceType: "DAILY_CLOSE",
          source: "PROVIDER", providerCalls: 1,
        };
        if (cache.size >= MAX_CACHE_SIZE) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, { quote: value, until: now() + QUOTE_TTL_MS });
        return value;
      })();
      inflight.set(cacheKey, pending);
      const operation = pending;
      void operation.finally(() => {
        if (inflight.get(cacheKey) === operation) inflight.delete(cacheKey);
      }).catch(() => {});
    }
    return await pending;
  }

  async function quoteToken(token: unknown): Promise<DynamicMarketQuote> {
    const { key, sha } = keyForPreview(input.env);
    const selected = readSelection(token, key, sha, now());
    return readInstrument(selected);
  }

  return { discover, quoteToken, readInstrument };
}

export function classifyDynamicMarketError(error: unknown): { status: number; error: string } {
  if (error instanceof MarketDataError) {
    if (error.code === "DISABLED") return { status: 423, error: "MARKET_CORE_DISABLED" };
    if (error.code === "RATE_LIMITED") return { status: 429, error: "RATE_LIMITED" };
    if (error.code === "INVALID_REQUEST" || error.code === "INVALID_INSTRUMENT") {
      return { status: 400, error: "INVALID_MARKET_REQUEST" };
    }
    if (error.code === "PROVIDER_REJECTED") return { status: 502, error: "PROVIDER_REJECTED" };
    return { status: 502, error: "PROVIDER_UNAVAILABLE" };
  }
  if (error instanceof CatalogConnectorError) {
    if (error.code === "RATE_LIMITED") return { status: 429, error: "RATE_LIMITED" };
    if (error.code === "INVALID_REQUEST") return { status: 400, error: "INVALID_MARKET_REQUEST" };
    if (error.code === "PROVIDER_REJECTED") return { status: 502, error: "PROVIDER_REJECTED" };
  }
  return { status: 503, error: "MARKET_CORE_UNAVAILABLE" };
}
