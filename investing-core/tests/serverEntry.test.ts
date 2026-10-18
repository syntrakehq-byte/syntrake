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

test("Clerk A/B rehearsal read endpoint fails closed outside exact PREVIEW", async () => {
  const { isInvestingR0aClerkAbReadRehearsalEnabled, INVESTING_R0A_AB_PREVIEW_BRANCH } =
    await import("../server/rehearsalReadGate");

  const approved = {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: INVESTING_R0A_AB_PREVIEW_BRANCH,
    INVESTING_R0A_AB_READ_MODE: "rehearsal",
    INVESTING_R0A_AB_READ_PROJECT_REF: "zkqgpejlkgootkvkebhd",
    NEXT_PUBLIC_SUPABASE_URL: "https://zkqgpejlkgootkvkebhd.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TESTONLY123456789",
  };
  assert.equal(isInvestingR0aClerkAbReadRehearsalEnabled(approved), true);

  const disabled = [
    { ...approved, VERCEL_ENV: "production" },
    { ...approved, VERCEL_ENV: "development" },
    { ...approved, VERCEL_ENV: undefined },
    { ...approved, VERCEL_GIT_COMMIT_REF: "main" },
    { ...approved, VERCEL_GIT_COMMIT_REF: undefined },
    { ...approved, INVESTING_R0A_AB_READ_MODE: undefined },
    { ...approved, INVESTING_R0A_AB_READ_MODE: "live" },
    { ...approved, INVESTING_R0A_AB_READ_PROJECT_REF: "vbazzxqyuqcrmjytaboc" },
    { ...approved, NEXT_PUBLIC_SUPABASE_URL: "https://vbazzxqyuqcrmjytaboc.supabase.co" },
    { ...approved, NEXT_PUBLIC_SUPABASE_URL: "https://zkqgpejlkgootkvkebhd.supabase.co.attacker.test" },
    { ...approved, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "service_role_private_key" },
    { ...approved, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    {},
  ];
  for (const cfg of disabled) {
    assert.equal(isInvestingR0aClerkAbReadRehearsalEnabled(cfg), false);
  }
});
