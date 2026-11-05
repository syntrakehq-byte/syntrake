import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { ContinuousWorkerService } from "../continuousWorkerService";
import { serveInvestingMarketData } from "../investingOperationalService";
import { planDemand } from "../coordinator";
import { historicalRowsToResult, type MarketDataResult } from "../contracts";

const db = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
const role = "g3b_worker_login";
const password = "g3b-worker-password";
const ids = { provider: "b3000000-0000-0000-0000-000000000001", rights: "b3000000-0000-0000-0000-000000000002", issuer: "b3000000-0000-0000-0000-000000000003", instrument: "b3000000-0000-0000-0000-000000000004", listing: "b3000000-0000-0000-0000-000000000005", budget: "b3000000-0000-0000-0000-000000000006", job: "b3000000-0000-0000-0000-000000000007" };

async function sql(file: string) { await db.query(await readFile(resolve(process.cwd(), file), "utf8")); }

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') v")).rows[0].v, /^17\./);
  for (const file of [
    "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql",
    "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql",
    "supabase/release-candidates/20261102090000_g2a_universal_historical_api.sql",
    "supabase/release-candidates/20261031170000_r3c_coordinator_candidate.sql",
    "supabase/release-candidates/20261031183000_r3c3_sql_recovery_candidate.sql",
    "supabase/release-candidates/20261101190000_r3d2_supervision_candidate.sql",
    "supabase/release-candidates/20261101193000_r3d4_worker_runtime_permissions.sql",
  ]) await sql(file);
  await db.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  await db.query(`GRANT market_core_ingest TO ${role} WITH INHERIT TRUE, SET FALSE`);
  await db.query("INSERT INTO market_core.worker_identity_bindings VALUES ($1,$2)", [role, "g3b-worker"]);
  await db.query("INSERT INTO market_core.providers VALUES ($1,'G3B_PROVIDER','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'g3b-rights',true,true,NULL)", [ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'G3B issuer')", [ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument, ids.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from) VALUES($1,$2,'XNAS','OPERATING','USD','G3B',DATE '2020-01-01')", [ids.listing, ids.instrument]);
  await db.query("INSERT INTO market_core.provider_budget_periods VALUES($1,$2,DATE '2020-01-01',DATE '2030-01-01',1,0,0)", [ids.budget, ids.provider]);
  const demand = planDemand({ listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, interval: "1day", adjustment: "none", from: "2026-02-02", to: "2026-02-02", freshness: "AVAILABLE", costClass: "KNOWN" });
  assert.equal(demand.state, "READY");
  await db.query("INSERT INTO market_core.ingest_jobs(job_id,demand_key,listing_id,provider_id,rights_policy_id,budget_period_id,estimated_credits,idempotency_key,state,attempt,max_attempts,next_run_at) VALUES($1,$2,$3,$4,$5,$6,1,'g3b-demand','PENDING',0,3,clock_timestamp())", [ids.job, demand.demandKey, ids.listing, ids.provider, ids.rights, ids.budget]);
});

after(async () => {
  try {
    await db.query(`REVOKE market_core_ingest FROM ${role}`);
    await db.query(`DROP ROLE IF EXISTS ${role}`);
    await db.query("DROP SCHEMA IF EXISTS market_core CASCADE");
    await db.query("DROP EXTENSION IF EXISTS btree_gist");
  } finally { await db.end(); }
});

test("G3-B runs autonomous Coordinator -> LOGIN worker -> PostgreSQL -> Investing without Clerk", async () => {
  const token = (await db.query("SELECT market_core.register_worker_instance($1,$2) AS token", ["g3b-worker", "g3b-instance"])).rows[0].token as string;
  let providerCalls = 0;
  const provider = async () => {
    providerCalls++;
    return { status: "AVAILABLE", value: [{ marketDate: "2026-02-02", open: "100", high: "110", low: "90", close: "105", volume: "10" }], marketDate: "2026-02-02", sourceRefs: [{ provider: "G3B_PROVIDER", originalSourceId: "fixture", requestId: null, sourceDocumentUri: null }], firstSeenAt: "2026-02-02T12:00:00Z", ingestedAt: "2026-02-02T12:00:00Z", asKnownAt: "2026-02-02T12:00:00Z", revisionId: "b".repeat(64), schemaVersion: "1.0", quality: { flags: ["FIXTURE"], coverage: "FULL" }, rights: { policyId: ids.rights, display: true, retentionUntil: null } };
  };
  const factory = async () => new Client({ connectionString: `postgres://${role}:${password}@localhost:5432/postgres` });
  const service = (workerId: string) => new ContinuousWorkerService({ workerId, instanceId: "g3b-instance", capabilityToken: token, clientFactory: factory, provider, exchangeTimezone: "America/New_York", consumedCredits: "1", maxTasks: 1, maxPolls: 1, heartbeatIntervalMs: 50 });
  const [a, b] = await Promise.all([service("g3b-worker").start(), service("g3b-worker").start()]);
  assert.equal(a.committed + b.committed, 1);
  assert.equal(providerCalls, 1);
  assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [ids.job])).rows[0].state, "COMMITTED");
  assert.equal((await db.query("SELECT consumed_credits::text FROM market_core.provider_budget_periods WHERE budget_period_id=$1", [ids.budget])).rows[0].consumed_credits, "1.000000");

  const reader = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
  await reader.connect();
  try {
    await reader.query("SET ROLE market_core_reader");
    const request = { listingId: ids.listing, startDate: "2026-02-01", endDate: "2026-02-28", asOf: "2026-03-01T00:00:00Z", interval: "1day" as const, adjustment: "none" as const };
    const rows = (await reader.query("SELECT * FROM market_core.read_market_history($1,$2::date,$3::date,$4::timestamptz,$5,$6)", [ids.listing, request.startDate, request.endDate, request.asOf, request.interval, request.adjustment])).rows;
    const historical = historicalRowsToResult(request, rows);
    assert.equal(historical.status, "AVAILABLE");
    const point = historical.points[0];
    if (!point || point.close === null || point.revisionId === null || point.asKnownAt === null) throw new Error("INVALID_PERSISTED_HISTORICAL_POINT");
    const current: MarketDataResult = { instrument: { kind: "EQUITY", symbol: "G3B", mic: "XNAS", currency: "USD", key: "EQUITY:XNAS:G3B:USD", instrumentId: historical.instrumentId, listingId: historical.listingId }, listingRef: historical.listingId, sourceRefs: [{ provider: "G3B_PROVIDER", originalSourceId: point.sourceRevision ?? "persisted", requestId: null, sourceDocumentUri: null }], revisionId: point.revisionId, price: point.close, currency: historical.currency ?? "USD", marketDate: point.marketDate, asOf: point.asKnownAt, quality: { coverage: "FULL", freshness: "KNOWN" }, rights: { policyId: historical.rightsPolicyId ?? ids.rights, display: true, retentionUntil: null }, interval: historical.interval, adjustment: historical.adjustment };
    const discovery = { status: "READY" as const, candidates: [], resolutions: [], routing: null, providerKey: "G3B_PROVIDER", listingRef: historical.listingId, close: current.price, marketData: current, identityVerified: true, reason: "PG17" };
    const served = await serveInvestingMarketData({ discovery, historical: request, requiresDisplay: true, rightsPolicyId: ids.rights, readCurrent: async () => current, readHistory: async () => historical, refresh: async () => { throw new Error("refresh must not run for valid cache"); } });
    assert.equal(served.status, "AVAILABLE");
    assert.equal(served.source, "CACHE");
    assert.equal(served.refreshed, false);
    assert.equal(served.current?.price, point.close);
    assert.equal(served.history?.points[0]?.revisionId, point.revisionId);
  } finally { await reader.end(); }
});
