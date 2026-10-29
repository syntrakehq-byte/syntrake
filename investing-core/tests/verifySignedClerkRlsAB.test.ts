import assert from "node:assert/strict";
import test from "node:test";
import {
  verifySignedClerkRlsAB,SignedRlsABBlocked,
  type SignedRlsABInput,type ReadTransport,
} from "../security/verifySignedClerkRlsAB";

const NOW=1800000000;
const a={userId:"user_preview_actor_A",accountId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"};
const b={userId:"user_preview_actor_B",accountId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"};
const encoder=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(userId:string,role="authenticated",exp=NOW+3600):string{
 return encoder({alg:"RS256",typ:"JWT"})+"."+
   encoder({sub:userId,role,exp,iss:"https://clerk.example"})+
   "."+"SIGNATURE_FAKE_JWT_FOR_MOCK_ONLY";
}
function valid():SignedRlsABInput {
 return {projectUrl:"https://zkqgpejlkgootkvkebhd.supabase.co",
  publishableKey:"sb_publishable_synthetic_test_1234567890",
  actorA:{...a,jwt:jwt(a.userId)},actorB:{...b,jwt:jwt(b.userId)}};
}
function mockGateway(options?:{
  foreignLeak?:boolean,wrongOwner?:boolean,badSignatureAccepted?:boolean,
  status?:number,throwError?:boolean,
}):{transport:ReadTransport,calls:{url:string;init:RequestInit}[]}{
 const calls:{url:string;init:RequestInit}[]=[];
 const input=valid();
 const transport:ReadTransport=async(url,init)=>{
  calls.push({url,init});
  if(options?.throwError)throw Error("PASSWORD_MUST_NEVER_LEAK");
  if(options?.status)return Response.json({error:"PRIVATE_INFO"},{status:options.status});
  const bearer=(init.headers as Record<string,string>).Authorization;
  const token=bearer.slice("Bearer ".length);
  const user=token===input.actorA.jwt?a.userId:token===input.actorB.jwt?b.userId:null;
  if(user===null&&!options?.badSignatureAccepted)
    return Response.json({msg:"signed JWT required"},{status:401});
  const id=new URL(url).searchParams.get("id")?.slice(3);
  if(!id)return Response.json({error:"no id"},{status:400});
  const owner=id===a.accountId?a.userId:id===b.accountId?b.userId:null;
  if(!owner)return Response.json([],{status:200});
  if(owner!==user&&!options?.foreignLeak)return Response.json([],{status:200});
  const responseOwner=options?.wrongOwner?"user_unexpected_owner":owner;
  return Response.json([{id,owner_user_id:responseOwner}]);
 };
 return {transport,calls};
}
const denied=(e:unknown)=>e instanceof SignedRlsABBlocked &&
  e.message==="SIGNED_CLERK_AB_VERIFICATION_BLOCKED";
test("R2-F verified gateway + real A/B isolation contract: five GETs, no finance writes",async()=>{
 const mock=mockGateway();
 const result=await verifySignedClerkRlsAB(valid(),mock.transport,NOW);
 assert.deepEqual(result,{
   state:"SIGNED_CLERK_AB_RLS_READ_ONLY_PASS",
   projectRef:"zkqgpejlkgootkvkebhd",
   distinctClerkActors:true,
   verifiedOwnAccountReads:2,deniedCrossActorReads:2,
   rejectedTamperedBearer:true,
   httpMethods:"GET_ONLY",
   financialState:"NOT_ASSESSED",noFinancialWrites:true,
   scope:"EXTERNAL_POSTGREST_READ_ONLY",
 });
 assert.ok(Object.isFrozen(result));
 assert.equal(mock.calls.length,5);
 const ids=mock.calls.map(c=>new URL(c.url).searchParams.get("id"));
 assert.deepEqual(ids,["eq."+a.accountId,"eq."+b.accountId,
   "eq."+b.accountId,"eq."+a.accountId,"eq."+a.accountId]);
 for(const c of mock.calls){
   assert.equal(c.init.method,"GET");
   assert.equal(c.init.cache,"no-store");
   assert.equal(c.init.redirect,"error");
   assert.equal((c.init.headers as Record<string,string>)["Accept-Profile"],"investing");
   assert.equal((c.init.headers as Record<string,string>).apikey,
     valid().publishableKey);
   assert.equal(new URL(c.url).origin,valid().projectUrl);
   assert.equal(new URL(c.url).searchParams.get("limit"),"2");
 }
 assert.ok(!JSON.stringify(result).includes(a.userId));
 assert.ok(!JSON.stringify(result).includes(a.accountId));
});
test("R2-F preflight: Production, insufficient Clerk claims, duplicate identities fail before network",async()=>{
 let calls=0;const transport:ReadTransport=async()=>{
   calls++;throw Error("MUST_NOT_CALL_REMOTE");
 };
 const v=valid();
 const scenarios:SignedRlsABInput[]=[
   {...v,projectUrl:"https://vbazzxqyuqcrmjytaboc.supabase.co"},
   {...v,projectUrl:"http://zkqgpejlkgootkvkebhd.supabase.co"},
   {...v,projectUrl:"https://zkqgpejlkgootkvkebhd.supabase.co/path"},
   {...v,publishableKey:"service_role_key"},
   {...v,actorB:{...v.actorB,accountId:v.actorA.accountId}},
   {...v,actorB:{...v.actorB,userId:v.actorA.userId}},
   {...v,actorA:{...v.actorA,jwt:jwt(b.userId)}},
   {...v,actorA:{...v.actorA,jwt:jwt(a.userId,"anon")}},
   {...v,actorA:{...v.actorA,jwt:jwt(a.userId,"authenticated",NOW-1)}},
   {...v,actorA:{...v.actorA,jwt:"header.payload.signature"}},
   {...v,actorA:{...v.actorA,accountId:"not-uuid"}},
 ];
 for(const scenario of scenarios)
   await assert.rejects(verifySignedClerkRlsAB(scenario,transport,NOW),denied);
 assert.equal(calls,0,"incomplete/ambiguous inputs must never touch Supabase");
});
test("R2-F negative RLS, wrong ownership and tampered token accepted all BLOCK",async()=>{
 for(const bad of [
   {foreignLeak:true},{wrongOwner:true},{badSignatureAccepted:true},
   {status:403},{status:503},{throwError:true},
 ]){
   const mock=mockGateway(bad);
   await assert.rejects(verifySignedClerkRlsAB(valid(),mock.transport,NOW),
      (e:unknown)=>denied(e)&&!String(e).includes("PASSWORD_MUST_NEVER_LEAK"));
   assert.ok(mock.calls.length<=5);
 }
});
test("R2-F empty own account read is NOT acceptable proof of A/B",async()=>{
 const mock:ReadTransport=async()=>Response.json([]);
 await assert.rejects(verifySignedClerkRlsAB(valid(),mock,NOW),denied);
});
test("R2-F duplicated or oversized row result fails closed",async()=>{
 const mock:ReadTransport=async(url,init)=>{
  const actor=(init.headers as Record<string,string>).Authorization;
  const id=new URL(url).searchParams.get("id")?.slice(3);
  const owner=actor.includes(valid().actorA.jwt)?a.userId:b.userId;
  return Response.json([{id,owner_user_id:owner},{id,owner_user_id:owner}]);
 };
 await assert.rejects(verifySignedClerkRlsAB(valid(),mock,NOW),denied);
});
