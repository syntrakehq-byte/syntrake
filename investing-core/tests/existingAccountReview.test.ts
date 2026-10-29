import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectOwnExistingInvestingAccounts, ExistingAccountReadBlocked,
} from "../server/existingAccountReview";
import { handleExistingAccountReviewGet } from "../server/existingAccountReviewHttp";

const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "candidate/investing-r2-preview-security-compat-20261024",
  VERCEL_GIT_COMMIT_SHA:"1111111111111111111111111111111111111111",
  INVESTING_R2_APPROVED_PREVIEW_SHA:"1111111111111111111111111111111111111111",
  INVESTING_R2C_PREVIEW_MODE: "enabled",
  SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
  INVESTING_R2C_SUPABASE_PROJECT_REF: "zkqgpejlkgootkvkebhd",
  NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_testing_key_1234567890",
};
const A = {
  userId: "user_ci_own_actor_A",
  sessionId: "session_a",
  getToken: async () => "head.payload.signature",
};
const ownAccount = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondAccount = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ownPortfolio = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const denied = (code: string) => (e: unknown) =>
  e instanceof ExistingAccountReadBlocked && e.code === code;
type Call = { url: string; init: RequestInit };
function fakeDb(accounts: unknown, portfolios: unknown) {
  const calls: Call[] = [];
  const transport = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(url.includes("/investment_accounts?") ? accounts : portfolios);
  };
  return { calls, transport };
}
test("R2-C3 existing account: own-account/portfolio readback stays UNAVAILABLE financially", async () => {
  const { calls, transport } = fakeDb(
    [{ id: ownAccount, owner_user_id: A.userId }],
    [{ id: ownPortfolio, investment_account_id: ownAccount }],
  );
  const result = await inspectOwnExistingInvestingAccounts(env, A, transport);
  assert.deepEqual(result, {
    kind: "EXISTING_INVESTING_ACCOUNTS",
    accountId: ownAccount, portfolioIds: [ownPortfolio],
    accountMultiplicity: "ONE", financialTruth: "UNAVAILABLE",
    reconciliation: "REQUIRED", evidence: "SUPABASE_RLS_READ",
    financialWrites: false,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result?.portfolioIds), true);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.init.method, "GET");
    assert.equal((c.init.headers as Record<string, string>).Authorization,
      "Bearer head.payload.signature");
    assert.equal((c.init.headers as Record<string, string>)["Accept-Profile"], "investing");
    assert.equal(c.init.cache, "no-store");
    assert.ok(c.url.startsWith(env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/"));
    assert.equal(new URL(c.url).searchParams.get("order"), "id.asc");
  }
  assert.equal(new URL(calls[0].url).searchParams.get("owner_user_id"), "eq." + A.userId);
  assert.equal(new URL(calls[1].url).searchParams.get("investment_account_id"), "eq." + ownAccount);
  assert.ok(!JSON.stringify(result).includes(A.userId));
});
test("R2-C3 one account without a portfolio does not invent holdings or portfolio IDs", async () => {
  const db = fakeDb([{ id: ownAccount, owner_user_id: A.userId }], []);
  const result = await inspectOwnExistingInvestingAccounts(env, A, db.transport);
  assert.deepEqual(result?.portfolioIds, []);
  assert.equal(result?.financialTruth, "UNAVAILABLE");
});
test("R2-C3 no account is null; multiple accounts not randomly selected", async () => {
  const absent = fakeDb([], []);
  assert.equal(await inspectOwnExistingInvestingAccounts(env, A, absent.transport), null);
  assert.equal(absent.calls.length, 1);
  const multiple = fakeDb([
    { id: ownAccount, owner_user_id: A.userId },
    { id: secondAccount, owner_user_id: A.userId },
  ], []);
  const result = await inspectOwnExistingInvestingAccounts(env, A, multiple.transport);
  assert.equal(result?.accountMultiplicity, "MULTIPLE");
  assert.equal(result?.accountId, null);
  assert.deepEqual(result?.portfolioIds, []);
  assert.equal(multiple.calls.length, 1);
});
test("R2-C3 reject forged cross-owner data and inconsistent position responses", async () => {
  for (const accounts of [
    [{ id: ownAccount, owner_user_id: "user_another_person" }],
    [{ id: "FORGED", owner_user_id: A.userId }],
    [{ id: ownAccount, owner_user_id: A.userId, cash_minor: "0" }],
    [{ id: ownAccount, owner_user_id: A.userId },
     { id: ownAccount, owner_user_id: A.userId }],
  ]) {
    const db = fakeDb(accounts, []);
    await assert.rejects(inspectOwnExistingInvestingAccounts(env, A, db.transport),
      denied("READ_UNAVAILABLE"));
  }
  for (const portfolios of [
    [{ id: ownPortfolio, investment_account_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
    [{ id: ownPortfolio, investment_account_id: ownAccount, marketValue: 0 }],
    [{ id: ownPortfolio, investment_account_id: ownAccount },
     { id: ownPortfolio, investment_account_id: ownAccount }],
    Array.from({length: 51}, (_, i) => ({
      id: i === 0 ? ownPortfolio : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      investment_account_id: ownAccount,
    })),
  ]) {
    const db = fakeDb([{id: ownAccount, owner_user_id: A.userId}], portfolios);
    await assert.rejects(inspectOwnExistingInvestingAccounts(env, A, db.transport),
      denied("READ_UNAVAILABLE"));
  }
});
test("R2-C3 reject invalid auth, missing JWT and wrong Preview target before network access", async () => {
  let calls = 0;
  const transport = async () => { calls++; return Response.json([]); };
  for (const actor of [
    { ...A, userId: null }, { ...A, sessionId: null },
    { ...A, userId: "forged" },
  ]) await assert.rejects(inspectOwnExistingInvestingAccounts(env, actor, transport),
    denied("UNAUTHENTICATED"));
  for (const actor of [
    { ...A, getToken: async () => null },
    { ...A, getToken: async () => "not.jwt!" },
  ]) await assert.rejects(inspectOwnExistingInvestingAccounts(env, actor, transport),
    denied("NOT_AUTHORIZED"));
  for (const settings of [
    { ...env, VERCEL_ENV: "production" },
    { ...env, VERCEL_GIT_COMMIT_REF: "main" },
    { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://vbazzxqyuqcrmjytaboc.supabase.co" },
    { ...env, INVESTING_R2C_PREVIEW_MODE: "disabled" },
  ]) await assert.rejects(inspectOwnExistingInvestingAccounts(settings, A, transport),
    denied("DISABLED"));
  assert.equal(calls, 0);
});
test("R2-C3 network/provider errors and malformed read fail closed", async () => {
  for (const status of [401,403,500]) {
    await assert.rejects(inspectOwnExistingInvestingAccounts(env, A,
      async () => Response.json({error:"hidden"},{status})),
    denied(status === 500 ? "READ_UNAVAILABLE" : "NOT_AUTHORIZED"));
  }
  await assert.rejects(inspectOwnExistingInvestingAccounts(env, A,
    async () => {throw new Error("transport hidden");}),denied("READ_UNAVAILABLE"));
  await assert.rejects(inspectOwnExistingInvestingAccounts(env, A,
    async () => Response.json({bad: true})),denied("READ_UNAVAILABLE"));
});
test("R2-C3 GET endpoint: no public writes, paths or cross-actor inputs", async () => {
  const db = fakeDb([{id: ownAccount,owner_user_id:A.userId}],[]);
  const url = "https://preview.example/api/investing/existing-account";
  const valid = await handleExistingAccountReviewGet(new Request(url),env,
    async () => A,db.transport);
  assert.equal(valid.status,200);
  const value = await valid.json();
  assert.equal(value.financialWrites,false);
  assert.equal(value.financialTruth,"UNAVAILABLE");
  assert.equal(value.state,"EXISTING_ACCOUNT_REVIEW_REQUIRED");
  assert.equal(value.existing.accountId,ownAccount);
  assert.equal(db.calls.length,2);
  assert.equal(valid.headers.get("Cache-Control"),"private, no-store, max-age=0");
  for (const request of [
    new Request(url,{method:"POST",body:"{}"}),
    new Request(url+"?account_id="+secondAccount),
    new Request("https://preview.example/api/investing/other"),
  ]) assert.notEqual((await handleExistingAccountReviewGet(request,env,async()=>A,db.transport)).status,200);
  assert.equal(db.calls.length,2);
  const blocked = await handleExistingAccountReviewGet(new Request(url),
    {...env,VERCEL_ENV:"production"},async()=>A,db.transport);
  assert.equal(blocked.status,404);
  assert.equal(db.calls.length,2);
  const noSession = await handleExistingAccountReviewGet(new Request(url),env,
    async()=>({...A,userId:null}),db.transport);
  assert.equal(noSession.status,401);
  const error = await handleExistingAccountReviewGet(new Request(url),env,
    async()=>A,async()=>new Response(null,{status:503}));
  assert.equal(error.status,503);
  assert.equal((await error.json()).error,"READ_UNAVAILABLE");
});
