import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

type Candidate = {
  path: string;
  name: string;
  version?: string;
  blob: string;
  needsVersionedMigration?: boolean;
};
type Manifest = {
  schema: string;
  status: string;
  productionProjectRef: string;
  predecessorMigrations: { version: string; name: string }[];
  candidateMigrations: Candidate[];
  excludedHistoricalPreviewOnly: string[];
};
const KNOWN_PRODUCTION = "vbazzxqyuqcrmjytaboc";

/**
 * Guard read-only source integrity. Never connects to a database and never
 * grants permission to run SQL on Production; checks the exact reviewed blobs.
 */
export async function verifyR2ProductionBundle() {
  const location = new URL("../../supabase/release-candidates/r2-production-bundle.manifest.json", import.meta.url);
  const m = JSON.parse(await readFile(location, "utf8")) as Manifest;
  assert.equal(m.schema, "syntrake.investing.r2-production-bundle.candidate.v1");
  assert.equal(m.status, "NO_GO_PRODUCTION__CANDIDATE_ONLY");
  assert.equal(m.productionProjectRef, KNOWN_PRODUCTION);
  assert.deepEqual(m.predecessorMigrations, [
    { version: "20261017191056", name: "remote_schema" },
    { version: "20261020180000", name: "investing_first_readonly_release" },
  ]);
  assert.equal(m.candidateMigrations.length, 4);
  assert.equal(new Set(m.candidateMigrations.map(c=>c.name)).size, 4);
  assert.equal(new Set(m.candidateMigrations.map(c=>c.path)).size, 4);
  assert.deepEqual(m.candidateMigrations.map(c=>c.name), [
    "r2b_unverified_portfolio_imports", "r2c_onboarding_intents",
    "r2c2_first_portfolio", "r2_bl2bl3_canonical",
  ]);
  assert.deepEqual(m.candidateMigrations.slice(0, 3).map(c=>c.version), [
    "20261022200000", "20261022210000", "20261023063000",
  ]);
  assert.equal(m.candidateMigrations[3]?.needsVersionedMigration, false);
  assert.equal(m.candidateMigrations[3]?.version, "20261029201005");
  const paths = m.candidateMigrations.map(c=>c.path);
  assert.equal(m.excludedHistoricalPreviewOnly.length, 3);
  assert.ok(m.excludedHistoricalPreviewOnly.every(p => !paths.includes(p) && /_preview_/.test(p)));
  for (const item of m.candidateMigrations) {
    assert.ok(/^[a-f0-9]{40}$/.test(item.blob), "expected exact Git blob SHA");
    assert.match(item.path, /^(supabase\/release-candidates\/|docs\/r2\/)/);
    const data = await readFile(new URL("../../" + item.path, import.meta.url));
    assert.ok(data.length > 1000, "SQL source unexpectedly empty");
    const gitBlob = createHash("sha1")
      .update("blob " + data.length + "\0").update(data).digest("hex");
    assert.equal(gitBlob, item.blob, "candidate SQL drift: " + item.path);
    assert.equal((data.toString("utf8").match(/\bCREATE ROLE\s+investing_/gi) ?? [])
      .every(v=>!v.includes("postgres")), true);
  }
  return m.candidateMigrations.map(({path,version,name,blob})=>({path,version,name,blob}));
}

if (process.argv[2] === "verify") {
  verifyR2ProductionBundle()
    .then(files=>process.stdout.write("R2_RELEASE_BUNDLE_SOURCE_HASH_PASS " + files.map(f=>f.name).join(",") + "\n"))
    .catch(err=>{ process.stderr.write("R2_RELEASE_BUNDLE_BLOCKED " + (err instanceof Error ? err.message : "unknown") + "\n");process.exitCode=1; });
}
