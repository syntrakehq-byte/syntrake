import assert from "node:assert/strict";
import test from "node:test";
import {
  InvestingReadBlocked,
  readOwnInvestingAccounts,
  type ReadTransport,
} from "../server/supabaseReadTransport";

const config = {
  url: "https://vbazzxqyuqcrmjytaboc.supabase.co",
  publishableKey: "sb_publishable_" + "x".repeat(32),
};
const ACCOUNT_A = "00000000-0000-4000-8000-000000000011";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000012";
const A = { userId: "clerk_user_a", sessionId: "session_a", getToken: async () => "fixture.a.token" };
const B = { userId: "clerk_user_b", sessionId: "session_b", getToken: async () => "fixture.b.token" };
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { "content-type": "application/json" },
  });
}
async function blocked(operation: Promise<unknown>, code: InvestingReadBlocked["code"]) {
  await assert.rejects(operation, (error: unknown) =>
    error instanceof InvestingReadBlocked && error.code === code,
  );
}

test("Clerk-derived Supabase read transport: fail closed (synthetic HTTP fixtures only)", async (t) => {
  await t.test("two independent user sessions cannot choose a user/account; distinct RLS-scoped responses", async () => {
    const observed: { authorization: string; url: string; method: string; profile: string; apikey: string }[] = [];
    // This is a simulated PostgREST gateway, NOT evidence of real JWT signature validation.
    const transport: ReadTransport = async (url, init) => {
      const headers = new Headers(init.headers);
      const authorization = headers.get("authorization") ?? "";
      observed.push({
        authorization, url, method: init.method ?? "", 
        profile: headers.get("accept-profile") ?? "",
        apikey: headers.get("apikey") ?? "",
      });
      if (authorization === "Bearer fixture.a.token") return json([{
        id: ACCOUNT_A, name: "A", base_currency: "EUR",
      }]);
      if (authorization === "Bearer fixture.b.token") return json([{
        id: ACCOUNT_B, name: "B", base_currency: "EUR",
      }]);
      return json({message: "JWT rejected"}, 401);
    };

    const [left,right] = await Promise.all([
      readOwnInvestingAccounts(A, config, transport),
      readOwnInvestingAccounts(B, config, transport),
    ]);
    assert.deepEqual(left.accounts.map(a=>a.id),[ACCOUNT_A]);
    assert.deepEqual(right.accounts.map(a=>a.id),[ACCOUNT_B]);
    assert.equal(left.actorId, "clerk_user_a");
    assert.equal(right.actorId, "clerk_user_b");
    assert.equal(left.evidence, "SUPABASE_REST_RESPONSE");
    assert.equal(left.state, "AVAILABLE");
    assert.equal(observed.length,2);
    assert.ok(observed.every(x=>x.method==="GET" && x.profile==="investing" && x.apikey===config.publishableKey));
    assert.ok(observed.every(x=>x.url.startsWith(config.url+"/rest/v1/investment_accounts?")));
    assert.ok(observed.every(x=>!x.url.includes("user_id")&&!x.url.includes("clerk_user_")&&!x.url.includes("account_id")));
    assert.ok(observed.every(x=>!x.url.includes("service_role")));
    assert.deepEqual(new Set(observed.map(x=>x.authorization)),new Set(["Bearer fixture.a.token","Bearer fixture.b.token"]));
  });

  await t.test("no session, no token, malformed token never reach network", async () => {
    let called=0;
    const forbidden:ReadTransport = async()=>{called++;throw Error("must not call network");};
    await blocked(readOwnInvestingAccounts({ ...A, userId:null },config,forbidden),"UNAUTHENTICATED");
    await blocked(readOwnInvestingAccounts({ ...A, sessionId:null },config,forbidden),"UNAUTHENTICATED");
    await blocked(readOwnInvestingAccounts({ ...A, getToken:async()=>null },config,forbidden),"TOKEN_UNAVAILABLE");
    await blocked(readOwnInvestingAccounts({ ...A, getToken:async()=> "unsigned" },config,forbidden),"TOKEN_UNAVAILABLE");
    await blocked(readOwnInvestingAccounts({ ...A, getToken:async()=> {throw new Error("clerk failure");} },config,forbidden),"TOKEN_UNAVAILABLE");
    assert.equal(called,0);
  });

  await t.test("blocks wrong Supabase hosts, insecure URLs, and any privileged/malformed API key", async () => {
    let called=0;
    const forbidden:ReadTransport=async()=>{called++;throw Error("must not call network");};
    for(const url of ["http://vbazzxqyuqcrmjytaboc.supabase.co", "https://evil.example/", "https://vbazzxqyuqcrmjytaboc.supabase.co@evil.example", "https://vbazzxqyuqcrmjytaboc.supabase.co/rest/v1/", "https://vbazzxqyuqcrmjytaboc.supabase.co/?foo=bar"]) {
      await blocked(readOwnInvestingAccounts(A,{...config,url},forbidden),"INVALID_CONFIGURATION");
    }
    for(const publishableKey of [undefined,"","sb_secret_secretsecret","eyJ.fake.jwt","service_role"]) {
      await blocked(readOwnInvestingAccounts(A,{...config,publishableKey},forbidden),"INVALID_CONFIGURATION");
    }
    assert.equal(called,0);
  });

  await t.test("rejects invalid JWT at Supabase gateway, denied RLS, malformed JSON, and network errors", async () => {
    const denied:ReadTransport = async()=>json({message:"JWT rejected"},401);
    await blocked(readOwnInvestingAccounts(A,config,denied),"READ_UNAUTHORIZED");
    await blocked(readOwnInvestingAccounts(A,config,async()=>json({message:"RLS denied"},403)),"READ_UNAUTHORIZED");
    await blocked(readOwnInvestingAccounts(A,config,async()=>json({message:"missing schema"},404)),"READ_UNAVAILABLE");
    await blocked(readOwnInvestingAccounts(A,config,async()=>{throw Error("offline");}),"READ_UNAVAILABLE");
    await blocked(readOwnInvestingAccounts(A,config,async()=>new Response("invalid JSON")),"INVALID_READ_RESPONSE");
    await blocked(readOwnInvestingAccounts(A,config,async()=>json([{ id:ACCOUNT_A,name:"A",base_currency:"EUR",extra:"unexpected" }])),"INVALID_READ_RESPONSE");
    await blocked(readOwnInvestingAccounts(A,config,async()=>json({accounts:[]})),"INVALID_READ_RESPONSE");
  });

  await t.test("empty accounts do not imply zero cash or a real provisioned portfolio", async () => {
    const result=await readOwnInvestingAccounts(A,config,async()=>json([]));
    assert.equal(result.state,"EMPTY_OR_UNPROVISIONED");
    assert.deepEqual(result.accounts,[]);
    assert.ok(!("cash" in result));
    assert.ok(!("portfolio" in result));
  });
});
