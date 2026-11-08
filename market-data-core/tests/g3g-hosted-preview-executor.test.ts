import test from "node:test";
import assert from "node:assert/strict";
import { createG3PreviewClient } from "../g3PreviewPinnedClients";
import {
  handleG3HostedPreviewRequest,
  isG3HostedPreviewReady,
  runG3HostedWorkerOnce,
} from "../g3HostedPreviewExecutor";
import { isG3PreviewProviderReady } from "../gate";
import type { WorkerStats } from "../autonomousWorker";

const sha = "a".repeat(40);
const secret = "SecureTestToken".padEnd(64, "A");
const env = Object.freeze({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3g-preview-hosted-worker-20261108",
  VERCEL_GIT_COMMIT_SHA: sha,
  G3G_APPROVED_SHA: sha,
  G3G_EXECUTOR_TOKEN: secret,
  G3G_READINESS_MODE: "enabled",
  G3G_WORKER_MODE: "disabled",
  SYNTRAKE_G3_PROVIDER_ENABLED: "disabled",
});
const makeRequest = (operation: string, authorization = "Bearer " + secret, url = "https://preview.invalid/api/internal/g3-worker") =>
  new Request(url, { method: "POST", headers: { Authorization: authorization, "X-G3-Operation": operation } });
const stats: WorkerStats = {
  attempts: 1, claimAttempts: 1, committed: 1, failed: 0,
  noWork: 0, recovered: 0, stopped: false,
};

test("G3-G runtime accepts only Preview branch with pinned exact commit", () => {
  assert.equal(isG3HostedPreviewReady(env), true);
  for (const overrides of [
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "development" },
    { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_REF: "feat/g3e-integrated-rehearsal-20261106" },
    { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    { VERCEL_GIT_COMMIT_SHA: undefined },
    { G3G_APPROVED_SHA: "b".repeat(40) },
    { G3G_APPROVED_SHA: undefined },
  ]) assert.equal(isG3HostedPreviewReady({ ...env, ...overrides }), false);
  assert.equal(isG3PreviewProviderReady(env), false);
});

test("G3-G authenticated readiness is read-only, no ingestion or provider call", async () => {
  let reads = 0; let runs = 0;
  const handlers = {
    readiness: async () => { reads++; },
    runOnce: async () => { runs++; return stats; },
  };
  const response = await handleG3HostedPreviewRequest(makeRequest("readiness"), env, handlers);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "READY_READONLY", providerCalls: 0, marketWrites: 0 });
  assert.equal(reads, 1);
  assert.equal(runs, 0);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
});

test("G3-G unauthorized or non-Preview attempts have no side effects", async () => {
  let reads = 0; let runs = 0;
  const handlers = { readiness: async () => { reads++; }, runOnce: async () => { runs++; return stats; } };
  const attempts = [
    [makeRequest("readiness", "Bearer invalid"), env],
    [makeRequest("readiness", ""), env],
    [makeRequest("readiness"), { ...env, G3G_EXECUTOR_TOKEN: undefined }],
    [makeRequest("readiness"), { ...env, VERCEL_ENV: "production" }],
    [makeRequest("readiness"), { ...env, G3G_APPROVED_SHA: "b".repeat(40) }],
    [makeRequest("readiness", "Bearer " + secret, "https://preview.invalid/api/internal/g3-worker?danger=yes"), env],
    [new Request("https://preview.invalid/api/internal/g3-worker", {method:"GET", headers: {Authorization:"Bearer " + secret}}), env],
    [makeRequest("readiness"), { ...env, G3G_READINESS_MODE: "disabled" }],
  ] as const;
  for (const [request, currentEnv] of attempts) {
    const response = await handleG3HostedPreviewRequest(request, currentEnv, handlers);
    assert.equal(response.status, 404);
  }
  assert.equal(reads, 0); assert.equal(runs, 0);
});

test("G3-G cannot run worker without both operator and Twelve Data provider gates", async () => {
  let calls = 0;
  const response = await handleG3HostedPreviewRequest(makeRequest("run"), env, {
    readiness: async () => { throw new Error("unexpected"); },
    runOnce: async () => { calls++; return stats; },
  });
  assert.equal(response.status, 423);
  assert.equal(calls, 0);
  await assert.rejects(runG3HostedWorkerOnce(env), /G3G_WORKER_DISABLED/);
});

test("G3-G activated handler returns only bounded aggregate stats, not secret or market values", async () => {
  const licensed = {
    ...env,
    G3G_WORKER_MODE: "enabled",
    SYNTRAKE_G3_PROVIDER_ENABLED: "enabled",
    SYNTRAKE_G3_LICENSE_SCOPE: "internal-non-display",
    SYNTRAKE_G3_APPROVED_SHA: sha,
    SYNTRAKE_TWELVE_DATA_API_KEY: "TEST_OFFLINE_NO_NETWORK_CRED_123456",
  };
  assert.equal(isG3PreviewProviderReady(licensed), true);
  let count = 0;
  const response = await handleG3HostedPreviewRequest(makeRequest("run"), licensed, {
    readiness: async () => { throw new Error("unexpected"); },
    runOnce: async () => { count++; return stats; },
  });
  assert.equal(count, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status:"COMMITTED", attempts:1, committed:1, failed:0 });

  // A handler-level mock does not attest storage. The real executor must refuse first.
  await assert.rejects(runG3HostedWorkerOnce(licensed), /G3G_WORKER_LICENSE_UNVERIFIED/);
});

test("G3-G does not expose operational errors or accept invalid operations", async () => {
  const handlers = {
    readiness: async (): Promise<void> => { throw new Error("Secret connection credentials"); },
    runOnce: async () => stats,
  };
  const failed = await handleG3HostedPreviewRequest(makeRequest("readiness"), env, handlers);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "G3G_READINESS_UNAVAILABLE" });
  const invalid = await handleG3HostedPreviewRequest(makeRequest("arbitrary"), env, handlers);
  assert.equal(invalid.status, 400);
});

test("G3-G blocks production or wrong-role connection strings before opening PostgreSQL", () => {
  const ca = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----";
  const bad = [
    "postgres://syntrake_g3_preview_reader:password_long_enough@db.vbazzxqyuqcrmjytaboc.supabase.co:5432/postgres",
    "postgres://postgres:password_long_enough@db.gehlmcjctcfdbtzlyswm.supabase.co:5432/postgres",
    "postgres://syntrake_g3_preview_reader:password_long_enough@localhost:5432/postgres",
    "http://syntrake_g3_preview_reader:password_long_enough@db.gehlmcjctcfdbtzlyswm.supabase.co/postgres",
  ];
  for (const url of bad) {
    assert.throws(() => createG3PreviewClient({
      MARKET_DATA_READER_DATABASE_URL: url, MARKET_DATA_READER_CA_PEM: ca,
    }, "reader"), /G3G_DB_TARGET_REJECTED/);
  }
  assert.throws(() => createG3PreviewClient({}, "ingest"), /G3G_DB_NOT_CONFIGURED/);
});
