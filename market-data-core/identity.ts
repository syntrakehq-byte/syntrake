/** R3-A: provider identity is NEVER just a ticker. This domain has no portfolio/ledger dependencies. */
export type InstrumentKind = "EQUITY" | "ETF" | "FX";
export type Provider = "TWELVE_DATA" | (string & {});
export type InstrumentIdentity = Readonly<{
  kind: InstrumentKind;
  symbol: string;
  mic: string | null;
  currency: string;
  key: string;
  instrumentId: string | null;
  listingId: string | null;
}>;
export type MatchStatus = "EXACT" | "AMBIGUOUS" | "UNRESOLVED" | "REVIEW_REQUIRED";
export type ProviderAlias = Readonly<{ provider: Provider; providerReference: string; listingId: string | null; instrumentId: string | null; validFrom: string | null; validTo: string | null }>;
export type AliasResolution = Readonly<{ status: MatchStatus; alias: ProviderAlias; instrumentId: string | null; listingId: string | null }>;

export type MarketDataErrorCode =
  | "INVALID_INSTRUMENT" | "DISABLED" | "INVALID_CONFIG" | "RATE_LIMITED"
  | "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE"
  | "INVALID_REQUEST" | "BUDGET_UNAVAILABLE";

export class MarketDataError extends Error {
  readonly code: MarketDataErrorCode;
  readonly retryAfterSeconds: number | null;
  constructor(code: MarketDataErrorCode, retryAfterSeconds: number | null = null) {
    super(code); // No upstream URL, API key, raw provider body or private details.
    this.name = "MarketDataError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Use explicit MIC/currency for listed assets and explicit base/quote for FX; never silently guess exchanges. */
export function instrumentIdentity(value: unknown): InstrumentIdentity {
  if (!isPlainObject(value) || Object.keys(value).some(k => !["kind", "symbol", "mic", "currency"].includes(k))) {
    throw new MarketDataError("INVALID_INSTRUMENT");
  }
  const { kind, symbol, currency, mic } = value;
  if (kind !== "EQUITY" && kind !== "ETF" && kind !== "FX") throw new MarketDataError("INVALID_INSTRUMENT");
  if (typeof symbol !== "string" || typeof currency !== "string" ||
      symbol.length > 32 || !/^[A-Z]{3}$/.test(currency)) throw new MarketDataError("INVALID_INSTRUMENT");
  if (kind === "FX") {
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol) || symbol.slice(0, 3) === symbol.slice(4) ||
        currency !== symbol.slice(4) || (mic !== undefined && mic !== null)) {
      throw new MarketDataError("INVALID_INSTRUMENT");
    }
  } else {
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol) ||
        typeof mic !== "string" || !/^[A-Z0-9]{4}$/.test(mic)) {
      throw new MarketDataError("INVALID_INSTRUMENT");
    }
  }
  const actualMic = kind === "FX" ? null : (mic as string);
  return Object.freeze({
    kind, symbol, mic: actualMic, currency, instrumentId: null, listingId: null,
    key: [kind, actualMic ?? "FX", symbol, currency].join(":"),
  });
}

export function resolveProviderAlias(provider: Provider, providerReference: string, candidates: readonly ProviderAlias[]): AliasResolution {
  const matches = candidates.filter(x => x.provider === provider && x.providerReference === providerReference);
  if (matches.length !== 1) return { status: matches.length === 0 ? "UNRESOLVED" : "AMBIGUOUS", alias: matches[0] ?? { provider, providerReference, listingId: null, instrumentId: null, validFrom: null, validTo: null }, instrumentId: null, listingId: null };
  const alias = matches[0];
  if (!alias.listingId && !alias.instrumentId) return { status: "REVIEW_REQUIRED", alias, instrumentId: null, listingId: null };
  return { status: "EXACT", alias, instrumentId: alias.instrumentId, listingId: alias.listingId };
}

export function record(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}
