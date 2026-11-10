import { createHash } from "node:crypto";
import { instrumentIdentity, MarketDataError, record, resolveProviderAlias, validMarketDate, type AliasResolution, type InstrumentIdentity } from "./identity";
import { isR3E1RealCallReady, requirePreviewMarketProviderReady, requireR3E1RealCallReady } from "./gate";
import { validateEnvelope, type DataEnvelope } from "./contracts";

export type DailyCandle = Readonly<{
  marketDate: string; // Exchange-local trading DATE; NEVER convert to midnight UTC.
  open: string; high: string; low: string; close: string;
  volume: string | null; // Integer string; FX may have no volume.
}>;
export type DailySeries = Readonly<{
  instrument: InstrumentIdentity;
  provider: "TWELVE_DATA";
  interval: "1day";
  adjustment: "none";
  exchangeTimezone: string;
  observedAtUtc: string; // Ingestion timestamp, NOT exchange timestamp / quote freshness.
  latency: "NOT_VERIFIED";
  evidence: "PROVIDER_RESPONSE";
  candles: readonly DailyCandle[]; // Chronological ascending, contiguous calendar days NOT assumed.
  provenance: Readonly<{ provider: "TWELVE_DATA"; originalSourceId: string; requestId: null; sourceDocumentUri: null }>;
  envelope: DataEnvelope<readonly DailyCandle[]>;
}>;

type Env = Readonly<Record<string, string | undefined>>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Clock = () => Date;
export type ProviderUsageHeaders = Readonly<{ remaining: string | null; used: string | null }>;
const R3E1_INTERNAL = Symbol("r3e1-once");
const PERSONAL_PREVIEW_INTERNAL = Symbol("personal-dynamic-preview");
let r3e1CallConsumed = false;
function sanitizeCreditHeader(value: string | null): string | null {
  if (value === null || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= 1_000_000_000 ? String(n) : null;
}

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(s + "T00:00:00.000Z");
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s;
}

function validTimezone(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 70 || !/^[A-Za-z0-9_+\-/]+$/.test(s)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: s }); return true; }
  catch { return false; }
}

// Strict positive decimal in character form. Do not convert money/price to IEEE-754 floats.
function decimal(s: unknown): string {
  if (typeof s !== "string" || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(s)) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  return s;
}
function amount(s: string): bigint {
  const [whole, fraction = ""] = s.split(".");
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
}
function candle(value: unknown): DailyCandle {
  const x = record(value);
  if (!x || !validDate(x.datetime)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const open = decimal(x.open), high = decimal(x.high), low = decimal(x.low), close = decimal(x.close);
  const o = amount(open), h = amount(high), l = amount(low), c = amount(close);
  if (o <= 0n || c <= 0n || l <= 0n || h <= 0n || l > h || o < l || o > h || c < l || c > h) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  let volume: string | null = null;
  if (x.volume !== undefined && x.volume !== null) {
    if (typeof x.volume !== "string" || !/^(?:0|[1-9]\d{0,23})$/.test(x.volume)) {
      throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    }
    volume = x.volume;
  }
  return Object.freeze({ marketDate: x.datetime, open, high, low, close, volume });
}

function parseSeries(raw: unknown, instrument: InstrumentIdentity, observedAtUtc: string, providerReference: string): Omit<DailySeries, "envelope"> {
  const body = record(raw), meta = record(body?.meta), values = body?.values;
  const invalid = (field: "BODY" | "SYMBOL" | "INTERVAL" | "CURRENCY" | "TIMEZONE" | "TYPE") =>
    new MarketDataError("INVALID_PROVIDER_RESPONSE", null, null,
      instrument.kind === "FX" ? "FX_META_" + field : null);
  if (!body || body.status !== "ok" || !meta || !Array.isArray(values) || values.length < 1 || values.length > 1000) {
    throw invalid("BODY");
  }
  if (meta.symbol !== providerReference) throw invalid("SYMBOL");
  if (meta.interval !== "1day") throw invalid("INTERVAL");
  const forexPair = instrument.kind === "FX"
    ? /^([A-Z]{3})\/([A-Z]{3})$/.exec(providerReference)
    : null;
  // Twelve Data may describe FX using its base currency, its quote currency,
  // or no currency metadata. The exact verified EUR/USD-style provider symbol
  // establishes the quote denomination; never accept a third currency.
  const fxCurrencyValid = forexPair !== null &&
    instrument.currency === forexPair[2] &&
    (meta.currency === forexPair[1] || meta.currency === forexPair[2] ||
      meta.currency === null || meta.currency === undefined);
  if (instrument.kind === "FX" ? !fxCurrencyValid : meta.currency !== instrument.currency) {
    throw invalid("CURRENCY");
  }
  if (!validTimezone(meta.exchange_timezone)) throw invalid("TIMEZONE");
  const expectedType = instrument.kind === "EQUITY" ? "Common Stock" :
    instrument.kind === "ETF" ? "ETF" : "Physical Currency";
  if (meta.type !== expectedType) throw invalid("TYPE");
  if (instrument.mic !== null && meta.mic_code !== instrument.mic) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  const candles = values.map(candle);
  for (let i = 1; i < candles.length; i++) {
    // Twelve Data returns the newest first. Unordered/duplicated entries are not safe.
    if (candles[i - 1].marketDate <= candles[i].marketDate) {
      throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    }
  }
  return Object.freeze({
    provider: "TWELVE_DATA" as const, instrument, interval: "1day" as const,
    adjustment: "none" as const, exchangeTimezone: meta.exchange_timezone,
    observedAtUtc, latency: "NOT_VERIFIED" as const,
    evidence: "PROVIDER_RESPONSE" as const,
    candles: Object.freeze(candles.reverse()),
    provenance: { provider: "TWELVE_DATA" as const, originalSourceId: `time_series:${instrument.kind}:${instrument.mic ?? "FX"}:${providerReference}:${instrument.currency}:1day:none`, requestId: null, sourceDocumentUri: null },
  });
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const seconds = Number(raw);
  return seconds >= 0 && seconds <= 86_400 ? seconds : null;
}

/**
 * Strict fixed-host, server-only, one-symbol GET for daily OHLC; no public API endpoint.
 * Injectable HTTP for deterministic offline tests. Provider key never appears in errors/results.
 * NO retries: a durable, shared credit reservation is required before any scheduling (R3-B).
 */
export async function fetchDailySeries(input: Readonly<{
  env: Env;
  instrument: InstrumentIdentity;
  /** An exact, point-in-time resolved provider alias is REQUIRED for registry-owned IDs. */
  sourceAlias?: AliasResolution;
  asOf?: string;
  outputSize: number;
  /** Inclusive exchange-local dates for an explicit daily-history request. */
  startDate?: string;
  endDate?: string;
  transport?: Fetcher;
  clock?: Clock;
  onResponseHeaders?: (headers: ProviderUsageHeaders) => void;
  rights?: Readonly<{ policyId: string; display: boolean; retentionUntil: string | null }>;
  internalAuthorization?: symbol;
  checkoutSha?: string;
}>): Promise<DailySeries> {
  // Fail BEFORE constructing URL or calling transport when not authorized.
  const apikey = input.internalAuthorization === R3E1_INTERNAL
    ? requireR3E1ProviderReadyOnce(input.env, input.checkoutSha)
    : input.internalAuthorization === PERSONAL_PREVIEW_INTERNAL
      ? requireR3E1RealCallReady(input.env, input.checkoutSha ?? "")
      : requirePreviewMarketProviderReady(input.env);
  const hint = instrumentIdentity({
    kind: input.instrument?.kind, symbol: input.instrument?.symbol,
    mic: input.instrument?.mic, currency: input.instrument?.currency,
  });
  if (!Number.isSafeInteger(input.outputSize) || input.outputSize < 1 || input.outputSize > 1000) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  const hasRange = input.startDate !== undefined || input.endDate !== undefined;
  if (hasRange && (!input.startDate || !input.endDate ||
      !validDate(input.startDate) || !validDate(input.endDate) ||
      input.startDate > input.endDate ||
      (Date.parse(input.endDate + "T00:00:00Z") -
       Date.parse(input.startDate + "T00:00:00Z")) > 366 * 86400000)) {
    throw new MarketDataError("INVALID_REQUEST");
  }

  const instrument = input.instrument;
  const resolved = instrument.instrumentId !== null || instrument.listingId !== null;
  let providerReference = hint.symbol;
  if (resolved) {
    // The descriptive ticker key and the registry-owned key are DIFFERENT by design.
    // Never trust a caller-supplied registry ID without an EXACT provider alias.
    if (!instrument.instrumentId || !instrument.listingId ||
        instrument.key !== `instrument:${instrument.instrumentId}:listing:${instrument.listingId}` ||
        !input.sourceAlias || input.sourceAlias.status !== "EXACT" ||
        !input.asOf || !validMarketDate(input.asOf)) {
      throw new MarketDataError("INVALID_REQUEST");
    }
    const alias = input.sourceAlias.alias;
    if (!alias || !/^[A-Z0-9][A-Z0-9.\/-]{0,31}$/.test(alias.providerReference)) {
      throw new MarketDataError("INVALID_REQUEST");
    }
    const checked = resolveProviderAlias("TWELVE_DATA", alias.providerReference, input.asOf, [alias]);
    if (checked.status !== "EXACT" ||
        checked.instrumentId !== instrument.instrumentId ||
        checked.listingId !== instrument.listingId ||
        checked.instrumentId !== input.sourceAlias.instrumentId ||
        checked.listingId !== input.sourceAlias.listingId) {
      throw new MarketDataError("INVALID_REQUEST");
    }
    providerReference = alias.providerReference;
  } else if (instrument.instrumentId !== null || instrument.listingId !== null ||
             instrument.key !== hint.key || input.sourceAlias !== undefined || input.asOf !== undefined) {
    // Hints are deliberately non-canonical. Only used for isolated offline adapter tests.
    throw new MarketDataError("INVALID_REQUEST");
  }
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", providerReference);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(input.outputSize));
  url.searchParams.set("adjust", "none"); // Explicit to prevent implicit corporate-action rewrites.
  if (hasRange) {
    url.searchParams.set("start_date", input.startDate!);
    url.searchParams.set("end_date", input.endDate!);
  }
  if (instrument.mic) url.searchParams.set("mic_code", instrument.mic);

  let response: Response;
  try {
    response = await (input.transport ?? fetch)(url.toString(), {
      method: "GET", headers: { Accept: "application/json", Authorization: `apikey ${apikey}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    // Transport diagnostics are intentionally restricted to a finite enum:
    // never log request URLs, user inputs, credential headers or error messages.
    const kind = error instanceof Error && ["TypeError", "TimeoutError", "AbortError"].includes(error.name)
      ? error.name : "OTHER";
    const cause = error instanceof Error && error.cause && typeof error.cause === "object"
      ? (error.cause as { code?: unknown }).code : null;
    const allowedCodes = ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID"];
    const safeCause = typeof cause === "string" && allowedCodes.includes(cause) ? cause : "OTHER";
    const diagnostic = kind + ":" + safeCause;
    throw new MarketDataError("PROVIDER_UNAVAILABLE", null, null, diagnostic);
  }
  if (response.status === 429) throw new MarketDataError("RATE_LIMITED", retryAfter(response), 429);
  if (response.status === 401 || response.status === 403) throw new MarketDataError("PROVIDER_REJECTED", null, response.status);
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    throw new MarketDataError("INVALID_REQUEST", null, response.status);
  }
  if (response.status >= 500 && response.status <= 599) {
    throw new MarketDataError("PROVIDER_UNAVAILABLE", null, response.status);
  }
  if (!response.ok) throw new MarketDataError("PROVIDER_UNAVAILABLE", null, response.status);
  input.onResponseHeaders?.({
    // Twelve Data documents these names as the authoritative usage headers.
    // Keep the older aliases only as compatibility fallbacks for test doubles
    // and previously deployed transports; all values remain sanitized.
    remaining: sanitizeCreditHeader(response.headers.get("api-credits-left") ?? response.headers.get("x-ratelimit-remaining") ?? response.headers.get("x-credits-remaining")),
    used: sanitizeCreditHeader(response.headers.get("api-credits-used") ?? response.headers.get("x-ratelimit-used") ?? response.headers.get("x-credits-used")),
  });
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > 512_000) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  let body: unknown;
  try {
    const raw = await response.text();
    if (raw.length > 512_000) throw new Error("OVERSIZE");
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  const parsed = record(body);
  if (parsed?.status === "error") {
    // Provider may encode a 429/account error inside an HTTP 200 JSON body.
    if (parsed.code === 429 || parsed.code === "429") throw new MarketDataError("RATE_LIMITED");
    throw new MarketDataError("PROVIDER_REJECTED");
  }
  let now: Date;
  try { now = (input.clock ?? (() => new Date()))(); }
  catch { throw new MarketDataError("INVALID_REQUEST"); }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new MarketDataError("INVALID_REQUEST");
  const series = parseSeries(body, instrument, now.toISOString(), providerReference);
  if (series.candles.length > input.outputSize) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (hasRange && series.candles.some(c =>
    c.marketDate < input.startDate! || c.marketDate > input.endDate!)) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  if (resolved) {
    const alias = input.sourceAlias!.alias;
    if (series.candles.some(c => (alias.validFrom !== null && c.marketDate < alias.validFrom) ||
        (alias.validTo !== null && c.marketDate >= alias.validTo))) {
      throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    }
  }
  // A content-addressed observation revision changes whenever price/source/identity changes.
  // R3-B must assign durable database revisions; this is NOT a persistence sequence number.
  const revisionId = "sha256:" + createHash("sha256").update(JSON.stringify({
    key: series.instrument.key, provider: series.provider,
    source: series.provenance.originalSourceId, interval: series.interval,
    adjustment: series.adjustment, candles: series.candles,
  })).digest("hex");
  const envelope = validateEnvelope<readonly DailyCandle[]>({
    status: "AVAILABLE", value: series.candles, sourceRefs: [series.provenance],
    marketDate: series.candles[series.candles.length - 1]?.marketDate,
    firstSeenAt: series.observedAtUtc, ingestedAt: series.observedAtUtc, asKnownAt: series.observedAtUtc,
    revisionId, schemaVersion: "1.0",
    quality: { flags: ["LATENCY_NOT_VERIFIED"], coverage: "FULL" }, rights: input.rights ?? { policyId: "provider-contract-pending", display: false, retentionUntil: null },
  }, (value): value is readonly DailyCandle[] =>
    Array.isArray(value) && value.length > 0 &&
    value.every((c: unknown) => record(c) !== null &&
      validDate((c as DailyCandle).marketDate) &&
      typeof (c as DailyCandle).open === "string" &&
      typeof (c as DailyCandle).high === "string" &&
      typeof (c as DailyCandle).low === "string" &&
      typeof (c as DailyCandle).close === "string" &&
      ((c as DailyCandle).volume === null || typeof (c as DailyCandle).volume === "string")));
  return Object.freeze({ ...series, envelope });
}

function requireR3E1ProviderReadyOnce(env: Env, checkoutSha: string | undefined): string {
  if (!checkoutSha || !isR3E1RealCallReady(env, checkoutSha)) throw new MarketDataError("DISABLED");
  if (r3e1CallConsumed) throw new MarketDataError("INVALID_REQUEST");
  r3e1CallConsumed = true;
  return requireR3E1RealCallReady(env, checkoutSha);
}

export async function fetchDailySeriesR3E1Once(input: Readonly<Parameters<typeof fetchDailySeries>[0] & { checkoutSha: string }>): Promise<DailySeries> {
  return fetchDailySeries({ ...input, internalAuthorization: R3E1_INTERNAL });
}

/** Shared Market Core daily-price adapter. Requires an authenticated server caller and a pinned personal Preview. */
export async function fetchPersonalPreviewDailySeries(input: Readonly<Parameters<typeof fetchDailySeries>[0] & { checkoutSha: string }>): Promise<DailySeries> {
  return fetchDailySeries({ ...input, internalAuthorization: PERSONAL_PREVIEW_INTERNAL });
}
