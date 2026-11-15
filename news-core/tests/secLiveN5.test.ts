import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  payloadJson: string;
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
  return { publications: parsed.publications, payloadJson: JSON.stringify(payload), fetchImpl };
}

async function installTarget(store: PostgresNewsStore, scope: string): Promise<void> {
  await store.ensureSource("sec-edgar", "sec");
  await store.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: CIK, parameters: { forms: ["10-K", "10-Q", "8-K", "20-F", "6-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });
}

async function applyN1Migrations(admin: Client): Promise<void> {
  for (const file of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql"]) await admin.query(await readFile(migration(file), "utf8"));
}

async function openIsolatedDatabase(): Promise<{ admin: Client; connectionString: string; close: () => Promise<void> }> {
  if (!DB_URL) throw new Error("NEWS_DATABASE_URL or TEST_DATABASE_URL is required");
  const databaseName = `news_n0_${randomUUID().replaceAll("-", "")}`;
  const provisioner = new Client({ connectionString: DB_URL }); await provisioner.connect();
  await provisioner.query(`create database "${databaseName}"`);
  const databaseUrl = new URL(DB_URL); databaseUrl.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: databaseUrl.toString() }); await admin.connect();
  return {
    admin,
    connectionString: databaseUrl.toString(),
    close: async () => {
      await admin.end();
      // Child workers can close their pools just after their exit event. Terminate
      // any final backend before dropping the isolated database so teardown cannot
      // mask an already completed crash/recovery proof.
      await provisioner.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]);
      await provisioner.query(`drop database if exists "${databaseName}"`);
      await provisioner.end();
    },
  };
}

async function absentPublication(admin: Client, publications: ReplayFixture["publications"]): Promise<ReplayFixture["publications"][number]> {
  for (const publication of publications) {
    const count = Number((await admin.query("select count(*)::int n from news_core.publications where source_id=$1 and external_id=$2", [publication.sourceId, publication.externalId])).rows[0].n);
    if (count === 0) return publication;
  }
  throw new Error("N0_REPLAY_BASELINE_NOT_EMPTY");
}

function spawnT26Worker(connectionString: string, scope: string, payloadFile: string, mode: "barrier" | "recover"): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("news-core/tests/n0T26Worker.ts")], {
    env: { ...process.env, NEWS_DATABASE_URL: connectionString, N0_T26_SCOPE: scope, N0_T26_PAYLOAD_FILE: payloadFile, N0_T26_WORKER_MODE: mode },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForWorkerOutput(worker: ChildProcessWithoutNullStreams, marker: string, timeoutMs = 30_000): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { worker.removeAllListeners("exit"); reject(new Error(`N0_T26_WORKER_TIMEOUT marker=${marker} output=${output}`)); }, timeoutMs);
    const onData = (chunk: Buffer) => { output += chunk.toString(); if (output.includes(marker)) { clearTimeout(timer); worker.stdout.off("data", onData); resolve(output); } };
    worker.stdout.on("data", onData); worker.stderr.on("data", chunk => { output += chunk.toString(); });
    worker.once("exit", (code, signal) => { if (!output.includes(marker)) { clearTimeout(timer); reject(new Error(`N0_T26_WORKER_EXIT code=${code} signal=${signal} output=${output}`)); } });
  });
}

async function waitForWorkerExit(worker: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise(resolve => worker.once("exit", (code, signal) => resolve({ code, signal })));
}

async function stopWorker(worker: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill("SIGKILL");
  await waitForWorkerExit(worker);
}

test("N0-T25: two attributable SEC cycles use a genuine isolated baseline and remain idempotent", { skip: !enabled && "N5_REAL_SOURCE=1 required for the official SEC proof" }, async () => {
  if (!DB_URL) throw new Error("NEWS_DATABASE_URL or TEST_DATABASE_URL is required for N0-T25");
  const isolated = await openIsolatedDatabase(); const admin = isolated.admin; const pool = new Pool({ connectionString: isolated.connectionString, max: 4 }); const store = new PostgresNewsStore(pool); const suffix = randomUUID().replaceAll("-", ""); const scope = `n0-t25-${suffix}`;
  try {
    await applyN1Migrations(admin); const replay = await genuineSecReplay(); await installTarget(store, scope);
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
  } finally { await store.close(); await isolated.close(); }
});

test("N0-T26: PID1 SIGKILL after fetch recovers in PID2 without checkpoint loss or duplication", { skip: !enabled && "N5_REAL_SOURCE=1 required for the official SEC proof" }, async () => {
  if (!DB_URL) throw new Error("NEWS_DATABASE_URL or TEST_DATABASE_URL is required for N0-T26");
  const isolated = await openIsolatedDatabase(); const admin = isolated.admin; const suffix = randomUUID().replaceAll("-", ""); const scope = `n0-t26-${suffix}`;
  let pid1: ChildProcessWithoutNullStreams | undefined;
  let pid2: ChildProcessWithoutNullStreams | undefined;
  let pid3: ChildProcessWithoutNullStreams | undefined;
  let payloadDir: string | undefined;
  try {
    await applyN1Migrations(admin); const replay = await genuineSecReplay(); payloadDir = await mkdtemp(path.join(os.tmpdir(), "syntrake-n0-t26-")); const payloadFile = path.join(payloadDir, "sec-submissions.json"); await writeFile(payloadFile, replay.payloadJson, "utf8"); const pool = new Pool({ connectionString: isolated.connectionString, max: 4 }); const store = new PostgresNewsStore(pool); await installTarget(store, scope); const candidate = await absentPublication(admin, replay.publications); await store.close();
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 0);
    pid1 = spawnT26Worker(isolated.connectionString, scope, payloadFile, "barrier");
    const pid1Number = pid1.pid;
    assert.ok(pid1Number && pid1Number > 0);
    await waitForWorkerOutput(pid1, "N0_T26_CHILD_READY");
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 0);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.checkpoints where collection_scope_key=$1", [scope])).rows[0].n), 0);
    assert.equal(pid1.kill("SIGKILL"), true);
    const pid1Exit = await waitForWorkerExit(pid1);
    assert.equal(pid1Exit.signal, "SIGKILL", `PID1 must terminate by SIGKILL, got code=${pid1Exit.code} signal=${pid1Exit.signal}`);
    console.log(`N0_T26_PID1 pid=${pid1Number} exitSignal=${pid1Exit.signal} publicationsDuringCrash=0 checkpointsDuringCrash=0`);
    // Preserve PID1's execution linkage and make only its lease stale. The real
    // claim path must fence/recover the crashed RUNNING execution before PID2
    // acquires the target; clearing active_execution_id here would bypass that
    // production recovery path and leave an orphan RUNNING execution.
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_until=clock_timestamp()-interval '1 second' where collection_scope_key=$1", [scope]);
    const reclaimState = await admin.query<{ execution_state: string; lease_until: string | null; active_execution_id: string | null }>(
      "select e.state as execution_state,t.lease_until,t.active_execution_id from news_core.collection_targets t left join news_core.executions e on e.execution_id=t.active_execution_id where t.collection_scope_key=$1",
      [scope],
    );
    console.log(`N0_T26_RECLAIM_READY scope=${scope} executionState=${reclaimState.rows[0]?.execution_state ?? "NULL"} leaseUntil=${reclaimState.rows[0]?.lease_until ?? "NULL"} activeExecution=${reclaimState.rows[0]?.active_execution_id ?? "NULL"}`);
    pid2 = spawnT26Worker(isolated.connectionString, scope, payloadFile, "recover");
    const pid2Number = pid2.pid;
    assert.ok(pid2Number && pid2Number > 0 && pid2Number !== pid1Number);
    await waitForWorkerOutput(pid2, "N0_T26_CHILD_DONE");
    const pid2Exit = await waitForWorkerExit(pid2);
    assert.equal(pid2Exit.code, 0);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 1);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publication_revisions pr join news_core.publications p using (publication_id) where p.source_id='sec-edgar' and p.external_id=$1", [candidate.externalId])).rows[0].n), 1);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.checkpoints where collection_scope_key=$1 and visibility_state='COMMITTED'", [scope])).rows[0].n), 1);
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_owner=null, lease_until=null, active_execution_id=null where collection_scope_key=$1", [scope]);
    pid3 = spawnT26Worker(isolated.connectionString, scope, payloadFile, "recover");
    const pid3Number = pid3.pid;
    assert.ok(pid3Number && pid3Number !== pid1Number && pid3Number !== pid2Number);
    await waitForWorkerOutput(pid3, "N0_T26_CHILD_DONE");
    const pid3Exit = await waitForWorkerExit(pid3);
    assert.equal(pid3Exit.code, 0);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar' and external_id=$1", [candidate.externalId])).rows[0].n), 1);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.publication_revisions pr join news_core.publications p using (publication_id) where p.source_id='sec-edgar' and p.external_id=$1", [candidate.externalId])).rows[0].n), 1);
    console.log(`N0_T26_PROOF cik=${CIK} accession=${candidate.externalId} pid1=${pid1Number} pid1Signal=${pid1Exit.signal} pid2=${pid2Number} pid3=${pid3Number} checkpointDuringCrash=absent finalPublications=1 finalRevisions=1 replayDuplicates=0`);
  } finally {
    await stopWorker(pid1);
    await stopWorker(pid2);
    await stopWorker(pid3);
    if (payloadDir) await rm(payloadDir, { recursive: true, force: true });
    await isolated.close();
  }
});
