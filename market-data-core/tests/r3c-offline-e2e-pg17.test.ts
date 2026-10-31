import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { runOfflineIngestOnce } from "../offlinePipeline";
import { AutonomousWorker } from "../autonomousWorker";
import { ContinuousWorkerService } from "../continuousWorkerService";
import { createTwelveDataOfflineProvider } from "../twelveDataProvider";
import { canonicalIdentity, resolveProviderAlias } from "../identity";
import type { DailyCandle } from "../twelveData";

const db = new Client({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "postgres",
  connectionTimeoutMillis: 3000,
});
const ids = {
  provider: "80000000-0000-0000-0000-000000000001",
  rights: "80000000-0000-0000-0000-000000000002",
  issuer: "80000000-0000-0000-0000-000000000003",
  instrument: "80000000-0000-0000-0000-000000000004",
  listing: "80000000-0000-0000-0000-000000000005",
  budget: "80000000-0000-0000-0000-000000000006",
  twelveProvider: "80000000-0000-0000-0000-000000000012",
  twelveBudget: "80000000-0000-0000-0000-000000000013",
  twelveAlias: "80000000-0000-0000-0000-000000000014",
  otherListing: "80000000-0000-0000-0000-000000000015",
  otherAlias: "80000000-0000-0000-0000-000000000016",
};
const runtimeRoles = { worker: "r3d4_worker_login", workerB: "r3d4_worker_b_login", supervisor: "r3d4_supervisor_login" };
const runtimePasswords = { worker: randomBytes(24).toString("hex"), workerB: randomBytes(24).toString("hex"), supervisor: randomBytes(24).toString("hex") };
const useRuntimeIdentity = process.env.R3D4_ONLY === "1";
const candle: DailyCandle = {
  marketDate: "2026-01-05", open: "100.00", high: "110.00",
  low: "90.00", close: "105.50", volume: "23",
};
function response(c: DailyCandle = candle) {
  const now = new Date().toISOString();
  return {
    status: "AVAILABLE" as const,
    value: [c],
    marketDate: c.marketDate,
    sourceRefs: [{
      provider: "FAKE_E2E",
      originalSourceId: "offline-fixture-only",
      requestId: null,
      sourceDocumentUri: null,
    }],
    firstSeenAt: now,
    ingestedAt: now,
    asKnownAt: now,
    revisionId: "sha256:offline-demo-not-provider-evidence",
    schemaVersion: "1.0",
    quality: { flags: ["OFFLINE_SYNTHETIC"], coverage: "FULL" },
    rights: { policyId: ids.rights, display: false, retentionUntil: null },
  };
}
async function createJob(jobId: string, demandHex: string): Promise<void> {
  await db.query(
    `INSERT INTO market_core.ingest_jobs
      (job_id,demand_key,listing_id,provider_id,rights_policy_id,budget_period_id,
       estimated_credits,idempotency_key,state,attempt,max_attempts,next_run_at,last_error)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,'PENDING',0,3,clock_timestamp(),NULL)`,
    [jobId,demandHex.repeat(64),ids.listing,ids.provider,ids.rights,ids.budget,"idem-"+jobId],
  );
}
before(async () => {
  await db.connect();
  const v = await db.query<{ version: string }>("SELECT current_setting('server_version') AS version");
  assert.match(v.rows[0].version, /^17\./);
  await db.query(await readFile(resolve(process.cwd(),
    "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql"),"utf8"));
  await db.query(await readFile(resolve(process.cwd(),
    "supabase/release-candidates/20261031170000_r3c_coordinator_candidate.sql"),"utf8"));
  await db.query(await readFile(resolve(process.cwd(),
    "supabase/release-candidates/20261031183000_r3c3_sql_recovery_candidate.sql"),"utf8"));
  await db.query(await readFile(resolve(process.cwd(),
    "supabase/release-candidates/20261031190000_r3d2_supervision_candidate.sql"),"utf8"));
  await db.query(await readFile(resolve(process.cwd(),
    "supabase/release-candidates/20261031193000_r3d4_worker_runtime_permissions.sql"),"utf8"));
  await db.query(`CREATE ROLE ${runtimeRoles.worker} LOGIN PASSWORD '${runtimePasswords.worker}';`);
  await db.query(`CREATE ROLE ${runtimeRoles.workerB} LOGIN PASSWORD '${runtimePasswords.workerB}';`);
  await db.query(`CREATE ROLE ${runtimeRoles.supervisor} LOGIN PASSWORD '${runtimePasswords.supervisor}';`);
  await db.query(`GRANT market_core_ingest TO ${runtimeRoles.worker} WITH INHERIT TRUE, SET FALSE`);
  await db.query(`GRANT market_core_ingest TO ${runtimeRoles.workerB} WITH INHERIT TRUE, SET FALSE`);
  await db.query(`GRANT market_core_supervisor TO ${runtimeRoles.supervisor} WITH INHERIT TRUE, SET FALSE`);
  await db.query(`GRANT SELECT ON market_core.worker_identity_bindings TO ${runtimeRoles.worker}, ${runtimeRoles.workerB}`);
  await db.query(`GRANT SELECT (job_id, worker_id, lease_until) ON market_core.job_leases TO ${runtimeRoles.worker}, ${runtimeRoles.workerB}`);
  await db.query("INSERT INTO market_core.worker_identity_bindings VALUES ($1,$2),($3,$4)", [runtimeRoles.worker,"service-pg17",runtimeRoles.workerB,"worker-b"]);
  await db.query("INSERT INTO market_core.providers VALUES ($1,'FAKE_E2E','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.providers VALUES ($1,'TWELVE_DATA','ACTIVE')", [ids.twelveProvider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'offline-fixture',true,false,NULL)",[ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'Offline Test Issuer')",[ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')",[ids.instrument,ids.issuer]);
  await db.query("INSERT INTO market_core.listings VALUES ($1,$2,'XNAS','USD','TEST',DATE '2020-01-01',NULL)",[ids.listing,ids.instrument]);
  await db.query("INSERT INTO market_core.listings VALUES ($1,$2,'XNYS','USD','OTHER',DATE '2020-01-01',NULL)",[ids.otherListing,ids.instrument]);
  await db.query(`INSERT INTO market_core.provider_budget_periods
    VALUES ($1,$2,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',2,0,0)`,[ids.budget,ids.provider]);
  await db.query(`INSERT INTO market_core.provider_budget_periods
    VALUES ($1,$2,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',2,0,0)`,[ids.twelveBudget,ids.twelveProvider]);
  await db.query("INSERT INTO market_core.provider_aliases VALUES ($1,$2,'TEST',$3,DATE '2020-01-01',NULL)",[ids.twelveAlias,ids.twelveProvider,ids.listing]);
  await db.query("INSERT INTO market_core.provider_aliases VALUES ($1,$2,'OTHER',$3,DATE '2020-01-01',NULL)",[ids.otherAlias,ids.twelveProvider,ids.otherListing]);
});
afterEach(async () => {
  await db.query("DELETE FROM market_core.ingestion_runs");
  await db.query("DELETE FROM market_core.job_leases");
  await db.query("DELETE FROM market_core.credit_reservations");
  await db.query("DELETE FROM market_core.ingest_jobs");
  await db.query("UPDATE market_core.provider_budget_periods SET reserved_credits=0,consumed_credits=0");
});
after(async () => {
  await db.query(`REVOKE ALL ON market_core.worker_identity_bindings, market_core.job_leases FROM ${runtimeRoles.worker}, ${runtimeRoles.workerB}`);
  await db.query(`REVOKE market_core_ingest FROM ${runtimeRoles.worker}, ${runtimeRoles.workerB}`);
  await db.query(`REVOKE market_core_supervisor FROM ${runtimeRoles.supervisor}`);
  await db.query(`DROP ROLE IF EXISTS ${runtimeRoles.worker}`);
  await db.query(`DROP ROLE IF EXISTS ${runtimeRoles.workerB}`);
  await db.query(`DROP ROLE IF EXISTS ${runtimeRoles.supervisor}`);
  await db.query("DROP SCHEMA IF EXISTS market_core CASCADE");
  await db.query("DROP EXTENSION IF EXISTS btree_gist");
  await db.query("DROP ROLE IF EXISTS market_core_reader");
  await db.query("DROP ROLE IF EXISTS market_core_ingest");
  await db.query("DROP ROLE IF EXISTS market_core_coordinator_owner");
  await db.query("DROP ROLE IF EXISTS market_core_supervisor");
  await db.query("DROP ROLE IF EXISTS anon");
  await db.query("DROP ROLE IF EXISTS authenticated");
  await db.end();
});

test("offline claim -> fake -> strict validation -> R3-B revision -> one ACK + replay", async () => {
  const firstJob = "80000000-0000-0000-0000-000000000007";
  await createJob(firstJob, "a");
  let fakeCalls = 0;
  const fake = async () => { fakeCalls++; return response(); };
  const opts = {
    db, provider: fake, workerId:"offline-worker",
    leaseToken:"80000000-0000-0000-0000-000000000008",
    runId:"80000000-0000-0000-0000-000000000009",
    providerRunKey:"offline-run-one",
    consumedCredits:"1", exchangeTimezone:"America/New_York",
  };
  const result = await runOfflineIngestOnce(opts);
  assert.equal(result.state,"COMMITTED");
  if (result.state !== "COMMITTED") throw Error("unreachable");
  assert.equal(result.jobId,firstJob);
  assert.equal(fakeCalls,1);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1",[firstJob])).rows[0].state,"COMMITTED");
  const row = await db.query(`SELECT r.close_value::text AS close, o.exchange_timezone
    FROM market_core.market_observation_revisions r
    JOIN market_core.market_observations o USING (observation_id)
    WHERE r.revision_id=$1`,[result.revisionId]);
  assert.equal(row.rows[0].close,"105.500000000000");
  assert.equal(row.rows[0].exchange_timezone,"America/New_York");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs")).rows[0].n,1);
  const budget = await db.query("SELECT reserved_credits::text, consumed_credits::text FROM market_core.provider_budget_periods WHERE budget_period_id=$1", [ids.budget]);
  assert.equal(budget.rows[0].reserved_credits,"0.000000");
  assert.equal(budget.rows[0].consumed_credits,"1.000000");
  assert.deepEqual(await runOfflineIngestOnce(opts),{state:"NO_WORK"});
  assert.equal(fakeCalls,1);

  // A second *different* legitimate demand for the same source content does
  // not rewrite or duplicate the already materialized point-in-time revision.
  const secondJob = "80000000-0000-0000-0000-00000000000a";
  await createJob(secondJob,"b");
  const second=await runOfflineIngestOnce({
    ...opts, leaseToken:"80000000-0000-0000-0000-00000000000b",
    runId:"80000000-0000-0000-0000-00000000000c", providerRunKey:"offline-run-two",
  });
  assert.equal(second.state,"COMMITTED");
  if (second.state !== "COMMITTED") throw Error("unreachable");
  assert.equal(second.revisionId,result.revisionId);
  assert.equal(fakeCalls,2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.market_observations")).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.market_observation_revisions")).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs")).rows[0].n,2);
  assert.equal((await db.query("SELECT consumed_credits::text AS consumed FROM market_core.provider_budget_periods WHERE budget_period_id=$1", [ids.budget])).rows[0].consumed,"2.000000");
});

test("R3-D1 autonomous runner uses independent PG17 session and completes one queued job", async () => {
  const job = "80000000-0000-0000-0000-0000000000aa";
  await createJob(job, "c");
  const capabilityToken = (await db.query("SELECT market_core.register_worker_instance('autonomous-pg17','instance-d2') AS token")).rows[0].token as string;
  const worker = new AutonomousWorker({
    workerId: "autonomous-pg17", exchangeTimezone: "UTC", maxTasks: 1,
    clientFactory: async () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 }),
    provider: async () => response(), consumedCredits: "1", heartbeat: { instanceId: "instance-d2", capabilityToken },
  });
  const stats = await worker.run();
  assert.equal(stats.committed, 1);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows[0].state, "COMMITTED");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs WHERE job_id=$1", [job])).rows[0].n, 1);
});

test("R3-D1 idle polling observes a task created after the queue was empty", async () => {
  const worker = new AutonomousWorker({
    workerId: "idle-pg17", exchangeTimezone: "UTC", pollIntervalMs: 10, maxTasks: 1, maxPolls: 20, consumedCredits: "1",
    clientFactory: async () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 }),
    provider: async () => response(),
  });
  const running = worker.run();
  await new Promise(resolve => setTimeout(resolve, 30));
  const job = "80000000-0000-0000-0000-0000000000ab";
  await createJob(job, "d");
  const stats = await running;
  assert.equal(stats.committed, 1);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows[0].state, "COMMITTED");
});

test("R3-D1 parallel workers produce one provider call, ACK and reservation", async () => {
  const job = "80000000-0000-0000-0000-0000000000ac";
  await createJob(job, "e");
  let providerCalls = 0;
  const clientFactory = async () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  const makeWorker = (workerId: string) => new AutonomousWorker({ workerId, exchangeTimezone: "UTC", maxTasks: 1, maxPolls: 1, consumedCredits: "1", clientFactory, provider: async () => { providerCalls++; return response(); } });
  const [left, right] = await Promise.all([makeWorker("parallel-left").run(), makeWorker("parallel-right").run()]);
  assert.equal(left.committed + right.committed, 1);
  assert.equal(providerCalls, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs WHERE job_id=$1", [job])).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.credit_reservations WHERE job_id=$1", [job])).rows[0].n, 1);
});

test("malformed OHLC is rejected without persisting a revision or charging credits", async () => {
  await createJob("80000000-0000-0000-0000-00000000000d","c");
  const previous = (await db.query("SELECT count(*)::int AS n FROM market_core.market_observation_revisions")).rows[0].n as number;
  await assert.rejects(runOfflineIngestOnce({
    db, provider:async()=>response({ ...candle, close:"150.00" }),
    workerId:"bad-payload",leaseToken:"80000000-0000-0000-0000-00000000000e",
    runId:"80000000-0000-0000-0000-00000000000f",
    providerRunKey:"bad-payload",consumedCredits:"1",
    exchangeTimezone:"America/New_York",
  }));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.market_observation_revisions")).rows[0].n,previous);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs")).rows[0].n,0);
  assert.equal((await db.query("SELECT consumed_credits::text AS value FROM market_core.provider_budget_periods")).rows[0].value,"0.000000");
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs")).rows[0].state,"FETCHING");
  // Fixture-only clock travel proves a timed-out billable call is NOT replayed.
  const recovery = await db.query("SELECT market_core.recover_expired_ingest_leases(clock_timestamp()+interval '6 minutes') AS n");
  assert.equal(recovery.rows[0].n,1);
  const held = await db.query("SELECT j.state,j.last_error,r.state AS reservation_state,b.reserved_credits::text AS reserved FROM market_core.ingest_jobs j JOIN market_core.credit_reservations r ON r.job_id=j.job_id JOIN market_core.provider_budget_periods b ON b.budget_period_id=r.budget_period_id");
  assert.equal(held.rows[0].state,"DEAD_LETTER");
  assert.equal(held.rows[0].last_error,"COST_UNCERTAIN");
  assert.equal(held.rows[0].reservation_state,"RESERVED");
  assert.equal(held.rows[0].reserved,"1.000000");
  assert.deepEqual(await runOfflineIngestOnce({
    db, provider:async()=>{throw Error("NEVER_REFETCH");},
    workerId:"no-replay",leaseToken:"80000000-0000-0000-0000-000000000010",
    runId:"80000000-0000-0000-0000-000000000011",
    providerRunKey:"no-replay",consumedCredits:"1",
    exchangeTimezone:"America/New_York",
  }),{state:"NO_WORK"});
});

test("R3-D3 service sends periodic heartbeats during a slow offline task and shuts down cleanly", async () => {
  const job = "80000000-0000-0000-0000-0000000000ae";
  await createJob(job, "f");
  const workerId = "service-pg17";
  const instanceId = "instance-service-pg17";
  const capabilityToken = (await db.query("SELECT market_core.register_worker_instance($1,$2) AS token", [workerId, instanceId])).rows[0].token as string;
  const clientFactory = async () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: useRuntimeIdentity ? runtimeRoles.worker : (process.env.PGUSER ?? "postgres"), password: useRuntimeIdentity ? runtimePasswords.worker : (process.env.PGPASSWORD ?? "postgres"), database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  let providerStarted = false;
  let releaseProvider!: () => void;
  const providerBlocked = new Promise<void>(resolve => { releaseProvider = resolve; });
  const service = new ContinuousWorkerService({
    workerId, instanceId, capabilityToken, clientFactory, exchangeTimezone: "UTC", consumedCredits: "1",
    heartbeatIntervalMs: 15, maxTasks: 1, maxPolls: 1,
    provider: async () => { providerStarted = true; await providerBlocked; return response(); },
  });
  const running = service.start();
  const providerDeadline = Date.now() + 3000;
  while (!providerStarted && Date.now() < providerDeadline) await new Promise(resolve => setTimeout(resolve, 5));
  if (!providerStarted) {
    await assert.rejects(running, error => error instanceof Error && /WORKER_IDENTITY_REJECTED|WORKER_FAILURE/.test(error.message));
    throw new Error(`offline worker did not reach provider; heartbeat=${service.heartbeatError ?? "none"}`);
  }
  const initial = (await db.query("SELECT last_seen_at FROM market_core.worker_heartbeats WHERE worker_id=$1 AND instance_id=$2", [workerId, instanceId])).rows[0].last_seen_at as Date;
  let periodic: Date | undefined;
  const deadline = Date.now() + 1000;
  while (!periodic && Date.now() < deadline) {
    const row = await db.query("SELECT last_seen_at FROM market_core.worker_heartbeats WHERE worker_id=$1 AND instance_id=$2", [workerId, instanceId]);
    const current = row.rows[0]?.last_seen_at as Date | undefined;
    if (current && current.valueOf() > initial.valueOf()) periodic = current;
    else await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(periodic && periodic.valueOf() > initial.valueOf());
  releaseProvider();
  await running;
  const stats = await service.shutdown().then(() => service.isRunning);
  assert.equal(stats, false);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows[0].state, "COMMITTED");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.credit_reservations WHERE job_id=$1", [job])).rows[0].n, 1);
  const supervisor = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: runtimeRoles.supervisor, password: runtimePasswords.supervisor, database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  await supervisor.connect();
  const supervisorView = await supervisor.query("SELECT * FROM market_core.supervisor_snapshot($1::interval)", ["1 minute"]);
  assert.ok(supervisorView.rows.some(row => row.worker_id === workerId));
  await supervisor.end();
});

test("PG17 least-privilege probe permits only the worker catalog read and supervisor inspection", async () => {
  await db.query("SET ROLE market_core_ingest");
  const provider = await db.query("SELECT provider_id, provider_key FROM market_core.providers LIMIT 1");
  assert.ok(Array.isArray(provider.rows));
  await db.query("RESET ROLE");
  await db.query("SET ROLE market_core_supervisor");
  const snapshot = await db.query("SELECT * FROM market_core.supervisor_snapshot($1::interval)", ["1 minute"]);
  assert.ok(Array.isArray(snapshot.rows));
  await db.query("RESET ROLE");
});

test("PG17 LOGIN worker cannot read or write outside an active claim", async () => {
  const job = "80000000-0000-0000-0000-0000000000b0";
  await createJob(job, "b");
  const worker = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: runtimeRoles.worker, password: runtimePasswords.worker, database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  await worker.connect();
  await assert.rejects(worker.query("SET ROLE market_core_ingest"), /permission denied to set role/);
  await assert.doesNotReject(worker.query("RESET ROLE"));
  const hidden = await worker.query("SELECT job_id FROM market_core.ingest_jobs WHERE job_id=$1", [job]);
  assert.equal(hidden.rows.length, 0);
  const spoof = await worker.query("SELECT * FROM market_core.claim_ingest_job_safe($1,$2)", ["worker-b", "80000000-0000-0000-0000-0000000000b1"]);
  assert.equal(spoof.rows.length, 0);
  await assert.rejects(worker.query(`INSERT INTO market_core.market_observations
    (observation_id,listing_id,provider_id,rights_policy_id,interval,market_date,exchange_timezone,adjustment,created_at)
    VALUES ('80000000-0000-0000-0000-0000000000b1',$1,$2,$3,'1day',DATE '2026-01-05','UTC','none',clock_timestamp())`, [ids.listing, ids.provider, ids.rights]), /row-level security|permission denied/);
  await assert.rejects(worker.query("UPDATE market_core.provider_budget_periods SET reserved_credits=reserved_credits+1"), /permission denied|row-level security/);
  await assert.rejects(worker.query("SELECT * FROM market_core.supervisor_snapshot('1 minute'::interval)"), /permission denied|function/);
  await worker.end();
});

test("PG17 isolates two LOGIN workers on the active lease owner", async () => {
  const job = "80000000-0000-0000-0000-0000000000b2";
  await createJob(job, "c");
  let providerStarted = false;
  let releaseProvider!: () => void;
  const blocked = new Promise<void>(resolve => { releaseProvider = resolve; });
  const workerB = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: runtimeRoles.workerB, password: runtimePasswords.workerB, database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  await workerB.connect();
  const running = runOfflineIngestOnce({
    db: workerB, workerId: "worker-b", leaseToken: "80000000-0000-0000-0000-0000000000b3",
    runId: "80000000-0000-0000-0000-0000000000b4", providerRunKey: "worker-b-run",
    consumedCredits: "1", exchangeTimezone: "UTC",
    provider: async () => { providerStarted = true; await blocked; return response(); },
  });
  const deadline = Date.now() + 3000;
  while (!providerStarted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(providerStarted, true);
  const workerA = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: runtimeRoles.worker, password: runtimePasswords.worker, database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  await workerA.connect();
  assert.equal((await workerA.query("SELECT job_id FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows.length, 0);
  await assert.rejects(workerA.query(`INSERT INTO market_core.market_observations
    (observation_id,listing_id,provider_id,rights_policy_id,interval,market_date,exchange_timezone,adjustment,created_at)
    VALUES ('80000000-0000-0000-0000-0000000000b5',$1,$2,$3,'1day',DATE '2026-01-05','UTC','none',clock_timestamp())`, [ids.listing, ids.provider, ids.rights]), /row-level security|permission denied/);
  await workerA.end();
  releaseProvider();
  assert.equal((await running).state, "COMMITTED");
  await workerB.end();
});

test("R3-E0 PG17 LOGIN worker uses the Twelve Data adapter through R3-C", async () => {
  const job = "80000000-0000-0000-0000-0000000000b6";
  await db.query(`INSERT INTO market_core.ingest_jobs
    (job_id,demand_key,listing_id,provider_id,rights_policy_id,budget_period_id,estimated_credits,idempotency_key,state,attempt,max_attempts,next_run_at,last_error)
    VALUES ($1,$2,$3,$4,$5,$6,1,$7,'PENDING',0,3,clock_timestamp(),NULL)`,
    [job,"e".repeat(64),ids.listing,ids.twelveProvider,ids.rights,ids.twelveBudget,"idem-"+job]);
  const identity = canonicalIdentity({
    instrument: { instrumentId: ids.instrument, issuerId: ids.issuer, kind: "EQUITY", denominationCurrency: "USD" },
    listing: { listingId: ids.listing, instrumentId: ids.instrument, mic: "XNAS", tradingCurrency: "USD", ticker: "TEST", validFrom: "2020-01-01", validTo: null },
  });
  const alias = resolveProviderAlias("TWELVE_DATA", "TEST", "2026-01-05", [{
    provider: "TWELVE_DATA", providerReference: "TEST", instrumentId: ids.instrument, listingId: ids.listing, validFrom: "2020-01-01", validTo: null,
  }]);
  const provider = createTwelveDataOfflineProvider({
    env: { VERCEL_ENV:"preview", VERCEL_GIT_COMMIT_REF:"feat/r3-market-data-core-20261030", VERCEL_GIT_COMMIT_SHA:"a".repeat(40), SYNTRAKE_R3_PROVIDER_ENABLED:"enabled", SYNTRAKE_R3_PREVIEW_APPROVED_SHA:"a".repeat(40), SYNTRAKE_TWELVE_DATA_API_KEY:"offline-key-123456" },
    resolve: async () => ({ instrument: identity, sourceAlias: alias, asOf: "2026-01-05" }),
    transport: async () => new Response(JSON.stringify({ status:"ok", meta:{ symbol:"TEST", interval:"1day", currency:"USD", exchange_timezone:"America/New_York", type:"Common Stock", mic_code:"XNAS" }, values:[{ datetime:"2026-01-05", open:"100", high:"110", low:"90", close:"105.5", volume:"23" }] }), { status:200 }),
    clock: () => new Date("2026-01-06T12:00:00Z"),
  });
  const worker = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: runtimeRoles.workerB, password: runtimePasswords.workerB, database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  await worker.connect();
  const result = await runOfflineIngestOnce({ db: worker, provider, workerId:"worker-b", leaseToken:"80000000-0000-0000-0000-0000000000b7", runId:"80000000-0000-0000-0000-0000000000b8", providerRunKey:"r3e0-login", consumedCredits:"1", exchangeTimezone:"America/New_York" });
  assert.equal(result.state, "COMMITTED");
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows[0].state, "COMMITTED");
  assert.equal((await db.query("SELECT consumed_credits::text AS c FROM market_core.provider_budget_periods WHERE budget_period_id=$1", [ids.twelveBudget])).rows[0].c, "1.000000");
  await worker.end();
});

test("R3-E0 rejects a Registry identity from another listing before HTTP or ACK", async () => {
  const job = "80000000-0000-0000-0000-0000000000b9";
  const revisionsBefore = (await db.query("SELECT count(*)::int AS n FROM market_core.market_observation_revisions")).rows[0].n as number;
  await db.query(`INSERT INTO market_core.ingest_jobs
    (job_id,demand_key,listing_id,provider_id,rights_policy_id,budget_period_id,estimated_credits,idempotency_key,state,attempt,max_attempts,next_run_at,last_error)
    VALUES ($1,$2,$3,$4,$5,$6,1,$7,'PENDING',0,3,clock_timestamp(),NULL)`,
    [job,"f".repeat(64),ids.listing,ids.twelveProvider,ids.rights,ids.twelveBudget,"idem-"+job]);
  const otherIdentity = canonicalIdentity({
    instrument: { instrumentId: ids.instrument, issuerId: ids.issuer, kind: "EQUITY", denominationCurrency: "USD" },
    listing: { listingId: ids.otherListing, instrumentId: ids.instrument, mic: "XNYS", tradingCurrency: "USD", ticker: "OTHER", validFrom: "2020-01-01", validTo: null },
  });
  const otherAlias = resolveProviderAlias("TWELVE_DATA", "OTHER", "2026-01-05", [{
    provider: "TWELVE_DATA", providerReference: "OTHER", instrumentId: ids.instrument, listingId: ids.otherListing, validFrom: "2020-01-01", validTo: null,
  }]);
  let transportCalls = 0;
  const provider = createTwelveDataOfflineProvider({
    env: { VERCEL_ENV:"preview", VERCEL_GIT_COMMIT_REF:"feat/r3-market-data-core-20261030", VERCEL_GIT_COMMIT_SHA:"a".repeat(40), SYNTRAKE_R3_PROVIDER_ENABLED:"enabled", SYNTRAKE_R3_PREVIEW_APPROVED_SHA:"a".repeat(40), SYNTRAKE_TWELVE_DATA_API_KEY:"offline-key-123456" },
    resolve: async () => ({ instrument: otherIdentity, sourceAlias: otherAlias, asOf: "2026-01-05" }),
    transport: async () => { transportCalls++; return new Response("unexpected"); },
  });
  const worker = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: runtimeRoles.workerB, password: runtimePasswords.workerB, database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  await worker.connect();
  await assert.rejects(runOfflineIngestOnce({ db: worker, provider, workerId:"worker-b", leaseToken:"80000000-0000-0000-0000-0000000000ba", runId:"80000000-0000-0000-0000-0000000000bb", providerRunKey:"r3e0-mismatch", consumedCredits:"1", exchangeTimezone:"America/New_York" }), /OFFLINE_PROVIDER_IDENTITY_MISMATCH/);
  assert.equal(transportCalls, 0);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows[0].state, "FETCHING");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.market_observation_revisions")).rows[0].n, revisionsBefore);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs WHERE job_id=$1", [job])).rows[0].n, 0);
  await worker.end();
});

test("R3-D3 rejects invalid or revoked capability before claim, provider call, ACK or reservation", async () => {
  const job = "80000000-0000-0000-0000-0000000000af";
  await createJob(job, "a");
  const clientFactory = async () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
  let providerCalls = 0;
  const base = { workerId: "capability-pg17", instanceId: "instance-capability-pg17", clientFactory, provider: async () => { providerCalls++; return response(); }, exchangeTimezone: "UTC", consumedCredits: "1", maxTasks: 1, maxPolls: 1, heartbeatIntervalMs: 10 } as const;
  const invalid = new ContinuousWorkerService({ ...base, capabilityToken: "0".repeat(64) });
  await assert.rejects(invalid.start(), /WORKER_IDENTITY_REJECTED/);
  assert.equal(providerCalls, 0);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [job])).rows[0].state, "PENDING");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.credit_reservations WHERE job_id=$1", [job])).rows[0].n, 0);

  const oldToken = (await db.query("SELECT market_core.register_worker_instance($1,$2) AS token", [base.workerId, base.instanceId])).rows[0].token as string;
  await db.query("SELECT market_core.register_worker_instance($1,$2)", [base.workerId, "instance-capability-replacement"]);
  const revoked = new ContinuousWorkerService({ ...base, capabilityToken: oldToken });
  await assert.rejects(revoked.start(), /WORKER_IDENTITY_REJECTED/);
  assert.equal(providerCalls, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.credit_reservations WHERE job_id=$1", [job])).rows[0].n, 0);
});
