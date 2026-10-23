import test from "node:test";
import assert from "node:assert/strict";
import {verifyClerkABReadOnly,VerificationBlocked} from "./clerk-ab-readonly.mjs";
const projectUrl="https://zkqgpejlkgootkvkebhd.supabase.co/";
const publishableKey="sb_publishable_abcdefghijklmnopqrstuvwxyz";
const uuid={a:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",b:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",pa:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",pb:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"};
function token(sub) {
  const payload={sub,role:"authenticated",iss:"https://clerk.example.test",aud:"syntrake",exp:Math.floor(Date.now()/1000)+3600};
  return "e30."+Buffer.from(JSON.stringify(payload)).toString("base64url")+".signature";
}
const tokenA=token("user_test_actor_AAAAA"),tokenB=token("user_test_actor_BBBBB");
function mockFetch({leak=false,forgeAccepted=false,emptyB=false}={}){
  return async (input,init)=>{
    assert.equal(init.method,"GET"); // guarantee: test suite refuses writes
    assert.equal(init.headers["Accept-Profile"],"investing");
    const bearer=init.headers.Authorization?.replace("Bearer ","");
    if (!bearer||![tokenA,tokenB].includes(bearer)){
      if (!forgeAccepted)return {status:403};
      return {status:200,json:async()=>[]};
    }
    const isA=bearer===tokenA,sub=isA?"user_test_actor_AAAAA":"user_test_actor_BBBBB";
    const ownId=isA?uuid.a:uuid.b, ownP=isA?uuid.pa:uuid.pb;
    const url=new URL(input);let data;
    if (url.pathname.endsWith("/investment_accounts"))
      data=emptyB&&!isA?[]:[{id:ownId,owner_user_id:sub}];
    else if (url.pathname.endsWith("/portfolios"))
      data=emptyB&&!isA?[]:[{id:ownP,investment_account_id:ownId}];
    else if (url.pathname.endsWith("/initial_portfolio_receipts"))
      data=emptyB&&!isA?[]:[{user_id:sub,account_id:ownId}];
    else if (url.pathname.endsWith("/onboarding_intents"))
      data=emptyB&&!isA?[]:[{id:ownP,actor_user_id:sub}];
    else throw Error("unexpected table");
    if (url.searchParams.has("id")) {
      const v=url.searchParams.get("id");data=data.filter(row=>v.includes(row.id));
    }
    for(const field of ["user_id","actor_user_id"]) {
      if(url.searchParams.has(field))data=data.filter(row=>row[field]===url.searchParams.get(field).slice(3));
    }
    if (leak&&!isA&&url.pathname.endsWith("investment_accounts")&&url.searchParams.has("id"))
      data=[{id:uuid.a}];
    return {status:200,json:async()=>data};
  };
}
const conf=(fetchImpl,others={})=>({projectUrl,publishableKey,tokenA,tokenB,fetchImpl,...others});
test("valid separate actors, own reads, foreign filters, and bad signatures => PASS",async()=>{
  const result=await verifyClerkABReadOnly(conf(mockFetch()));
  assert.equal(result.state,"PASS_READ_ONLY_AB");
  assert.deepEqual(result.a,{accountCount:1,portfolioCount:1,receiptCount:1});
});
test("refuses production or mismatched project before any HTTP",async()=>{
  await assert.rejects(verifyClerkABReadOnly(conf(mockFetch(),{projectUrl:"https://vbazzxqyuqcrmjytaboc.supabase.co"})),e=>e.code==="WRONG_PROJECT_OR_PRODUCTION_BLOCKED");
});
test("distinct Clerk sessions required",async()=>{
  await assert.rejects(verifyClerkABReadOnly(conf(mockFetch(),{tokenB:tokenA})),e=>e.code==="A_AND_B_NOT_DISTINCT_COMPATIBLE_CLERK_SESSIONS");
});
test("no B owned account is INCONCLUSIVE, never PASS",async()=>{
  await assert.rejects(verifyClerkABReadOnly(conf(mockFetch({emptyB:true}))),e=>e.code==="INCONCLUSIVE_MISSING_OWN_ACCOUNTS_OR_PORTFOLIOS");
});
test("foreign account leakage is blocked",async()=>{
  await assert.rejects(verifyClerkABReadOnly(conf(mockFetch({leak:true}))),e=>e.code==="CROSS_IDENTITY_RECORD_ACCESSIBLE");
});
test("forged token acceptance by gateway is blocked",async()=>{
  await assert.rejects(verifyClerkABReadOnly(conf(mockFetch({forgeAccepted:true}))),e=>e.code==="UNSIGNED_OR_TAMPERED_JWT_NOT_REJECTED");
});
test("never yields PASS if token has expired",async()=>{
  const bad="e30."+Buffer.from(JSON.stringify({sub:"user_test_actor_AAAAA",role:"authenticated",iss:"https://clerk.example.test",aud:"syntrake",exp:1})).toString("base64url")+".signature";
  await assert.rejects(verifyClerkABReadOnly(conf(mockFetch(),{tokenA:bad})),e=>e instanceof VerificationBlocked&&e.code==="INVALID_CLAIMS_OR_EXPIRED");
});
