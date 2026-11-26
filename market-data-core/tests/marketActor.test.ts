import test from "node:test";
import assert from "node:assert/strict";
import { verifyMarketActor } from "../requireMarketActor";

test("Market Core accepts distinct independently authenticated accounts without founder IDs",()=>{
  const a=verifyMarketActor({userId:"user_customer_alpha_001",sessionId:"sess_a"});
  const b=verifyMarketActor({userId:"user_customer_beta_002",sessionId:"sess_b"});
  assert.notEqual(a.userId,b.userId);
  assert.equal(a.userId,"user_customer_alpha_001");
  assert.equal(b.userId,"user_customer_beta_002");
});

test("Market Core refuses anonymous, incomplete and malformed identities",()=>{
  for (const credentials of [
    {userId:null,sessionId:"sess_a"},{userId:"user_customer_alpha_001",sessionId:null},
    {userId:"founder",sessionId:"sess_a"},{userId:"",sessionId:"sess_a"},
  ]) assert.throws(()=>verifyMarketActor(credentials),/UNAUTHENTICATED/);
});
