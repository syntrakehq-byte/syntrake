import assert from "node:assert/strict";
import test from "node:test";
import { handleOnboardingPortfolioPreviewPost } from "../server/onboardingPortfolioPreviewHttp";
import { isOnboardingPortfolioPreviewReady } from "../server/onboardingPortfolioFromClerk";

const sha = "a".repeat(40);
const branchRef = "a".repeat(20);
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/bl2bl3-canonical-draft",
  VERCEL_GIT_COMMIT_SHA: sha,
  SYNTRAKE_ONBOARDING_APPROVED_PREVIEW_SHA: sha,
  SYNTRAKE_ONBOARDING_PG_ENABLED: "enabled",
  SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF: branchRef,
  NEXT_PUBLIC_SUPABASE_URL: "https://" + branchRef + ".supabase.co",
  SYNTRAKE_ONBOARDING_POOLER_HOST: "aws-0-eu-west-3.pooler.supabase.com",
  SYNTRAKE_ONBOARDING_DATABASE_URL: "postgresql://investing_bl2bl3_preview_login." + branchRef + ":dummy@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
  SYNTRAKE_ONBOARDING_PG_CA_PEM: "-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
};
const url = "https://candidate.example/api/investing/portfolio/onboarding";
const revisionId = "revision_test_00000000001";
const accountId = "00000000-0000-4000-8000-000000000001";
const body = { operation: "APPLY_INITIAL_REVISION", accountId, revisionId };
const actor = { userId: "user_abcdefgh", sessionId: "sess_abcdefgh" };
function post(raw: unknown, origin = "https://candidate.example") {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(raw) });
}
test("BL2/BL3 HTTP: preview requires exact SHA, branch, dedicated login, TLS and non-production DB", () => {
  assert.equal(isOnboardingPortfolioPreviewReady(env), true);
  for (const bad of [
    { ...env, VERCEL_ENV: "production" },
    { ...env, VERCEL_ENV: undefined },
    { ...env, VERCEL_GIT_COMMIT_REF: "main" },
    { ...env, VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    { ...env, SYNTRAKE_ONBOARDING_PG_ENABLED: "disabled" },
    { ...env, SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF: "vbazzxqyuqcrmjytaboc" },
    { ...env, SYNTRAKE_ONBOARDING_DATABASE_URL: env.SYNTRAKE_ONBOARDING_DATABASE_URL.replace(branchRef, "vbazzxqyuqcrmjytaboc") },
    { ...env, SYNTRAKE_ONBOARDING_DATABASE_URL: env.SYNTRAKE_ONBOARDING_DATABASE_URL.replace("investing_bl2bl3_preview_login", "postgres") },
    { ...env, SYNTRAKE_ONBOARDING_DATABASE_URL: env.SYNTRAKE_ONBOARDING_DATABASE_URL + "?sslmode=disable" },
    { ...env, SYNTRAKE_ONBOARDING_POOLER_HOST: "attacker.example" },
    { ...env, SYNTRAKE_ONBOARDING_DATABASE_URL: env.SYNTRAKE_ONBOARDING_DATABASE_URL.replace("pooler.supabase.com", "pooler.example.com") },
    { ...env, SYNTRAKE_ONBOARDING_DATABASE_URL: env.SYNTRAKE_ONBOARDING_DATABASE_URL.replace(":5432/postgres", ":6543/postgres") },
    { ...env, SYNTRAKE_ONBOARDING_DATABASE_URL: env.SYNTRAKE_ONBOARDING_DATABASE_URL.replace("aws-0-eu-west-3.pooler.supabase.com", "db." + branchRef + ".supabase.co") },
    { ...env, SYNTRAKE_ONBOARDING_PG_CA_PEM: "" },
  ]) assert.equal(isOnboardingPortfolioPreviewReady(bad), false);
});
test("BL2/BL3 HTTP: gate denies before Clerk, body parsing and PostgreSQL", async () => {
  let auth = 0, db = 0;
  const result = await handleOnboardingPortfolioPreviewPost(post(body), { ...env, VERCEL_ENV: "production" },
    async () => { auth++; return actor; }, () => { db++; throw Error("DB_FORBIDDEN"); });
  assert.equal(result.status, 404);
  assert.equal(auth, 0);
  assert.equal(db, 0);
});
test("BL2/BL3 HTTP: CSRF, query parameters and forged identity are denied before database", async () => {
  let db = 0;
  const blocked = [
    post(body, "https://evil.example"),
    post({ ...body, userId: "user_victim" }),
    post({ ...body, verifiedCapital: { amountMinor: "1000" } }),
    new Request(url + "?userId=forged", { method: "POST", headers: { origin: "https://candidate.example", "content-type": "application/json" }, body: JSON.stringify(body) }),
  ];
  for (const req of blocked) {
    const out = await handleOnboardingPortfolioPreviewPost(req, env, async () => actor, () => { db++; throw Error("DB_FORBIDDEN"); });
    assert.ok(out.status >= 400 && out.status < 500);
  }
  assert.equal(db, 0);
});
test("BL2/BL3 HTTP: no session rejects before PostgreSQL; DB failure never leaks credentials", async () => {
  let db = 0;
  const unauth = await handleOnboardingPortfolioPreviewPost(post(body), env,
    async () => { throw Error("UNAUTHENTICATED"); }, () => { db++; throw Error("DB_FORBIDDEN"); });
  assert.equal(unauth.status, 401);
  assert.equal(db, 0);
  const down = await handleOnboardingPortfolioPreviewPost(post(body), env,
    async () => actor, () => { throw Error("PRIVATE_DATABASE_PASSWORD"); });
  assert.equal(down.status, 503);
  const content = await down.text();
  assert.ok(!content.includes("PRIVATE_DATABASE_PASSWORD"));
  assert.ok(!content.includes(env.SYNTRAKE_ONBOARDING_DATABASE_URL));
  assert.equal(down.headers.get("Cache-Control"), "private, no-store, max-age=0");
});
test("BL2/BL3 HTTP: rejects oversized content even with missing content-length", async () => {
  let calls = 0;
  const huge = post({ ...body, padding: "x".repeat(140000) });
  const response = await handleOnboardingPortfolioPreviewPost(huge, env,
    async () => actor, () => { calls++; throw Error("DB_FORBIDDEN"); });
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});
