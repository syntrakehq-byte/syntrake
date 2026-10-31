import { MarketDataError } from "./identity";
export type DataStatus = "AVAILABLE" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS";
export type SourceRef = Readonly<{ provider: string; originalSourceId: string; requestId: string | null; sourceDocumentUri: string | null }>;
export type DataEnvelope<T> = Readonly<{ status: DataStatus; value?: T; sourceRefs: readonly SourceRef[]; marketDate?: string; eventTime?: string; publishedAt?: string; firstSeenAt: string; ingestedAt: string; asKnownAt: string; revisionId: string; schemaVersion: string; quality: Readonly<{ flags: readonly string[]; coverage: "FULL" | "PARTIAL" | "NONE" }>; rights: Readonly<{ policyId: string; display: boolean; retentionUntil: string | null }>; diagnostics?: readonly string[] }>;
const statuses = new Set<DataStatus>(["AVAILABLE", "STALE", "PARTIAL", "UNAVAILABLE", "LICENSE_BLOCKED", "AMBIGUOUS"]);
function iso(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value)); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
export function validateEnvelope<T>(value: unknown, validateValue?: (value: unknown) => value is T): DataEnvelope<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const x = value as Record<string, unknown>, status = x.status;
  if (typeof status !== "string" || !statuses.has(status as DataStatus) || !iso(x.firstSeenAt) || !iso(x.ingestedAt) || !iso(x.asKnownAt) || new Date(String(x.firstSeenAt)) > new Date(String(x.ingestedAt)) || new Date(String(x.asKnownAt)) > new Date(String(x.ingestedAt)) || !nonEmpty(x.revisionId) || !/^\d+\.\d+$/.test(String(x.schemaVersion))) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (!Array.isArray(x.sourceRefs) || x.sourceRefs.length === 0 || x.sourceRefs.some(source => { const s = source as Record<string, unknown>; return typeof source !== "object" || source === null || !nonEmpty(s.provider) || !nonEmpty(s.originalSourceId) || (s.requestId !== null && !nonEmpty(s.requestId)) || (s.sourceDocumentUri !== null && !/^https:\/\//.test(String(s.sourceDocumentUri))); })) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const q = x.quality as Record<string, unknown>, r = x.rights as Record<string, unknown>;
  if (!q || !Array.isArray(q.flags) || q.flags.some(flag => !nonEmpty(flag)) || !["FULL", "PARTIAL", "NONE"].includes(String(q.coverage)) || !r || !nonEmpty(r.policyId) || typeof r.display !== "boolean" || (r.retentionUntil !== null && !iso(r.retentionUntil))) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (status === "AVAILABLE" && (x.value === undefined || (validateValue && !validateValue(x.value)))) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if ((status === "UNAVAILABLE" || status === "LICENSE_BLOCKED" || status === "AMBIGUOUS") && x.value !== undefined) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  if (status === "AVAILABLE" && q.coverage !== "FULL") throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  return value as DataEnvelope<T>;
}
