import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  FIRST_INVESTING_RELEASE_NAME,
  FIRST_INVESTING_RELEASE_VERSION,
  type MigrationVersionName,
  assertFirstInvestingReleasePredecessor,
} from "./releaseHistoryGate";
import { RECOVERED_BASELINE_SQL_SHA256 } from "./productionHistorySnapshot";

export const TARGET_PRODUCTION_SUPABASE = "vbazzxqyuqcrmjytaboc" as const;
export const EXPECTED_RELEASE_SQL_GIT_BLOB = "f23fadf42d050a7d45f84ef166f94168256eb892" as const;
export const EXPECTED_SOURCE_MAIN = "28b237a2d80f87d3090bcd8895568abcd68c19f1" as const;
export const RELEASE_SQL_PATH = "supabase/release-candidates/20261020180000_investing_first_readonly_release.sql" as const;

type MigrationRow = MigrationVersionName & Readonly<{
  statementCount: number;
  statementSha256: string;
}>;

export type PreflightSnapshot = Readonly<{
  projectRef: string;
  pgVersion: string;
  investingSchemaExists: boolean;
  investingAccountsExists: boolean;
  investingLedgerExists: boolean;
  contributionWriterExists: boolean;
  runtimeWriterExists: boolean;
  authJwtFunctionExists: boolean;
  migrations: readonly MigrationRow[];
}>;

export type OperatorUIConfirmation = Readonly<{
  classification: "USER_OBSERVED_ONLY";
  dataApiAutoExposeOff: boolean;
  investingNotYetExposed: boolean;
  clerkProviderEnabled: boolean;
}>;

export type PreflightResult = Readonly<{
  decision: "PASS_READ_ONLY_PRECHECK_ONLY" | "BLOCKED";
  reasons: readonly string[];
  productionApplyAuthorized: false;
  productionDeploymentAuthorized: false;
}>;

/**
 * The check is pure and deliberately has NO database connector, migration
 * execution, Vercel integration or access token.
 *
 * Even a PASS cannot authorize an actual apply: evidence freshness and
 * independent operator approvals must be verified against the live target.
 */
export function evaluateFirstProductionMigrationPreflight(
  snapshot: PreflightSnapshot,
  ui: OperatorUIConfirmation,
): PreflightResult {
  const reasons: string[] = [];
  const deny = (code: string) => reasons.push(code);
  if (snapshot.projectRef !== TARGET_PRODUCTION_SUPABASE) deny("WRONG_DATABASE_PROJECT");
  if (!/^17\./.test(snapshot.pgVersion)) deny("UNEXPECTED_POSTGRES_VERSION");
  if (snapshot.investingSchemaExists ||
      snapshot.investingAccountsExists ||
      snapshot.investingLedgerExists) deny("TARGET_ALREADY_CONTAINS_INVESTING");
  if (snapshot.contributionWriterExists || snapshot.runtimeWriterExists)
    deny("UNAPPROVED_FINANCIAL_WRITER_EXISTS");
  if (!snapshot.authJwtFunctionExists) deny("AUTH_JWT_FUNCTION_MISSING");
  try {
    assertFirstInvestingReleasePredecessor(snapshot.migrations);
  } catch {
    deny("MIGRATION_VERSION_OR_NAME_DRIFT");
  }
  if (snapshot.migrations.length !== 1 ||
      snapshot.migrations[0]?.statementCount !== 32 ||
      snapshot.migrations[0]?.statementSha256 !== RECOVERED_BASELINE_SQL_SHA256) {
    deny("MIGRATION_HISTORY_CONTENT_DRIFT");
  }
  if (ui.classification !== "USER_OBSERVED_ONLY" ||
      !ui.dataApiAutoExposeOff || !ui.investingNotYetExposed || !ui.clerkProviderEnabled)
    deny("CONTROL_PLANE_SCREENSHOT_OR_SETTING_UNVERIFIED");
  return Object.freeze({
    decision: reasons.length ? "BLOCKED" : "PASS_READ_ONLY_PRECHECK_ONLY",
    reasons,
    productionApplyAuthorized: false,
    productionDeploymentAuthorized: false,
  });
}

/** The only acceptable candidate SQL: content bound to the audited Git blob.
 * Do not allow runtime replacement from a request/environment-provided path.
 */
export async function verifyFirstReleaseSQLArtifact(): Promise<Readonly<{
  gitBlobSha1: string;
  sqlBytes: number;
  migrationVersion: typeof FIRST_INVESTING_RELEASE_VERSION;
  migrationName: typeof FIRST_INVESTING_RELEASE_NAME;
}>> {
  const sql = await readFile(
    new URL("../../supabase/release-candidates/20261020180000_investing_first_readonly_release.sql", import.meta.url),
  );
  const prefix = Buffer.from(`blob ${sql.byteLength}\0`, "utf8");
  const hash = createHash("sha1").update(prefix).update(sql).digest("hex");
  if (hash !== EXPECTED_RELEASE_SQL_GIT_BLOB) {
    throw new Error("BLOCKED_RELEASE_SQL_BLOB_CHANGED");
  }
  const str = sql.toString("utf8");
  if (!str.includes("-- BEGIN EXACT FOUNDATION SQL\n") ||
      !str.includes("-- BEGIN EXACT OWNER GUARD SQL\n") ||
      !str.includes("REVOKE SELECT ON") ||
      str.includes("CREATE ROLE investing_contribution_writer") ||
      str.includes("CREATE ROLE investing_writer_runtime")) {
    throw new Error("BLOCKED_RELEASE_SQL_SCOPE_DRIFT");
  }
  return Object.freeze({
    gitBlobSha1: hash,
    sqlBytes: sql.byteLength,
    migrationVersion: FIRST_INVESTING_RELEASE_VERSION,
    migrationName: FIRST_INVESTING_RELEASE_NAME,
  });
}
