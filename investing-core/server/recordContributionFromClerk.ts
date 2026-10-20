import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";
import { parseUserReportedContributionJson } from "./contributionJsonContract";
import {
  recordUserReportedContribution,
  type ContributionWriterDB,
  type DeclaredContributionResult,
} from "./recordUserReportedContribution";

/**
 * INTERNAL server-only entry point. Financial authority comes from a
 * verified server-side Clerk session and a caller-provisioned minimally
 * privileged PostgreSQL connection (never a request-supplied URL).
 *
 * R0-A is a foundation candidate; the temporary PREVIEW pool and all
 * external HTTP probe routes have been removed after the isolated A/C
 * financial E2E rehearsal. No runtime database or broker authority is
 * provisioned or exposed by this module.
 */
export async function recordUserReportedContributionFromClerk(
  serverDatabase: ContributionWriterDB,
  untrustedInput: unknown,
): Promise<DeclaredContributionResult> {
  const verifiedActor = await requireVerifiedClerkActor();
  const canonicalInput = parseUserReportedContributionJson(untrustedInput);
  return recordUserReportedContribution(serverDatabase, verifiedActor, canonicalInput);
}
