/**
 * Stable, bounded PostgreSQL error classification for PREVIEW-ONLY,
 * server-Clerk-authenticated GET diagnostics. Never expose raw messages,
 * connection strings, tokens, actors, hosts, SQL or PG error.detail.
 */
export function connectionProbeFailureKind(error: unknown):
  "AUTH_REJECTED" | "TLS_REJECTED" | "NETWORK_FAILED" | "DB_PERMISSION_DENIED" |
  "DATABASE_REJECTED" | "INTERNAL_ERROR" {
  if (!error || typeof error !== "object") return "INTERNAL_ERROR";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (code === "28P01" || code === "28000") return "AUTH_REJECTED";
  if (new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "CERT_HAS_EXPIRED"]).has(code)) return "TLS_REJECTED";
  if (new Set(["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN",
    "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"]).has(code)) return "NETWORK_FAILED";
  if (code === "42501") return "DB_PERMISSION_DENIED";
  if (/^[0-9A-Z]{5}$/.test(code)) return "DATABASE_REJECTED";
  return "INTERNAL_ERROR";
}
