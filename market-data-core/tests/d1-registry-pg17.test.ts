import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const db = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
const ids = { providerA:"a0000000-0000-0000-0000-000000000001", providerB:"a0000000-0000-0000-0000-000000000002", rightsA:"a0000000-0000-0000-0000-000000000003", rightsB:"a0000000-0000-0000-0000-000000000004", issuer:"a0000000-0000-0000-0000-000000000005", instrument:"a0000000-0000-0000-0000-000000000006", listingNas:"a0000000-0000-0000-0000-000000000007", listingNgs:"a0000000-0000-0000-0000-000000000008", budget:"a0000000-0000-0000-0000-000000000009", sourceA:"a0000000-0000-0000-0000-00000000000a", sourceB:"a0000000-0000-0000-0000-00000000000b", snapA:"a0000000-0000-0000-0000-00000000000c", snapB:"a0000000-0000-0000-0000-00000000000d", candidateA:"a0000000-0000-0000-0000-00000000000e", candidateB:"a0000000-0000-0000-0000-00000000000f" };
const base = "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql";
const d1 = "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql";

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') AS v")).rows[0].v, /^17\./);
  await db.query(await readFile(resolve(process.cwd(), base), "utf8"));
  await db.query(await readFile(resolve(process.cwd(), d1), "utf8"));
  await db.query("INSERT INTO market_core.providers VALUES ($1,'CATALOG_A','ACTIVE'),($2,'CATALOG_B','ACTIVE')", [ids.providerA,ids.providerB]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'catalog-a',true,false,NULL),($2,'catalog-b',false,false,NULL)", [ids.rightsA,ids.rightsB]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'Apple Inc.')", [ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument,ids.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from,valid_to) VALUES ($1,$2,'XNAS','OPERATING','USD','AAPL',DATE '1980-12-12',NULL),($3,$2,'XNGS','SEGMENT','USD','AAPL',DATE '1980-12-12',NULL)", [ids.listingNas,ids.instrument,ids.listingNgs]);
});
after(async () => { try { await db.query("RESET ROLE"); await db.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await db.query("DROP EXTENSION IF EXISTS btree_gist"); for (const role of ["market_core_catalog_ingest","market_core_catalog_reader","market_core_registry_reviewer","market_core_reader","market_core_ingest","anon","authenticated"]) await db.query(`DROP ROLE IF EXISTS ${role}`); } finally { await db.end(); } });

test("D1 PG17 persists two-provider snapshots and keeps XNAS/XNGS listings distinct", async () => {
  await db.query("INSERT INTO market_core.catalog_sources VALUES ($1,$2,'SRC_A','LISTINGS',$3,true,false,'https://catalog-a.test/snapshot',clock_timestamp()),($4,$5,'SRC_B','LISTINGS',$6,true,false,'https://catalog-b.test/snapshot',clock_timestamp())", [ids.sourceA,ids.providerA,ids.rightsA,ids.sourceB,ids.providerB,ids.rightsA]);
  await db.query("INSERT INTO market_core.catalog_snapshots VALUES ($1,$2,'2026-11-01',clock_timestamp(),DATE '2026-11-01',NULL,repeat('a',64),'REVIEW_REQUIRED',clock_timestamp()),($3,$4,'2026-11-01',clock_timestamp(),DATE '2026-11-01',NULL,repeat('b',64),'REVIEW_REQUIRED',clock_timestamp())", [ids.snapA,ids.sourceA,ids.snapB,ids.sourceB]);
  await db.query("INSERT INTO market_core.catalog_candidates(candidate_id,snapshot_id,provider_reference,provider_identifier_type,provider_scope,issuer_reference,instrument_reference,listing_reference,legal_name,asset_class,ticker,mic,mic_role,trading_currency,denomination_currency,valid_from,review_state,created_at) VALUES ($1,$2,'AAPL-XNAS','PROVIDER_NATIVE','LISTING','issuer-apple','instrument-apple','listing-xnas','Apple Inc.','EQUITY','AAPL','XNAS','OPERATING','USD','USD',DATE '1980-12-12','REVIEW_REQUIRED',clock_timestamp()),($3,$4,'APPLE.NASDAQ','PROVIDER_NATIVE','LISTING','issuer-apple','instrument-apple','listing-xngs','Apple Inc.','EQUITY','AAPL','XNGS','SEGMENT','USD','USD',DATE '1980-12-12','REVIEW_REQUIRED',clock_timestamp())", [ids.candidateA,ids.snapA,ids.candidateB,ids.snapB]);
  assert.deepEqual((await db.query("SELECT mic,mic_role FROM market_core.catalog_candidates ORDER BY mic")).rows, [{mic:"XNAS",mic_role:"OPERATING"},{mic:"XNGS",mic_role:"SEGMENT"}]);
  await db.query("INSERT INTO market_core.catalog_candidate_identifiers VALUES ($1,$2,'ISIN','US0378331005','INSTRUMENT',$3,$4,DATE '1980-12-12',NULL,'IDENTIFIER_RECORD','STRONG',true,'XNAS',clock_timestamp()),($5,$6,'ISIN','US0378331005','INSTRUMENT',$7,$8,DATE '1980-12-12',NULL,'IDENTIFIER_RECORD','STRONG',true,'XNGS',clock_timestamp())", ["b0000000-0000-0000-0000-000000000001",ids.candidateA,ids.sourceA,ids.snapA,"b0000000-0000-0000-0000-000000000002",ids.candidateB,ids.sourceB,ids.snapB]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.catalog_candidate_identifiers")).rows[0].n,2);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,instrument_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('b0000000-0000-0000-0000-000000000011','ISIN','US0378331005','INSTRUMENT',$1,$2,$3,'IDENTIFIER_RECORD',true,clock_timestamp())", [ids.instrument,ids.sourceA,ids.snapA]);
  await assert.rejects(db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,issuer_id,instrument_id,source_id,snapshot_id,evidence_kind,created_at) VALUES ('b0000000-0000-0000-0000-000000000012','CIK','0000320193','ISSUER',$1,$2,$3,$4,'IDENTIFIER_RECORD',clock_timestamp())", [ids.issuer,ids.instrument,ids.sourceA,ids.snapA]));
});

test("D1 rejects wrong identifier scopes, contradictory MIC roles, aliases and licenses", async () => {
  await assert.rejects(db.query("INSERT INTO market_core.catalog_candidate_identifiers VALUES ('b0000000-0000-0000-0000-000000000003',$1,'CIK','0000320193','LISTING',$2,$3,NULL,NULL,'IDENTIFIER_RECORD','STRONG',true,'XNAS',clock_timestamp())", [ids.candidateA,ids.sourceA,ids.snapA]));
  await assert.rejects(db.query("INSERT INTO market_core.catalog_candidates(candidate_id,snapshot_id,provider_reference,provider_identifier_type,provider_scope,ticker,mic,mic_role,created_at) VALUES ('b0000000-0000-0000-0000-000000000004',$1,'BAD','TICKER','LISTING','AAPL','XNAS','INVALID',clock_timestamp())", [ids.snapA]));
  await assert.rejects(db.query("INSERT INTO market_core.catalog_sources VALUES ('b0000000-0000-0000-0000-000000000005',$1,'SRC_DENY','LISTINGS',$2,false,true,NULL,clock_timestamp())", [ids.providerA,ids.rightsB]));
  await assert.rejects(db.query("INSERT INTO market_core.catalog_candidate_identifiers VALUES ('b0000000-0000-0000-0000-000000000013',$1,'ISIN','US0378331005','INSTRUMENT',$2,$3,NULL,NULL,'IDENTIFIER_RECORD','STRONG',true,'XNAS',clock_timestamp())", [ids.candidateA,ids.sourceB,ids.snapB]));
  await assert.rejects(db.query("INSERT INTO market_core.provider_aliases VALUES ('b0000000-0000-0000-0000-000000000006',$1,'AAPL',$2,DATE '2020-01-01',DATE '2025-01-01','TICKER','LISTING')", [ids.providerA,ids.listingNas]));
  await assert.rejects(db.query("INSERT INTO market_core.provider_aliases VALUES ('b0000000-0000-0000-0000-000000000007',$1,'AAPL',$2,DATE '2024-01-01',NULL,'TICKER','LISTING')", [ids.providerA,ids.listingNas]));
});

test("D1 preserves append-only snapshots, review history and no EXACT state", async () => {
  await assert.rejects(db.query("UPDATE market_core.catalog_snapshots SET state='SUPERSEDED' WHERE snapshot_id=$1", [ids.snapA]));
  await assert.rejects(db.query("DELETE FROM market_core.catalog_candidates WHERE candidate_id=$1", [ids.candidateA]));
  await db.query("INSERT INTO market_core.catalog_review_decisions VALUES ('b0000000-0000-0000-0000-000000000008',$1,'REVIEW_REQUIRED','IDENTITY_LINK_REQUIRED',repeat('c',64),'reviewer',clock_timestamp())", [ids.candidateA]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.catalog_review_decisions WHERE decision='EXACT'")).rows[0].n,0);
  await assert.rejects(db.query("INSERT INTO market_core.catalog_review_decisions VALUES ('b0000000-0000-0000-0000-000000000009',$1,'EXACT','MATCHED',repeat('d',64),'reviewer',clock_timestamp())", [ids.candidateA]));
});

test("D1 restricted catalog roles cannot access financial tables or mutate history", async () => {
  await db.query("SET ROLE market_core_catalog_reader");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM market_core.catalog_candidates")).rows[0].n,2);
  await assert.rejects(db.query("SELECT count(*) FROM market_core.provider_budget_periods"));
  await assert.rejects(db.query("INSERT INTO market_core.catalog_candidates(candidate_id,snapshot_id,provider_reference,provider_identifier_type,provider_scope,created_at) VALUES ('b0000000-0000-0000-0000-000000000010',$1,'X','TICKER','LISTING',clock_timestamp())", [ids.snapA]));
  await db.query("RESET ROLE");
  await db.query("SET ROLE market_core_catalog_ingest");
  await assert.rejects(db.query("UPDATE market_core.catalog_sources SET source_key='MUTATED' WHERE source_id=$1", [ids.sourceA]));
  await db.query("RESET ROLE");
});
