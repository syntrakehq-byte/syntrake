import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { runNewsExecutorOnce } from "../autonomousExecutor";
import { fetchSecFilings } from "../secAdapter";
import { fetchSafeExternal } from "../sourceSecurity";
import { PostgresNewsStore } from "../postgresStore";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const enabled = process.env.N5_REAL_SOURCE === "1";
const CIK = "0000320193";
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const userAgent = () => process.env.SEC_USER_AGENT ?? "SYNTRAKE N5 CI/1.0 security@syntrake.com";

type ReplayFixture = Readonly<{
  publications: Awaited<ReturnType<typeof fetchSecFilings>>["publications"];
  fetchImpl: typeof fetch;
}>;

async function genuineSecReplay(): Promise<ReplayFixture> {
  const response = await fetchSafeExternal(`https://data.sec.gov/submissions/CIK${CIK}.json`, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `SEC live response must be successful: ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.cik, CIK, "SEC live payload must identify the requested CIK");
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  const parsed = await fetchSecFilings({ cik: CIK, userAgent: userAgent(), fetchImpl, now: new Date("2026-11-14T20:00:00.000Z") });
  assert.ok(parsed.publications.length > 0, "the genuine SEC payload must contain filings");
  return { publications: parsed.publications, fetchImpl };
}

async function installTarget(store: PostgresNewsStore, scope: string): Promise<void> {
  await store.ensureSource("sec-edgar", "sec");
  await store.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: CIK, parameters: { forms: ["10-K", "10-Q", "8-K", "20-F", "6-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });
}

async function applyN1Migrations(admin: Client): Promise<void> {
  for (const file of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql"]) await admin.query(await readFile(migration(file), "utf8"));
}

async function absentPublication(admin: Client, publications: ReplayFixture["publications"]): Promise<ReplayFixture["publications"][number]> {
  for (const publication of publications) {
    const count = Number((await admin.query("select count(*)::int n from news_core.publications where source_id=$1 and external_id=$2", [publication.sourceId, publication.externalId])).rows[0].n);
    if (count === 0) return publication;
  }
  throw new Error("N0_REPLAY_BASELINE_NOT_EMPTY");
}

test("N0-T25: two attributable SEC cycles use a genuine isolated baseline and remain idempotent", { skip: !enabled && "N5_REAL_SOURCE=1 required for the official SEC proof" }, async () => {
  if (!DB_URL) throw new Error("NEWS_DATABASE_URL or TEST_DATABASE_URL is required for N0-T25");
  const admin = new Client({ connectionString: DB_URL }); const pool = new Pool({ connectionString: DB_URL, max: 4 }); const store = new PostgresNewsStore(pool); const suffix = randomUUID().replaceAll("-", ""); const scope = `n0-t25-${suffix}`;
  try {
    await admin.connect(); await applyN1Migrations(admin); const replay = await genuineSecReplay(); await installTarget(store, scope);
    const candidate = await absentPublication(admin, replay.publications);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 0);
    const first = await runNewsExecutorOnce({ store, workerId: `n0-t25-cycle-1-${suffix}`, secUserAgent: userAgent(), collectionScopeKey: scope, fetchImpl: replay.fetchImpl, fetchTimeoutMs: 30_000 });
    assert.equal(first.claimed, true);
    const firstRows = await admin.query("select count(*)::int n, min(origin_fingerprint) origin_fingerprint from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId]);
    assert.equal(firstRows.rows[0].n, 1, "the first cycle must durably ingest the genuine accession"); assert.equal(firstRows.rows[0].origin_fingerprint, candidate.originFingerprint); assert.ok((await store.getCheckpoint(scope))?.cursor);
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_owner=null, lease_until=null, active_execution_id=null where collection_scope_key=$1", [scope]);
    const second = await runNewsExecutorOnce({ store, workerId: `n0-t25-cycle-2-${suffix}`, secUserAgent: userAgent(), collectionScopeKey: scope, fetchImpl: replay.fetchImpl, fetchTimeoutMs: 30_000 });
    assert.equal(second.claimed, true); assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 1);
    assert.equal((await store.readPublicationRevisionsAsOf(new Date(Date.now() + 60_000).toISOString(), candidate.publicationId)).length, 1);
    console.log(`N0_T25_PROOF cik=${CIK} accession=${candidate.externalId} source=${candidate.sourceId} originFingerprint=${candidate.originFingerprint} baseline=0 firstCount=1 secondCount=1 checkpointAfterFirst=yes`);
  } finally { await Promise.all([store.close(), admin.end()]); }
});

test("N0-T26: executor recovers an injected post-fetch pre-commit crash without checkpoint loss or duplication", { skip: !enabled && "N5_REAL_SOURCE=1 required for the official SEC proof" }, async () => {
  if (!DB_URL) throw new Error("NEWS_DATABASE_URL or TEST_DATABASE_URL is required for N0-T26");
  const admin = new Client({ connectionString: DB_URL }); const pool = new Pool({ connectionString: DB_URL, max: 4 }); const store = new PostgresNewsStore(pool); const suffix = randomUUID().replaceAll("-", ""); const scope = `n0-t26-${suffix}`;
  try {
    await admin.connect(); await applyN1Migrations(admin); const replay = await genuineSecReplay(); await installTarget(store, scope); const candidate = await absentPublication(admin, replay.publications);
    const originalIngest = store.ingest.bind(store); let injectOnce = true;
    store.ingest = async (batch, options) => injectOnce ? (injectOnce = false, originalIngest(batch, { ...options, failurePoint: "before-commit" })) : originalIngest(batch, options);
    await assert.rejects(runNewsExecutorOnce({ store, workerId: `n0-t26-worker-1-${suffix}`, secUserAgent: userAgent(), collectionScopeKey: scope, fetchImpl: replay.fetchImpl, fetchTimeoutMs: 30_000 }), /INJECTED_FAILURE_BEFORE_COMMIT/);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 0); assert.equal(await store.getCheckpoint(scope), null);
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_owner=null, lease_until=null, active_execution_id=null where collection_scope_key=$1", [scope]);
    const recovered = await runNewsExecutorOnce({ store, workerId: `n0-t26-worker-2-${suffix}`, secUserAgent: userAgent(), collectionScopeKey: scope, fetchImpl: replay.fetchImpl, fetchTimeoutMs: 30_000 });
    assert.equal(recovered.claimed, true); assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 1); assert.ok((await store.getCheckpoint(scope))?.cursor);
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_owner=null, lease_until=null, active_execution_id=null where collection_scope_key=$1", [scope]);
    await runNewsExecutorOnce({ store, workerId: `n0-t26-worker-3-${suffix}`, secUserAgent: userAgent(), collectionScopeKey: scope, fetchImpl: replay.fetchImpl, fetchTimeoutMs: 30_000 });
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 1);
    console.log(`N0_T26_PROOF cik=${CIK} accession=${candidate.externalId} crash=post-fetch-pre-commit worker1=failed worker2=recovered checkpointDuringCrash=absent finalPublications=1 replayDuplicates=0`);
  } finally { await Promise.all([store.close(), admin.end()]); }
});
