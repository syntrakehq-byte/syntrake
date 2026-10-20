import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** No credentials; imports must not open PG or grant a financial writer. */
test("private Clerk-bound adapters load without exposing a pool or financial HTTP route", async () => {
  const entry = await import("../server/recordContributionFromClerk");
  const reader = await import("../server/loadOwnInvestingAccounts");
  assert.equal(typeof entry.recordUserReportedContributionFromClerk, "function");
  assert.equal(typeof reader.loadOwnInvestingAccountsFromClerk, "function");
  assert.equal("recordUserReportedContributionInRehearsal" in entry, false);
});

test("R0-A Preview-only browser routes and diagnostic modules are absent from closure candidate", () => {
  const absent = [
    "app/api/investing/rehearsal/auth-check/route.ts",
    "app/api/investing/rehearsal/claim-check/route.ts",
    "app/api/investing/rehearsal/contribution-smoke/route.ts",
    "app/api/investing/rehearsal/writer-connection-check/route.ts",
    "app/investing/rehearsal/writer-smoke/page.tsx",
    "app/investing/rehearsal/writer-smoke/WriterSmokeClient.tsx",
    "investing-core/server/privateWriterPool.ts",
    "investing-core/server/writerHttpRehearsalGate.ts",
    "investing-core/server/rehearsalReadGate.ts",
    "investing-core/server/rehearsalJwtIndicators.ts",
  ];
  for (const file of absent) {
    assert.equal(existsSync(resolve(process.cwd(), file)), false, file);
  }
});
