import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { createPostgresCatalogPersistence, onboardCatalog } from "../catalogOnboarding";
import type { CatalogSource } from "../instrumentDiscovery";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
const ids = { provider: "d6a00000-0000-0000-0000-000000000001", rights: "d6a00000-0000-0000-0000-000000000002", source: "d6a00000-0000-0000-0000-000000000003", snapshot: "d6a00000-0000-0000-0000-000000000004" };
const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: ids.snapshot, snapshotVersion: "1", observedAt: "2025-01-01T00:00:00Z", licensePolicyId: "d6-rights", storageAllowed: true, sharingAllowed: false };

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') AS v")).rows[0].v, /^17\./);
  for (const file of ["supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql", "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql", "supabase/release-candidates/20261102100000_d6a_catalog_candidate_identity_key.sql"]) await db.query(await readFile(resolve(process.cwd(), file), "utf8"));
  await db.query("INSERT INTO market_core.providers VALUES ($1,'TWELVE_DATA','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'d6-rights',true,false,NULL)", [ids.rights]);
  await db.query("INSERT INTO market_core.catalog_sources VALUES ($1,$2,'D6A','LISTINGS',$3,true,false,NULL,TIMESTAMPTZ '2025-01-01')", [ids.source, ids.provider, ids.rights]);
  await db.query("INSERT INTO market_core.catalog_snapshots VALUES ($1,$2,'1',TIMESTAMPTZ '2025-01-01',DATE '1980-01-01',NULL,repeat('a',64),'REVIEW_REQUIRED',TIMESTAMPTZ '2025-01-01')", [ids.snapshot, ids.source]);
});
after(async () => { await db.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await db.query("DROP EXTENSION IF EXISTS btree_gist"); await db.end(); });

test("D6-A persists same-ticker listings independently and is idempotent", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [
    { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNAS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" },
    { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" },
  ] }), { status: 200 }) });
  const persistence = createPostgresCatalogPersistence(db, ids.source);
  const input = { connector, query: { ticker: "AAPL" }, source, asOf: "2026-01-01T00:00:00Z", persistence, loadRegistry: async () => [] };
  const first = await onboardCatalog(input);
  assert.equal(first.discovery.status, "AMBIGUOUS");
  assert.deepEqual(first.discovery.candidates.map(c => c.listing?.mic), ["XNAS", "XNGS"]);
  assert.deepEqual(first.persisted.map(p => p.state), ["PERSISTED", "PERSISTED"]);
  assert.equal(first.resolutions.every(r => r.status !== "EXACT"), true);
  const second = await onboardCatalog(input);
  assert.deepEqual(second.persisted.map(p => p.candidateId), first.persisted.map(p => p.candidateId));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.catalog_candidates")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.catalog_candidate_identifiers")).rows[0].n, 2);
});

test("D6-A does not persist when catalog rights deny storage", async () => {
  const deniedSource = { ...source, storageAllowed: false };
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: { ...deniedSource, storageAllowed: true }, transport: async () => new Response(JSON.stringify({ status: "ok", data: [] }), { status: 200 }) });
  const persistence = createPostgresCatalogPersistence(db, ids.source);
  await assert.rejects(onboardCatalog({ connector, query: { ticker: "AAPL" }, source: deniedSource, asOf: "2026-01-01T00:00:00Z", persistence, loadRegistry: async () => [] }), /LICENSE_BLOCKED/);
});
