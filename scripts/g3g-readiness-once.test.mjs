import test from "node:test";
import assert from "node:assert/strict";
import {
  validateG3ReadinessInput,
  checkG3ReadinessResponse,
  runG3ReadinessProbe,
} from "./g3g-readiness-once.mjs";

const sha = "a".repeat(40);
const host = "syntrake-df4fk3o5j-syntrake.vercel.app";
const env = Object.freeze({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/g3g-preview-hosted-worker-20261108",
  VERCEL_GIT_COMMIT_SHA: sha,
  G3G_APPROVED_SHA: sha,
  G3G_READINESS_MODE: "enabled",
  G3G_WORKER_MODE: "disabled",
  SYNTRAKE_G3_PROVIDER_ENABLED: "disabled",
  G3G_EXECUTOR_TOKEN: "secret".padEnd(60, "A"),
  G3G_PREVIEW_URL: "https://" + host + "/",
  G3G_EXPECTED_DEPLOYMENT_HOST: host,
});
const endpoint = "https://" + host + "/api/internal/g3-worker";

test("G3-G read-only CLI refuses Production, unapproved SHA, enabled worker or provider", () => {
  assert.equal(validateG3ReadinessInput(env), endpoint);
  for (const change of [
    { VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    { G3G_APPROVED_SHA: "b".repeat(40) },
    { G3G_WORKER_MODE: "enabled" },
    { SYNTRAKE_G3_PROVIDER_ENABLED: "enabled" },
    { G3G_READINESS_MODE: "disabled" },
    { G3G_EXECUTOR_TOKEN: undefined },
  ]) assert.throws(() => validateG3ReadinessInput({ ...env, ...change }), /PREFLIGHT_CLOSED/);
});

test("G3-G CLI pins an exact Vercel Preview deployment without accepting alternate origins", () => {
  for (const url of [
    "https://production.syntrake.com/",
    "http://" + host + "/",
    "https://evil.example.com/",
    "https://user:password@" + host + "/",
    "https://" + host + "/?token=secret",
    "https://" + host + "/api/internal/g3-worker",
    "https://" + host + ":8443/",
  ]) assert.throws(() => validateG3ReadinessInput({ ...env, G3G_PREVIEW_URL: url }), /URL_INVALID/);
  assert.throws(() => validateG3ReadinessInput({ ...env, G3G_EXPECTED_DEPLOYMENT_HOST: "other.vercel.app" }), /DEPLOYMENT_NOT_PINNED/);
});

test("G3-G CLI only accepts a real read-only success payload", () => {
  assert.deepEqual(checkG3ReadinessResponse('{"status":"READY_READONLY","providerCalls":0,"marketWrites":0}'), {
    status: "READY_READONLY", providerCalls: 0, marketWrites: 0,
  });
  for (const response of [
    "not json", '{"status":"BLOCKED"}',
    '{"status":"READY_READONLY","providerCalls":1,"marketWrites":0}',
    '{"status":"READY_READONLY","providerCalls":0,"marketWrites":1}',
    '{"status":"READY_READONLY","providerCalls":"0","marketWrites":0}',
  ]) assert.throws(() => checkG3ReadinessResponse(response));
});

test("G3-G CLI invokes only one POST readiness call, without shell and without provider activity", async () => {
  let invoked = 0;
  const fakeClient = async (bin, args, options) => {
    invoked++;
    assert.equal(bin, "vercel");
    assert.deepEqual(args.slice(0, 4), ["curl", endpoint, "-X", "POST"]);
    assert.ok(args.includes("X-G3-Operation: readiness"));
    assert.ok(!args.includes("X-G3-Operation: run"));
    assert.equal(options.shell, false);
    return { stdout: '{"status":"READY_READONLY","providerCalls":0,"marketWrites":0}' };
  };
  assert.equal((await runG3ReadinessProbe(env, fakeClient)).status, "READY_READONLY");
  assert.equal(invoked, 1);
  await assert.rejects(
    runG3ReadinessProbe(env, async () => { throw new Error("Vercel token: supersecret"); }),
    error => error instanceof Error && error.message === "G3_READINESS_VERCEL_CURL_FAILED",
  );
});
