import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { parsePortfolioImportDraft } from "../portfolio/portfolioImportDraft";

export class PortfolioImportBlocked extends Error {
  constructor(public readonly code:
    "UNAUTHENTICATED" | "INVALID_INPUT" | "NOT_AUTHORIZED" |
    "IDEMPOTENCY_CONFLICT" | "SOURCE_CONFLICT" | "WRITE_UNAVAILABLE") {
    super(code);
  }
}
type VerifiedServerSession = Readonly<{ userId: string | null; sessionId: string | null }>;
type ImportRequest = Readonly<{ portfolioId: string; idempotencyKey: string; declaration: unknown }>;
export type ImportReceipt = Readonly<{ kind: "UNVERIFIED_IMPORT"; snapshotId: string; ledgerChanged: false }>;
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/);

/** Caller MUST derive session via Clerk auth() on the server, never JSON. */
export async function savePortfolioImport(
  pool: Pick<Pool, "connect">, session: VerifiedServerSession, request: ImportRequest,
): Promise<ImportReceipt> {
  if (!session.userId || !session.sessionId) throw new PortfolioImportBlocked("UNAUTHENTICATED");
  let portfolioId: string, idempotencyKey: string;
  let draft: ReturnType<typeof parsePortfolioImportDraft>;
  try {
    portfolioId = z.string().uuid().parse(request.portfolioId);
    idempotencyKey = key.parse(request.idempotencyKey);
    draft = parsePortfolioImportDraft(request.declaration);
  } catch {
    throw new PortfolioImportBlocked("INVALID_INPUT");
  }
  const canonical = JSON.stringify({
    provenance: draft.provenance, name: draft.portfolioName, currency: draft.baseCurrency,
    cash: draft.cashBalances.map(c => [c.currency, c.minor.toString()]),
    positions: draft.positions.map(p => [
      p.isin, p.mic, p.quoteCurrency, p.quantityAtoms.toString(),
      p.reportedCostBasis?.currency ?? null, p.reportedCostBasis?.minor.toString() ?? null,
    ]),
    planned: draft.plannedContributions.map(p => [p.currency, p.minor.toString(), p.dueDate]),
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  let db: PoolClient | undefined;
  let active = false;
  try {
    db = await pool.connect();
    await db.query("BEGIN");
    active = true;
    // Requires a separately authorized non-public runtime login that may
    // SET ROLE to the NOLOGIN writer. Not available in Production.
    await db.query("SET LOCAL ROLE investing_import_writer");
    await db.query("SELECT set_config('syntrake.actor_user_id', $1, true)", [session.userId]);
    const ownerSql = "SELECT p.investment_account_id AS id FROM investing.portfolios p " +
      "JOIN investing.investment_accounts a ON a.id=p.investment_account_id " +
      "JOIN investing.account_memberships m ON m.investment_account_id=a.id " +
      "AND m.user_id=a.owner_user_id AND m.role='owner' " +
      "WHERE p.id=$1 AND a.owner_user_id=$2";
    const before = await db.query<{ id: string }>(ownerSql, [portfolioId, session.userId]);
    if (before.rows.length !== 1) throw new PortfolioImportBlocked("NOT_AUTHORIZED");
    const account = before.rows[0].id;
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('syntrake.investing.account:' || $1::text, 20261018))",
      [account],
    );
    const after = await db.query<{ id: string }>(ownerSql, [portfolioId, session.userId]);
    if (after.rows.length !== 1 || after.rows[0].id !== account) {
      throw new PortfolioImportBlocked("NOT_AUTHORIZED");
    }
    const inserted = await db.query<{id:string}>(
      "INSERT INTO investing.portfolio_import_snapshots " +
      "(investment_account_id,portfolio_id,actor_user_id,idempotency_key,payload_sha256," +
      "import_schema_version,declared_portfolio_name,declared_base_currency," +
      "source_kind,source_reference,source_as_of,expected_cash_rows," +
      "expected_position_rows,expected_planned_rows) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING id",
      [account,portfolioId,session.userId,idempotencyKey,hash,draft.schemaVersion,
       draft.portfolioName,draft.baseCurrency,draft.provenance.source,
       draft.provenance.sourceReference,draft.provenance.asOf,
       draft.cashBalances.length,draft.positions.length,draft.plannedContributions.length],
    );
    if (!inserted.rows.length) {
      const previous = await db.query<{id:string;payload_sha256:string;portfolio_id:string}>(
        "SELECT id,payload_sha256,portfolio_id FROM investing.portfolio_import_snapshots " +
        "WHERE investment_account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3",
        [account,session.userId,idempotencyKey],
      );
      if (!previous.rows.length) throw new PortfolioImportBlocked("SOURCE_CONFLICT");
      if (previous.rows[0].payload_sha256 !== hash || previous.rows[0].portfolio_id !== portfolioId) {
        throw new PortfolioImportBlocked("IDEMPOTENCY_CONFLICT");
      }
      await db.query("COMMIT"); active = false;
      return { kind: "UNVERIFIED_IMPORT", snapshotId: previous.rows[0].id, ledgerChanged: false };
    }
    const snapshotId = inserted.rows[0].id;
    for (const cash of draft.cashBalances) {
      await db.query("INSERT INTO investing.portfolio_import_cash " +
        "(snapshot_id,investment_account_id,portfolio_id,currency,reported_amount_minor) " +
        "VALUES ($1,$2,$3,$4,$5)",
        [snapshotId,account,portfolioId,cash.currency,cash.minor.toString()]);
    }
    for (const p of draft.positions) {
      await db.query("INSERT INTO investing.portfolio_import_positions " +
        "(snapshot_id,investment_account_id,portfolio_id,isin,mic,quote_currency," +
        "quantity_atoms,reported_cost_currency,reported_cost_minor) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [snapshotId,account,portfolioId,p.isin,p.mic,p.quoteCurrency,p.quantityAtoms.toString(),
         p.reportedCostBasis?.currency ?? null,p.reportedCostBasis?.minor.toString() ?? null]);
    }
    for (const [n,p] of draft.plannedContributions.entries()) {
      await db.query("INSERT INTO investing.portfolio_import_planned_contributions " +
        "(snapshot_id,investment_account_id,portfolio_id,line_number,currency,planned_amount_minor,due_date) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [snapshotId,account,portfolioId,n,p.currency,p.minor.toString(),p.dueDate]);
    }
    const sealed = await db.query<{id:string}>(
      "UPDATE investing.portfolio_import_snapshots SET snapshot_status='finalized' " +
      "WHERE id=$1 AND investment_account_id=$2 AND actor_user_id=$3 AND snapshot_status='draft' RETURNING id",
      [snapshotId,account,session.userId],
    );
    if (sealed.rows.length !== 1) throw new PortfolioImportBlocked("WRITE_UNAVAILABLE");
    await db.query("COMMIT"); active = false;
    return { kind: "UNVERIFIED_IMPORT", snapshotId, ledgerChanged: false };
  } catch (e) {
    if (active && db) await db.query("ROLLBACK").catch(() => undefined);
    if (e instanceof PortfolioImportBlocked) throw e;
    throw new PortfolioImportBlocked("WRITE_UNAVAILABLE");
  } finally {
    db?.release();
  }
}
