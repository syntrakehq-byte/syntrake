import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { ContinuousWorkerService } from "../continuousWorkerService";
import { planDemand } from "../coordinator";
import { handleInvestingMarketDataRead, loadInvestingMarketDataFromPostgres } from "../investingMarketDataHttp";
import type { Actor } from "../../investing-core/contracts";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const db = new Client({ connectionString: adminUrl });
const workerRole = "g3e_worker_login";
const readerRole = "g3e_reader_login";
const workerPassword = "g3e-worker-password";
const readerPassword = "g3e-reader-password";
const ids = {
  provider: "e3000000-0000-0000-0000-000000000001", rights: "e3000000-0000-0000-0000-000000000002",
  issuer: "e3000000-0000-0000-0000-000000000003", instrument: "e3000000-0000-0000-0000-000000000004",
  listing: "e3000000-0000-0000-0000-000000000005", budget: "e3000000-0000-0000-0000-000000000006",
  job: "e3000000-0000-0000-0000-000000000007",
};
const actor: Actor = { userId: "g3e-preview-user", sessionId: "g3e-preview-session" };

async function migration(file: string) { await db.query(await readFile(resolve(process.cwd(), file), "utf8")); }

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') AS v")).rows[0].v, /^17\./);
  for (const file of [
    "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql",
    "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql",
    "supabase/release-candidates/20261102090000_g2a_universal_historical_api.sql",
    "supabase/release-candidates/20261031170000_r3c_coordinator_candidate.sql",
    "supabase/release-candidates/20261031183000_r3c3_sql_recovery_candidate.sql",
    "supabase/release-candidates/20261031190000_r3d2_supervision_candidate.sql",
    "supabase/release-candidates/20261031193000_r3d4_worker_runtime_permissions.sql",
  ]) await migration(file);
  await db.query(`CREATE ROLE ${workerRole} LOGIN PASSWORD '${workerPassword}'`);
  await db.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${readerPassword}'`);
  await db.query(`GRANT market_core_ingest TO ${workerRole} WITH INHERIT TRUE, SET FALSE`);
  await db.query(`GRANT market_core_reader TO ${readerRole}`);
  await db.query("INSERT INTO market_core.worker_identity_bindings VALUES ($1,$2)", [workerRole, "g3e-worker"]);
  await db.query("INSERT INTO market_core.providers VALUES ($1,'G3E_OFFLINE_PROVIDER','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'g3e-rights',true,true,NULL)", [ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'G3E issuer')", [ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument, ids.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from) VALUES($1,$2,'XNAS','OPERATING','USD','G3E',DATE '2020-01-01')", [ids.listing, ids.instrument]);
  await db.query("INSERT INTO market_core.provider_budget_periods VALUES($1,$2,DATE '2020-01-01',DATE '2030-01-01',1,0,0)", [ids.budget, ids.provider]);
});

after(async () => {
  try {
    await db.query("DROP SCHEMA IF EXISTS market_core CASCADE");
    await db.query("DROP EXTENSION IF EXISTS btree_gist");
    for (const role of [workerRole, readerRole, "market_core_coordinator_owner", "market_core_supervisor", "market_core_reader", "market_core_ingest", "market_core_catalog_ingest", "market_core_catalog_reader", "market_core_registry_reviewer", "anon", "authenticated"]) {
      try { await db.query(`DROP OWNED BY ${role}`); } catch { /* partial setup */ }
      try { await db.query(`DROP ROLE IF EXISTS ${role}`); } catch { /* partial setup */ }
    }
  } finally { await db.end(); }
});

test("G3-E proves Coordinator -> LOGIN worker -> PG17 -> authenticated API using the same revision", async () => {
  const demand = planDemand({ listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, interval: "1day", adjustment: "none", from: "2026-02-02", to: "2026-02-02", freshness: "AVAILABLE", costClass: "KNOWN" });
  assert.equal(demand.state, "READY");
  await db.query("INSERT INTO market_core.ingest_jobs(job_id,demand_key,listing_id,provider_id,rights_policy_id,budget_period_id,estimated_credits,idempotency_key,state,attempt,max_attempts,next_run_at) VALUES($1,$2,$3,$4,$5,$6,1,'g3e-demand','PENDING',0,3,clock_timestamp())", [ids.job, demand.demandKey, ids.listing, ids.provider, ids.rights, ids.budget]);
  const instanceToken = (await db.query("SELECT market_core.register_worker_instance($1,$2) AS token", ["g3e-worker", "g3e-instance"])).rows[0].token as string;
  let providerCalls = 0;
  const provider = async () => {
    providerCalls++;
    return { status: "AVAILABLE", value: [{ marketDate: "2026-02-02", open: "100", high: "110", low: "90", close: "105", volume: "10" }], marketDate: "2026-02-02", sourceRefs: [{ provider: "G3E_OFFLINE_PROVIDER", originalSourceId: "fixture:g3e:aapl", requestId: null, sourceDocumentUri: null }], firstSeenAt: "2026-02-02T12:00:00Z", ingestedAt: "2026-02-02T12:00:00Z", asKnownAt: "2026-02-02T12:00:00Z", revisionId: "e".repeat(64), schemaVersion: "1.0", quality: { flags: ["COVERAGE_FULL", "FRESHNESS_KNOWN"], coverage: "FULL" }, rights: { policyId: ids.rights, display: true, retentionUntil: null } };
  };
  const workerFactory = async () => new Client({ connectionString: `postgres://${workerRole}:${workerPassword}@localhost:5432/postgres` });
  const service = new ContinuousWorkerService({ workerId: "g3e-worker", instanceId: "g3e-instance", capabilityToken: instanceToken, clientFactory: workerFactory, provider, exchangeTimezone: "America/New_York", consumedCredits: "1", maxTasks: 1, maxPolls: 1, heartbeatIntervalMs: 50 });
  const stats = await service.start();
  assert.equal(stats.committed, 1);
  assert.equal(providerCalls, 1);
  const persisted = (await db.query("SELECT j.job_id, j.state, r.revision_id, r.source_revision, o.observation_id FROM market_core.ingest_jobs j JOIN market_core.market_observations o ON o.listing_id=j.listing_id AND o.provider_id=j.provider_id JOIN market_core.market_observation_revisions r ON r.observation_id=o.observation_id WHERE j.job_id=$1", [ids.job])).rows[0];
  assert.equal(persisted.state, "COMMITTED");
  assert.ok(persisted.revision_id);
  const readerUrl = new URL(adminUrl); readerUrl.username = readerRole; readerUrl.password = readerPassword;
  const env = { VERCEL_ENV: "preview", MARKET_DATA_G3C_MODE: "enabled", MARKET_DATA_G3C_APPROVED_SHA: "e".repeat(40), VERCEL_GIT_COMMIT_SHA: "e".repeat(40), MARKET_DATA_G3C_APPROVED_RIGHTS_POLICY_ID: ids.rights, MARKET_DATA_READER_DATABASE_URL: readerUrl.toString() };
  const url = `https://preview.invalid/api/investing/market-data?listingId=${ids.listing}&startDate=2026-02-01&endDate=2026-02-28&asOf=2026-03-01T00%3A00%3A00Z&interval=1day&adjustment=none`;
  const response = await handleInvestingMarketDataRead(url, env, async () => actor, (request, authenticatedActor) => loadInvestingMarketDataFromPostgres(request, authenticatedActor, env));
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; current?: { revisionId: string; price: string } | null; history?: { points: Array<{ revisionId: string; close: string | null }> } | null };
  assert.equal(body.status, "AVAILABLE");
  assert.equal(body.current?.revisionId, persisted.revision_id);
  assert.equal(body.current?.price, "105.000000000000");
  assert.equal(body.history?.points[0]?.revisionId, persisted.revision_id);
  assert.equal(body.history?.points[0]?.close, "105.000000000000");
  assert.equal((await db.query("SELECT consumed_credits::text FROM market_core.provider_budget_periods WHERE budget_period_id=$1", [ids.budget])).rows[0].consumed_credits, "1.000000");
  assert.equal((await db.query("SELECT has_table_privilege($1,'market_core.market_observations','INSERT') AS can_insert", [readerRole])).rows[0].can_insert, false);
});
