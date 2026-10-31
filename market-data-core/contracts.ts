import { MarketDataError } from "./identity";
export type DataStatus = "AVAILABLE" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS";
export type DataEnvelope<T> = Readonly<{ status: DataStatus; value?: T; sourceRefs: readonly Readonly<{ provider: string; originalSourceId: string; requestId: string | null; sourceDocumentUri: string | null }>[]; marketDate?: string; eventTime?: string; publishedAt?: string; firstSeenAt: string; ingestedAt: string; asKnownAt: string; revisionId: string; schemaVersion: string; quality: Readonly<{ flags: readonly string[]; coverage: "FULL" | "PARTIAL" | "NONE" }>; rights: Readonly<{ policyId: string; display: boolean; retentionUntil: string | null }>; diagnostics?: readonly string[] }>;
export function validateEnvelope<T>(value: unknown): DataEnvelope<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  const x = value as Record<string, unknown>;
  if (!["AVAILABLE", "STALE", "PARTIAL", "UNAVAILABLE", "LICENSE_BLOCKED", "AMBIGUOUS"].includes(String(x.status)) || typeof x.firstSeenAt !== "string" || typeof x.ingestedAt !== "string" || typeof x.asKnownAt !== "string" || typeof x.revisionId !== "string" || typeof x.schemaVersion !== "string" || !Array.isArray(x.sourceRefs) || !x.quality || !x.rights) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  return value as DataEnvelope<T>;
}
