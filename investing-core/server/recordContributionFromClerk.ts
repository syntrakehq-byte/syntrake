import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";
import { parseUserReportedContributionJson } from "./contributionJsonContract";
import { createRehearsalWriterPool } from "./privateWriterPool";
import {
  recordUserReportedContribution,
  type ContributionWriterDB,
  type DeclaredContributionResult,
} from "./recordUserReportedContribution";

/**
 * Authorized server-only entrypoint. Caller controls untrusted declaration
 * payload but NEVER supplies userId, sessionId, Clerk token or an Actor.
 * Auth context is derived from Clerk server auth() on every invocation.
 *
 * The passed database is a PRIVATE server-owned, separately provisioned
 * minimal-login PG pool. The lower-level writer further insists on SET LOCAL
 * ROLE investing_contribution_writer and scopes all RLS checks to this Actor.
 *
 * Not an HTTP route. No connection strings or financial authority are
 * made available to browsers. USER_REPORTED is not confirmed broker cash.
 */
export async function recordUserReportedContributionFromClerk(
  serverDatabase: ContributionWriterDB,
  untrustedInput: unknown,
): Promise<DeclaredContributionResult> {
  const verifiedActor = await requireVerifiedClerkActor();
  // Validate untrusted JSON after Clerk verification, before opening SQL.
  const canonicalInput = parseUserReportedContributionJson(untrustedInput);
  return recordUserReportedContribution(serverDatabase, verifiedActor, canonicalInput);
}

/**
 * Not a Next.js route. A future protected Node-only caller can use this
 * rehearsal-only composition without accepting pool URLs, Clerk identity or
 * database roles from a request. There is deliberately NO global pool.
 *
 * The database pool is not created until AFTER Clerk authentication and strict
 * JSON validation succeed. Every invocation closes its own pool; a bounded
 * lifecycle manager is required before enabling any HTTP endpoint.
 *
 * This path fails closed unless an operator has explicitly enabled a pinned
 * rehearsal-only private PostgreSQL configuration and granted the exact SQL
 * NOLOGIN capability to the dedicated private LOGIN.
 */
export async function recordUserReportedContributionInRehearsal(
  untrustedInput: unknown,
): Promise<DeclaredContributionResult> {
  const verifiedActor = await requireVerifiedClerkActor();
  const canonicalInput = parseUserReportedContributionJson(untrustedInput);
  const privatePool = createRehearsalWriterPool();
  try {
    return await recordUserReportedContribution(privatePool, verifiedActor, canonicalInput);
  } finally {
    await privatePool.end();
  }
}
