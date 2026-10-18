import { Buffer } from "node:buffer";

/**
 * Rehearsal-only inspection of the JWT CLAIMS sent by Clerk's server auth().
 * Decoding is NOT verification. Never use this output for authorization:
 * Supabase independently verifies the JWT cryptographically and enforces RLS.
 *
 * No actor IDs, session IDs, tokens, arbitrary claim values, or error details
 * are returned to the caller, persisted, or logged.
 */
const EXPECTED_CLERK_DEV_ISSUER = "https://useful-flea-8054.clerk.accounts.dev";

export type RehearsalJwtIndicators = Readonly<{
  issuerMatchesPreview: boolean;
  roleIsAuthenticated: boolean;
}>;

const DENY: RehearsalJwtIndicators = Object.freeze({
  issuerMatchesPreview: false,
  roleIsAuthenticated: false,
});

export function inspectRehearsalJwtClaims(token: string | null): RehearsalJwtIndicators {
  if (!token || token.length > 8192) return DENY;
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)) ||
    parts[1].length > 8192
  ) return DENY;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return DENY;
    const claims = decoded as Record<string, unknown>;
    return {
      issuerMatchesPreview: claims.iss === EXPECTED_CLERK_DEV_ISSUER,
      roleIsAuthenticated: claims.role === "authenticated",
    };
  } catch {
    return DENY;
  }
}

