import assert from "node:assert/strict";
import test from "node:test";
import {initializeCommand,initializeFirstInvestingPortfolio,InitialPortfolioBlocked}
 from "../server/initializeFirstPortfolio";
import {isR2C2PreviewReady} from "../server/initialPortfolioRuntime";
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
