import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePrivateFirstPortfolioPost, isR2C4PrivateWriteReady,
} from "../server/firstPortfolioPreviewHttp";
const env={
  VERCEL_ENV:"preview",
  VERCEL_GIT_COMMIT_REF:"candidate/investing-r2c4-private-preview-initialization-20261024",
  INVESTING_R2C_PREVIEW_MODE:"enabled",
  INVESTING_R2C_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
  NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_unit_test_1234567890",
  INVESTING_R2C4_PRIVATE_WRITE:"enabled",
  INVESTING_R2C4_PROJECT_REF:"zkqgpejlkgootkvkebhd",
  INVESTING_R2C4_PG_DSN:"postgresql://investing_initial_preview_runtime:ci_placeholder@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres",
  INVESTING_R2C4_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY_NOT_A_REAL_CERTIFICATE\\n-----END CERTIFICATE-----",
};
const url="https://preview.example/api/investing/portfolio/initialize";
const command={
  idempotencyKey:"00000000-0000-4000-8000-000000000321",
  accountName:"Investing Principal",portfolioName:"Long Term",baseCurrency:"EUR",
};
const actor={userId:"user_ci_actorABCDE",sessionId:"sess_ci_clerkABCDE"};
function request(raw:unknown,options?:{origin?:string;type?:string}):Request{
  return new Request(url,{
    method:"POST",
    headers:{"origin":options?.origin??"https://preview.example",
      "content-type":options?.type??"application/json"},
    body:JSON.stringify(raw),
  });
}
test("R2-C4: direct private login, exact preview ref, and strong TLS trust are mandatory",()=>{
  assert.equal(isR2C4PrivateWriteReady(env),true);
  for(const bad of [
    {...env,VERCEL_ENV:"production"},
    {...env,VERCEL_GIT_COMMIT_REF:"main"},
    {...env,VERCEL_GIT_COMMIT_REF:"candidate/another"},
    {...env,INVESTING_R2C4_PRIVATE_WRITE:"disabled"},
    {...env,INVESTING_R2C_PREVIEW_MODE:"disabled"},
    {...env,INVESTING_R2C4_PROJECT_REF:"vbazzxqyuqcrmjytaboc"},
    {...env,INVESTING_R2C4_PG_CA_PEM:""},
    {...env,INVESTING_R2C4_PG_DSN:"postgresql://postgres:secret@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres"},
    {...env,INVESTING_R2C4_PG_DSN:"postgresql://investing_initial_preview_runtime:secret@db.vbazzxqyuqcrmjytaboc.supabase.co:5432/postgres"},
    {...env,INVESTING_R2C4_PG_DSN:"postgresql://investing_initial_preview_runtime:secret@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres?sslmode=disable"},
    {...env,INVESTING_R2C4_PG_DSN:"postgresql://investing_initial_preview_runtime:secret@localhost:5432/postgres"},
  ])assert.equal(isR2C4PrivateWriteReady(bad),false);
});
test("R2-C4: disabled/no authorization never calls Clerk or touches private PG pool",async()=>{
  let authCalls=0,dbCalls=0;
  const done=await handlePrivateFirstPortfolioPost(request(command),
    {...env,VERCEL_ENV:"production"},
    async()=>{authCalls++;return actor;},
    ()=>{dbCalls++;throw Error("must not connect")});
  assert.equal(done.status,404);
  assert.equal(authCalls,0);
  assert.equal(dbCalls,0);
});
test("R2-C4: CSRF, invalid path, query, verb and forged fields blocked before SQL",async()=>{
  let authCalls=0,dbCalls=0;
  const load=async()=>{authCalls++;return actor;};
  const db=()=>{dbCalls++;throw Error("must not connect")};
  for(const req of [
    request(command,{origin:"https://evil.example"}),
    request(command,{type:"text/plain"}),
    new Request(url+"?userId=forged",{method:"POST",headers:{"origin":"https://preview.example",
      "content-type":"application/json"},body:JSON.stringify(command)}),
    new Request(url,{method:"GET"}),
  ]) {
    const result=await handlePrivateFirstPortfolioPost(req,env,load,db);
    assert.notEqual(result.status,200);
    assert.notEqual(result.status,201);
  }
  assert.equal(authCalls,0);
  assert.equal(dbCalls,0);
  for(const forged of [
    {...command,userId:"user_fake_99999"},{...command,tenantId:"other"},
    {...command,accountId:"00000000-0000-4000-8000-000000000100"},
    {...command,cashMinor:"0"},{...command,brokerId:"broker"},
    {...command,tradingBook:"book"},{...command,mandate:"LIVE"},
  ]) {
    const result=await handlePrivateFirstPortfolioPost(request(forged),env,load,db);
    assert.equal(result.status,400);
  }
  assert.equal(dbCalls,0);
});
test("R2-C4: forged declared Content-Length cannot bypass actual byte cap",async()=>{
  let calls=0;
  const oversized={...command,accountName:"x".repeat(1500)};
  const res=await handlePrivateFirstPortfolioPost(
    request(oversized),env,async()=>actor,
    ()=>{calls++;throw Error("DB not allowed")});
  assert.equal(res.status,413);
  assert.equal(calls,0);
});
test("R2-C4: unauthenticated and DB unavailable fail closed without leaking SQL or secrets",async()=>{
  let calls=0;
  const unauthenticated=await handlePrivateFirstPortfolioPost(
    request(command),env,async()=>({userId:null,sessionId:null}),
    ()=>{calls++;throw Error("MUST_NOT_CONNECT")});
  assert.equal(unauthenticated.status,401);
  assert.equal(calls,0);
  const failed=await handlePrivateFirstPortfolioPost(request(command),
    env,async()=>actor,()=>{calls++;throw new Error("PRIVATE_POSTGRES_PASSWORD")});
  assert.equal(failed.status,503);
  const content=await failed.text();
  assert.ok(!content.includes("PRIVATE_POSTGRES_PASSWORD"));
  assert.ok(!content.includes(env.INVESTING_R2C4_PG_DSN));
  assert.equal(failed.headers.get("Cache-Control"),"private,no-store,max-age=0");
});
