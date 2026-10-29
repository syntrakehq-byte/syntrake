import type { Pool, PoolClient } from "pg";
import type {
  LifecycleTransition, OnboardingRevision, OwnedAccount, PortfolioRecord,
  PortfolioRepository, RevisionLifecycle, Transaction,
} from "../r2/onboardingPortfolio";

type DB = Pick<Pool, "connect">;

/**
 * Server-only repository for the canonical BL2/BL3 contract. R2-C2 remains
 * responsible for creating the structural portfolio; this adapter only reads
 * that portfolio and persists revisions/projections/events atomically.
 */
export function createPostgresPortfolioRepository(database: DB, actorUserId: string): PortfolioRepository {
  return {
    async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      const client = await database.connect();
      let open = false;
      let broken = false;
      try {
        await client.query("BEGIN"); open = true;
        await client.query("SET LOCAL ROLE investing_bl2bl3_runtime");
        const role = await client.query<{ role: string }>("SELECT current_user AS role");
        if (role.rows[0]?.role !== "investing_bl2bl3_runtime") throw new Error("BL2BL3_RUNTIME_ROLE_NOT_ACTIVE");
        await client.query("SELECT set_config('syntrake.actor_user_id',$1,true)", [actorUserId]);
        await client.query("SELECT set_config('lock_timeout','1500ms',true), set_config('statement_timeout','7000ms',true), set_config('idle_in_transaction_session_timeout','9000ms',true)");
        const result = await work(transactionFor(client, actorUserId));
        await client.query("COMMIT"); open = false;
        return result;
      } catch (error) {
        if (open) await client.query("ROLLBACK").catch(() => { broken = true; });
        throw error;
      } finally { client.release(broken); }
    },
  };
}

function transactionFor(client: PoolClient, actor: string): Transaction {
  return {
    async resolveOwnedAccount(accountId): Promise<OwnedAccount | null> {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::uuid::text, 20261018))",
        [accountId],
      );
      const r = await client.query<{ id: string; owner_user_id: string }>(
        "SELECT a.id,a.owner_user_id FROM investing.investment_accounts a JOIN investing.account_memberships m ON m.investment_account_id=a.id AND m.user_id=a.owner_user_id AND m.role='owner' WHERE a.id=$1::uuid AND a.owner_user_id=$2::text",
        [accountId, actor],
      );
      return r.rows[0] ? { id: r.rows[0].id, ownerUserId: r.rows[0].owner_user_id } : null;
    },
    async getRevision(accountId, actorUserId, revisionId) { return readRevision(client, accountId, actorUserId, revisionId); },
    async getRevisionByIdempotency(accountId, actorUserId, key) {
      const r = await client.query("SELECT * FROM investing.onboarding_revisions WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3", [accountId, actorUserId, key]);
      return r.rows[0] ? mapRevision(r.rows[0]) : null;
    },
    async getPortfolio(accountId, actorUserId) {
      const r = await client.query("SELECT p.id,p.investment_account_id,p.name,r.current_revision_id,r.version FROM investing.initial_portfolio_receipts x JOIN investing.portfolios p ON p.id=x.portfolio_id AND p.investment_account_id=x.account_id LEFT JOIN investing.onboarding_projections r ON r.portfolio_id=p.id WHERE x.account_id=$1 AND x.user_id=$2", [accountId, actorUserId]);
      if (r.rowCount !== 1) return null;
      const row = r.rows[0];
      const history = await client.query<{ revision_id: string }>("SELECT revision_id FROM investing.onboarding_revision_portfolios WHERE portfolio_id=$1 AND account_id=$2 ORDER BY revision_id", [row.id, row.investment_account_id]);
      return { portfolioId: row.id, accountId: row.investment_account_id, ownerUserId: actorUserId, name: row.name, currentRevisionId: row.current_revision_id ?? null, revisionIds: history.rows.map((x) => x.revision_id), version: Number(row.version ?? 0) };
    },
    async getVerifiedCapital() { return null; },
    async appendRevision(revision) {
      await client.query("INSERT INTO investing.onboarding_revisions(account_id,revision_id,actor_user_id,idempotency_key,input_payload,declared_capital,verified_capital,verification_status,supersedes_revision_id,status,status_changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$3)", [revision.accountId, revision.revisionId, revision.actorUserId, revision.idempotencyKey, JSON.stringify(revision.input), JSON.stringify(revision.capital.declaredCapital), revision.capital.verifiedCapital ? JSON.stringify(revision.capital.verifiedCapital) : null, revision.capital.verification, revision.supersedes]);
    },
    async transitionRevision(accountId, revisionId, actorUserId, expected, next) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('syntrake.bl2bl3.account:' || $1::text, 20261026))", [accountId]);
      await client.query("SELECT investing.transition_onboarding_revision($1,$2,$3,$4,$5)", [accountId, revisionId, actorUserId, expected, next]);
      const current = await readRevision(client, accountId, actorUserId, revisionId);
      if (!current) throw new Error("REVISION_NOT_FOUND");
      const revision = current;
      return { revision, transition: { accountId, revisionId, actorUserId, from: expected, to: next, occurredAt: revision.lifecycle.changedAt } as LifecycleTransition };
    },
    async updatePortfolio(expectedVersion, expectedRevisionId, portfolio) {
      if (expectedVersion === 0 && expectedRevisionId === null) {
        const inserted = await client.query<{ ok: boolean }>("SELECT investing.update_onboarding_projection($1,$2,$3,$4,$5,$6) AS ok", [portfolio.accountId, portfolio.portfolioId, portfolio.currentRevisionId, expectedVersion, expectedRevisionId, portfolio.version]);
        return inserted.rows[0]?.ok === true;
      }
      const updated = await client.query<{ ok: boolean }>("SELECT investing.update_onboarding_projection($1,$2,$3,$4,$5,$6) AS ok", [portfolio.accountId, portfolio.portfolioId, portfolio.currentRevisionId, expectedVersion, expectedRevisionId, portfolio.version]);
      return updated.rows[0]?.ok === true;
    },
  };
}

async function readRevision(client: PoolClient, accountId: string, actor: string, revisionId: string): Promise<OnboardingRevision | null> {
  const r = await client.query("SELECT * FROM investing.onboarding_revisions WHERE account_id=$1 AND actor_user_id=$2 AND revision_id=$3", [accountId, actor, revisionId]);
  return r.rows[0] ? mapRevision(r.rows[0]) : null;
}

function mapRevision(row: any): OnboardingRevision {
  return { revisionId: row.revision_id, idempotencyKey: row.idempotency_key, actorUserId: row.actor_user_id, accountId: row.account_id, input: row.input_payload, capital: { declaredCapital: row.declared_capital, verifiedCapital: row.verified_capital, verification: row.verification_status }, provenance: "USER_DECLARED", createdAt: row.created_at.toISOString(), supersedes: row.supersedes_revision_id, lifecycle: { status: row.status, changedAt: row.status_changed_at.toISOString(), changedBy: row.status_changed_by } };
}
