import test from "node:test";
import assert from "node:assert/strict";
import { isPersonalMarketReady, requirePersonalMarketReady } from "../personalMarketGate";
const sha="a".repeat(40);
const env={
 VERCEL_ENV:"production", VERCEL_GIT_COMMIT_SHA:sha,
 SYNTRAKE_MARKET_APPROVED_SHA:sha, SYNTRAKE_MARKET_MODE:"personal",
 SYNTRAKE_MARKET_VISIBILITY:"owner-only", SYNTRAKE_MARKET_PERSISTENCE:"disabled",
 SYNTRAKE_MARKET_OWNER_USER_ID:"user_test_owner_123",
 SYNTRAKE_TWELVE_DATA_API_KEY:"fake_test_0123456789abcdefghijklmnopqrstuvwxyz",
};
test("personal production requires the exact SHA, owner, and disabled persistence",()=>{
 assert.equal(isPersonalMarketReady(env),true);
 assert.equal(requirePersonalMarketReady(env,sha),env.SYNTRAKE_TWELVE_DATA_API_KEY);
 for (const changed of [
  {VERCEL_ENV:"development"},{SYNTRAKE_MARKET_MODE:"disabled"},
  {SYNTRAKE_MARKET_VISIBILITY:"all-users"},{SYNTRAKE_MARKET_PERSISTENCE:"enabled"},
  {SYNTRAKE_MARKET_OWNER_USER_ID:""},
  {SYNTRAKE_MARKET_APPROVED_SHA:"b".repeat(40)},
  {SYNTRAKE_TWELVE_DATA_API_KEY:""}
 ]) {
  const newEnv={...env,...changed};
  assert.equal(isPersonalMarketReady(newEnv),false);
  assert.throws(()=>requirePersonalMarketReady(newEnv,sha));
 }
 assert.throws(()=>requirePersonalMarketReady(env,"c".repeat(40)));
});
