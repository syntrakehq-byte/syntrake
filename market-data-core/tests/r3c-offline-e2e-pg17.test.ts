import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { runOfflineIngestOnce } from "../offlinePipeline";
import { AutonomousWorker } from "../autonomousWorker";
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
};
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
  await db.query("INSERT INTO market_core.providers VALUES ($1,'FAKE_E2E','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'offline-fixture',true,false,NULL)",[ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'Offline Test Issuer')",[ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')",[ids.instrument,ids.issuer]);
  await db.query("INSERT INTO market_core.listings VALUES ($1,$2,'XNAS','USD','TEST',DATE '2020-01-01',NULL)",[ids.listing,ids.instrument]);
  await db.query(`INSERT INTO market_core.provider_budget_periods
    VALUES ($1,$2,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',2,0,0)`,[ids.budget,ids.provider]);
});
afterEach(async () => {
  await db.query("DELETE FROM market_core.ingestion_runs");
  await db.query("DELETE FROM market_core.job_leases");
  await db.query("DELETE FROM market_core.credit_reservations");
  await db.query("DELETE FROM market_core.ingest_jobs");
  await db.query("UPDATE market_core.provider_budget_periods SET reserved_credits=0,consumed_credits=0");
});
after(async () => {
  await db.query("DROP SCHEMA IF EXISTS market_core CASCADE");
  await db.query("DROP EXTENSION IF EXISTS btree_gist");
  await db.query("DROP ROLE IF EXISTS market_core_reader");
  await db.query("DROP ROLE IF EXISTS market_core_ingest");
  await db.query("DROP ROLE IF EXISTS market_core_coordinator_owner");
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
  const budget = await db.query("SELECT reserved_credits::text, consumed_credits::text FROM market_core.provider_budget_periods");
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
  assert.equal((await db.query("SELECT consumed_credits::text AS consumed FROM market_core.provider_budget_periods")).rows[0].consumed,"2.000000");
});

test("R3-D1 autonomous runner uses independent PG17 session and completes one queued job", async () => {
  const job = "80000000-0000-0000-0000-0000000000aa";
  await createJob(job, "c");
  const worker = new AutonomousWorker({
    workerId: "autonomous-pg17", exchangeTimezone: "UTC", maxTasks: 1,
    clientFactory: async () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 }),
    provider: async () => response(), consumedCredits: "1",
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
