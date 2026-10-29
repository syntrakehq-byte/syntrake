import assert from "node:assert/strict";
import test from "node:test";
import {
  isR2ProductionBaseReady, isR2ProductionIntentReady,
  isR2ProductionDbReady, makeR2ProductionPool,
} from "../server/r2ProductionGate";
import { isR2CPreviewEnabled } from "../server/onboardingTransport";
import { isR2C2PortfolioReady, isOnboardingPortfolioReady } from "../server/onboardingPortfolioFromClerk";
import { isR2DImportReady } from "../server/importPreviewRuntime";
import { isR2C4PrivateWriteReady } from "../server/firstPortfolioPreviewHttp";

const ref = "vbazzxqyuqcrmjytaboc";
const sha = "a".repeat(40);
const host = "aws-1-eu-west-3.pooler.supabase.com";
const ca = "-----BEGIN CERTIFICATE-----\\nCI_NOT_REAL\\n-----END CERTIFICATE-----";
const env = {
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_GIT_COMMIT_SHA: sha,
  SYNTRAKE_R2_PRODUCTION_ENABLED: "enabled",
  SYNTRAKE_R2_PRODUCTION_APPROVED_SHA: sha,
  SYNTRAKE_R2_PRODUCTION_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_URL: "https://" + ref + ".supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci_key_1234567890",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_CI_ONLY_1234567890",
  CLERK_SECRET_KEY: "sk_live_CI_ONLY_1234567890",
  SYNTRAKE_R2C_PRODUCTION_ENABLED: "enabled",
  SYNTRAKE_R2C2_PRODUCTION_ENABLED: "enabled",
  SYNTRAKE_BL2BL3_PRODUCTION_ENABLED: "enabled",
  SYNTRAKE_R2D_PRODUCTION_ENABLED: "enabled",
  SYNTRAKE_R2_PRODUCTION_POOLER_HOST: host,
  SYNTRAKE_R2C2_PRODUCTION_PG_CA_PEM: ca,
  SYNTRAKE_BL2BL3_PRODUCTION_PG_CA_PEM: ca,
  SYNTRAKE_R2D_PRODUCTION_PG_CA_PEM: ca,
  SYNTRAKE_R2C2_PRODUCTION_DATABASE_URL:
    `postgresql://investing_initial_provisioner_prod_login.${ref}:ci@${host}:5432/postgres`,
  SYNTRAKE_BL2BL3_PRODUCTION_DATABASE_URL:
    `postgresql://investing_bl2bl3_prod_login.${ref}:ci@${host}:5432/postgres`,
  SYNTRAKE_R2D_PRODUCTION_DATABASE_URL:
    `postgresql://investing_import_prod_login.${ref}:ci@${host}:5432/postgres`,
};

test("R2 Production remains off with missing release authorization; Preview gate never accepts Production",()=>{
  assert.equal(isR2ProductionBaseReady({...env,SYNTRAKE_R2_PRODUCTION_ENABLED:"disabled"}),false);
  assert.equal(isR2CPreviewEnabled(env),false);
  for(const cap of ["r2c2","bl2bl3","import"] as const)
    assert.equal(isR2ProductionDbReady({...env,SYNTRAKE_R2_PRODUCTION_ENABLED:"disabled"},cap),false);
});

test("Production explicit main and exact SHA protects all capabilities; no Dev Clerk issuer",()=>{
  assert.equal(isR2ProductionBaseReady(env),true);
  assert.equal(isR2ProductionIntentReady(env),true);
  assert.equal(isR2C2PortfolioReady(env),true);
  assert.equal(isR2C4PrivateWriteReady(env),true);
  assert.equal(isOnboardingPortfolioReady(env),true);
  assert.equal(isR2DImportReady(env),true);
  for (const bad of [
    {...env,VERCEL_ENV:"preview"},
    {...env,VERCEL_GIT_COMMIT_REF:"feat/bl2bl3-canonical-draft"},
    {...env,VERCEL_GIT_COMMIT_SHA:"b".repeat(40)},
    {...env,SYNTRAKE_R2_PRODUCTION_APPROVED_SHA:"b".repeat(40)},
    {...env,SYNTRAKE_R2_PRODUCTION_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa"},
    {...env,NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co"},
    {...env,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:"pk_test_BAD"},
    {...env,CLERK_SECRET_KEY:"sk_test_BAD"},
  ]){
    assert.equal(isR2ProductionBaseReady(bad),false);
    assert.equal(isR2ProductionIntentReady(bad),false);
    assert.equal(isR2C2PortfolioReady(bad),false);
    assert.equal(isR2DImportReady(bad),false);
  }
});

test("All three private Production login pools are independent and TLS-strict",()=>{
  for(const cap of ["r2c2","bl2bl3","import"] as const) {
    assert.equal(isR2ProductionDbReady(env,cap),true);
    const pool=makeR2ProductionPool(env,cap);
    // Construct only, never connect. Fake CI credentials must never reach a DB.
    assert.equal(typeof pool.options.ssl === "object" && pool.options.ssl !== null && pool.options.ssl.rejectUnauthorized, true);
    void pool.end();
  }
  for(const x of [
    {...env,SYNTRAKE_R2C2_PRODUCTION_ENABLED:"disabled"},
    {...env,SYNTRAKE_BL2BL3_PRODUCTION_ENABLED:"disabled"},
    {...env,SYNTRAKE_R2D_PRODUCTION_ENABLED:"disabled"},
    {...env,SYNTRAKE_R2_PRODUCTION_POOLER_HOST:"db."+ref+".supabase.co"},
    {...env,SYNTRAKE_R2_PRODUCTION_POOLER_HOST:host+".attacker.example"},
    {...env,SYNTRAKE_R2_PRODUCTION_POOLER_HOST:""},
  ])assert.equal(["r2c2","bl2bl3","import"].every(c=>isR2ProductionDbReady(x,c)),false);
  for(const wrong of [
    "postgresql://postgres:secret@"+host+":5432/postgres",
    "postgresql://investing_initial_provisioner_prod_login."+ref+":pw@"+host+":6543/postgres",
    "postgresql://investing_initial_provisioner_prod_login."+ref+":pw@db."+ref+".supabase.co:5432/postgres",
    "postgresql://investing_initial_provisioner_prod_login."+ref+":pw@"+host+":5432/postgres?sslmode=disable",
    "postgresql://investing_bl2bl3_prod_login."+ref+":pw@"+host+":5432/postgres",
  ]) assert.equal(isR2ProductionDbReady({...env,SYNTRAKE_R2C2_PRODUCTION_DATABASE_URL:wrong},"r2c2"),false);
  assert.equal(isR2ProductionDbReady({...env,SYNTRAKE_R2C2_PRODUCTION_PG_CA_PEM:""},"r2c2"),false);
  assert.throws(()=>makeR2ProductionPool({...env,SYNTRAKE_R2_PRODUCTION_ENABLED:"disabled"},"r2c2"),/R2_PRODUCTION_NOT_AUTHORIZED/);
});
