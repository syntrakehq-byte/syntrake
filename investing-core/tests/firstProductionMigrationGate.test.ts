import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateFirstProductionMigrationPreflight,
  verifyFirstReleaseSQLArtifact,
  EXPECTED_RELEASE_SQL_GIT_BLOB,
  TARGET_PRODUCTION_SUPABASE,
  type PreflightSnapshot,
  type OperatorUIConfirmation,
} from "../releases/firstProductionMigrationGate";

const snapshot: PreflightSnapshot = Object.freeze({
  projectRef: TARGET_PRODUCTION_SUPABASE,
  pgVersion: "17.11",
  investingSchemaExists: false,
  investingAccountsExists: false,
  investingLedgerExists: false,
  contributionWriterExists: false,
  runtimeWriterExists: false,
  authJwtFunctionExists: true,
  migrations: [{
    version: "20261017191056",
    name: "remote_schema",
    statementCount: 32,
    statementSha256: "8cec567d53f9f17868c7110b48d17212e1ba8db897f513aee36e287f0016335d",
  }],
});
const ui: OperatorUIConfirmation = Object.freeze({
  classification: "USER_OBSERVED_ONLY",
  dataApiAutoExposeOff: true,
  investingNotYetExposed: true,
  clerkProviderEnabled: true,
});

test("R1 production schema preflight only PASS as read-only check, never as deploy authority", () => {
  assert.deepEqual(evaluateFirstProductionMigrationPreflight(snapshot,ui), {
    decision: "PASS_READ_ONLY_PRECHECK_ONLY",
    reasons: [],
    productionApplyAuthorized: false,
    productionDeploymentAuthorized: false,
  });
});

test("R1 production preflight fails closed for every material wrong target, missing or drifted condition", () => {
  const variants: Readonly<Partial<PreflightSnapshot>>[] = [
    { projectRef: "zkqgpejlkgootkvkebhd" },
    { pgVersion: "16.7" },
    { pgVersion: "UNKNOWN" },
    { investingSchemaExists: true },
    { investingAccountsExists: true },
    { investingLedgerExists: true },
    { contributionWriterExists: true },
    { runtimeWriterExists: true },
    { authJwtFunctionExists: false },
    { migrations: [] },
    { migrations: [{...snapshot.migrations[0],version:"20261017191057"}] },
    { migrations: [{...snapshot.migrations[0],name:"rewritten"}] },
    { migrations: [{...snapshot.migrations[0],statementCount:31}] },
    { migrations: [{...snapshot.migrations[0],statementSha256:"0".repeat(64)}] },
    { migrations: [snapshot.migrations[0],{version:"20261018000000",name:"unexpected",statementCount:1,statementSha256:"1"}] },
    { migrations: [{...snapshot.migrations[0]},{...snapshot.migrations[0]}] },
  ];
  for (const variant of variants) {
    const actual = evaluateFirstProductionMigrationPreflight({...snapshot,...variant},ui);
    assert.equal(actual.decision,"BLOCKED",JSON.stringify(variant));
    assert.ok(actual.reasons.length>0);
    assert.equal(actual.productionApplyAuthorized,false);
    assert.equal(actual.productionDeploymentAuthorized,false);
  }
  for (const missing of ["dataApiAutoExposeOff","investingNotYetExposed","clerkProviderEnabled"] as const) {
    assert.equal(evaluateFirstProductionMigrationPreflight(snapshot,{...ui,[missing]:false}).decision,"BLOCKED");
  }
  assert.equal(evaluateFirstProductionMigrationPreflight(snapshot,{...ui,classification:"OTHER" as "USER_OBSERVED_ONLY"}).decision,"BLOCKED");
});

test("first release SQL exactly matches audited immutable Git blob, no writer capability", async () => {
  const release = await verifyFirstReleaseSQLArtifact();
  assert.equal(release.gitBlobSha1, EXPECTED_RELEASE_SQL_GIT_BLOB);
  assert.equal(release.sqlBytes, 20433);
  assert.equal(release.migrationVersion, "20261020180000");
  assert.equal(release.migrationName, "investing_first_readonly_release");
  const sql=await readFile(new URL("../../supabase/release-candidates/20261020180000_investing_first_readonly_release.sql",import.meta.url),"utf8");
  assert.ok(!sql.includes("CREATE ROLE investing_contribution_writer"));
  assert.ok(!sql.includes("CREATE ROLE investing_writer_runtime"));
});
