import assert from "node:assert/strict";
import test from "node:test";
import {isApprovedR2PreviewDeployment} from "../server/previewDeploymentGate";
import {isR2CPreviewEnabled} from "../server/onboardingTransport";
import {isR2DImportReady} from "../server/importPreviewRuntime";
import {isR2C4PrivateWriteReady} from "../server/firstPortfolioPreviewHttp";

const SHA="1".repeat(40);
const env={
  VERCEL_ENV:"preview",
  VERCEL_GIT_COMMIT_REF:"candidate/investing-r2f-clerk-rls-ab-gate-20261024",
  VERCEL_GIT_COMMIT_SHA:SHA,
  SYNTRAKE_ONBOARDING_APPROVED_PREVIEW_SHA:SHA,
  INVESTING_R2_APPROVED_PREVIEW_SHA:SHA,
  INVESTING_R2C_PREVIEW_MODE:"enabled",
  SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",
  NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_test_1234567890",
  INVESTING_R2C4_PRIVATE_WRITE:"enabled",
  INVESTING_R2C4_PROJECT_REF:"zkqgpejlkgootkvkebhd",
  INVESTING_R2C4_PG_DSN:"postgresql://investing_initial_preview_runtime:ci_placeholder@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres",
  INVESTING_R2C4_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
  INVESTING_R2D_IMPORT_ENABLED:"enabled",
  INVESTING_R2D_PROJECT_REF:"zkqgpejlkgootkvkebhd",
  INVESTING_R2D_PG_DSN:"postgresql://investing_import_preview_runtime:ci_placeholder@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres",
  INVESTING_R2D_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
};
const canonicalEnv={
  ...env,
  VERCEL_GIT_COMMIT_REF:"feat/bl2bl3-canonical-draft",
  SYNTRAKE_ONBOARDING_PG_ENABLED:"enabled",
  SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",
  NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  SYNTRAKE_ONBOARDING_POOLER_HOST:"aws-0-eu-west-3.pooler.supabase.com",
  SYNTRAKE_ONBOARDING_DATABASE_URL:"postgresql://investing_bl2bl3_preview_login.aaaaaaaaaaaaaaaaaaaa:dummy@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
  SYNTRAKE_ONBOARDING_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
  SYNTRAKE_R2C2_PG_ENABLED:"enabled",
  SYNTRAKE_R2C2_POOLER_HOST:"aws-0-eu-west-3.pooler.supabase.com",
  SYNTRAKE_R2C2_DATABASE_URL:"postgresql://investing_initial_provisioner_preview_login.aaaaaaaaaaaaaaaaaaaa:dummy@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
  SYNTRAKE_R2C2_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
};
test("R2 exact-SHA gate: distinct candidate branch names are not hardcoded, only reviewed commit is authorized",()=>{
 for(const branch of [
  "candidate/investing-r2f-clerk-rls-ab-gate-20261024",
  "candidate/investing-r2-next-proposal",
  "candidate/investing-r2c4-private-preview-20261024",
 ]) assert.equal(isApprovedR2PreviewDeployment({
   ...env,VERCEL_GIT_COMMIT_REF:branch,
 }),true);
 assert.equal(isR2CPreviewEnabled(env),true);
 assert.equal(isR2C4PrivateWriteReady(canonicalEnv),true);
 assert.equal(isR2DImportReady(env),true);
});
test("R2 fail closed on unapproved SHA, malformed/old git metadata, Production and absent token",()=>{
 const bad=[
  {...env,INVESTING_R2_APPROVED_PREVIEW_SHA:undefined},
  {...env,VERCEL_GIT_COMMIT_SHA:undefined},
  {...env,VERCEL_ENV:"production"},
  {...env,VERCEL_ENV:"development"},
  {...env,VERCEL_GIT_COMMIT_REF:"main"},
  {...env,VERCEL_GIT_COMMIT_REF:"candidate/unrelated"},
  {...env,VERCEL_GIT_COMMIT_REF:"candidate/investing-r3"},
  {...env,VERCEL_GIT_COMMIT_REF:"candidate/investing-r2\nmain"},
  {...env,VERCEL_GIT_COMMIT_SHA:"2".repeat(40)},
  {...env,INVESTING_R2_APPROVED_PREVIEW_SHA:"2".repeat(40)},
  {...env,VERCEL_GIT_COMMIT_SHA:"not_a_sha"},
  {...env,INVESTING_R2_APPROVED_PREVIEW_SHA:"1".repeat(39)},
  {...env,VERCEL_GIT_COMMIT_SHA:"A".repeat(40)},
  {...env,INVESTING_R2_APPROVED_PREVIEW_SHA:"A".repeat(40)},
 ];
 for(const config of bad){
  assert.equal(isApprovedR2PreviewDeployment(config),false,
   JSON.stringify({env:config.VERCEL_ENV,ref:config.VERCEL_GIT_COMMIT_REF}));
  assert.equal(isR2CPreviewEnabled(config),false);
  assert.equal(isR2C4PrivateWriteReady(config),false);
  assert.equal(isR2DImportReady(config),false);
 }
});
test("R2 exact SHA is necessary not sufficient: missing capability, wrong project, no trust fail closed",()=>{
 for(const config of [
  {...env,INVESTING_R2C_PREVIEW_MODE:"disabled"},
  {...env,NEXT_PUBLIC_SUPABASE_URL:"https://vbazzxqyuqcrmjytaboc.supabase.co"},
 ]){
  assert.equal(isR2CPreviewEnabled(config),false);
  assert.equal(isR2C4PrivateWriteReady(config),false);
  assert.equal(isR2DImportReady(config),false);
 }
 assert.equal(isR2C4PrivateWriteReady({...env,INVESTING_R2C4_PRIVATE_WRITE:"disabled"}),false);
 assert.equal(isR2DImportReady({...env,INVESTING_R2D_IMPORT_ENABLED:"disabled"}),false);
 assert.equal(isR2C4PrivateWriteReady({...env,INVESTING_R2C4_PG_CA_PEM:""}),false);
 assert.equal(isR2DImportReady({...env,INVESTING_R2D_PG_CA_PEM:""}),false);
});
