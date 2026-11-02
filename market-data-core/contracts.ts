import { MarketDataError } from "./identity";
import type { InstrumentIdentity } from "./identity";

/** Consumer-neutral market result. Consumer quantity/valuation is deliberately absent. */
export type MarketDataResult = Readonly<{
  instrument: InstrumentIdentity;
  listingRef: string | null;
  sourceRefs: readonly SourceRef[];
  revisionId: string;
  price: string;
  currency: string;
  marketDate: string;
  asOf: string;
  quality: Readonly<{ coverage: "FULL" | "PARTIAL" | "NONE"; freshness: "KNOWN" | "UNKNOWN" }>;
  rights: Readonly<{ policyId: string; display: boolean; retentionUntil: string | null }>;
  interval: "1day";
  adjustment: "none";
}>;

/** Consumer-neutral historical request. The market interval and PIT cutoff are independent. */
export type HistoricalMarketDataRequest = Readonly<{
  listingId: string;
  startDate: string;
  endDate: string;
  asOf: string;
  interval: "1day";
  adjustment: "none";
}>;

export type HistoricalMarketDataPoint = Readonly<{
  marketDate: string;
  close: string | null;
  revisionId: string | null;
  asKnownAt: string | null;
  sourceRevision: string | null;
  qualityFlags: readonly string[];
}>;

export type HistoricalMarketDataResult = Readonly<{
  request: HistoricalMarketDataRequest;
  status: "AVAILABLE" | "PARTIAL" | "LICENSE_BLOCKED" | "UNAVAILABLE";
  instrumentId: string | null;
  listingId: string;
  providerId: string | null;
  rightsPolicyId: string | null;
  currency: string | null;
  interval: "1day";
  adjustment: "none";
  points: readonly HistoricalMarketDataPoint[];
}>;

export type HistoricalMarketDataRow = Readonly<{
  listing_id: string;
  instrument_id: string;
  provider_id: string;
  rights_policy_id: string;
  currency: string;
  bar_interval: string;
  adjustment: string;
  market_date: string;
  status: "AVAILABLE" | "LICENSE_BLOCKED";
  revision_id: string | null;
  close_value: string | null;
  as_known_at: string | null;
  source_revision: string | null;
  quality_flags: readonly string[] | null;
}>;

function isoUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Converts rows returned by read_market_history; SQL rows are untrusted input at this boundary. */
export function historicalRowsToResult(request: HistoricalMarketDataRequest, rows: readonly unknown[]): HistoricalMarketDataResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(request.endDate) || request.startDate > request.endDate || !isoUtc(request.asOf)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (rows.length === 0) return createHistoricalMarketDataResult({ request, status: "UNAVAILABLE", instrumentId: null, listingId: request.listingId, providerId: null, rightsPolicyId: null, currency: null, interval: request.interval, adjustment: request.adjustment, points: [] });
  const typed = rows as readonly HistoricalMarketDataRow[];
  const first = typed[0];
  if (!first || first.listing_id !== request.listingId || first.bar_interval !== request.interval || first.adjustment !== request.adjustment || !/^[A-Z]{3}$/.test(first.currency)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const providers = new Set(typed.map(row => row.provider_id));
  const policies = new Set(typed.map(row => row.rights_policy_id));
  const currencies = new Set(typed.map(row => row.currency));
  if (providers.size !== 1 || policies.size !== 1 || currencies.size !== 1 || typed.some(row => row.listing_id !== first.listing_id || row.instrument_id !== first.instrument_id || row.bar_interval !== request.interval || row.adjustment !== request.adjustment)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const cutoff = Date.parse(request.asOf);
  const points = typed.map(row => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.market_date) || row.market_date < request.startDate || row.market_date > request.endDate || row.market_date > request.asOf.slice(0, 10) || (row.as_known_at !== null && (!isoUtc(row.as_known_at) || Date.parse(row.as_known_at) > cutoff)) || (row.source_revision !== null && !/^[a-f0-9]{64}$/.test(row.source_revision)) || !Array.isArray(row.quality_flags ?? [])) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    if (row.status === "AVAILABLE" && (row.close_value === null || row.revision_id === null)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    if (row.status === "LICENSE_BLOCKED" && row.close_value !== null) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    return { marketDate: row.market_date, close: row.close_value, revisionId: row.revision_id, asKnownAt: row.as_known_at, sourceRevision: row.source_revision, qualityFlags: row.quality_flags ?? [] };
  });
  const blocked = points.filter(point => point.close === null).length;
  const status = blocked === points.length ? "LICENSE_BLOCKED" : blocked > 0 ? "PARTIAL" : "AVAILABLE";
  return createHistoricalMarketDataResult({ request, status, instrumentId: first.instrument_id, listingId: first.listing_id, providerId: first.provider_id, rightsPolicyId: first.rights_policy_id, currency: first.currency, interval: request.interval, adjustment: request.adjustment, points });
}

export function createHistoricalMarketDataResult(input: HistoricalMarketDataResult): HistoricalMarketDataResult {
  if (!/^[0-9a-f-]{36}$/.test(input.listingId) || input.request.listingId !== input.listingId) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.request.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.request.endDate) || input.request.startDate > input.request.endDate) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (!isoUtc(input.request.asOf) || input.interval !== input.request.interval || input.adjustment !== input.request.adjustment) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const cutoff = Date.parse(input.request.asOf);
  if (input.status === "AVAILABLE" && input.points.length === 0 || input.status === "LICENSE_BLOCKED" && input.points.some(point => point.close !== null) || input.status === "UNAVAILABLE" && input.points.length !== 0) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  for (const point of input.points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.marketDate) || point.marketDate < input.request.startDate || point.marketDate > input.request.endDate || point.marketDate > input.request.asOf.slice(0, 10) || (point.asKnownAt !== null && (!isoUtc(point.asKnownAt) || Date.parse(point.asKnownAt) > cutoff))) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  return Object.freeze({ ...input, points: Object.freeze(input.points.map(point => Object.freeze({ ...point, qualityFlags: Object.freeze([...point.qualityFlags]) }))) });
}

export function readMarketDataForConsumer(
  result: MarketDataResult,
  requirement: Readonly<{ rightsPolicyId: string; requiresDisplay: boolean; interval?: "1day" | "1hour" | "1min" }>,
): MarketDataResult | null {
  if (result.rights.policyId !== requirement.rightsPolicyId || (requirement.requiresDisplay && !result.rights.display) || (requirement.interval !== undefined && result.interval !== requirement.interval)) return null;
  return result;
}

export type DataStatus = "AVAILABLE" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS";
export type SourceRef = Readonly<{
  provider: string;
  originalSourceId: string;
  requestId: string | null;
  sourceDocumentUri: string | null;
}>;
type EnvelopeCommon = Readonly<{
  sourceRefs: readonly SourceRef[];
  marketDate?: string;
  eventTime?: string;
  publishedAt?: string;
  firstSeenAt: string;
  ingestedAt: string;
  asKnownAt: string;
  revisionId: string;
  schemaVersion: string;
  quality: Readonly<{ flags: readonly string[]; coverage: "FULL" | "PARTIAL" | "NONE" }>;
  rights: Readonly<{ policyId: string; display: boolean; retentionUntil: string | null }>;
  diagnostics?: readonly string[];
}>;

/** Value is forbidden in blocked/missing/ambiguous states. Consumer payload validation is MANDATORY. */
export type DataEnvelope<T> = EnvelopeCommon & Readonly<
  | { status: "AVAILABLE"; value: T }
  | { status: "STALE" | "PARTIAL"; value: T }
  | { status: "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS"; value?: never }
>;

function rejected(): never { throw new MarketDataError("INVALID_PROVIDER_RESPONSE"); }
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !/[\x00-\x1f]/.test(value);
}
/** Only UTC RFC3339 timestamps, not arbitrary strings accepted by Date.parse. */
function utcTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
function marketDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function sourceRef(value: unknown): value is SourceRef {
  if (!object(value) || !nonEmpty(value.provider) || !nonEmpty(value.originalSourceId)) return false;
  if (value.requestId !== null && !nonEmpty(value.requestId)) return false;
  if (value.sourceDocumentUri === null) return true;
  if (typeof value.sourceDocumentUri !== "string" || value.sourceDocumentUri.length > 2048) return false;
  try {
    const uri = new URL(value.sourceDocumentUri);
    return uri.protocol === "https:" && !!uri.hostname && !uri.username && !uri.password;
  } catch { return false; }
}

/**
 * Validate a boundary object at runtime; a TypeScript generic alone NEVER validates T.
 * Callers must provide a payload validator even for unavailability states.
 * Never assert a value is valid merely because it exists.
 */
export function validateEnvelope<T>(
  value: unknown,
  validateValue: (payload: unknown) => payload is T,
): DataEnvelope<T> {
  if (typeof validateValue !== "function" || !object(value)) rejected();
  const x = value;
  if (!["AVAILABLE", "STALE", "PARTIAL", "UNAVAILABLE", "LICENSE_BLOCKED", "AMBIGUOUS"].includes(String(x.status))) rejected();
  if (!utcTime(x.firstSeenAt) || !utcTime(x.ingestedAt) || !utcTime(x.asKnownAt)) rejected();
  if (Date.parse(x.firstSeenAt as string) > Date.parse(x.ingestedAt as string) || Date.parse(x.asKnownAt as string) > Date.parse(x.ingestedAt as string)) rejected();
  if (x.publishedAt !== undefined && (!utcTime(x.publishedAt) || Date.parse(x.publishedAt) > Date.parse(x.ingestedAt as string))) rejected();
  if (x.eventTime !== undefined && !utcTime(x.eventTime)) rejected();
  if (x.marketDate !== undefined && !marketDay(x.marketDate)) rejected();
  if (!nonEmpty(x.revisionId) || typeof x.schemaVersion !== "string" || !/^\d+\.\d+$/.test(x.schemaVersion)) rejected();
  if (!Array.isArray(x.sourceRefs) || x.sourceRefs.length === 0 || !x.sourceRefs.every(sourceRef)) rejected();
  if (!object(x.quality) || !Array.isArray(x.quality.flags) || !x.quality.flags.every(nonEmpty) ||
      !["FULL", "PARTIAL", "NONE"].includes(String(x.quality.coverage))) rejected();
  if (!object(x.rights) || !nonEmpty(x.rights.policyId) || typeof x.rights.display !== "boolean" ||
      (x.rights.retentionUntil !== null && !utcTime(x.rights.retentionUntil))) rejected();
  if (x.diagnostics !== undefined && (!Array.isArray(x.diagnostics) || !x.diagnostics.every(nonEmpty))) rejected();
  if (x.status === "AVAILABLE" && x.quality.coverage !== "FULL") rejected();
  if (x.status === "PARTIAL" && x.quality.coverage !== "PARTIAL") rejected();
  if (x.status === "UNAVAILABLE" && x.quality.coverage !== "NONE") rejected();

  if (x.status === "AVAILABLE" || x.status === "STALE" || x.status === "PARTIAL") {
    if (!("value" in x) || !validateValue(x.value)) rejected();
  } else if ("value" in x) {
    rejected();
  }
  return x as DataEnvelope<T>;
}
