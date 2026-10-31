import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const client = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
before(async () => { await client.connect(); await client.query(await readFile(resolve(process.cwd(), "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql"), "utf8")); });
after(async () => { await client.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await client.end(); });

test("PG17 candidate has private schema, constraints, no owner or ledger fields", async () => {
  const tables = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='market_core' ORDER BY table_name");
  assert.deepEqual(tables.rows.map(x => x.table_name), ["instruments", "issuers", "license_policies", "listings", "market_observation_revisions", "market_observations", "provider_aliases", "providers"]);
  const cols = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='market_core'");
  assert.equal(cols.rows.some(x => ["owner_id", "portfolio_id", "ledger_id"].includes(x.column_name)), false);
  const rls = await client.query<{ relforcerowsecurity: boolean }>("SELECT relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='market_core' AND c.relname='market_observations'");
  assert.equal(rls.rows[0].relforcerowsecurity, true);
});

test("identity, aliases and revisions preserve history and reject overlap", async () => {
  const ids = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003", "00000000-0000-0000-0000-000000000004", "00000000-0000-0000-0000-000000000005", "00000000-0000-0000-0000-000000000006", "00000000-0000-0000-0000-000000000007"];
  await client.query("INSERT INTO market_core.providers VALUES ($1,'SYNTHETIC','ACTIVE')", [ids[0]]);
  await client.query("INSERT INTO market_core.license_policies VALUES ($1,'synthetic-deny',true,false,NULL)", [ids[1]]);
  await client.query("INSERT INTO market_core.issuers VALUES ($1,'Synthetic Issuer')", [ids[2]]);
  await client.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids[3], ids[2]]);
  await client.query("INSERT INTO market_core.listings VALUES ($1,$2,'XNAS','USD','SYN',DATE '2020-01-01',DATE '2024-01-01'),($3,$2,'XNAS','USD','SYN',DATE '2024-01-01',NULL)", [ids[4], ids[3], ids[5]]);
  await client.query("INSERT INTO market_core.provider_aliases VALUES ($1,$2,'SYN',$3,DATE '2020-01-01',DATE '2024-01-01'),($4,$2,'SYN',$5,DATE '2024-01-01',NULL)", [ids[6], ids[0], ids[4], "00000000-0000-0000-0000-00000000000a", ids[5]]);
  const observation = "00000000-0000-0000-0000-000000000008";
  await client.query("INSERT INTO market_core.market_observations VALUES ($1,$2,$3,$4,'1day',DATE '2026-01-02','UTC','none',100,110,90,105,10,'2026-01-03Z','2026-01-03Z','2026-01-03Z',repeat('a',64),ARRAY['SYNTHETIC'])", [observation, ids[5], ids[0], ids[1]]);
  await client.query("INSERT INTO market_core.market_observation_revisions VALUES ($1,$2,NULL,repeat('a',64),'2026-01-03Z','2026-01-03Z','2026-01-03Z',NULL)", [ids[1], observation]);
  await client.query("INSERT INTO market_core.market_observation_revisions VALUES ($1,$2,$3,repeat('b',64),'2026-01-04Z','2026-01-04Z','2026-01-04Z',NULL)", [ids[0], observation, ids[1]]);
  const pit = await client.query("SELECT source_revision FROM market_core.market_observation_revisions WHERE observation_id=$1 AND as_known_at <= TIMESTAMPTZ '2026-01-03 23:59:59Z' ORDER BY as_known_at DESC LIMIT 1", [observation]);
  assert.equal(pit.rows[0].source_revision, "a".repeat(64));
  await assert.rejects(client.query("INSERT INTO market_core.market_observations VALUES ($1,$2,$3,$4,'1day',DATE '2026-01-03','UTC','none',100,110,90,105,NULL,'2026-01-03Z','2026-01-03Z','2026-01-03Z',repeat('a',64),ARRAY[]::text[])", ["00000000-0000-0000-0000-000000000009", ids[5], ids[0], ids[1]]));
});

test("default public roles have no market_core access", async () => {
  const privileges = await client.query("SELECT has_schema_privilege('public','market_core','USAGE') AS usage, has_table_privilege('public','market_core.market_observations','SELECT') AS select");
  assert.equal(privileges.rows[0].usage, false); assert.equal(privileges.rows[0].select, false);
});
