import { MarketDataError } from "./identity";

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
  if (x.firstSeenAt > x.ingestedAt || x.asKnownAt > x.ingestedAt) rejected();
  if (x.publishedAt !== undefined && (!utcTime(x.publishedAt) || x.publishedAt > x.ingestedAt)) rejected();
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
