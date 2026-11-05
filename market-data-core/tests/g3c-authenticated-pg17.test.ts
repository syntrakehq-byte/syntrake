import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { handleInvestingMarketDataRead, loadInvestingMarketDataFromPostgres } from "../investingMarketDataHttp";
import type { Actor } from "../../investing-core/contracts";

const db = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
const id = { provider: "c3000000-0000-0000-0000-000000000001", rights: "c3000000-0000-0000-0000-000000000002", issuer: "c3000000-0000-0000-0000-000000000003", instrument: "c3000000-0000-0000-0000-000000000004", listing: "c3000000-0000-0000-0000-000000000005", observation: "c3000000-0000-0000-0000-000000000006", revision: "c3000000-0000-0000-0000-000000000007" };
const actor: Actor = { userId: "clerk_pg17_user", sessionId: "clerk_pg17_session" };
const env = { VERCEL_ENV: "preview", MARKET_DATA_G3C_MODE: "enabled", MARKET_DATA_G3C_APPROVED_SHA: "c".repeat(40), VERCEL_GIT_COMMIT_SHA: "c".repeat(40), MARKET_DATA_READER_DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" };

async function migration(file: string) { await db.query(await readFile(resolve(process.cwd(), file), "utf8")); }

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') v")).rows[0].v, /^17\./);
  await migration("supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql");
  await migration("supabase/release-candidates/20261102090000_g2a_universal_historical_api.sql");
  await db.query("INSERT INTO market_core.providers VALUES($1,'G3C_PROVIDER','ACTIVE')", [id.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES($1,'g3c-rights',true,true,NULL)", [id.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES($1,'G3C issuer')", [id.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES($1,$2,'EQUITY','USD')", [id.instrument, id.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,trading_currency,ticker,valid_from) VALUES($1,$2,'XNAS','USD','G3C',DATE '2020-01-01')", [id.listing, id.instrument]);
  await db.query("INSERT INTO market_core.market_observations VALUES($1,$2,$3,$4,'1day',DATE '2026-01-02','UTC','none',TIMESTAMPTZ '2026-01-02T12:00:00Z')", [id.observation, id.listing, id.provider, id.rights]);
  await db.query("INSERT INTO market_core.market_observation_revisions(revision_id,observation_id,listing_id,source_revision,open_value,high_value,low_value,close_value,volume_value,first_seen_at,ingested_at,as_known_at) VALUES($1,$2,$3,repeat('c',64),100,110,90,105,10,TIMESTAMPTZ '2026-01-02T12:00:00Z',TIMESTAMPTZ '2026-01-02T12:00:00Z',TIMESTAMPTZ '2026-01-02T12:00:00Z')", [id.revision, id.observation, id.listing]);
});

after(async () => { try { await db.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await db.query("DROP EXTENSION IF EXISTS btree_gist"); } finally { await db.end(); } });

test("G3-C reads persisted PIT data through the authorized PostgreSQL reader and HTTP boundary", async () => {
  const url = `https://www.syntrake.com/api/investing/market-data?listingId=${id.listing}&startDate=2026-01-01&endDate=2026-01-31&asOf=2026-03-01T00%3A00%3A00Z&interval=1day&adjustment=none`;
  const response = await handleInvestingMarketDataRead(url, env, async () => actor, (request, authenticatedActor) => loadInvestingMarketDataFromPostgres(request, authenticatedActor, env));
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; current?: { price: string } | null; history?: { points: Array<{ close: string | null }> } | null };
  assert.equal(body.status, "AVAILABLE");
  assert.equal(body.current?.price, "105.000000000000");
  assert.equal(body.history?.points[0]?.close, "105.000000000000");
});
