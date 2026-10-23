import assert from "node:assert/strict";
import test from "node:test";
import {inspectExistingAccountViaClerkJwt} from "../server/legacyAccountReconciliation";
import {InitialPortfolioBlocked} from "../server/initializeFirstPortfolio";
const env={
 VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"candidate/investing-r2c2-first-portfolio-20261023",
 INVESTING_R2C2_PREVIEW_MODE:"enabled",INVESTING_R2C2_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
 NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture_abcdefghijklmnopqrstuvwxyz",
};
const A={userId:"user_actor_AAAAA",sessionId:"session_a",getToken:async()=>"header.payload.signature"};
const a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type HttpCall={url:string;init:RequestInit};
const makeTransport=(accountRows:unknown,portfolioRows:unknown)=>{
 const calls:HttpCall[]=[];
 const fn=async(url:string,init:RequestInit):Promise<Response>=>{
  calls.push({url,init});
  return Response.json(url.includes("/investment_accounts?")?accountRows:portfolioRows);
 };
 return {calls,fn};
};
const rejected=(code:string)=>(e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code===code;
test("R2-C2 reconciliation: one owned legacy account and portfolio are read-only and unverified",async()=>{
 const {calls,fn}=makeTransport([{id:a,owner_user_id:A.userId}],
  [{id:b,investment_account_id:a}]);
 const result=await inspectExistingAccountViaClerkJwt(env,A,fn);
 assert.deepEqual(result,{
  accountId:a,portfolioIds:[b],accountMultiplicity:"ONE",
  financialTruth:"UNAVAILABLE",reconciliation:"REQUIRED",evidence:"SUPABASE_RLS_READ",
 });
 assert.equal(calls.length,2);
 for(const call of calls){
  assert.equal(call.init.method,"GET");
  assert.equal((call.init.headers as Record<string,string>)["Accept-Profile"],"investing");
  assert.equal((call.init.headers as Record<string,string>).Authorization,"Bearer header.payload.signature");
  assert.ok(call.url.startsWith("https://zkqgpejlkgootkvkebhd.supabase.co/rest/v1/"));
 }
 const u1=new URL(calls[0].url),u2=new URL(calls[1].url);
 assert.equal(u1.searchParams.get("owner_user_id"),"eq."+A.userId);
 assert.equal(u2.searchParams.get("investment_account_id"),"eq."+a);
 assert.ok(!JSON.stringify(result).includes(A.userId));
});
test("R2-C2 reconciliation: existing account without portfolio does not fabricate one",async()=>{
 const {fn}=makeTransport([{id:a,owner_user_id:A.userId}],[]);
 assert.deepEqual((await inspectExistingAccountViaClerkJwt(env,A,fn))?.portfolioIds,[]);
});
test("R2-C2 reconciliation: no own account is real null, not a fabricated account",async()=>{
 const {fn,calls}=makeTransport([],[]);
 assert.equal(await inspectExistingAccountViaClerkJwt(env,A,fn),null);
 assert.equal(calls.length,1);
});
test("R2-C2 reconciliation: multiple owned accounts cannot be silently chosen",async()=>{
 const {fn,calls}=makeTransport([{id:a,owner_user_id:A.userId},{id:b,owner_user_id:A.userId}],[]);
 const result=await inspectExistingAccountViaClerkJwt(env,A,fn);
 assert.equal(result?.accountMultiplicity,"MULTIPLE");
 assert.equal(result?.accountId,null);
 assert.deepEqual(result?.portfolioIds,[]);
 assert.equal(calls.length,1);
});
test("R2-C2 reconciliation: injected cross-owner account blocked",async()=>{
 const {fn}=makeTransport([{id:a,owner_user_id:"user_attacker_BBBBB"}],[]);
 await assert.rejects(inspectExistingAccountViaClerkJwt(env,A,fn),rejected("READ_UNAVAILABLE"));
});
test("R2-C2 reconciliation: portfolio not belonging to discovered account blocked",async()=>{
 const {fn}=makeTransport([{id:a,owner_user_id:A.userId}],
  [{id:b,investment_account_id:b}]);
 await assert.rejects(inspectExistingAccountViaClerkJwt(env,A,fn),rejected("READ_UNAVAILABLE"));
});
test("R2-C2 reconciliation: invalid identity or token fails before any GET",async()=>{
 let count=0;const transport=async()=>{count++;return Response.json([]);};
 for(const actor of [
  {...A,userId:null},{...A,sessionId:null},{...A,userId:"attacker"},
 ])await assert.rejects(inspectExistingAccountViaClerkJwt(env,actor,transport),rejected("UNAUTHENTICATED"));
 await assert.rejects(inspectExistingAccountViaClerkJwt(env,{
  ...A,getToken:async()=>null},transport),rejected("NOT_AUTHORIZED"));
 assert.equal(count,0);
});
test("R2-C2 reconciliation: Preview flag, project ref and Production fail before any GET",async()=>{
 let count=0;const transport=async()=>{count++;return Response.json([]);};
 for(const bad of [
  {...env,VERCEL_ENV:"production"},
  {...env,VERCEL_GIT_COMMIT_REF:"main"},
  {...env,NEXT_PUBLIC_SUPABASE_URL:"https://vbazzxqyuqcrmjytaboc.supabase.co"},
  {...env,INVESTING_R2C2_PREVIEW_MODE:"disabled"},
 ])await assert.rejects(inspectExistingAccountViaClerkJwt(bad,A,transport),rejected("NOT_AUTHORIZED"));
 assert.equal(count,0);
});
test("R2-C2 reconciliation: network, 401, 500, unexpected payload and page overflow fail closed",async()=>{
 for(const status of [401,403,500]){
  await assert.rejects(inspectExistingAccountViaClerkJwt(env,A,async()=>Response.json({error:"private"},{status})),
    rejected(status===500?"READ_UNAVAILABLE":"NOT_AUTHORIZED"));
 }
 await assert.rejects(inspectExistingAccountViaClerkJwt(env,A,
  async()=>{throw new Error("private transport details")}),rejected("READ_UNAVAILABLE"));
 await assert.rejects(inspectExistingAccountViaClerkJwt(env,A,
  async()=>Response.json({bad:true})),rejected("READ_UNAVAILABLE"));
 const {fn}=makeTransport([{id:a,owner_user_id:A.userId}],
  Array.from({length:51},(_,i)=>({id:b,investment_account_id:a,sequence:i})));
 await assert.rejects(inspectExistingAccountViaClerkJwt(env,A,fn),rejected("READ_UNAVAILABLE"));
});
