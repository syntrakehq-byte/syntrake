import { z } from "zod";
import { contributionSchema, type Contribution } from "../contracts";

/**
 * Future HTTP JSON boundary only. Not an endpoint and not an authorization
 * mechanism. JSON does NOT represent bigint exactly, so all minor units must
 * arrive as a canonical base-10 positive INTEGER STRING.
 *
 * Reject client-supplied actor / userId / sessionId / role rather than
 * silently ignoring a request attempting to claim database authority.
 * The only allowed actor is from the server's verified Clerk session.
 */
const contributionJsonSchema = z.strictObject({
  accountId: contributionSchema.shape.accountId,
  idempotencyKey: contributionSchema.shape.idempotencyKey,
  currency: contributionSchema.shape.currency,
  amountMinor: z.string().regex(
    /^[1-9][0-9]{0,37}$/,
    "amountMinor must be a positive canonical decimal integer string",
  ).transform((value) => BigInt(value)),
  externalReference: contributionSchema.shape.externalReference,
});

export function parseUserReportedContributionJson(untrusted: unknown): Contribution {
  const parsed = contributionJsonSchema.parse(untrusted);
  return contributionSchema.parse(parsed);
}
