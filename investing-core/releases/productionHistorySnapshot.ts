import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const RECOVERED_BASELINE_SQL_SHA256 = "8cec567d53f9f17868c7110b48d17212e1ba8db897f513aee36e287f0016335d";
export const RECOVERED_BASELINE_SQL_MD5 = "6fa0e0a4fae7278370cae55ac5d4fc7f";

type RecoveredMigrationSnapshot = Readonly<{
  schema: string;
  classification: string;
  sourceProjectRef: string;
  version: string;
  name: string;
  statementCount: number;
  statementArrayJoinedByNewlineMd5: string;
  statementArrayJoinedByNewlineSha256: string;
  statements: readonly string[];
}>;

const allowedSQL = /^(SET |SELECT pg_catalog\.set_config\(|COMMENT ON SCHEMA |CREATE EXTENSION IF NOT EXISTS |ALTER PUBLICATION |GRANT USAGE ON SCHEMA |ALTER DEFAULT PRIVILEGES FOR ROLE )/;

/**
 * Read-only recovered production migration history, captured via a SELECT on
 * supabase_migrations.schema_migrations, NOT the original remote SQL source.
 * Render as a CI-only, already-applied baseline; NEVER execute it on a real DB.
 */
export async function recoveredProductionHistorySnapshot():
  Promise<Readonly<{ version: string; name: string; statements: readonly string[] }>> {
  const raw = await readFile(
    new URL("../../supabase/release-evidence/20261017191056_remote_schema.registry.json", import.meta.url),
    "utf8",
  );
  const data: unknown = JSON.parse(raw);
  assert.ok(data && typeof data === "object" && !Array.isArray(data));
  const value = data as RecoveredMigrationSnapshot;
  assert.equal(value.schema, "syntrake.supabase.migration-history-evidence.v1");
  assert.equal(value.classification, "READ_ONLY_PRODUCTION_REGISTRY_SNAPSHOT_NOT_AN_ORIGINAL_MIGRATION_FILE");
  assert.equal(value.sourceProjectRef, "vbazzxqyuqcrmjytaboc");
  assert.equal(value.version, "20261017191056");
  assert.equal(value.name, "remote_schema");
  assert.equal(value.statementCount, 32);
  assert.equal(value.statementArrayJoinedByNewlineMd5, RECOVERED_BASELINE_SQL_MD5);
  assert.equal(value.statementArrayJoinedByNewlineSha256, RECOVERED_BASELINE_SQL_SHA256);
  assert.ok(Array.isArray(value.statements) && value.statements.length === 32);
  assert.ok(value.statements.every((sql) =>
    typeof sql === "string" && !sql.includes(";") && allowedSQL.test(sql)
  ));
  const concatenated = value.statements.join("\n");
  assert.equal(createHash("md5").update(concatenated).digest("hex"), RECOVERED_BASELINE_SQL_MD5);
  assert.equal(createHash("sha256").update(concatenated).digest("hex"), RECOVERED_BASELINE_SQL_SHA256);
  return { version: value.version, name: value.name, statements: value.statements };
}

export async function renderRecoveredBaselineForDisposableCI(): Promise<string> {
  assert.equal(process.env.CI, "true", "CI-only historical fixture");
  const history = await recoveredProductionHistorySnapshot();
  return (
    "-- RECONSTRUCTED FROM REAL PRODUCTION MIGRATION REGISTRY; NOT THE ORIGINAL SQL FILE.\n" +
    "-- ALREADY APPLIED in isolated PG17 registry. NEVER RUN OR SHIP TO SUPABASE PRODUCTION.\n" +
    history.statements.map((stmt) => stmt + ";").join("\n") + "\n"
  );
}
