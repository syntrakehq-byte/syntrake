import assert from "node:assert/strict";
import test from "node:test";
import { isR1AccountReadEnabled, handleR1AccountsRead } from "../server/accountsReadHttp";
import { InvestingReadBlocked, type InvestingReadResult } from "../server/supabaseReadTransport";

const prodRef = "vbazzxqyuqcrmjytaboc";
const previewRef = "zkqgpejlkgootkvkebhd";
const sha = "a".repeat(40);
const production = {
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_GIT_COMMIT_SHA: sha,
  INVESTING_R1_PRODUCTION_APPROVED_SHA: sha,
  INVESTING_R1_PRODUCTION_READ_MODE: "enabled",
  INVESTING_R1_SUPABASE_PROJECT_REF: prodRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${prodRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "z".repeat(24),
};
const testRead: InvestingReadResult = {
  evidence: "SUPABASE_REST_RESPONSE",
  actorId: "CI_ONLY_FAKE_ACTOR_NOT_REAL",
  state: "AVAILABLE",
  accounts: [{id:"00000000-0000-4000-8000-000000000033",name:"CI fake account",baseCurrency:"EUR"}],
};

test("prod R1 gate requires explicit mode AND exact deployed immutable SHA, not only settings", () => {
  assert.equal(isR1AccountReadEnabled(production), true, "pure configuration contract, NOT a real production deployment");
  const negatives: Record<string, string | undefined>[] = [
    { INVESTING_R1_PRODUCTION_READ_MODE: undefined },
    { INVESTING_R1_PRODUCTION_READ_MODE: "disabled" },
    { INVESTING_R1_PRODUCTION_READ_MODE: "true" },
    { INVESTING_R1_PRODUCTION_APPROVED_SHA: undefined },
    { INVESTING_R1_PRODUCTION_APPROVED_SHA: "a".repeat(39) },
    { INVESTING_R1_PRODUCTION_APPROVED_SHA: "A".repeat(40) },
    { INVESTING_R1_PRODUCTION_APPROVED_SHA: "b".repeat(40) },
    { VERCEL_GIT_COMMIT_SHA: undefined },
    { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    { VERCEL_GIT_COMMIT_REF: "candidate/investing-r1-production-readonly-release-20261020" },
    { VERCEL_GIT_COMMIT_REF: undefined },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development" },
    { VERCEL_ENV: undefined },
    { INVESTING_R1_SUPABASE_PROJECT_REF: previewRef },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co` },
    { INVESTING_R1_SUPABASE_PROJECT_REF: previewRef, NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: "https://" + prodRef + ".supabase.co/" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://" + prodRef + ".supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://" + prodRef + ".supabase.co.attacker.invalid" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_" + "z".repeat(32) },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "service_role" },
  ];
  for (const delta of negatives) {
    assert.equal(isR1AccountReadEnabled({...production, ...delta}), false, JSON.stringify(delta));
  }
  assert.equal(isR1AccountReadEnabled({}), false);
});

test("prod endpoint is 404 when disabled and never accesses Clerk/DB in that state", async () => {
  let touched = 0;
  const result = await handleR1AccountsRead(
    "https://www.syntrake.com/api/investing/accounts",
    {...production,INVESTING_R1_PRODUCTION_READ_MODE:"disabled"},
    async () => {touched++;return testRead;}
  );
  assert.equal(result.status, 404);
  assert.deepEqual(await result.json(), {error:"NOT_FOUND"});
  assert.equal(touched, 0);
});

test("contract-positive synthetic case returns only accounts; no actor/financial state", async () => {
  const result = await handleR1AccountsRead("https://www.syntrake.com/api/investing/accounts", production, async()=>testRead);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(),{
    state:"AVAILABLE",accounts:testRead.accounts,source:"SUPABASE_RLS_READ",financialState:"NOT_INCLUDED"
  });
  assert.equal(result.headers.get("cache-control"),"private, no-store, max-age=0");
});

test("prod gate blocks cross-user/tenant/account selection even in mocked enabled mode", async () => {
  let count=0;
  for(const url of [
    "https://www.syntrake.com/api/investing/accounts?actor=attacker",
    "https://www.syntrake.com/api/investing/accounts?accountId=00000000-0000-4000-8000-000000000033",
    "https://www.syntrake.com/api/investing/accounts?tenant=other",
  ]){
    const result=await handleR1AccountsRead(url,production,async()=>{count++;return testRead;});
    assert.equal(result.status,400,url);
  }
  assert.equal(count,0);
});

test("candidate Preview still opt-in and can never use production project ref", () => {
  const preview = {
    ...production,
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "candidate/investing-r1-production-readonly-release-20261020",
    INVESTING_R1_ACCOUNTS_READ_MODE: "enabled",
    INVESTING_R1_SUPABASE_PROJECT_REF: previewRef,
    NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
  };
  assert.equal(isR1AccountReadEnabled(preview), true);
  assert.equal(isR1AccountReadEnabled({...preview,INVESTING_R1_ACCOUNTS_READ_MODE:"disabled"}),false);
  assert.equal(isR1AccountReadEnabled({...preview,INVESTING_R1_SUPABASE_PROJECT_REF:prodRef,NEXT_PUBLIC_SUPABASE_URL:`https://${prodRef}.supabase.co`}),false);
});


test("R1-C production error mapping remains fail closed without synthetic zero balances", async () => {
  const cases = [
    ["UNAUTHENTICATED", 401, "UNAUTHENTICATED"],
    ["READ_UNAUTHORIZED", 403, "BLOCKED"],
    ["TOKEN_UNAVAILABLE", 503, "READ_UNAVAILABLE"],
    ["INVALID_CONFIGURATION", 503, "READ_UNAVAILABLE"],
    ["INVALID_READ_RESPONSE", 503, "READ_UNAVAILABLE"],
    ["READ_UNAVAILABLE", 503, "READ_UNAVAILABLE"],
  ] as const;

  for (const [code, status, reason] of cases) {
    const response = await handleR1AccountsRead(
      "https://www.syntrake.com/api/investing/accounts",
      production,
      async () => { throw new InvestingReadBlocked(code); },
    );
    assert.equal(response.status, status, code);
    const body = await response.json();
    assert.deepEqual(body, { error: reason });
    assert.equal(JSON.stringify(body).includes("CI_ONLY_FAKE_ACTOR"), false);
    assert.equal("accounts" in body, false);
    assert.equal("cash" in body, false);
    assert.equal("balance" in body, false);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});

test("R1-C rehearsal branch never becomes readable merely through global Preview flags", async () => {
  const rehearse = {
    ...production,
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "candidate/investing-r1c-release-rehearsal-20261021",
    INVESTING_R1_ACCOUNTS_READ_MODE: "enabled",
    INVESTING_R1_SUPABASE_PROJECT_REF: previewRef,
    NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
  };
  assert.equal(isR1AccountReadEnabled(rehearse), false);
  let requested = false;
  const response = await handleR1AccountsRead(
    "https://www.syntrake.com/api/investing/accounts",
    rehearse,
    async () => { requested = true; return testRead; },
  );
  assert.equal(requested, false);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
});
