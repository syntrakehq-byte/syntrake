import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const client = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
const ids = { provider: "00000000-0000-0000-0000-000000000001", rights: "00000000-0000-0000-0000-000000000002", issuer: "00000000-0000-0000-0000-000000000003", equity: "00000000-0000-0000-0000-000000000004", etf: "00000000-0000-0000-0000-000000000005", listing: "00000000-0000-0000-0000-000000000006", listing2: "00000000-0000-0000-0000-000000000007", obs: "00000000-0000-0000-0000-000000000008", rev1: "00000000-0000-0000-0000-000000000009", rev2: "00000000-0000-0000-0000-00000000000a" };

before(async () => { await client.connect(); const version = await client.query("SELECT current_setting('server_version') AS version"); assert.match(version.rows[0].version, /^17\./); await client.query(await readFile(resolve(process.cwd(), "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql"), "utf8")); });
after(async () => { await client.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await client.query("DROP EXTENSION IF EXISTS btree_gist"); await client.query("DROP ROLE IF EXISTS market_core_reader"); await client.query("DROP ROLE IF EXISTS market_core_ingest"); await client.query("DROP ROLE IF EXISTS anon"); await client.query("DROP ROLE IF EXISTS authenticated"); await client.end(); });

async function seed(): Promise<void> {
  await client.query("INSERT INTO market_core.providers VALUES ($1,'SYNTHETIC','ACTIVE')", [ids.provider]);
  await client.query("INSERT INTO market_core.license_policies VALUES ($1,'deny-display',true,false,NULL)", [ids.rights]);
  await client.query("INSERT INTO market_core.issuers VALUES ($1,'Synthetic Issuer')", [ids.issuer]);
  await client.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD'),($3,$2,'ETF','USD')", [ids.equity, ids.issuer, ids.etf]);
  await client.query("INSERT INTO market_core.listings VALUES ($1,$2,'XNAS','USD','SYN',DATE '2020-01-01',DATE '2024-01-01'),($3,$2,'XNAS','USD','SYN',DATE '2024-01-01',NULL)", [ids.listing, ids.equity, ids.listing2]);
  await client.query("INSERT INTO market_core.provider_aliases VALUES ('00000000-0000-0000-0000-00000000000b',$1,'SYN',$2,DATE '2020-01-01',DATE '2024-01-01'),('00000000-0000-0000-0000-00000000000c',$1,'SYN',$3,DATE '2024-01-01',NULL)", [ids.provider, ids.listing, ids.listing2]);
  await client.query("INSERT INTO market_core.market_observations VALUES ($1,$2,$3,$4,'1day',DATE '2026-01-02','UTC','none','2026-01-03Z')", [ids.obs, ids.listing2, ids.provider, ids.rights]);
}

test("PG17 schema, candidate tables and private ACLs exist", async () => {
  await seed();
  const version = await client.query("SELECT current_setting('server_version') AS version"); assert.match(version.rows[0].version, /^17\./);
  const tables = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='market_core' ORDER BY table_name");
  assert.deepEqual(tables.rows.map(x => x.table_name), ["instruments", "issuers", "license_policies", "listings", "market_observation_revisions", "market_observations", "provider_aliases", "providers"]);
  const columns = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='market_core'");
  assert.equal(columns.rows.some(x => ["owner_id", "portfolio_id", "ledger_id"].includes(x.column_name)), false);
  const rls = await client.query<{ relforcerowsecurity: boolean }>("SELECT relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='market_core' AND c.relname='market_observation_revisions'"); assert.equal(rls.rows[0].relforcerowsecurity, true);
});

test("revisions preserve effective old/new prices and PIT selects the correct revision", async () => {
  await client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,volume_value,first_seen_at,ingested_at,as_known_at) VALUES ($1,$2,$3,repeat('a',64),100,110,90,105,10,'2026-01-03Z','2026-01-03Z','2026-01-03Z')", [ids.rev1, ids.obs, ids.listing2]);
  await client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,supersedes_revision_id,source_revision,open_value,high_value,low_value,close_value,volume_value,first_seen_at,ingested_at,as_known_at) VALUES ($1,$2,$3,$4,repeat('b',64),100,112,90,107,10,'2026-01-04Z','2026-01-04Z','2026-01-04Z')", [ids.rev2, ids.obs, ids.listing2, ids.rev1]);
  const before = await client.query("SELECT close_value FROM market_core.market_observation_revisions WHERE observation_id=$1 AND as_known_at <= TIMESTAMPTZ '2026-01-03 23:59:59Z' ORDER BY as_known_at DESC LIMIT 1", [ids.obs]);
  const after = await client.query("SELECT close_value FROM market_core.market_observation_revisions WHERE observation_id=$1 AND as_known_at <= TIMESTAMPTZ '2026-01-04 23:59:59Z' ORDER BY as_known_at DESC LIMIT 1", [ids.obs]);
  assert.equal(before.rows[0].close_value, "105.000000000000"); assert.equal(after.rows[0].close_value, "107.000000000000");
  await assert.rejects(client.query("UPDATE market_core.market_observation_revisions SET close_value=1 WHERE revision_id=$1", [ids.rev2]));
  await assert.rejects(client.query("DELETE FROM market_core.market_observation_revisions WHERE revision_id=$1", [ids.rev1]));
  await assert.rejects(client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,first_seen_at,ingested_at,as_known_at) VALUES ('00000000-0000-0000-0000-00000000000d',$1,$2,repeat('b',64),100,110,90,105,'2026-01-03Z','2026-01-03Z','2026-01-03Z')", [ids.obs, ids.listing2]));
});

test("identity windows, aliases and chronology reject inconsistent records", async () => {
  await assert.rejects(client.query("INSERT INTO market_core.listings VALUES ('00000000-0000-0000-0000-00000000000e',$1,'XNAS','USD','SYN',DATE '2023-01-01',DATE '2025-01-01')", [ids.equity]));
  await assert.rejects(client.query("INSERT INTO market_core.provider_aliases VALUES ('00000000-0000-0000-0000-00000000000f',$1,'BAD',$2,DATE '2019-01-01',DATE '2024-01-01')", [ids.provider, ids.listing2]));
  await assert.rejects(client.query("INSERT INTO market_core.market_observation_revisions (revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,first_seen_at,ingested_at,as_known_at) VALUES ('00000000-0000-0000-0000-000000000010',$1,$2,repeat('c',64),100,110,90,105,'2026-01-04Z','2026-01-03Z','2026-01-03Z')", [ids.obs, ids.listing2]));
});

test("backend roles are least-privilege and rights default denies display", async () => {
  const rights = await client.query("SELECT display_allowed, cache_allowed FROM market_core.license_policies WHERE rights_policy_id=$1", [ids.rights]); assert.equal(rights.rows[0].display_allowed, false); assert.equal(rights.rows[0].cache_allowed, true);
  await client.query("SET ROLE market_core_reader");
  const readable = await client.query("SELECT count(*)::int AS count FROM market_core.market_observation_revisions"); assert.equal(readable.rows[0].count, 2);
  await assert.rejects(client.query("INSERT INTO market_core.market_observations VALUES ('00000000-0000-0000-0000-000000000011',$1,$2,$3,'1day',DATE '2026-01-03','UTC','none','2026-01-03Z')", [ids.listing2, ids.provider, ids.rights]));
  await client.query("RESET ROLE");
  await client.query("SET ROLE market_core_ingest");
  await assert.rejects(client.query("UPDATE market_core.market_observation_revisions SET close_value=1 WHERE revision_id=$1", [ids.rev2]));
  await assert.rejects(client.query("DELETE FROM market_core.market_observation_revisions WHERE revision_id=$1", [ids.rev1]));
  await client.query("RESET ROLE");
  const publicAccess = await client.query("SELECT has_schema_privilege('anon','market_core','USAGE') AS usage, has_table_privilege('authenticated','market_core.market_observations','SELECT') AS select"); assert.equal(publicAccess.rows[0].usage, false); assert.equal(publicAccess.rows[0].select, false);
});
