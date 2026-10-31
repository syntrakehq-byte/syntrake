/** Domain identity is provider-neutral. This module has no portfolio, ledger or network dependencies. */
export type InstrumentKind = "EQUITY" | "ETF" | "FX";
export type Provider = "TWELVE_DATA" | (string & {});
/** A descriptive market hint is NOT a registry-resolved identity. */
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
export type ProviderAlias = Readonly<{
  provider: Provider;
  providerReference: string;
  listingId: string | null;
  instrumentId: string | null;
  validFrom: string | null; // inclusive market date
  validTo: string | null;   // exclusive market date
}>;
export type AliasResolution = Readonly<{
  status: MatchStatus;
  alias: ProviderAlias;
  instrumentId: string | null;
  listingId: string | null;
}>;
export type Issuer = Readonly<{ issuerId: string; legalName: string }>;
export type RegistryInstrument = Readonly<{
  instrumentId: string; issuerId: string | null; kind: InstrumentKind; denominationCurrency: string;
}>;
export type RegistryListing = Readonly<{
  listingId: string; instrumentId: string; mic: string | null; tradingCurrency: string;
  ticker: string; validFrom: string; validTo: string | null;
}>;

export type MarketDataErrorCode =
  | "INVALID_INSTRUMENT" | "DISABLED" | "INVALID_CONFIG" | "RATE_LIMITED"
  | "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE"
  | "INVALID_REQUEST" | "BUDGET_UNAVAILABLE";

export class MarketDataError extends Error {
  readonly code: MarketDataErrorCode;
  readonly retryAfterSeconds: number | null;
  constructor(code: MarketDataErrorCode, retryAfterSeconds: number | null = null) {
    super(code); // No upstream URL, API key, provider body or private details.
    this.name = "MarketDataError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function validProviderReference(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(value);
}
export function validMarketDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** Validate a market description, without claiming it resolves to any owned registry entity. */
export function instrumentIdentity(value: unknown): InstrumentIdentity {
  if (!object(value) || Object.keys(value).some(k => !["kind", "symbol", "mic", "currency"].includes(k))) {
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

/** Resolve only across aliases that were VALID for the requested exchange-local date. */
export function resolveProviderAlias(
  provider: Provider, providerReference: string, asOf: string, candidates: readonly ProviderAlias[],
): AliasResolution {
  if (!validId(provider) || !validProviderReference(providerReference) || !validMarketDate(asOf) ||
      !Array.isArray(candidates) || !candidates.every(x =>
        object(x) && validId(x.provider) && validProviderReference(x.providerReference) &&
        (x.instrumentId === null || validId(x.instrumentId)) &&
        (x.listingId === null || validId(x.listingId)) &&
        (x.validFrom === null || validMarketDate(x.validFrom)) &&
        (x.validTo === null || validMarketDate(x.validTo)) &&
        (x.validFrom === null || x.validTo === null || x.validFrom < x.validTo))) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  const matches = candidates.filter(x => x.provider === provider && x.providerReference === providerReference &&
    (x.validFrom === null || x.validFrom <= asOf) &&
    (x.validTo === null || asOf < x.validTo));
  const unresolved: ProviderAlias = { provider, providerReference, listingId: null, instrumentId: null, validFrom: null, validTo: null };
  if (matches.length !== 1) {
    return { status: matches.length ? "AMBIGUOUS" : "UNRESOLVED", alias: unresolved, instrumentId: null, listingId: null };
  }
  const alias = matches[0];
  if (!alias.instrumentId || !alias.listingId) {
    return { status: "REVIEW_REQUIRED", alias, instrumentId: null, listingId: null };
  }
  return { status: "EXACT", alias, instrumentId: alias.instrumentId, listingId: alias.listingId };
}

/** Only registry-owned IDs can create a resolved identity; never derive them from a ticker. */
export function canonicalIdentity(input: Readonly<{
  instrument: RegistryInstrument; listing: RegistryListing;
}>): InstrumentIdentity {
  if (!input || !input.instrument || !input.listing ||
      !validId(input.instrument.instrumentId) ||
      (input.instrument.issuerId !== null && !validId(input.instrument.issuerId)) ||
      !/^[A-Z]{3}$/.test(input.instrument.denominationCurrency) ||
      !validId(input.listing.listingId) ||
      input.listing.instrumentId !== input.instrument.instrumentId ||
      !validMarketDate(input.listing.validFrom) ||
      (input.listing.validTo !== null && !validMarketDate(input.listing.validTo)) ||
      (input.listing.validTo !== null && input.listing.validTo <= input.listing.validFrom)) {
    throw new MarketDataError("INVALID_INSTRUMENT");
  }
  const hint = instrumentIdentity({
    kind: input.instrument.kind, symbol: input.listing.ticker,
    mic: input.listing.mic, currency: input.listing.tradingCurrency,
  });
  return Object.freeze({
    ...hint, instrumentId: input.instrument.instrumentId, listingId: input.listing.listingId,
    key: `instrument:${input.instrument.instrumentId}:listing:${input.listing.listingId}`,
  });
}

export function record(value: unknown): Record<string, unknown> | null { return object(value) ? value : null; }
