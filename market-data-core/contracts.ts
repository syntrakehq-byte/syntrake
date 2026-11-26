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
  market_date: string | Date;
  status: "AVAILABLE" | "LICENSE_BLOCKED";
  revision_id: string | null;
  close_value: string | null;
  as_known_at: string | Date | null;
  source_revision: string | null;
  quality_flags: readonly string[] | null;
}>;

function isoUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

/** PostgreSQL UUID accepts all 128-bit hexadecimal values, not only RFC4122 v1-v5. */
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}
function positiveDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}
/** pg decodes DATE as local midnight; UTC slicing shifts the day in positive timezones. */
function rowDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}
function rowUtc(value: unknown): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    return value.toISOString();
  }
  if (typeof value === "string") return value;
  throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
}
function validHistoricalRequest(value: unknown): value is HistoricalMarketDataRequest {
  return object(value) && uuid(value.listingId) && marketDay(value.startDate) &&
    marketDay(value.endDate) && value.startDate <= value.endDate && isoUtc(value.asOf) &&
    value.interval === "1day" && value.adjustment === "none";
}
function validFlags(flags: unknown): flags is string[] {
  return Array.isArray(flags) && flags.every(nonEmpty);
}

/** Converts untrusted SQL rows into a consumer-neutral, fail-closed historical result. */
export function historicalRowsToResult(request: HistoricalMarketDataRequest, rows: readonly unknown[]): HistoricalMarketDataResult {
  if (!validHistoricalRequest(request) || !Array.isArray(rows) || !rows.every(object)) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  if (rows.length === 0) return createHistoricalMarketDataResult({
    request, status: "UNAVAILABLE", instrumentId: null, listingId: request.listingId,
    providerId: null, rightsPolicyId: null, currency: null,
    interval: request.interval, adjustment: request.adjustment, points: [],
  });

  const typed = rows as unknown as readonly HistoricalMarketDataRow[];
  const first = typed[0];
  if (!uuid(first.listing_id) || !uuid(first.instrument_id) || !uuid(first.provider_id) ||
      !uuid(first.rights_policy_id) || first.listing_id !== request.listingId ||
      first.bar_interval !== request.interval || first.adjustment !== request.adjustment ||
      !/^[A-Z]{3}$/.test(first.currency)) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }

  const cutoff = Date.parse(request.asOf);
  const seenDates = new Set<string>();
  const points = typed.map(row => {
    const marketDate = rowDate(row.market_date);
    const asKnownAt = rowUtc(row.as_known_at);
    if (!uuid(row.listing_id) || !uuid(row.instrument_id) || !uuid(row.provider_id) ||
        !uuid(row.rights_policy_id) || row.listing_id !== first.listing_id ||
        row.instrument_id !== first.instrument_id || row.provider_id !== first.provider_id ||
        row.rights_policy_id !== first.rights_policy_id || row.currency !== first.currency ||
        row.bar_interval !== request.interval || row.adjustment !== request.adjustment ||
        (row.status !== "AVAILABLE" && row.status !== "LICENSE_BLOCKED") ||
        !marketDay(marketDate) || marketDate < request.startDate ||
        marketDate > request.endDate || marketDate > request.asOf.slice(0, 10) ||
        seenDates.has(marketDate) || !validFlags(row.quality_flags) ||
        (asKnownAt !== null && (!isoUtc(asKnownAt) || Date.parse(asKnownAt) > cutoff))) {
      throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    }
    seenDates.add(marketDate);
    if (row.status === "AVAILABLE") {
      if (!uuid(row.revision_id) || !positiveDecimal(row.close_value) ||
          asKnownAt === null || typeof row.source_revision !== "string" ||
          !/^[a-f0-9]{64}$/.test(row.source_revision)) {
        throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
      }
    } else if (row.revision_id !== null || row.close_value !== null ||
               asKnownAt !== null || row.source_revision !== null ||
               row.quality_flags.length !== 0) {
      throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    }
    return {
      marketDate, close: row.close_value, revisionId: row.revision_id,
      asKnownAt, sourceRevision: row.source_revision, qualityFlags: row.quality_flags,
    };
  });

  const blocked = points.filter(point => point.close === null).length;
  const status = blocked === points.length ? "LICENSE_BLOCKED" :
    blocked > 0 ? "PARTIAL" : "AVAILABLE";
  return createHistoricalMarketDataResult({
    request, status, instrumentId: first.instrument_id, listingId: first.listing_id,
    providerId: first.provider_id, rightsPolicyId: first.rights_policy_id,
    currency: first.currency, interval: request.interval, adjustment: request.adjustment, points,
  });
}

export function createHistoricalMarketDataResult(input: HistoricalMarketDataResult): HistoricalMarketDataResult {
  if (!object(input) || !validHistoricalRequest(input.request) ||
      input.listingId !== input.request.listingId ||
      input.interval !== input.request.interval ||
      input.adjustment !== input.request.adjustment || !Array.isArray(input.points) ||
      !["AVAILABLE", "PARTIAL", "LICENSE_BLOCKED", "UNAVAILABLE"].includes(input.status)) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  if (input.status === "UNAVAILABLE") {
    if (input.points.length !== 0 || input.instrumentId !== null ||
        input.providerId !== null || input.rightsPolicyId !== null ||
        input.currency !== null) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  } else if (!uuid(input.instrumentId) || !uuid(input.providerId) ||
             !uuid(input.rightsPolicyId) || typeof input.currency !== "string" ||
             !/^[A-Z]{3}$/.test(input.currency) || input.points.length === 0) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }

  const cutoff = Date.parse(input.request.asOf);
  let available = 0;
  let blocked = 0;
  const dates = new Set<string>();
  for (const point of input.points) {
    if (!object(point) || !marketDay(point.marketDate) ||
        point.marketDate < input.request.startDate ||
        point.marketDate > input.request.endDate ||
        point.marketDate > input.request.asOf.slice(0, 10) ||
        dates.has(point.marketDate) || !validFlags(point.qualityFlags) ||
        (point.asKnownAt !== null &&
          (!isoUtc(point.asKnownAt) || Date.parse(point.asKnownAt) > cutoff))) {
      throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    }
    dates.add(point.marketDate);
    if (point.close === null) {
      blocked++;
      if (point.revisionId !== null || point.asKnownAt !== null ||
          point.sourceRevision !== null || point.qualityFlags.length !== 0) {
        throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
      }
    } else {
      available++;
      if (!positiveDecimal(point.close) || !uuid(point.revisionId) ||
          !isoUtc(point.asKnownAt) || typeof point.sourceRevision !== "string" ||
          !/^[a-f0-9]{64}$/.test(point.sourceRevision)) {
        throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
      }
    }
  }
  if ((input.status === "AVAILABLE" && (available === 0 || blocked !== 0)) ||
      (input.status === "LICENSE_BLOCKED" && (blocked === 0 || available !== 0)) ||
      (input.status === "PARTIAL" && (blocked === 0 || available === 0))) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  return Object.freeze({
    ...input,
    points: Object.freeze(input.points.map(point =>
      Object.freeze({ ...point, qualityFlags: Object.freeze([...point.qualityFlags]) }))),
  });
}

export function readMarketDataForConsumer(
  result: MarketDataResult,
  requirement: Readonly<{ rightsPolicyId: string; requiresDisplay: boolean; interval?: "1day" | "1hour" | "1min" }>,
  now: Date = new Date(),
): MarketDataResult | null {
  const until = result.rights.retentionUntil;
  // License expiry applies equally to private Investing/Trading consumers,
  // not only the HTTP display route. Invalid clocks and retention fail closed.
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()) ||
      (until !== null && (Number.isNaN(Date.parse(until)) || Date.parse(until) <= now.valueOf())) ||
      result.rights.policyId !== requirement.rightsPolicyId ||
      (requirement.requiresDisplay && !result.rights.display) ||
      (requirement.interval !== undefined && result.interval !== requirement.interval)) return null;
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
