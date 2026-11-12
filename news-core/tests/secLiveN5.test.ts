import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { registerSecTarget, runNewsExecutorOnce } from "../autonomousExecutor";
import { PostgresNewsStore } from "../postgresStore";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const enabled = process.env.N5_REAL_SOURCE === "1";
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);

test("N5 real SEC cycles run without web sessions and remain idempotent", { skip: !enabled && "N5_REAL_SOURCE=1 required for the official SEC proof" }, async () => {
  if (!DB_URL) throw new Error("NEWS_DATABASE_URL or TEST_DATABASE_URL is required for N5 live proof");
  const admin = new Client({ connectionString: DB_URL }); const pool = new Pool({ connectionString: DB_URL, max: 4 }); const store = new PostgresNewsStore(pool); const userAgent = process.env.SEC_USER_AGENT ?? "SYNTRAKE N5 CI/1.0 security@syntrake.com";
  try {
    await admin.connect(); await admin.query(await readFile(migration("20261111150000_news_core_postgres_n1.sql"), "utf8")); await admin.query(await readFile(migration("20261111170000_news_core_n2a_revisions.sql"), "utf8"));
    const scope = await registerSecTarget(store, "0000320193");
    const first = await runNewsExecutorOnce({ store, workerId: "n5-live-cycle-1", secUserAgent: userAgent, collectionScopeKey: scope, fetchTimeoutMs: 30_000 });
    assert.equal(first.claimed, true);
    const afterFirst = await store.getCheckpoint(scope); assert.ok(afterFirst?.cursor);
    const countAfterFirst = Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar'")).rows[0].n);
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_until=null where collection_scope_key=$1", [scope]);
    const second = await runNewsExecutorOnce({ store, workerId: "n5-live-cycle-2", secUserAgent: userAgent, collectionScopeKey: scope, fetchTimeoutMs: 30_000 });
    assert.equal(second.claimed, true);
    const countAfterSecond = Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar'")).rows[0].n);
    assert.equal(countAfterSecond, countAfterFirst, "the second overlap cycle must not create duplicate publications");
  } finally { await Promise.all([store.close(), admin.end()]); }
});
