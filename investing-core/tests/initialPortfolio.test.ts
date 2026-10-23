import assert from "node:assert/strict";
import test from "node:test";
import {initializeCommand,initializeFirstInvestingPortfolio,InitialPortfolioBlocked}
 from "../server/initializeFirstPortfolio";
import {isR2C2PreviewReady,provisionViaVerifiedJwt,readViaVerifiedJwt}
 from "../server/initialPortfolioRuntime";
import {isR2CPreviewEnabled} from "../server/onboardingTransport";
const base={
 VERCEL_ENV:"preview",
 VERCEL_GIT_COMMIT_REF:"candidate/investing-r2c2-first-portfolio-20261023",
 INVESTING_R2C2_PREVIEW_MODE:"enabled",
 INVESTING_R2C2_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
 INVESTING_R2C_PREVIEW_MODE:"enabled",
 INVESTING_R2C_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
 NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_unit_fixture_abcdefghijklmnopqrstuvwxyz",
};
test("R2-C2 Preview exclusively: Production, wrong branch and DB project fail closed",()=>{
 assert.equal(isR2C2PreviewReady(base),true);
 assert.equal(isR2CPreviewEnabled(base),true);
 for(const drift of [
  {...base,VERCEL_ENV:"production"},
  {...base,VERCEL_GIT_COMMIT_REF:"main"},
  {...base,VERCEL_GIT_COMMIT_REF:"candidate/investing-r2c-onboarding-20261022"},
  {...base,INVESTING_R2C2_PREVIEW_MODE:"disabled"},
  {...base,INVESTING_R2C2_SUPABASE_PROJECT_REF:"vbazzxqyuqcrmjytaboc"},
 ])assert.equal(isR2C2PreviewReady(drift),false);
});
test("R2-C2 strict initial request rejects tenant, financial cash and order injection",()=>{
 const ok={idempotencyKey:"00000000-0000-4000-8000-000000000321",
 accountName:"Investing Principal",portfolioName:"Long Term",baseCurrency:"EUR"};
 assert.equal(initializeCommand.safeParse(ok).success,true);
 for(const bad of [
  {...ok,userId:"user_forger"}, {...ok,investmentAccountId:"00000000-0000-4000-8000-000000000321"},
  {...ok,cash:3000}, {...ok,tradingBookId:"attack"}, {...ok,authorization:"LIVE"},
  {...ok,baseCurrency:"BTC"}, {...ok,accountName:" "},
  {...ok,portfolioName:"z".repeat(200)},
 ])assert.equal(initializeCommand.safeParse(bad).success,false);
});
test("R2-C2 fails before DB connect with malformed input or unauthenticated actor",async()=>{
 const pool={connect:async()=>{throw new Error("must never connect")}};
 await assert.rejects(initializeFirstInvestingPortfolio(pool as never,
  {userId:null,sessionId:null},{}),
  (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="UNAUTHENTICATED");
 await assert.rejects(initializeFirstInvestingPortfolio(pool as never,
  {userId:"user_clerk_test_actor",sessionId:"session-123"},{baseCurrency:"EUR"}),
  (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="INVALID_INPUT");
});

test("R2-C2 restricted RPC uses only a real server Clerk JWT, no DB password or actor parameter",async()=>{
 const actor={userId:"user_authenticated_actor_test",sessionId:"sess_clerk",getToken:async()=>"header.payload.signature"};
 const calls:{url:string;options:RequestInit}[]=[];
 const transport=async(url:string,options:RequestInit):Promise<Response>=>{
  calls.push({url,options});
  if(options.method==="POST")
   return Response.json([{account_id:"00000000-0000-4000-8000-000000000123",
     portfolio_id:"00000000-0000-4000-8000-000000000124",
     state:"STRUCTURE_CREATED_UNFUNDED"}]);
  return Response.json([{account_id:"00000000-0000-4000-8000-000000000123",
    portfolio_id:"00000000-0000-4000-8000-000000000124"}]);
 };
 const request={idempotencyKey:"00000000-0000-4000-8000-000000000031",
  accountName:"Main Investing",portfolioName:"Long Term",baseCurrency:"EUR"};
 const saved=await provisionViaVerifiedJwt(base,actor,request,transport);
 assert.equal(saved.financialTruth,"UNAVAILABLE");
 assert.equal(saved.ledgerMovementsCreated,false);
 assert.equal(saved.cashBalance,"UNAVAILABLE");
 assert.deepEqual(await readViaVerifiedJwt(base,actor,transport),saved);
 assert.equal(calls.length,2);
 const sent=JSON.parse(String(calls[0].options.body)) as Record<string,unknown>;
 assert.deepEqual(Object.keys(sent).sort(),[
 "p_account_name","p_base_currency","p_idempotency_key","p_portfolio_name"].sort());
 assert.equal(sent.userId,undefined);
 assert.ok(calls[0].url.endsWith("/rest/v1/rpc/provision_first_portfolio"));
 assert.ok(calls[1].url.includes("/rest/v1/initial_portfolio_receipts"));
 const firstHeaders=calls[0].options.headers as Record<string,string>;
 assert.equal(firstHeaders.Authorization,"Bearer header.payload.signature");
 assert.equal(firstHeaders["Content-Profile"],"investing");
 assert.ok(!JSON.stringify(calls).includes("DATABASE_URL"));
 await assert.rejects(provisionViaVerifiedJwt(base,{...actor,userId:null},request,transport),
 (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="UNAUTHENTICATED");
 await assert.rejects(provisionViaVerifiedJwt(base,actor,{...request,ownerUserId:"user_attacker"},transport),
 (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="INVALID_INPUT");
 assert.equal(calls.length,2);
});
test("R2-C2 PostgREST errors and invalid responses fail closed",async()=>{
 const actor={userId:"user_authenticated_actor_test",sessionId:"sess_clerk",getToken:async()=>"header.payload.signature"};
 const request={idempotencyKey:"00000000-0000-4000-8000-000000000031",
  accountName:"Main Investing",portfolioName:"Long Term",baseCurrency:"EUR"};
 for(const [code,expected] of [
  ["P1203","INITIAL_PORTFOLIO_ALREADY_EXISTS"],
  ["P1204","NO_ONBOARDING_INTENT"],
  ["42501","WRITE_UNAVAILABLE"],
 ]){
  await assert.rejects(provisionViaVerifiedJwt(base,actor,request,
    async()=>Response.json({code,message:"internal query details"},{status:400})),
   (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code===expected);
 }
 await assert.rejects(provisionViaVerifiedJwt(base,actor,request,
  async()=>Response.json([], {status:200})),
  (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="WRITE_UNAVAILABLE");
 assert.equal(await readViaVerifiedJwt(base,actor,async()=>Response.json([])),null);
});
