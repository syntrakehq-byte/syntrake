import assert from "node:assert/strict";
import test from "node:test";
import { handleR1AccountsRead, isR1AccountReadEnabled } from "../server/accountsReadHttp";
import { InvestingReadBlocked, type InvestingReadResult } from "../server/supabaseReadTransport";

const ref = "vbazzxqyuqcrmjytaboc";
const route = "https://www.syntrake.com/api/investing/accounts";
const enabled = {
  INVESTING_R1_ACCOUNTS_READ_MODE: "enabled",
  INVESTING_R1_SUPABASE_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(30),
};
const ownerResult: InvestingReadResult = {
  evidence: "SUPABASE_REST_RESPONSE",
  actorId: "clerk_sensitive_user_id",
  state: "AVAILABLE",
  accounts: [{ id: "00000000-0000-4000-8000-000000000011", name: "Own account", baseCurrency: "EUR" }],
};

test("R1 is disabled by default and bound to exact matching Supabase project + public key", () => {
  assert.equal(isR1AccountReadEnabled(enabled), true);
  for (const delta of [
    { INVESTING_R1_ACCOUNTS_READ_MODE: undefined },
    { INVESTING_R1_ACCOUNTS_READ_MODE: "production" },
    { INVESTING_R1_SUPABASE_PROJECT_REF: undefined },
    { INVESTING_R1_SUPABASE_PROJECT_REF: "zkqgpejlkgootkvkebhd" },
    { INVESTING_R1_SUPABASE_PROJECT_REF: "not-a-ref" },
    { NEXT_PUBLIC_SUPABASE_URL: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "http://" + ref + ".supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://" + ref + ".supabase.co.attacker.example" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://" + ref + ".supabase.co/" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "service_role" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_please_never_expose" },
  ]) {
    assert.equal(isR1AccountReadEnabled({ ...enabled, ...delta }), false, JSON.stringify(delta));
  }
  assert.equal(isR1AccountReadEnabled({}), false);
});

test("R1 missing gate yields 404 and never attempts Clerk/DB reads", async () => {
  let count = 0;
  const response = await handleR1AccountsRead(route, {}, async () => { count++; return ownerResult; });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
  assert.equal(count, 0);
});

test("R1 rejects any query/account/user selection before reading", async () => {
  let count = 0;
  const forbidden = async () => { count++; return ownerResult; };
  for (const request of [
    route + "?accountId=00000000-0000-4000-8000-000000000011",
    route + "?userId=clerk_other",
    route + "?cash=0",
    route + "?",
    route.replace("/accounts", "/accounts/other"),
    "not a url",
  ]) {
    // URL('?') has an empty search in standard WHATWG parsing; that shape is
    // equivalent to the canonical route, so exclude it from the deny matrix.
    if (request.endsWith("?")) continue;
    const response = await handleR1AccountsRead(request, enabled, forbidden);
    assert.equal(response.status, 400, request);
    assert.deepEqual(await response.json(), { error: "INVALID_REQUEST" });
  }
  assert.equal(count, 0);
});

test("R1 successful account read does not leak actor/session and never suggests financial state", async () => {
  let called = 0;
  const response = await handleR1AccountsRead(route, enabled, async () => { called++; return ownerResult; });
  assert.equal(response.status, 200);
  assert.equal(called, 1);
  const body = await response.json();
  assert.deepEqual(body, {
    state: "AVAILABLE",
    accounts: ownerResult.accounts,
    source: "SUPABASE_RLS_READ",
    financialState: "NOT_INCLUDED",
  });
  assert.equal(JSON.stringify(body).includes("clerk_sensitive_user_id"), false);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

test("R1 real-empty is distinguishable from UNAVAILABLE; never fabricate cash=0", async () => {
  const result: InvestingReadResult = { ...ownerResult, state: "EMPTY_OR_UNPROVISIONED", accounts: [] };
  const response = await handleR1AccountsRead(route, enabled, async () => result);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.state, "EMPTY_OR_UNPROVISIONED");
  assert.deepEqual(body.accounts, []);
  assert.equal(body.financialState, "NOT_INCLUDED");
  assert.equal("cash" in body, false);
  assert.equal("balance" in body, false);
});

test("R1 maps auth failures to 401/403, unavailability to 503 without leaking upstream internals", async () => {
  const cases = [
    ["UNAUTHENTICATED", 401, "UNAUTHENTICATED"],
    ["READ_UNAUTHORIZED", 403, "BLOCKED"],
    ["READ_UNAVAILABLE", 503, "READ_UNAVAILABLE"],
    ["INVALID_CONFIGURATION", 503, "READ_UNAVAILABLE"],
    ["TOKEN_UNAVAILABLE", 503, "READ_UNAVAILABLE"],
    ["INVALID_READ_RESPONSE", 503, "READ_UNAVAILABLE"],
  ] as const;
  for (const [reason, status, errorName] of cases) {
    const response = await handleR1AccountsRead(route, enabled, async () => {
      throw new InvestingReadBlocked(reason);
    });
    assert.equal(response.status, status, reason);
    assert.deepEqual(await response.json(), { error: errorName });
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
  const response = await handleR1AccountsRead(route, enabled, async () => {
    throw new Error("PRIVATE SQL CONNECTION DETAILS");
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "READ_UNAVAILABLE" });
});
