import test from "node:test";
import assert from "node:assert/strict";
import { createG3BoundedMarketWorker } from "../g3BoundedMarketWorker";
import type { StorageAttestation } from "../g3LicensedTwelveData";
import type { Client } from "pg";

const approvedEnv = {
  VERCEL_ENV:"preview",
  VERCEL_GIT_COMMIT_REF:"feat/g3e-integrated-rehearsal-20261106",
  VERCEL_GIT_COMMIT_SHA:"f".repeat(40),
  SYNTRAKE_G3_APPROVED_SHA:"f".repeat(40),
  SYNTRAKE_G3_PROVIDER_ENABLED:"enabled",
  SYNTRAKE_G3_LICENSE_SCOPE:"internal-non-display",
  SYNTRAKE_TWELVE_DATA_API_KEY:"OFFLINE_TEST_NO_NETWORK_12345",
};
const rights: StorageAttestation={
  provider:"TWELVE_DATA",
  rightsPolicyId:"d2000000-0000-0000-0000-000000000002",
  scope:"internal-non-display",
  evidenceReference:"twelvedata:contract:offline-fixture-only",
  retentionUntil:"2030-01-01T00:00:00Z",
  reviewedAt:"2026-11-06T19:00:00Z",
  purgeVerified:true,
};
const base = {
  env: approvedEnv, attestation:rights,
  readerFactory:async()=>({} as Client),
  workerFactory:async()=>({} as Client),
  workerId:"g3f-worker",instanceId:"g3f-instance",
  capabilityToken:"a".repeat(64),
  exchangeTimezone:"America/New_York",
};

test("G3 F bounded worker never starts during module assembly or denied permission",()=>{
  assert.throws(()=>createG3BoundedMarketWorker({...base, env:{...approvedEnv,SYNTRAKE_G3_PROVIDER_ENABLED:"disabled"}}),/G3_WORKER_DISABLED/);
  assert.throws(()=>createG3BoundedMarketWorker({...base,attestation:null}),/G3_WORKER_LICENSE_UNVERIFIED/);
  assert.throws(()=>createG3BoundedMarketWorker({...base,capabilityToken:"short"}),/G3_WORKER_IDENTITY_INVALID/);
  const w=createG3BoundedMarketWorker(base);
  assert.equal(w.isRunning,false);
});
