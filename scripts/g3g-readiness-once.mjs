import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{48,256}$/;
const BRANCH = "feat/g3g-preview-hosted-worker-20261108";

/**
 * Preview-only, read-only smoke test using authenticated Vercel CLI.
 * It cannot schedule work, send a Twelve Data request or register a worker.
 * Nothing is executed when this module is imported into a unit test.
 */
export function validateG3ReadinessInput(env) {
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !== BRANCH ||
      !SHA.test(env.VERCEL_GIT_COMMIT_SHA ?? "") ||
      env.G3G_APPROVED_SHA !== env.VERCEL_GIT_COMMIT_SHA ||
      env.G3G_READINESS_MODE !== "enabled" ||
      env.G3G_WORKER_MODE !== "disabled" ||
      env.SYNTRAKE_G3_PROVIDER_ENABLED !== "disabled" ||
      !TOKEN.test(env.G3G_EXECUTOR_TOKEN ?? "")) {
    throw new Error("G3_READINESS_PREFLIGHT_CLOSED");
  }

  let url;
  try { url = new URL(env.G3G_PREVIEW_URL); } catch { throw new Error("G3_READINESS_URL_INVALID"); }
  if (url.protocol !== "https:" ||
      url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== "/" ||
      !/^syntrake-[a-z0-9]+-syntrake\.vercel\.app$/.test(url.hostname)) {
    throw new Error("G3_READINESS_URL_INVALID");
  }
  if (env.G3G_EXPECTED_DEPLOYMENT_HOST !== url.hostname) {
    throw new Error("G3_READINESS_DEPLOYMENT_NOT_PINNED");
  }
  return new URL("/api/internal/g3-worker", url).toString();
}

export function checkG3ReadinessResponse(stdout) {
  let response;
  try { response = JSON.parse(stdout.trim()); }
  catch { throw new Error("G3_READINESS_NON_JSON_RESPONSE"); }
  if (!response || response.status !== "READY_READONLY" ||
      response.providerCalls !== 0 || response.marketWrites !== 0) {
    throw new Error("G3_READINESS_NOT_VERIFIED");
  }
  return { status: "READY_READONLY", providerCalls: 0, marketWrites: 0 };
}

export async function runG3ReadinessProbe(env, client = exec) {
  const endpoint = validateG3ReadinessInput(env);
  // Do not interpolate into a shell; do not print or persist the Bearer token.
  let stdout;
  try {
    const result = await client("vercel", [
      "curl", endpoint, "-X", "POST",
      "-H", "X-G3-Operation: readiness",
      "-H", "Authorization: Bearer " + env.G3G_EXECUTOR_TOKEN,
      "-H", "Content-Type: application/json",
      "--data", "{}",
    ], { shell: false, timeout: 25000, maxBuffer: 16384 });
    stdout = result.stdout;
  } catch {
    // Vercel CLI errors can include the command line with credentials.
    throw new Error("G3_READINESS_VERCEL_CURL_FAILED");
  }
  return checkG3ReadinessResponse(stdout);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runG3ReadinessProbe(process.env)
    .then(result => { process.stdout.write(JSON.stringify(result) + "\n"); })
    .catch(error => {
      process.stderr.write(error instanceof Error ? error.message + "\n" : "G3_READINESS_FAILED\n");
      process.exitCode = 1;
    });
}
