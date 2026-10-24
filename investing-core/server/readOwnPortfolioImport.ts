import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { currencyCode, type CurrencyCode } from "../domain/money";

/**
 * Private R2-B1 readback of the *declared* immutable portfolio snapshot.
 * The supplied session must come from a verified Clerk server auth() call,
 * never from browser JSON. This helper exposes no HTTP route.
 */
export class PortfolioImportReadBlocked extends Error {
  constructor(public readonly code:
    "UNAUTHENTICATED" | "INVALID_INPUT" | "NOT_AUTHORIZED" | "NOT_FOUND" | "READ_UNAVAILABLE") {
    super(code);
  }
}

type VerifiedServerSession = Readonly<{ userId: string | null; sessionId: string | null }>;
type ReadCommand = Readonly<{ portfolioId: string; snapshotId: string }>;
type Coverage = "NOT_REPORTED" | "PARTIAL" | "ASSERTED_COMPLETE";

export type UnverifiedImportReadback = Readonly<{
  kind: "UNVERIFIED_IMPORT";
  evidenceStatus: "UNVERIFIED";
  snapshotId: string;
  portfolioId: string;
  schemaVersion: "R2_IMPORT_DRAFT_V1";
  provenance: Readonly<{
    source: "MANUAL_ENTRY" | "DOCUMENT_EXTRACTED";
    sourceReference: string;
    asOf: string;
  }>;
  portfolioName: string;
  baseCurrency: CurrencyCode;
  reportedCoverage: Readonly<{ cash: Coverage; positions: Coverage }>;
  cashBalances: readonly Readonly<{ currency: CurrencyCode; minor: bigint; verification: "UNVERIFIED" }>[];
  positions: readonly Readonly<{
    isin: string;
    mic: string;
    quoteCurrency: CurrencyCode;
    quantityAtoms: bigint;
    reportedCostBasis: Readonly<{ currency: CurrencyCode; minor: bigint }> | null;
    verification: "UNVERIFIED";
  }>[];
  plannedContributions: readonly Readonly<{ currency: CurrencyCode; minor: bigint; dueDate: string; realized: false }>[];
  verifiedCash: "UNAVAILABLE";
  valuation: "UNAVAILABLE";
  performance: "UNAVAILABLE";
  ledgerChanged: false;
}>;

type HeaderRow = {
  id: string;
  portfolio_id: string;
  import_schema_version: string;
  evidence_status: string;
  source_kind: string;
  source_reference: string;
  source_as_of_utc: string;
  declared_portfolio_name: string;
  declared_base_currency: string;
  reported_cash_coverage: string;
  reported_position_coverage: string;
  expected_cash_rows: number;
  expected_position_rows: number;
  expected_planned_rows: number;
};
type CashRow = { currency: string; amount_minor: string };
type PositionRow = {
  isin: string; mic: string; quote_currency: string; quantity_atoms: string;
  reported_cost_currency: string | null; reported_cost_minor: string | null;
};
type PlannedRow = { currency: string; amount_minor: string; due_date: string; realized: boolean };

const coverage = z.enum(["NOT_REPORTED", "PARTIAL", "ASSERTED_COMPLETE"]);
const source = z.enum(["MANUAL_ENTRY", "DOCUMENT_EXTRACTED"]);

function parseMoney(code: string, minor: string): Readonly<{currency: CurrencyCode; minor: bigint}> {
  return Object.freeze({ currency: currencyCode.parse(code.trim()), minor: BigInt(minor) });
}

/**
 * Absence of rows can never mean actual zero. No broker/market data is read.
 * SQL RLS + verified server actor + owner membership are all enforced.
 */
export async function readOwnPortfolioImport(
  pool: Pick<Pool, "connect">,
  session: VerifiedServerSession,
  command: ReadCommand,
): Promise<UnverifiedImportReadback> {
  if (!session.userId || !session.sessionId) throw new PortfolioImportReadBlocked("UNAUTHENTICATED");
  let portfolioId: string;
  let snapshotId: string;
  try {
    portfolioId = z.string().uuid().parse(command.portfolioId);
    snapshotId = z.string().uuid().parse(command.snapshotId);
  } catch {
    throw new PortfolioImportReadBlocked("INVALID_INPUT");
  }
  let db: PoolClient | undefined;
  let transactionOpen = false;
  try {
    db = await pool.connect();
    await db.query("BEGIN READ ONLY");
    transactionOpen = true;
    // Role is NOLOGIN, selectable only by a separately authorized runtime;
    // an arbitrary user-supplied ID is never allowed to set this session.
    await db.query("SET LOCAL ROLE investing_import_writer");
    await db.query("SELECT set_config('syntrake.actor_user_id', $1, true)", [session.userId]);

    const own = await db.query<{ id: string }>(
      "SELECT p.id FROM investing.portfolios p " +
      "JOIN investing.investment_accounts a ON a.id=p.investment_account_id " +
      "JOIN investing.account_memberships m ON m.investment_account_id=a.id " +
      "AND m.user_id=a.owner_user_id AND m.role='owner' " +
      "WHERE p.id=$1 AND a.owner_user_id=$2",
      [portfolioId, session.userId],
    );
    if (own.rows.length !== 1) throw new PortfolioImportReadBlocked("NOT_AUTHORIZED");

    const headers = await db.query<HeaderRow>(
      "SELECT s.id,s.portfolio_id,s.import_schema_version,s.evidence_status," +
      "s.source_kind,s.source_reference," +
      "to_char(s.source_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS source_as_of_utc," +
      "s.declared_portfolio_name,s.declared_base_currency,s.reported_cash_coverage," +
      "s.reported_position_coverage,s.expected_cash_rows,s.expected_position_rows,s.expected_planned_rows " +
      "FROM investing.portfolio_import_snapshots s " +
      "WHERE s.id=$1 AND s.portfolio_id=$2 AND s.actor_user_id=$3 AND s.snapshot_status='finalized'",
      [snapshotId, portfolioId, session.userId],
    );
    const h = headers.rows[0];
    if (!h || headers.rows.length !== 1) throw new PortfolioImportReadBlocked("NOT_FOUND");
    if (h.evidence_status !== "UNVERIFIED" || h.import_schema_version !== "R2_IMPORT_DRAFT_V1") {
      throw new PortfolioImportReadBlocked("READ_UNAVAILABLE");
    }

    const cash = await db.query<CashRow>(
      "SELECT currency,reported_amount_minor::text AS amount_minor " +
      "FROM investing.portfolio_import_cash WHERE snapshot_id=$1 ORDER BY currency",
      [snapshotId],
    );
    const positions = await db.query<PositionRow>(
      "SELECT isin,mic,quote_currency,quantity_atoms::text AS quantity_atoms," +
      "reported_cost_currency,reported_cost_minor::text AS reported_cost_minor " +
      "FROM investing.portfolio_import_positions WHERE snapshot_id=$1 " +
      "ORDER BY isin,mic,quote_currency",
      [snapshotId],
    );
    const planned = await db.query<PlannedRow>(
      "SELECT currency,planned_amount_minor::text AS amount_minor,due_date::text AS due_date,realized " +
      "FROM investing.portfolio_import_planned_contributions WHERE snapshot_id=$1 ORDER BY line_number",
      [snapshotId],
    );
    // Fail closed if an inconsistent/partial legacy snapshot somehow exists.
    if (cash.rows.length !== h.expected_cash_rows ||
        positions.rows.length !== h.expected_position_rows ||
        planned.rows.length !== h.expected_planned_rows ||
        planned.rows.some((p) => p.realized !== false)) {
      throw new PortfolioImportReadBlocked("READ_UNAVAILABLE");
    }

    const result: UnverifiedImportReadback = Object.freeze({
      kind: "UNVERIFIED_IMPORT",
      evidenceStatus: "UNVERIFIED",
      snapshotId: h.id,
      portfolioId: h.portfolio_id,
      schemaVersion: "R2_IMPORT_DRAFT_V1",
      provenance: Object.freeze({
        source: source.parse(h.source_kind),
        sourceReference: h.source_reference,
        asOf: h.source_as_of_utc,
      }),
      portfolioName: h.declared_portfolio_name,
      baseCurrency: currencyCode.parse(h.declared_base_currency.trim()),
      reportedCoverage: Object.freeze({
        cash: coverage.parse(h.reported_cash_coverage),
        positions: coverage.parse(h.reported_position_coverage),
      }),
      cashBalances: Object.freeze(cash.rows.map((c) => Object.freeze({
        ...parseMoney(c.currency, c.amount_minor), verification: "UNVERIFIED" as const,
      }))),
      positions: Object.freeze(positions.rows.map((p) => Object.freeze({
        isin: p.isin.trim(),
        mic: p.mic.trim(),
        quoteCurrency: currencyCode.parse(p.quote_currency.trim()),
        quantityAtoms: BigInt(p.quantity_atoms),
        reportedCostBasis: p.reported_cost_minor === null ? null : parseMoney(
          p.reported_cost_currency ?? "", p.reported_cost_minor,
        ),
        verification: "UNVERIFIED" as const,
      }))),
      plannedContributions: Object.freeze(planned.rows.map((p) => Object.freeze({
        ...parseMoney(p.currency, p.amount_minor), dueDate: p.due_date, realized: false as const,
      }))),
      verifiedCash: "UNAVAILABLE",
      valuation: "UNAVAILABLE",
      performance: "UNAVAILABLE",
      ledgerChanged: false,
    });

    await db.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (e) {
    if (transactionOpen && db) await db.query("ROLLBACK").catch(() => undefined);
    if (e instanceof PortfolioImportReadBlocked) throw e;
    throw new PortfolioImportReadBlocked("READ_UNAVAILABLE");
  } finally {
    db?.release();
  }
}

