import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { actorSchema, contributionSchema, type Actor } from "../contracts";

/**
 * Records USER_REPORTED bookkeeping evidence. No broker transfer, cash
 * confirmation or live trading. Caller MUST obtain Actor from a verified
 * server-side Clerk session; never from the request body.
 */
export type DeclaredContributionResult = Readonly<{
  transactionId: string;
  evidenceStatus: "USER_REPORTED";
  action: "DECLARED_CASH_CONTRIBUTION";
  currency: string;
  amountMinor: string;
  externalReference: string;
}>;

export type ContributionWriterDB = Pick<Pool, "connect">;

export class ContributionBlocked extends Error {
  constructor(public readonly code: "ACCOUNT_NOT_AUTHORIZED" | "ACCOUNT_NOT_READY" | "IDEMPOTENCY_CONFLICT" | "EXTERNAL_REFERENCE_CONFLICT" | "INCOMPLETE_RECORD") {
    super(code);
    this.name = "ContributionBlocked";
  }
}

function canonicalRequestHash(userId: string, input: {
  accountId: string;
  currency: string;
  amountMinor: bigint;
  externalReference: string;
}): string {
  const normalized = JSON.stringify({
    operation: "syntrake.user_reported_contribution.v1",
    userId,
    accountId: input.accountId,
    currency: input.currency,
    amountMinor: input.amountMinor.toString(),
    externalReference: input.externalReference,
  });
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Atomic ownership check, idempotency reservation, balanced journal, replay
 * result. Transaction-scoped advisory lock serializes cooperating operations
 * per account. The complementary owner-membership guard acquires the
 * same advisory lock at COMMIT when privileged membership/owner state changes.
 * This avoids UPDATE privilege on investment_accounts for the writer.
 * Requires an internal, privately configured, narrowly privileged PG pool.
 * This does NOT grant authority: server-verified Clerk actor + ownership
 * checks remain mandatory; untrusted DB connections cannot invoke the writer.
 * This function is not currently exposed through an HTTP route.
 */
export async function recordUserReportedContribution(
  database: ContributionWriterDB,
  authenticatedActor: Actor,
  untrustedInput: unknown,
): Promise<DeclaredContributionResult> {
  const actor = actorSchema.parse(authenticatedActor);
  const input = contributionSchema.parse(untrustedInput);
  const hash = canonicalRequestHash(actor.userId, input);
  const client: PoolClient = await database.connect();
  let inTransaction = false;
  let broken = false;
  try {
    await client.query("begin");
    inTransaction = true;

    // Hash collisions cause only unnecessary serialization, never cross-account
    // authorization; advisory locks are NOT the basis of financial authority.
    // Advisory locks serialize concurrent cooperative writers without table DML.
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::text, 20261018))",
      [input.accountId],
    );

    const authorized = await client.query<{ id: string }>(
      "select a.id from investing.investment_accounts a join investing.account_memberships m on m.investment_account_id=a.id where a.id=$1 and a.owner_user_id=$2 and m.user_id=$2 and m.role='owner'",
      [input.accountId, actor.userId],
    );
    if (authorized.rowCount !== 1) throw new ContributionBlocked("ACCOUNT_NOT_AUTHORIZED");

    const prior = await client.query<{ request_hash: string; result: DeclaredContributionResult | null }>(
      "select request_hash,result from investing.operation_idempotency_keys where investment_account_id=$1 and user_id=$2 and key=$3 for update",
      [input.accountId, actor.userId, input.idempotencyKey],
    );
    if (prior.rowCount === 1) {
      const existing = prior.rows[0];
      if (existing.request_hash !== hash) throw new ContributionBlocked("IDEMPOTENCY_CONFLICT");
      if (!existing.result || existing.result.evidenceStatus !== "USER_REPORTED")
        throw new ContributionBlocked("INCOMPLETE_RECORD");
      await client.query("commit");
      inTransaction = false;
      return existing.result;
    }

    const ledgers = await client.query<{ id: string; code: string }>(
      "select id,code from investing.ledger_accounts where investment_account_id=$1 and currency=$2 and code in ('cash','external_clearing')",
      [input.accountId, input.currency],
    );
    const cash = ledgers.rows.find((r) => r.code === "cash")?.id;
    const clearing = ledgers.rows.find((r) => r.code === "external_clearing")?.id;
    if (ledgers.rowCount !== 2 || !cash || !clearing || cash === clearing)
      throw new ContributionBlocked("ACCOUNT_NOT_READY");

    await client.query(
      "insert into investing.operation_idempotency_keys(investment_account_id,user_id,key,request_hash) values ($1,$2,$3,$4)",
      [input.accountId, actor.userId, input.idempotencyKey, hash],
    );

    const provenance = {
      kind: "USER_REPORTED",
      event: "DECLARED_CASH_CONTRIBUTION",
      externalReference: input.externalReference,
      source: "user_entry",
      verifiedByBroker: false,
      actorId: actor.userId,
      sessionFingerprint: createHash("sha256").update(actor.sessionId, "utf8").digest("hex"),
    };
    let journal: { id: string };
    try {
      const created = await client.query<{ id: string }>(
        "insert into investing.ledger_transactions(investment_account_id,idempotency_user_id,idempotency_key,provenance) values ($1,$2,$3,$4::jsonb) returning id",
        [input.accountId, actor.userId, input.idempotencyKey, JSON.stringify(provenance)],
      );
      journal = created.rows[0];
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new ContributionBlocked("EXTERNAL_REFERENCE_CONFLICT");
      throw error;
    }

    await client.query(
      "insert into investing.ledger_entries(transaction_id,investment_account_id,ledger_account_id,direction,currency,amount_minor) values ($1,$2,$3,'debit',$5,$6),($1,$2,$4,'credit',$5,$6)",
      [journal.id, input.accountId, cash, clearing, input.currency, input.amountMinor.toString()],
    );
    await client.query("update investing.ledger_transactions set status='posted' where id=$1", [journal.id]);

    const result: DeclaredContributionResult = Object.freeze({
      transactionId: journal.id,
      evidenceStatus: "USER_REPORTED",
      action: "DECLARED_CASH_CONTRIBUTION",
      currency: input.currency,
      amountMinor: input.amountMinor.toString(),
      externalReference: input.externalReference,
    });
    await client.query(
      "update investing.operation_idempotency_keys set result=$4::jsonb where investment_account_id=$1 and user_id=$2 and key=$3",
      [input.accountId, actor.userId, input.idempotencyKey, JSON.stringify(result)],
    );
    await client.query("commit");
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("rollback");
      } catch {
        broken = true;
      }
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
