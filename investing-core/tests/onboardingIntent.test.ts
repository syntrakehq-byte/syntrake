import assert from "node:assert/strict";
import test from "node:test";
import {
 onboardingChoiceSchema,onboardingCommandSchema,onboardingFingerprint,
 parseStoredOnboardingRow,
} from "../onboarding/onboardingIntent";
import {isR2CPreviewEnabled,latestOnboarding,declareOnboarding,OnboardingBlocked} from "../server/onboardingTransport";
import {handleInvestingOnboardingHttp} from "../server/onboardingHttp";

const preview={
 VERCEL_ENV:"preview",
 VERCEL_GIT_COMMIT_REF:"candidate/investing-r2c3-existing-account-read-20261024",
 INVESTING_R2C_PREVIEW_MODE:"enabled",
 INVESTING_R2C_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
 NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_testing_key_0123456789",
};
const actor={userId:"user_clerk_a_test",sessionId:"session-a",getToken:async()=> "header.payload.signature"};
const sample={pathway:"NEEDS_PORTFOLIO" as const,objective:"WEALTH_GROWTH" as const,horizonYears:15,lossCapacity:"MEDIUM" as const};
const sampleRow={
 id:"00000000-0000-4000-8000-000000000101",
 pathway:"NEEDS_PORTFOLIO",
 import_source:null,
 objective:"WEALTH_GROWTH",
 horizon_years:15,
 loss_capacity:"MEDIUM",
 evidence:"USER_REPORTED",
 financial_state:"NOT_PROVISIONED",
 created_at:"2026-10-22T19:00:00.000Z",
};
function mockCalls(){
 const calls:{url:string;init:RequestInit}[]=[];
 const transport=async(url:string,init:RequestInit)=>{
  calls.push({url,init});
  if(init.method==="POST")return new Response(null,{status:201});
  return Response.json([sampleRow],{status:200});
 };
 return {calls,transport};
}
test("R2-C strict, separate Investing paths: no financial or trading authority",()=>{
 assert.deepEqual(onboardingChoiceSchema.parse(sample),sample);
 assert.deepEqual(onboardingChoiceSchema.parse({
  pathway:"HAS_PORTFOLIO",importSource:"MANUAL_ENTRY",
 }),{pathway:"HAS_PORTFOLIO",importSource:"MANUAL_ENTRY"});
 for(const malformed of [
  {...sample,userId:"user_wrong"}, {...sample,capital:20000},
  {...sample,accountId:"00000000-0000-4000-8000-000000000101"},
  {...sample,tradingBook:"trade"}, {...sample,riskMandate:{auto:true}},
  {...sample,horizonYears:0},{...sample,horizonYears:61},
  {...sample,horizonYears:2.5},{...sample,lossCapacity:"GUARANTEED_RETURN"},
  {pathway:"NEEDS_PORTFOLIO",importSource:"MANUAL_ENTRY"},
  {pathway:"HAS_PORTFOLIO",objective:"RETIREMENT"},
 ])assert.equal(onboardingChoiceSchema.safeParse(malformed).success,false);
 assert.equal(onboardingCommandSchema.safeParse({
  idempotencyKey:"00000000-0000-4000-8000-000000000011",choice:sample,actorId:"forged",
 }).success,false);
 assert.notEqual(onboardingFingerprint(sample),onboardingFingerprint({...sample,horizonYears:16}));
 assert.equal(onboardingFingerprint(sample),onboardingFingerprint(onboardingChoiceSchema.parse({...sample})));
 assert.equal(parseStoredOnboardingRow(sampleRow).financialState,"NOT_PROVISIONED");
 assert.throws(()=>parseStoredOnboardingRow({...sampleRow,evidence:"VERIFIED"}));
});
test("R2-C Preview gate pins isolated branch and Supabase ref, Production always 404",()=>{
 assert.equal(isR2CPreviewEnabled(preview),true);
 for(const env of [
  {...preview,VERCEL_ENV:"production"},
  {...preview,VERCEL_GIT_COMMIT_REF:"main"},
  {...preview,VERCEL_GIT_COMMIT_REF:"candidate/investing-r2b1-persistent-import-20261022"},
  {...preview,INVESTING_R2C_PREVIEW_MODE:""},
  {...preview,INVESTING_R2C_SUPABASE_PROJECT_REF:"vbazzxqyuqcrmjytaboc"},
  {...preview,NEXT_PUBLIC_SUPABASE_URL:"https://vbazzxqyuqcrmjytaboc.supabase.co"},
  {...preview,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"service_role_secret"},
 ])assert.equal(isR2CPreviewEnabled(env),false);
});
test("R2-C POST is server Clerk-bound, no caller authority, and reads before declaring replay",async()=>{
 const {calls,transport}=mockCalls();
 const command={idempotencyKey:"00000000-0000-4000-8000-000000000012",choice:sample};
 const result=await declareOnboarding(preview,actor,command,transport);
 assert.equal(result.financialState,"NOT_PROVISIONED");
 assert.equal(calls.length,2);
 const payload=JSON.parse(String(calls[0].init.body));
 assert.equal(payload.actor_user_id,actor.userId);
 assert.equal(payload.financial_state,"NOT_PROVISIONED");
 assert.equal(payload.payload_sha256,onboardingFingerprint(sample));
 assert.equal(payload.brokerId,undefined);
 assert.equal(calls[0].init.method,"POST");
 assert.ok(String((calls[0].init.headers as Record<string,string>).Authorization).startsWith("Bearer "));
 assert.ok(calls[0].url.includes("on_conflict=actor_user_id"));
 assert.ok(calls[1].url.includes("idempotency_key=eq."));
 assert.deepEqual((await latestOnboarding(preview,actor,transport))?.choice,sample);
 await assert.rejects(
  declareOnboarding(preview,actor,{...command,actorId:"user_attack"},transport),
  (e:unknown)=>e instanceof OnboardingBlocked&&e.code==="INVALID_INPUT");
 assert.equal(calls.length,3,"bad input must not contact remote");
 await assert.rejects(
  declareOnboarding(preview,{...actor,userId:null},command,transport),
  (e:unknown)=>e instanceof OnboardingBlocked&&e.code==="UNAUTHENTICATED");
});
test("R2-C HTTP rejects cross-origin POST, bad paths, no session, and disabled production",async()=>{
 const command={idempotencyKey:"00000000-0000-4000-8000-000000000012",choice:sample};
 const body=JSON.stringify(command);
 const request=(origin:string|null,url="https://preview.example/api/investing/onboarding")=>
  new Request(url,{method:"POST",headers:{
   ...(origin?{Origin:origin}:{}),"Content-Type":"application/json",
  },body});
 const load=async()=>actor;
 const {transport,calls}=mockCalls();
 const valid=await handleInvestingOnboardingHttp(request("https://preview.example"),preview,load,transport);
 assert.equal(valid.status,201);
 assert.equal((await valid.json()).executionAuthority,"NONE");
 for(const illegal of [
   request("https://attacker.example"),request(null),
   request("https://preview.example","https://preview.example/api/investing/onboarding?userId=forged"),
 ]){
  assert.notEqual((await handleInvestingOnboardingHttp(illegal,preview,load,transport)).status,201);
 }
 assert.equal(calls.length,2);
 const bad=await handleInvestingOnboardingHttp(request("https://preview.example"),{...preview,VERCEL_ENV:"production"},load,transport);
 assert.equal(bad.status,404);
 const noActor=await handleInvestingOnboardingHttp(
  new Request("https://preview.example/api/investing/onboarding"),preview,
  async()=>({...actor,userId:null}),transport);
 assert.equal(noActor.status,401);
});
test("R2-C never conflates empty with unavailable, no fake cash or account",async()=>{
 const actorA={...actor};
 const empty=await latestOnboarding(preview,actorA,async()=>Response.json([]));
 assert.equal(empty,null);
 await assert.rejects(latestOnboarding(preview,actorA,async()=>new Response("",{status:503})),
  (e:unknown)=>e instanceof OnboardingBlocked&&e.code==="UNAVAILABLE");
 await assert.rejects(latestOnboarding(preview,{...actor,getToken:async()=>null},async()=>Response.json([])),
  (e:unknown)=>e instanceof OnboardingBlocked&&e.code==="TOKEN_UNAVAILABLE");
 const response=await handleInvestingOnboardingHttp(
  new Request("https://preview.example/api/investing/onboarding"),preview,
  async()=>actor,async()=>Response.json([]));
 assert.deepEqual(await response.json(),{
  state:"NO_DECLARED_INTENT",latest:null,financialState:"NOT_PROVISIONED",executionAuthority:"NONE",
 });
});
