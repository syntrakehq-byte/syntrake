import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { resolveCanonicalIdentity } from "../canonicalIdentityResolver";
import { routeProvider } from "../providerRouter";
import { planDemand } from "../coordinator";
import { AutonomousWorker } from "../autonomousWorker";
import { createTwelveDataOfflineProvider } from "../twelveDataProvider";
import { canonicalIdentity, resolveProviderAlias } from "../identity";
import type { CatalogSource } from "../instrumentDiscovery";
import type { ProviderCapability } from "../providerCapabilities";

const db = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
const workerRole = "d5_worker_login";
const readerRole = "d5_reader_login";
const workerPassword = "d5-worker-password";
const readerPassword = "d5-reader-password";
const ids = { provider: "d5000000-0000-0000-0000-000000000001", rights: "d5000000-0000-0000-0000-000000000002", issuer: "d5000000-0000-0000-0000-000000000003", instrument: "d5000000-0000-0000-0000-000000000004", listing: "d5000000-0000-0000-0000-000000000005", budget: "d5000000-0000-0000-0000-000000000006", source: "d5000000-0000-0000-0000-000000000007", snapshot: "d5000000-0000-0000-0000-000000000008", candidate: "d5000000-0000-0000-0000-000000000009", alias: "d5000000-0000-0000-0000-000000000010", job: "d5000000-0000-0000-0000-000000000011" };
const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "d5-snapshot", snapshotVersion: "1", observedAt: "2025-01-01T00:00:00Z", licensePolicyId: "d5-rights", storageAllowed: true, sharingAllowed: false };
async function sql(file: string): Promise<void> { await db.query(await readFile(resolve(process.cwd(), file), "utf8")); }
function transferDemand(input: Readonly<{ identityStatus: string; routed: ReturnType<typeof routeProvider>; providerKey: string; listingId: string; providerId: string; rightsPolicyId: string; estimatedCredits: number }>): ReturnType<typeof planDemand> | null {
  const selected = input.routed.selected;
  if (input.identityStatus !== "EXACT" || input.routed.status !== "READY" || !selected || selected.providerKey !== input.providerKey || selected.rights.policyId !== input.rightsPolicyId || !Number.isFinite(input.estimatedCredits) || input.estimatedCredits < 0 || selected.cost.knowledge !== "KNOWN" || selected.cost.nativeAmount !== input.estimatedCredits || selected.quota.knowledge !== "KNOWN" || selected.quota.remaining === null || selected.quota.remaining < input.estimatedCredits) return null;
  return planDemand({ listingId: input.listingId, providerId: input.providerId, rightsPolicyId: input.rightsPolicyId, interval: "1day", adjustment: "none", from: "2025-01-02", to: "2025-01-02", freshness: "AVAILABLE", costClass: "KNOWN" });
}

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') AS v")).rows[0].v, /^17\./);
  await sql("supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql");
  await sql("supabase/release-candidates/20261031170000_r3c_coordinator_candidate.sql");
  await sql("supabase/release-candidates/20261031183000_r3c3_sql_recovery_candidate.sql");
  await sql("supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql");
  await sql("supabase/release-candidates/20261101130000_r3d3_canonical_resolution_candidate.sql");
  await sql("supabase/release-candidates/20261031190000_r3d2_supervision_candidate.sql");
  await sql("supabase/release-candidates/20261031193000_r3d4_worker_runtime_permissions.sql");
  await db.query(`CREATE ROLE ${workerRole} LOGIN PASSWORD '${workerPassword}';`);
  await db.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${readerPassword}';`);
  await db.query(`GRANT market_core_ingest TO ${workerRole} WITH INHERIT TRUE, SET FALSE`);
  await db.query(`GRANT market_core_reader TO ${readerRole} WITH INHERIT TRUE, SET TRUE`);
  await db.query("INSERT INTO market_core.worker_identity_bindings VALUES ($1,$2)", [workerRole, "d5-worker"]);
  await db.query("INSERT INTO market_core.providers VALUES ($1,'TWELVE_DATA','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'d5-rights',true,true,NULL)", [ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'Apple Inc.')", [ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument, ids.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from) VALUES ($1,$2,'XNAS','OPERATING','USD','AAPL',DATE '2020-01-01')", [ids.listing, ids.instrument]);
  await db.query("INSERT INTO market_core.provider_aliases(provider_alias_id,provider_id,provider_reference,listing_id,valid_from,identifier_type,identifier_scope) VALUES ($1,$2,'AAPL',$3,DATE '2020-01-01','TICKER','LISTING')", [ids.alias, ids.provider, ids.listing]);
  await db.query("INSERT INTO market_core.provider_alias_observations VALUES ($1,TIMESTAMPTZ '2025-01-01',TIMESTAMPTZ '2025-01-01')", [ids.alias]);
  await db.query("INSERT INTO market_core.catalog_sources VALUES ($1,$2,'D5_SOURCE','LISTINGS',$3,true,false,NULL,TIMESTAMPTZ '2025-01-01')", [ids.source, ids.provider, ids.rights]);
  await db.query("INSERT INTO market_core.catalog_snapshots VALUES ($1,$2,'d5-1',TIMESTAMPTZ '2025-01-01',DATE '2020-01-01',NULL,repeat('a',64),'REVIEW_REQUIRED',TIMESTAMPTZ '2025-01-01')", [ids.snapshot, ids.source]);
  await db.query("INSERT INTO market_core.catalog_candidates(candidate_id,snapshot_id,provider_reference,provider_identifier_type,provider_scope,ticker,mic,mic_role,trading_currency,created_at) VALUES ($1,$2,'AAPL','TICKER','LISTING','AAPL','XNAS','OPERATING','USD',TIMESTAMPTZ '2025-01-01')", [ids.candidate, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,issuer_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('d5000000-0000-0000-0000-000000000012','CIK','0000320193','ISSUER',$1,$2,$3,'OFFICIAL_REGISTRY',true,TIMESTAMPTZ '2025-01-01')", [ids.issuer, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,instrument_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('d5000000-0000-0000-0000-000000000013','ISIN','US0378331005','INSTRUMENT',$1,$2,$3,'IDENTIFIER_RECORD',true,TIMESTAMPTZ '2025-01-01')", [ids.instrument, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,listing_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('d5000000-0000-0000-0000-000000000014','FIGI','BBG000B9XRY4','LISTING',$1,$2,$3,'EXCHANGE_REFERENCE',true,TIMESTAMPTZ '2025-01-01')", [ids.listing, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.provider_budget_periods VALUES ($1,$2,DATE '2025-01-01',DATE '2027-01-01',1,0,0)", [ids.budget, ids.provider]);
});
after(async () => { await db.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await db.query("DROP EXTENSION IF EXISTS btree_gist"); for (const role of [workerRole, readerRole, "market_core_reader", "market_core_ingest", "market_core_coordinator_owner", "market_core_catalog_ingest", "market_core_catalog_reader", "market_core_registry_reviewer", "market_core_supervisor"]) await db.query(`DROP ROLE IF EXISTS ${role}`); await db.end(); });

test("D5 integrated offline AAPL discovery -> Registry/D3 -> D4 -> R3-C -> worker -> R3-B read", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNAS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" }] }), { status: 200 }) });
  const discovered = await connector.search({ ticker: "AAPL", marketMic: "XNAS", currency: "USD" });
  assert.equal(discovered.candidates.length, 1);
  const candidate = discovered.candidates[0];
  const chain = (await db.query("SELECT l.listing_id,l.ticker,l.mic,l.mic_role,l.trading_currency,to_char(l.valid_from,'YYYY-MM-DD') AS valid_from,l.instrument_id,i.issuer_id,i.asset_class,i.denomination_currency FROM market_core.listings l JOIN market_core.instruments i ON i.instrument_id=l.instrument_id WHERE l.listing_id=$1", [ids.listing])).rows[0];
  const alias = (await db.query("SELECT p.provider_key,a.provider_reference,a.listing_id,to_char(a.valid_from,'YYYY-MM-DD') AS valid_from,to_char(o.known_at,'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS known_at FROM market_core.provider_aliases a JOIN market_core.providers p ON p.provider_id=a.provider_id JOIN market_core.provider_alias_observations o ON o.provider_alias_id=a.provider_alias_id WHERE a.provider_reference='AAPL'")).rows[0];
  const evidence = (await db.query("SELECT ii.identifier_id,ii.identifier_type AS type,ii.identifier_value AS value,ii.identifier_scope AS scope,ii.verified,ii.source_id,ii.snapshot_id,cs.rights_policy_id,to_char(csn.observed_at,'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS observed_at,ii.issuer_id,COALESCE(ii.instrument_id,l.instrument_id) AS instrument_id,ii.listing_id FROM market_core.instrument_identifiers ii LEFT JOIN market_core.listings l ON l.listing_id=ii.listing_id JOIN market_core.catalog_sources cs USING(source_id) JOIN market_core.catalog_snapshots csn USING(snapshot_id)")).rows;
  const registry = { issuerRef: chain.issuer_id, instrumentRef: chain.instrument_id, instrumentIssuerRef: chain.issuer_id, listingRef: chain.listing_id, assetClass: chain.asset_class, denominationCurrency: chain.denomination_currency, listing: { listingRef: chain.listing_id, ticker: chain.ticker, mic: chain.mic, micRole: chain.mic_role, tradingCurrency: chain.trading_currency, validity: { validFrom: chain.valid_from, validTo: null } }, validity: { validFrom: chain.valid_from, validTo: null }, aliases: [{ providerKey: alias.provider_key, providerReference: alias.provider_reference, listingRef: alias.listing_id, observedAt: alias.known_at, validity: { validFrom: alias.valid_from, validTo: null } }], identifiers: evidence.map(e => ({ evidenceId: e.identifier_id, type: e.type, value: e.value, scope: e.scope, source: "D1_REGISTRY" as const, verified: e.verified, sourceId: e.source_id, snapshotId: e.snapshot_id, rightsPolicyId: e.rights_policy_id, observedAt: e.observed_at, issuerRef: e.scope === "ISSUER" ? e.issuer_id : null, instrumentRef: e.scope === "ISSUER" ? null : e.instrument_id, listingRef: e.scope === "LISTING" ? e.listing_id : null, validity: { validFrom: "2020-01-01", validTo: null } })) };
  const resolved = resolveCanonicalIdentity({ candidate, registry: [registry], asOf: "2026-01-01T00:00:00Z" });
  assert.equal(resolved.status, "EXACT");
  const cap = (providerKey: string, cost: number): ProviderCapability => ({ providerKey, service: "MARKET_DATA", assetClasses: ["EQUITY"], markets: [{ mic: "XNAS", role: "OPERATING" }], currencies: ["USD"], coverage: { validFrom: "2020-01-01", validTo: null }, granularities: ["1day"], adjustments: ["none"], operational: "AVAILABLE", quality: { coverage: "KNOWN", freshness: "KNOWN", integrity: "KNOWN", score: 90 }, rights: { policyId: ids.rights, query: true, store: true, display: false, retain: true, share: false, valid: { validFrom: "2020-01-01", validTo: null } }, cost: { nativeUnit: "TWELVE_DATA_CREDITS", nativeAmount: cost, economic: null, knowledge: "KNOWN" }, quota: { nativeUnit: "TWELVE_DATA_CREDITS", remaining: 1, knowledge: "KNOWN" }, source: { sourceId: "d5-capability", snapshotId: "d5-cap-snapshot", observedAt: "2025-01-01T00:00:00Z" } });
  const routed = routeProvider({ identity: resolved, service: "MARKET_DATA", mic: "XNAS", micRole: "OPERATING", assetClass: "EQUITY", currency: "USD", from: "2025-01-02", to: "2025-01-02", granularity: "1day", adjustment: "none", asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: false, retain: true, share: false, policyId: ids.rights }, quality: { requireCoverage: true, requireFreshness: true, requireIntegrity: true, minScore: 80 }, maxEconomicCost: null }, [cap("TWELVE_DATA", 1)]);
  assert.equal(routed.status, "READY");
  assert.equal(routed.selected?.providerKey, "TWELVE_DATA");
  assert.equal((await db.query("SELECT provider_key FROM market_core.providers WHERE provider_id=$1", [ids.provider])).rows[0].provider_key, routed.selected?.providerKey);
  assert.equal(routed.selected?.rights.policyId, ids.rights);
  assert.equal(routed.selected?.cost.nativeAmount, 1);
  assert.equal(routed.selected?.quota.remaining, 1);
  const ownedInstrument = canonicalIdentity({ instrument: { instrumentId: chain.instrument_id, issuerId: chain.issuer_id, kind: chain.asset_class, denominationCurrency: chain.denomination_currency }, listing: { listingId: chain.listing_id, instrumentId: chain.instrument_id, mic: chain.mic, tradingCurrency: chain.trading_currency, ticker: chain.ticker, validFrom: chain.valid_from, validTo: null } });
  const ownedAlias = resolveProviderAlias("TWELVE_DATA", alias.provider_reference, "2025-01-02", [{ provider: "TWELVE_DATA", providerReference: alias.provider_reference, listingId: alias.listing_id, instrumentId: chain.instrument_id, validFrom: alias.valid_from, validTo: null }]);
  assert.equal(ownedAlias.status, "EXACT");
  let simulatedHttpCalls = 0;
  const offlineProvider = createTwelveDataOfflineProvider({
    env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/r3-market-data-core-20261030", SYNTRAKE_R3_PROVIDER_ENABLED: "enabled", VERCEL_GIT_COMMIT_SHA: "a".repeat(40), SYNTRAKE_R3_PREVIEW_APPROVED_SHA: "a".repeat(40), SYNTRAKE_TWELVE_DATA_API_KEY: "offline-test-key-1234" },
    resolve: async claim => { assert.equal(claim.listing_id, ownedInstrument.listingId); return { instrument: ownedInstrument, sourceAlias: ownedAlias, asOf: "2025-01-02" }; },
    transport: async (_url, init) => { simulatedHttpCalls++; assert.equal((init.headers as Record<string, string>).Authorization, "apikey offline-test-key-1234"); return new Response(JSON.stringify({ status: "ok", meta: { symbol: "AAPL", interval: "1day", currency: "USD", exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNAS" }, values: [{ datetime: "2025-01-02", open: "100.00", high: "110.00", low: "90.00", close: "105.50", volume: "23" }] }), { status: 200 }); },
  });
  let providerError: string | null = null;
  const workerProvider = async (claim: Parameters<typeof offlineProvider>[0]) => { try { return await offlineProvider(claim); } catch (error) { providerError = error instanceof Error ? error.message : String(error); throw error; } };
  const planned = transferDemand({ identityStatus: resolved.status, routed, providerKey: "TWELVE_DATA", listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, estimatedCredits: 1 });
  assert.ok(planned); assert.equal(planned.state, "READY");
  await db.query("INSERT INTO market_core.ingest_jobs(job_id,demand_key,listing_id,provider_id,rights_policy_id,budget_period_id,estimated_credits,idempotency_key,state,attempt,max_attempts,next_run_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,'PENDING',0,3,clock_timestamp())", [ids.job, planned.demandKey, ids.listing, ids.provider, ids.rights, ids.budget, "d5-aapl"]);
  const capabilityToken = (await db.query("SELECT market_core.register_worker_instance($1,$2) AS token", ["d5-worker", "d5-instance"])).rows[0].token as string;
  const workerEvents: unknown[] = [];
  let workerDbError: string | null = null;
  const probe = new Client({ connectionString: `postgres://${workerRole}:${workerPassword}@localhost:5432/postgres` });
  await probe.connect();
  const heartbeatProbe = await probe.query("SELECT market_core.record_worker_heartbeat($1,$2,$3) AS ok", ["d5-worker", "d5-instance", capabilityToken]);
  assert.equal(heartbeatProbe.rows[0].ok, true);
  await probe.end();
  const worker = new AutonomousWorker({ workerId: "d5-worker", clientFactory: async () => { const client = new Client({ connectionString: `postgres://${workerRole}:${workerPassword}@localhost:5432/postgres` }); const originalQuery = client.query.bind(client); Object.defineProperty(client, "query", { value: async (...args: Parameters<Client["query"]>) => { try { return await originalQuery(...args); } catch (error) { workerDbError = error instanceof Error ? error.message : String(error); throw error; } } }); return client; }, provider: workerProvider, exchangeTimezone: "America/New_York", maxTasks: 1, maxPolls: 1, consumedCredits: "1", heartbeat: { instanceId: "d5-instance", capabilityToken }, onEvent: event => workerEvents.push(event) });
  const stats = await worker.run();
  assert.equal(stats.committed, 1, JSON.stringify({ stats, workerEvents, workerDbError, providerError })); assert.equal(simulatedHttpCalls, 1);
  const saved = await db.query("SELECT o.listing_id,o.provider_id,o.rights_policy_id,o.market_date,r.revision_id,r.close_value::text AS close FROM market_core.market_observations o JOIN market_core.market_observation_revisions r USING(observation_id) WHERE o.listing_id=$1", [ids.listing]);
  assert.equal(saved.rows.length, 1); assert.equal(saved.rows[0].listing_id, ids.listing); assert.equal(saved.rows[0].close, "105.500000000000"); assert.equal((await db.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1", [ids.job])).rows[0].state, "COMMITTED");
  assert.equal((await db.query("SELECT consumed_credits::text FROM market_core.provider_budget_periods WHERE budget_period_id=$1", [ids.budget])).rows[0].consumed_credits, "1.000000");
  const replay = await new AutonomousWorker({ workerId: "d5-worker", clientFactory: async () => new Client({ connectionString: `postgres://${workerRole}:${workerPassword}@localhost:5432/postgres` }), provider: offlineProvider, exchangeTimezone: "America/New_York", maxTasks: 1, maxPolls: 1, consumedCredits: "1" }).run();
  assert.equal(replay.committed, 0); assert.equal(simulatedHttpCalls, 1);
  const reader = new Client({ connectionString: `postgres://${readerRole}:${readerPassword}@localhost:5432/postgres` }); await reader.connect(); await reader.query("SET ROLE market_core_reader");
  await db.query("UPDATE market_core.license_policies SET display_allowed=true WHERE rights_policy_id=$1", [ids.rights]);
  assert.equal((await reader.query("SELECT status FROM market_core.read_market_pit($1,TIMESTAMPTZ '2027-01-04')", [ids.listing])).rows[0].status, "AVAILABLE");
  await db.query("UPDATE market_core.license_policies SET display_allowed=false WHERE rights_policy_id=$1", [ids.rights]);
  const blockedRead = (await reader.query("SELECT status,close_value FROM market_core.read_market_pit($1,TIMESTAMPTZ '2027-01-04')", [ids.listing])).rows[0];
  assert.equal(blockedRead.status, "LICENSE_BLOCKED"); assert.equal(blockedRead.close_value, null);
  assert.equal((await reader.query("SELECT count(*)::int AS n FROM market_core.read_market_pit($1,TIMESTAMPTZ '2025-01-01') WHERE status='AVAILABLE'", [ids.listing])).rows[0].n, 0); await reader.end();

  const beforeJobs = Number((await db.query("SELECT count(*)::int AS n FROM market_core.ingest_jobs")).rows[0].n);
  const beforeReservations = Number((await db.query("SELECT count(*)::int AS n FROM market_core.credit_reservations")).rows[0].n);
  const deniedD3 = transferDemand({ identityStatus: "REVIEW_REQUIRED", routed, providerKey: "TWELVE_DATA", listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, estimatedCredits: 1 });
  const deniedRights = transferDemand({ identityStatus: "EXACT", routed: routeProvider({ identity: resolved, service: "MARKET_DATA", mic: "XNAS", micRole: "OPERATING", assetClass: "EQUITY", currency: "USD", from: "2025-01-02", to: "2025-01-02", granularity: "1day", adjustment: "none", asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: false, retain: true, share: false, policyId: ids.rights }, quality: { requireCoverage: true, requireFreshness: true, requireIntegrity: true, minScore: 80 }, maxEconomicCost: null }, [{ ...cap("TWELVE_DATA", 1), rights: { ...cap("TWELVE_DATA", 1).rights, query: false, store: false, retain: false } }]), providerKey: "TWELVE_DATA", listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, estimatedCredits: 1 });
  const deniedQuota = transferDemand({ identityStatus: "EXACT", routed: routeProvider({ identity: resolved, service: "MARKET_DATA", mic: "XNAS", micRole: "OPERATING", assetClass: "EQUITY", currency: "USD", from: "2025-01-02", to: "2025-01-02", granularity: "1day", adjustment: "none", asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: false, retain: true, share: false, policyId: ids.rights }, quality: { requireCoverage: true, requireFreshness: true, requireIntegrity: true, minScore: 80 }, maxEconomicCost: null }, [ { ...cap("TWELVE_DATA", 1), quota: { nativeUnit: "TWELVE_DATA_CREDITS", remaining: 0, knowledge: "KNOWN" } } ]), providerKey: "TWELVE_DATA", listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, estimatedCredits: 1 });
  const deniedProvider = transferDemand({ identityStatus: "EXACT", routed, providerKey: "OTHER_PROVIDER", listingId: ids.listing, providerId: ids.provider, rightsPolicyId: ids.rights, estimatedCredits: 1 });
  assert.equal(deniedD3, null, "D3 non-EXACT gate"); assert.equal(deniedRights, null, "D4 rights gate"); assert.equal(deniedQuota, null, "D4 quota gate"); assert.equal(deniedProvider, null, "provider identity gate");
  assert.equal(Number((await db.query("SELECT count(*)::int AS n FROM market_core.ingest_jobs")).rows[0].n), beforeJobs);
  assert.equal(Number((await db.query("SELECT count(*)::int AS n FROM market_core.credit_reservations")).rows[0].n), beforeReservations);
});
