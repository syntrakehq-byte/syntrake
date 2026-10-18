import assert from "node:assert/strict";
import test from "node:test";
import {
  fixedWriterSmokeDeclaration,
  hasSameOriginWriterIntent,
  isWriterHttpRehearsalEnabled,
  R0A_WRITER_REHEARSAL_BRANCH,
  WriterSmokeBadInput,
} from "../server/writerHttpRehearsalGate";

const ref = "zkqgpejlkgootkvkebhd";
const host = "syntrake-preview-fixture.vercel.app";
const A = "f886c954-0a0f-419c-890a-b77ecb0c36cf";
const C = "676ae244-9ead-449c-861d-2f34a81285e3";

const armed = {
  VERCEL_ENV: "preview",
  VERCEL_URL: host,
  VERCEL_GIT_COMMIT_REF: R0A_WRITER_REHEARSAL_BRANCH,
  INVESTING_R0A_WRITER_HTTP_MODE: "rehearsal-armed",
  INVESTING_WRITER_MODE: "rehearsal",
  INVESTING_WRITER_PROJECT_REF: ref,
  INVESTING_WRITER_DATABASE_URL: `postgresql://investing_writer_runtime:fake-test-secret@db.${ref}.supabase.co:5432/postgres`,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
  CLERK_SECRET_KEY: "sk_test_fixture",
};

test("writer rehearsal is never armed in production, wrong branch, missing credential or wrong Clerk", () => {
  assert.equal(isWriterHttpRehearsalEnabled(armed), true);
  const malformed = [
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: undefined },
    { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_REF: "candidate/other-branch" },
    { INVESTING_R0A_WRITER_HTTP_MODE: undefined },
    { INVESTING_R0A_WRITER_HTTP_MODE: "live" },
    { INVESTING_WRITER_MODE: "live" },
    { INVESTING_WRITER_PROJECT_REF: "vbazzxqyuqcrmjytaboc" },
    { INVESTING_WRITER_DATABASE_URL: undefined },
    { INVESTING_WRITER_DATABASE_URL: "postgresql://postgres:p@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres" },
    { INVESTING_WRITER_DATABASE_URL: "postgresql://investing_writer_runtime:p@db.vbazzxqyuqcrmjytaboc.supabase.co:5432/postgres" },
    { INVESTING_WRITER_DATABASE_URL: "postgresql://investing_writer_runtime:p@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres?sslmode=disable" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_wrong" },
    { CLERK_SECRET_KEY: "sk_live_wrong" },
  ];
  for (const delta of malformed) {
    assert.equal(isWriterHttpRehearsalEnabled({ ...armed, ...delta }), false, JSON.stringify(delta));
  }
  assert.equal(isWriterHttpRehearsalEnabled({}), false);
});

test("writer POST requires same-origin and exact HTTPS deployment with JSON", () => {
  const valid = {
    url: `https://${host}/api/investing/rehearsal/contribution-smoke`,
    origin: `https://${host}`,
    host,
    contentType: "application/json; charset=utf-8",
    fetchSite: "same-origin",
  };
  assert.equal(hasSameOriginWriterIntent(valid, armed), true);
  for (const mutated of [
    { url: `http://${host}/api/investing/rehearsal/contribution-smoke` },
    { url: `https://${host}/api/investing/rehearsal/contribution-smoke?accountId=${A}` },
    { url: `https://${host}/api/investing/rehearsal/auth-check` },
    { origin: "https://evil.example" },
    { origin: null },
    { host: "evil.example" },
    { contentType: "text/plain" },
    { fetchSite: "cross-site" },
    { fetchSite: "none" },
  ]) {
    assert.equal(hasSameOriginWriterIntent({ ...valid, ...mutated }, armed), false, JSON.stringify(mutated));
  }
  assert.equal(hasSameOriginWriterIntent(valid, { ...armed, VERCEL_URL: "other.vercel.app" }), false);
  assert.equal(hasSameOriginWriterIntent(valid, { ...armed, VERCEL_URL: "syntrake.com" }), false);
});

test("only two fixed test accounts and one 1-minor-unit replayable declaration per account", () => {
  const a = fixedWriterSmokeDeclaration({ accountId: A });
  const c = fixedWriterSmokeDeclaration({ accountId: C });
  assert.equal(a.accountId, A);
  assert.equal(c.accountId, C);
  assert.equal(a.amountMinor, "1");
  assert.equal(c.amountMinor, "1");
  assert.equal(a.currency, "EUR");
  assert.notEqual(a.idempotencyKey, c.idempotencyKey);
  assert.notEqual(a.externalReference, c.externalReference);
  assert.deepEqual(a, fixedWriterSmokeDeclaration({ accountId: A }));
  assert.deepEqual(c, fixedWriterSmokeDeclaration({ accountId: C }));
  for (const body of [
    {},
    { accountId: "00000000-0000-4000-8000-000000000099" },
    { accountId: A, userId: "pretend-A" },
    { accountId: A, actor: { userId: "pretend-A" } },
    { accountId: A, role: "investing_contribution_writer" },
    { accountId: A, amountMinor: "100000" },
    { accountId: A, idempotencyKey: "override" },
    { accountId: A, currency: "USD" },
    { accountId: A, externalReference: "inject" },
    { accountId: A, sessionId: "fake" },
    { accountId: A, token: "fake" },
    { accountId: 1234 },
    null,
  ]) assert.throws(
    () => fixedWriterSmokeDeclaration(body),
    (e: unknown) => e instanceof WriterSmokeBadInput,
  );
});

test("narrow Supavisor IPv4 session mode retains preview-only authority", async () => {
  const { parseRehearsalWriterPoolConfig } = await import("../server/privateWriterPool");
  const poolerUrl = `postgresql://investing_writer_runtime.${ref}:fake-test-secret@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;
  const sessionEnv = {
    ...armed,
    INVESTING_WRITER_CONNECTION_MODE: "session-pooler",
    INVESTING_WRITER_DATABASE_URL: poolerUrl,
  };
  assert.equal(isWriterHttpRehearsalEnabled(sessionEnv), true);
  const valid = parseRehearsalWriterPoolConfig(sessionEnv);
  assert.deepEqual(valid.ssl, { rejectUnauthorized: true });
  assert.equal(valid.max, 2);
  for (const delta of [
    { INVESTING_WRITER_CONNECTION_MODE: undefined },
    { INVESTING_WRITER_CONNECTION_MODE: "transaction-pooler" },
    { INVESTING_WRITER_PROJECT_REF: "vbazzxqyuqcrmjytaboc" },
    { INVESTING_WRITER_DATABASE_URL: `postgresql://postgres.${ref}:fake@aws-0-eu-west-3.pooler.supabase.com:5432/postgres` },
    { INVESTING_WRITER_DATABASE_URL: `postgresql://investing_writer_runtime.vbazzxqyuqcrmjytaboc:fake@aws-0-eu-west-3.pooler.supabase.com:5432/postgres` },
    { INVESTING_WRITER_DATABASE_URL: `postgresql://investing_writer_runtime.${ref}:fake@aws-0-us-east-1.pooler.supabase.com:5432/postgres` },
    { INVESTING_WRITER_DATABASE_URL: `postgresql://investing_writer_runtime.${ref}:fake@any-other.pooler.supabase.com:5432/postgres` },
    { INVESTING_WRITER_DATABASE_URL: `postgresql://investing_writer_runtime.${ref}:fake@aws-0-eu-west-3.pooler.supabase.com:6543/postgres` },
    { INVESTING_WRITER_DATABASE_URL: `postgresql://investing_writer_runtime.${ref}:fake@aws-0-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=disable` },
  ]) {
    assert.equal(isWriterHttpRehearsalEnabled({ ...sessionEnv, ...delta }), false, JSON.stringify(delta));
  }
});
