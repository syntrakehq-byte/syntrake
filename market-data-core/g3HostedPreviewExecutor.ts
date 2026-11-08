import { createHash, timingSafeEqual } from "node:crypto";
import type { WorkerStats } from "./autonomousWorker";
import { createG3BoundedMarketWorker } from "./g3BoundedMarketWorker";
import { createG3PreviewClient } from "./g3PreviewPinnedClients";
import type { StorageAttestation } from "./g3LicensedTwelveData";
import { isG3PreviewProviderReady } from "./gate";

type Env = Readonly<Record<string, string | undefined>>;
const BRANCH = "feat/g3g-preview-hosted-worker-20261108";
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const EVIDENCE = /^twelvedata:(?:contract|license|support-confirmation):[A-Za-z0-9._:-]{8,160}$/;
const TOKEN = /^[A-Za-z0-9_-]{48,256}$/;
const headers = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
});

function json(status: number, result: unknown): Response {
  return Response.json(result, { status, headers });
}

/** A separate operator SHA gate prevents accidentally enabling stale Preview builds. */
export function isG3HostedPreviewReady(env: Env): boolean {
  const ref = env.G3G_DEPLOYMENT_REF ?? env.VERCEL_GIT_COMMIT_REF;
  const sha = env.G3G_DEPLOYMENT_SHA ?? env.VERCEL_GIT_COMMIT_SHA;
  return env.VERCEL_ENV === "preview" &&
    ref === BRANCH &&
    typeof sha === "string" && SHA.test(sha) &&
    env.G3G_APPROVED_SHA === sha;
}

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !TOKEN.test(secret)) return false;
  const match = /^Bearer ([A-Za-z0-9_-]{48,256})$/.exec(header ?? "");
  if (!match) return false;
  const actual = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(actual, expected);
}

/** No credential, provider, database connection or scheduler starts on import. */
export async function handleG3HostedPreviewRequest(
  request: Request,
  env: Env,
  operations: Readonly<{
    readiness: () => Promise<void>;
    runOnce: () => Promise<WorkerStats>;
  }>,
): Promise<Response> {
  let url: URL;
  try { url = new URL(request.url); }
  catch { return json(404, { error: "NOT_FOUND" }); }
  if (request.method !== "POST" || url.pathname !== "/api/internal/g3-worker" ||
      url.search || url.hash || !isG3HostedPreviewReady(env) ||
      !authorized(request.headers.get("Authorization"), env.G3G_EXECUTOR_TOKEN)) {
    return json(404, { error: "NOT_FOUND" });
  }

  const operation = request.headers.get("X-G3-Operation");
  if (operation === "readiness") {
    if (env.G3G_READINESS_MODE !== "enabled") return json(404, { error: "NOT_FOUND" });
    try {
      await operations.readiness();
      return json(200, { status: "READY_READONLY", providerCalls: 0, marketWrites: 0 });
    } catch {
      return json(503, { error: "G3G_READINESS_UNAVAILABLE" });
    }
  }

  if (operation === "run") {
    // No Twelve Data call or even a DB connection without both independent gates.
    if (env.G3G_WORKER_MODE !== "enabled" || !isG3PreviewProviderReady(env)) {
      return json(423, { error: "G3G_LICENSE_OR_WORKER_DISABLED" });
    }
    try {
      const stats = await operations.runOnce();
      return json(200, {
        status: stats.committed > 0 ? "COMMITTED" : stats.failed > 0 ? "FAILED" : "NO_WORK",
        attempts: stats.attempts, committed: stats.committed, failed: stats.failed,
      });
    } catch {
      return json(503, { error: "G3G_WORKER_UNAVAILABLE" });
    }
  }
  return json(400, { error: "INVALID_OPERATION" });
}

function attestationFromEnvironment(value: string | undefined): StorageAttestation | null {
  if (!value || value.length > 2000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const a = parsed as Record<string, unknown>;
  if (a.provider !== "TWELVE_DATA" || a.scope !== "internal-non-display" ||
      a.purgeVerified !== true ||
      typeof a.rightsPolicyId !== "string" || !UUID.test(a.rightsPolicyId) ||
      typeof a.evidenceReference !== "string" || !EVIDENCE.test(a.evidenceReference) ||
      typeof a.retentionUntil !== "string" || !UTC.test(a.retentionUntil) ||
      typeof a.reviewedAt !== "string" || !UTC.test(a.reviewedAt) ||
      !Number.isFinite(Date.parse(a.retentionUntil)) ||
      !Number.isFinite(Date.parse(a.reviewedAt)) ||
      Date.parse(a.retentionUntil) <= Date.now() ||
      Date.parse(a.reviewedAt) > Date.now()) return null;
  return {
    provider: "TWELVE_DATA", rightsPolicyId: a.rightsPolicyId,
    scope: "internal-non-display", evidenceReference: a.evidenceReference,
    retentionUntil: a.retentionUntil, reviewedAt: a.reviewedAt, purgeVerified: true,
  };
}

/** Run only when explicitly requested by an authenticated, authorized scheduler. */
export async function runG3HostedWorkerOnce(env: Env): Promise<WorkerStats> {
  if (!isG3HostedPreviewReady(env) || env.G3G_WORKER_MODE !== "enabled" ||
      !isG3PreviewProviderReady(env)) throw new Error("G3G_WORKER_DISABLED");
  const attestation = attestationFromEnvironment(env.G3G_STORAGE_ATTESTATION_JSON);
  const token = env.G3G_INSTANCE_CAPABILITY_TOKEN ?? "";
  if (!attestation || !/^[a-f0-9]{64}$/.test(token)) throw new Error("G3G_WORKER_LICENSE_UNVERIFIED");
  const service = createG3BoundedMarketWorker({
    env,
    readerFactory: async () => createG3PreviewClient(env, "reader"),
    workerFactory: async () => createG3PreviewClient(env, "ingest"),
    attestation,
    workerId: "g3-preview-bounded",
    instanceId: "g3-preview-bounded",
    capabilityToken: token,
    exchangeTimezone: "America/New_York",
  });
  return service.start();
}

/** Readiness does not query a provider, create jobs or persist observations. */
export async function probeG3HostedPreviewReader(env: Env): Promise<void> {
  if (!isG3HostedPreviewReady(env) || env.G3G_READINESS_MODE !== "enabled") {
    throw new Error("G3G_READINESS_DISABLED");
  }
  const db = createG3PreviewClient(env, "reader");
  await db.connect();
  try {
    await db.query("SET ROLE market_core_reader");
    const { rows } = await db.query<{ role: string; version: string }>(
      "SELECT current_user::text AS role, current_setting('server_version_num') AS version",
    );
    if (rows.length !== 1 || rows[0].role !== "market_core_reader" ||
        !/^17\d{4,}$/.test(rows[0].version)) throw new Error("G3G_READER_REJECTED");
  } finally {
    await db.end();
  }
}
