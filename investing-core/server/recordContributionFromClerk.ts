import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";
import { parseUserReportedContributionJson } from "./contributionJsonContract";
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
