import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { resolveCanonicalIdentity } from "../canonicalIdentityResolver";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
const base = "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql";
const d1 = "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql";
const d3 = "supabase/release-candidates/20261101130000_r3d3_canonical_resolution_candidate.sql";
const ids = { provider: "d3000000-0000-0000-0000-000000000001", rights: "d3000000-0000-0000-0000-000000000002", issuer: "d3000000-0000-0000-0000-000000000003", instrument: "d3000000-0000-0000-0000-000000000004", listing: "d3000000-0000-0000-0000-000000000005", source: "d3000000-0000-0000-0000-000000000006", snapshot: "d3000000-0000-0000-0000-000000000007", candidate: "d3000000-0000-0000-0000-000000000008" };

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') AS version")).rows[0].version, /^17\./);
  await db.query(await readFile(resolve(process.cwd(), base), "utf8"));
  await db.query(await readFile(resolve(process.cwd(), d1), "utf8"));
  await db.query(await readFile(resolve(process.cwd(), d3), "utf8"));
  await db.query("INSERT INTO market_core.providers VALUES ($1,'D3_REGISTRY','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'d3-cache',true,false,NULL)", [ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'Apple Inc.')", [ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument, ids.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from) VALUES ($1,$2,'XNAS','OPERATING','USD','AAPL',DATE '1980-12-12')", [ids.listing, ids.instrument]);
  await db.query("INSERT INTO market_core.catalog_sources VALUES ($1,$2,'D3_SOURCE','LISTINGS',$3,true,false,NULL,clock_timestamp())", [ids.source, ids.provider, ids.rights]);
  await db.query("INSERT INTO market_core.catalog_snapshots VALUES ($1,$2,'d3-1',clock_timestamp(),DATE '1980-12-12',NULL,repeat('a',64),'REVIEW_REQUIRED',clock_timestamp())", [ids.snapshot, ids.source]);
  await db.query("INSERT INTO market_core.catalog_candidates(candidate_id,snapshot_id,provider_reference,provider_identifier_type,provider_scope,ticker,mic,mic_role,trading_currency,created_at) VALUES ($1,$2,'AAPL','PROVIDER_NATIVE','LISTING','AAPL','XNAS','OPERATING','USD',clock_timestamp())", [ids.candidate, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,issuer_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('d3000000-0000-0000-0000-000000000011','CIK','0000320193','ISSUER',$1,$2,$3,'OFFICIAL_REGISTRY',true,clock_timestamp())", [ids.issuer, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,instrument_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('d3000000-0000-0000-0000-000000000012','ISIN','US0378331005','INSTRUMENT',$1,$2,$3,'IDENTIFIER_RECORD',true,clock_timestamp())", [ids.instrument, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,listing_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('d3000000-0000-0000-0000-000000000013','FIGI','BBG000B9XRY4','LISTING',$1,$2,$3,'EXCHANGE_REFERENCE',true,clock_timestamp())", [ids.listing, ids.source, ids.snapshot]);
});

after(async () => {
  try { await db.query("RESET ROLE"); await db.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await db.query("DROP EXTENSION IF EXISTS btree_gist"); for (const role of ["market_core_catalog_ingest", "market_core_catalog_reader", "market_core_registry_reviewer", "market_core_reader", "market_core_ingest", "anon", "authenticated"]) await db.query(`DROP ROLE IF EXISTS ${role}`); } finally { await db.end(); }
});

test("D3 PG17 keeps resolution writes fail-closed and rejects forged EXACT links", async () => {
  const canonicalIds = (await db.query("SELECT identifier_type AS type, identifier_value AS value, identifier_scope AS scope FROM market_core.instrument_identifiers ORDER BY identifier_type")).rows;
  const candidate = { issuer: null, instrument: null, listing: { listingRef: ids.listing, ticker: "AAPL", mic: "XNAS", micRole: "OPERATING" as const, tradingCurrency: "USD", validity: { validFrom: "1980-12-12", validTo: null } }, providerReference: { providerKey: "TWELVE_DATA", providerReference: "AAPL", identifierType: "PROVIDER_NATIVE" as const, scope: "LISTING" as const, source: { providerKey: "TWELVE_DATA", snapshotId: "snap-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "d3-cache", storageAllowed: true, sharingAllowed: false }, validity: { validFrom: "1980-12-12", validTo: null } }, identifiers: [{ type: "PROVIDER_NATIVE" as const, value: "AAPL", scope: "LISTING" as const, source: { providerKey: "TWELVE_DATA", snapshotId: "snap-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "d3-cache", storageAllowed: true, sharingAllowed: false }, evidenceKind: "PROVIDER_CATALOG" as const, strength: "STRONG" as const, verified: false, validity: { validFrom: "1980-12-12", validTo: null }, marketMic: "XNAS" }], source: { providerKey: "TWELVE_DATA", snapshotId: "snap-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "d3-cache", storageAllowed: true, sharingAllowed: false } };
  const registry = { issuerRef: ids.issuer, instrumentRef: ids.instrument, listingRef: ids.listing, assetClass: "EQUITY" as const, denominationCurrency: "USD", listing: candidate.listing, validity: candidate.listing.validity, aliases: [{ providerKey: "TWELVE_DATA", providerReference: "AAPL", listingRef: ids.listing, validity: candidate.listing.validity }], identifiers: canonicalIds.map((e: { type: "CIK" | "ISIN" | "FIGI"; value: string; scope: "ISSUER" | "INSTRUMENT" | "LISTING" }, i: number) => ({ ...e, evidenceId: `pg-evidence-${i}`, source: "D1_REGISTRY" as const, issuerRef: e.scope === "ISSUER" ? ids.issuer : null, instrumentRef: e.scope === "INSTRUMENT" ? ids.instrument : null, listingRef: e.scope === "LISTING" ? ids.listing : null, validity: candidate.listing.validity })) };
  assert.equal(resolveCanonicalIdentity({ candidate, registry: [registry], asOf: "2026-11-01T00:00:00Z" }).status, "EXACT");
  await db.query("INSERT INTO market_core.canonical_resolution_decisions VALUES ($1,$2,'REVIEW_REQUIRED','EVIDENCE_INSUFFICIENT',NULL,NULL,NULL,repeat('a',64),'operator',clock_timestamp())", ["d3000000-0000-0000-0000-000000000009", ids.candidate]);
  await assert.rejects(db.query("UPDATE market_core.canonical_resolution_decisions SET reason_code='FORGED' WHERE candidate_id=$1", [ids.candidate]));
  await db.query("SET ROLE market_core_registry_reviewer");
  assert.equal((await db.query("SELECT status,listing_id FROM market_core.canonical_resolution_decisions WHERE candidate_id=$1", [ids.candidate])).rows[0].status, "REVIEW_REQUIRED");
  await assert.rejects(db.query("INSERT INTO market_core.canonical_resolution_decisions VALUES ('d3000000-0000-0000-0000-00000000000a',$1,'EXACT','FORGED',$2,$3,$4,repeat('b',64),'arbitrary',clock_timestamp())", [ids.candidate, ids.issuer, ids.instrument, ids.listing]));
  await db.query("SET ROLE market_core_catalog_ingest");
  await assert.rejects(db.query("INSERT INTO market_core.canonical_resolution_decisions VALUES ('d3000000-0000-0000-0000-00000000000b',$1,'EXACT','FORGED',$2,$3,$4,repeat('c',64),'ingest',clock_timestamp())", [ids.candidate, ids.issuer, ids.instrument, ids.listing]));
});
