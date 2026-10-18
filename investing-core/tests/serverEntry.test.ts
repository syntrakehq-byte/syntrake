import assert from "node:assert/strict";
import test from "node:test";

/**
 * A Node.js runtime smoke test, deliberately without Clerk API keys or
 * database credentials. Loading the entire server adapter must not create a
 * PostgreSQL connection or require any client-supplied Actor.
 *
 * This is NOT a Next.js route-bundle or signed-Clerk-session integration test.
 */
test("Clerk-bound Investing writer loads as a Node server-only module without activating SQL", async () => {
  const entry = await import("../server/recordContributionFromClerk");
  const transport = await import("../server/privateWriterPool");

  assert.equal(typeof entry.recordUserReportedContributionFromClerk, "function");
  assert.equal(typeof entry.recordUserReportedContributionInRehearsal, "function");
  assert.equal(typeof transport.createRehearsalWriterPool, "function");
  assert.equal(typeof transport.parseRehearsalWriterPoolConfig, "function");

  assert.throws(
    () => transport.parseRehearsalWriterPoolConfig({}),
    (error: unknown) => error instanceof transport.InvestingWriterConfigurationBlocked,
  );
});
