import assert from "node:assert/strict";
import test from "node:test";
import {handlePortfolioImportHttp} from "../server/importPreviewHttp";
import {isR2DImportReady} from "../server/importPreviewRuntime";
const env={
  VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"candidate/investing-r2-preview-security-compat-20261024",
  VERCEL_GIT_COMMIT_SHA:"1111111111111111111111111111111111111111",
  INVESTING_R2_APPROVED_PREVIEW_SHA:"1111111111111111111111111111111111111111",
  INVESTING_R2C_PREVIEW_MODE:"enabled",
  INVESTING_R2C_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
  NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_ci_key_1234567890",
  INVESTING_R2D_IMPORT_ENABLED:"enabled",
  INVESTING_R2D_PROJECT_REF:"zkqgpejlkgootkvkebhd",
  INVESTING_R2D_PG_DSN:"postgresql://investing_import_preview_runtime:ci_dummy@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres",
  INVESTING_R2D_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_NOT_REAL\\n-----END CERTIFICATE-----",
};
const url="https://preview.example/api/investing/portfolio/import";
const actor={userId:"user_ci_investing_actor_A",sessionId:"clerk_session_ci"};
const portfolioId="00000000-0000-4000-8000-0000000000a2";
const declaration={
  schemaVersion:"R2_IMPORT_DRAFT_V1",source:"MANUAL_ENTRY",
  sourceReference:"ci-http-r2d-source-001",asOf:"2026-10-24T18:00:00.000Z",
  portfolioName:"Declared",baseCurrency:"EUR",
  reportedCoverage:{cash:"NOT_REPORTED",positions:"PARTIAL"},
  cashBalances:[],positions:[{instrument:{isin:"US0378331005",mic:"XNAS",quoteCurrency:"USD"},
    quantity:"1.000000000001",reportedCostBasis:null}],plannedContributions:[],
};
const body={portfolioId,idempotencyKey:"ci-r2d-web-import-0001",declaration};
function post(payload:unknown,origin="https://preview.example"):Request{
 return new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},
    body:JSON.stringify(payload)});
}
const noDb=()=>{throw new Error("PRIVATE_PG_CREDENTIAL_MUST_NOT_BE_READ")};
test("R2-D gated by exact Preview branch/ref, dedicated NOLOGIN runtime and trusted TLS",()=>{
  assert.equal(isR2DImportReady(env),true);
  for(const x of [
    {...env,VERCEL_ENV:"production"},{...env,VERCEL_GIT_COMMIT_REF:"main"},
    {...env,INVESTING_R2D_IMPORT_ENABLED:"disabled"},
    {...env,INVESTING_R2D_PROJECT_REF:"vbazzxqyuqcrmjytaboc"},
    {...env,NEXT_PUBLIC_SUPABASE_URL:"https://vbazzxqyuqcrmjytaboc.supabase.co"},
    {...env,INVESTING_R2D_PG_CA_PEM:""},
    {...env,INVESTING_R2D_PG_DSN:"postgresql://postgres:root@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres"},
    {...env,INVESTING_R2D_PG_DSN:"postgresql://investing_import_preview_runtime:pw@db.vbazzxqyuqcrmjytaboc.supabase.co:5432/postgres"},
    {...env,INVESTING_R2D_PG_DSN:"postgresql://investing_import_preview_runtime:pw@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres?sslmode=disable"},
  ])assert.equal(isR2DImportReady(x),false);
});
test("R2-D Production/cross-origin/forged body never reaches database",async()=>{
  let called=0;const auth=async()=>{called++;return actor};
  const blocked=await handlePortfolioImportHttp(post(body),{...env,VERCEL_ENV:"production"},auth,noDb);
  assert.equal(blocked.status,404);assert.equal(called,0);
  for(const req of [
    post(body,"https://attacker.example"),
    post({...body,userId:"user_victim_1234"}),
    post({...body,declaration:{...declaration,brokerConfirmed:true}}),
    new Request(url+"?userId=victim",{method:"POST",headers:{"origin":"https://preview.example","content-type":"application/json"},body:JSON.stringify(body)}),
    new Request(url+"?portfolioId="+portfolioId+"&snapshotId=not-a-uuid"),
    new Request(url+"?portfolioId="+portfolioId+"&userId=victim"),
    new Request(url+"?portfolioId="+portfolioId+"&portfolioId="+portfolioId),
  ]){
    const res=await handlePortfolioImportHttp(req,env,auth,noDb);
    assert.notEqual(res.status,200);assert.notEqual(res.status,201);
  }
  const noAuth=await handlePortfolioImportHttp(post(body),env,
    async()=>({userId:null,sessionId:null}),noDb);
  assert.equal(noAuth.status,401);
  const unauthorized=await handlePortfolioImportHttp(post(body),env,
    async()=>({userId:"forged",sessionId:"sess"}),noDb);
  assert.equal(unauthorized.status,401);
});
test("R2-D enforces actual byte limit even with declared size absent; generic connection failure",async()=>{
  const oversized=post({...body,declaration:{...declaration,portfolioName:"x".repeat(1048600)}});
  const res=await handlePortfolioImportHttp(oversized,env,async()=>actor,noDb);
  assert.equal(res.status,413);
  const down=await handlePortfolioImportHttp(post(body),env,async()=>actor,noDb);
  assert.equal(down.status,503);
  const text=await down.text();
  assert.ok(!text.includes("PRIVATE_PG_CREDENTIAL"));
  assert.ok(!text.includes(env.INVESTING_R2D_PG_DSN));
  assert.equal(down.headers.get("Cache-Control"),"private, no-store, max-age=0");
});
