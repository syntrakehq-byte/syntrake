import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { createHistoricalMarketDataResult, historicalRowsToResult } from "../contracts";

const client = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
const ids = { provider: "00000000-0000-0000-0000-000000000101", rights: "00000000-0000-0000-0000-000000000102", expired: "00000000-0000-0000-0000-000000000109", issuer: "00000000-0000-0000-0000-000000000103", instrument: "00000000-0000-0000-0000-000000000104", listing: "00000000-0000-0000-0000-000000000105", blockedListing: "00000000-0000-0000-0000-00000000010a", observation: "00000000-0000-0000-0000-000000000106", blockedObservation: "00000000-0000-0000-0000-00000000010b", revision: "00000000-0000-0000-0000-000000000107", revised: "00000000-0000-0000-0000-00000000010c" };
const sql = async (file: string) => client.query(await readFile(resolve(process.cwd(), file), "utf8"));

before(async () => {
  await client.connect(); assert.match((await client.query("SELECT current_setting('server_version') AS version")).rows[0].version, /^17\./);
  await sql("supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql"); await sql("supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql"); await sql("supabase/release-candidates/20261102090000_g2a_universal_historical_api.sql");
  await client.query("INSERT INTO market_core.providers VALUES ($1,'HISTORICAL_TEST','ACTIVE')", [ids.provider]); await client.query("INSERT INTO market_core.license_policies VALUES ($1,'g2a-display',true,true,NULL),($2,'g2a-expired',true,true,'2026-01-01Z')", [ids.rights, ids.expired]); await client.query("INSERT INTO market_core.issuers VALUES ($1,'G2A Issuer')", [ids.issuer]); await client.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument, ids.issuer]);
  await client.query("INSERT INTO market_core.listings (listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from,valid_to) VALUES ($1,$2,'XNAS','OPERATING','USD','G2A',DATE '2020-01-01',NULL),($3,$2,'XNAS','OPERATING','USD','G2B',DATE '2020-01-01',NULL)", [ids.listing, ids.instrument, ids.blockedListing]);
  await client.query("INSERT INTO market_core.market_observations VALUES ($1,$2,$3,$4,'1day',DATE '2026-01-02','UTC','none','2026-01-03Z'),($5,$6,$3,$7,'1day',DATE '2026-01-02','UTC','none','2026-01-03Z')", [ids.observation, ids.listing, ids.provider, ids.rights, ids.blockedObservation, ids.blockedListing, ids.expired]);
  await client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,first_seen_at,ingested_at,as_known_at,quality_flags) VALUES ($1,$2,$3,repeat('e',64),100,110,90,105,'2026-01-03Z','2026-01-03Z','2026-01-03Z',ARRAY['VERIFIED']),($4,$2,$3,repeat('f',64),100,115,90,110,'2026-01-04Z','2026-01-05Z','2026-01-05Z',ARRAY['CORRECTED']),($5,$6,$7,repeat('d',64),100,110,90,105,'2026-01-03Z','2026-01-03Z','2026-01-03Z',ARRAY['VERIFIED'])", [ids.revision, ids.observation, ids.listing, ids.revised, "00000000-0000-0000-0000-00000000010d", ids.blockedObservation, ids.blockedListing]);
});
after(async () => { await client.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await client.query("DROP ROLE IF EXISTS market_core_reader"); await client.query("DROP ROLE IF EXISTS market_core_ingest"); await client.query("DROP ROLE IF EXISTS market_core_catalog_ingest"); await client.query("DROP ROLE IF EXISTS market_core_catalog_reader"); await client.query("DROP ROLE IF EXISTS market_core_registry_reviewer"); await client.query("DROP ROLE IF EXISTS anon"); await client.query("DROP ROLE IF EXISTS authenticated"); await client.end(); });

const request = (listingId: string, asOf = "2026-01-04T23:00:00Z") => ({ listingId, startDate: "2026-01-01", endDate: "2026-01-31", asOf, interval: "1day" as const, adjustment: "none" as const });

test("G2-A validates SQL rows and selects the revision known at the PIT cutoff", async () => {
  const oldRows = (await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-04T23:00:00Z','1day','none')", [ids.listing])).rows; const old = historicalRowsToResult(request(ids.listing), oldRows); assert.equal(old.status, "AVAILABLE"); assert.equal(old.instrumentId, ids.instrument); assert.equal(old.points[0].revisionId, ids.revision); assert.equal(old.points[0].close, "105.000000000000");
  const newerRows = (await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-06Z','1day','none')", [ids.listing])).rows; const newer = historicalRowsToResult(request(ids.listing, "2026-01-06T00:00:00Z"), newerRows); assert.equal(newer.points[0].revisionId, ids.revised); assert.equal(newer.points[0].close, "110.000000000000");
});
test("G2-A blocks expired rights at read time and display-denied prices and provenance", async () => {
  // Expiry is later than the historical PIT cutoff but earlier than the present.
  await client.query("UPDATE market_core.license_policies SET retention_until=CURRENT_TIMESTAMP - INTERVAL '1 day', display_allowed=true WHERE rights_policy_id=$1", [ids.expired]);
  const query = "SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-04Z','1day','none')";
  const rows = (await client.query(query, [ids.blockedListing])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "LICENSE_BLOCKED");
  assert.equal(rows[0].close_value, null);
  assert.equal(rows[0].revision_id, null);
  assert.equal(rows[0].as_known_at, null);
  assert.equal(rows[0].source_revision, null);
  assert.deepEqual(rows[0].quality_flags, []);
  const blocked = historicalRowsToResult(request(ids.blockedListing, "2026-01-04T00:00:00Z"), rows);
  assert.equal(blocked.status, "LICENSE_BLOCKED");
  assert.equal(blocked.points[0].sourceRevision, null);

  await client.query("UPDATE market_core.license_policies SET retention_until=NULL, display_allowed=false WHERE rights_policy_id=$1", [ids.rights]);
  const denied = (await client.query(query, [ids.listing])).rows;
  assert.equal(denied.length, 1);
  assert.equal(denied[0].status, "LICENSE_BLOCKED");
  for (const key of ["close_value", "revision_id", "as_known_at", "source_revision"]) assert.equal(denied[0][key], null);
  assert.deepEqual(denied[0].quality_flags, []);
  assert.equal(historicalRowsToResult(request(ids.listing, "2026-01-04T00:00:00Z"), denied).status, "LICENSE_BLOCKED");

  await client.query("SET ROLE market_core_reader");
  try {
    const readerRows = (await client.query(query, [ids.blockedListing])).rows;
    assert.equal(readerRows[0].status, "LICENSE_BLOCKED");
    assert.equal(readerRows[0].source_revision, null);
    assert.equal(readerRows[0].close_value, null);
  } finally { await client.query("RESET ROLE"); }

  for (const role of ["anon", "authenticated"]) {
    await client.query("SET ROLE " + role);
    try { await assert.rejects(client.query(query, [ids.listing])); }
    finally { await client.query("RESET ROLE"); }
  }
});

test("G2-A rejects tampered SQL rows and impossible result states", async () => {
  // The source is a real pg row (DATE and TIMESTAMPTZ are Date objects).
  const original = (await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-04Z','1day','none')", [ids.listing])).rows[0];
  // The previous test deliberately disabled display for this listing; use a fresh
  // unblocked reader response by restoring this local fixture's policy.
  await client.query("UPDATE market_core.license_policies SET display_allowed=true WHERE rights_policy_id=$1", [ids.rights]);
  const row = (await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-04Z','1day','none')", [ids.listing])).rows[0];
  assert.equal(original.status, "LICENSE_BLOCKED");
  assert.equal(row.status, "AVAILABLE");
  assert.equal(historicalRowsToResult(request(ids.listing,"2026-01-04T00:00:00Z"),[row]).points[0].close, "105.000000000000");

  const invalid = [
    { status: "STALE" }, { listing_id: "invalid" }, { instrument_id: "not-a-uuid" },
    { provider_id: "invalid" }, { rights_policy_id: "invalid" },
    { close_value: "-10" }, { close_value: "NaN" }, { close_value: "0.0000" },
    { revision_id: "invalid" }, { as_known_at: new Date("2026-01-05T00:00:00Z") },
    { source_revision: "invalid" }, { source_revision: null },
    { quality_flags: [""] }, { quality_flags: "VERIFIED" },
    { market_date: "2026-02-30" }, { currency: "US1" },
  ] as const;
  for (const fields of invalid) {
    assert.throws(() => historicalRowsToResult(request(ids.listing, "2026-01-04T00:00:00Z"), [{ ...row, ...fields }]), { code: "INVALID_PROVIDER_RESPONSE" });
  }
  assert.throws(() => historicalRowsToResult(request(ids.listing,"2026-01-04T00:00:00Z"),[row,{...row,market_date:"2026-01-03",provider_id:"00000000-0000-0000-0000-000000000999"}]), {code:"INVALID_PROVIDER_RESPONSE"});
  assert.throws(() => historicalRowsToResult(request(ids.listing,"2026-01-04T00:00:00Z"),[row,{...row}]), {code:"INVALID_PROVIDER_RESPONSE"});

  const empty = historicalRowsToResult(request(ids.listing), []);
  assert.equal(empty.status, "UNAVAILABLE");
  assert.throws(() => createHistoricalMarketDataResult({ ...empty, status:"AVAILABLE" }), { code:"INVALID_PROVIDER_RESPONSE" });
  assert.throws(() => createHistoricalMarketDataResult({ ...empty, status:"PARTIAL" }), { code:"INVALID_PROVIDER_RESPONSE" });
  assert.throws(() => historicalRowsToResult({ ...request(ids.listing), startDate:"2026-02-30" }, []), { code:"INVALID_PROVIDER_RESPONSE" });
});

test("G2-A rejects incompatible intervals, adjustments, ranges and future rows", async () => { assert.equal((await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-04Z','1hour','none')", [ids.listing])).rowCount, 0); assert.equal((await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-01-01',DATE '2026-01-31',TIMESTAMPTZ '2026-01-04Z','1day','splits')", [ids.listing])).rowCount, 0); assert.equal((await client.query("SELECT * FROM market_core.read_market_history($1,DATE '2026-02-01',DATE '2026-02-28',TIMESTAMPTZ '2026-01-04Z','1day','none')", [ids.listing])).rowCount, 0); assert.throws(() => historicalRowsToResult(request(ids.listing), [{ listing_id: ids.listing, instrument_id: ids.instrument, provider_id: ids.provider, rights_policy_id: ids.rights, currency: "USD", bar_interval: "1day", adjustment: "none", market_date: "2026-01-02", status: "AVAILABLE", revision_id: ids.revision, close_value: "105", as_known_at: "2026-01-05T00:00:00Z", source_revision: "e".repeat(64), quality_flags: [] }])); });
