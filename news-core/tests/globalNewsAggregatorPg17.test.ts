import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { GDELT_WORLD_INDEX_V1, fetchGdeltIndex } from "../globalNewsAggregator";
import { PostgresNewsStore } from "../postgresStore";
import { PostgresFactualStore } from "../factualPersistence";
import { NewsConsumptionApiV1 } from "../n5Api";
import { registerGlobalTarget, runNewsExecutorOnce } from "../autonomousExecutor";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
test("world-index live GDELT -> PostgreSQL17 -> N5", {
  skip: !DB_URL || process.env.RUN_GDELT_WORLD_LIVE !== "1" ? "real PG17 and RUN_GDELT_WORLD_LIVE=1 required" : false,
}, async () => {
  assert.ok(DB_URL);
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 4 });
  const readerPool = new Pool({ connectionString: DB_URL, max: 2 });
  const store = new PostgresNewsStore(pool);
  const factual = new PostgresFactualStore(readerPool, "news_reader");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const source = { ...GDELT_WORLD_INDEX_V1, sourceId: GDELT_WORLD_INDEX_V1.sourceId + "-" + suffix, checkpointScope: GDELT_WORLD_INDEX_V1.checkpointScope + "-" + suffix };
  try {
    await admin.connect();
    const version = (await admin.query<{ version: string }>("select current_setting('server_version') version")).rows[0].version;
    assert.ok(version.startsWith("17."), "requires PostgreSQL17");
    await admin.query(await readFile(new URL("../../supabase/migrations/20261117200000_news_core_ng8_operational_state.sql", import.meta.url), "utf8"));
    const retrieved = await fetchGdeltIndex(source);
    console.log("WORLD_INDEX_FETCH " + JSON.stringify({ name: "GDELT", items: retrieved.length, contentMode: "METADATA_ONLY" }));
    assert.ok(retrieved.length > 0, "index returned no usable HTTPS article links");
    await registerGlobalTarget(store, source);
    const executed = await runNewsExecutorOnce({
      store, workerId: "gdelt-" + suffix,
      globalSources: [source], globalRetrieve: async () => retrieved,
      collectionScopeKey: source.checkpointScope, leaseSeconds: 60,
      secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE global news CI",
    });
    assert.equal(executed.claimed, true);
    const count = (await admin.query<{ n: number }>("select count(*)::int n from news_core.publications where source_id=$1", [source.sourceId])).rows[0].n;
    assert.ok(count > 0);
    const api = new NewsConsumptionApiV1({ news: store, factual }, "0123456789abcdef", "gdelt-read-secret");
    let n5 = 0;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const cutoff = (await admin.query<{ cutoff: string }>("select clock_timestamp()::timestamptz::text cutoff")).rows[0].cutoff;
      const page = await api.discoverNews({ serviceId: "news_reader", credential: "gdelt-read-secret" }, { asOf: cutoff, filters: { sourceIds: [source.sourceId] }, limit: 10 });
      assert.equal(page.status, "AVAILABLE");
      if (page.data.length > 0) {
        assert.ok(page.data.every(x => x.contentExcerpt === null && x.sourceId === source.sourceId));
        n5 = page.data.length;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log("WORLD_INDEX_RECEIPT " + JSON.stringify({ name: "GDELT", fetched: retrieved.length, persisted: count, n5, rightsMode: "METADATA_ONLY" }));
    assert.ok(n5 > 0, "records are not yet visible in N5 with real PIT cutoff");
  } finally { await store.close(); await factual.close(); await admin.end(); }
});
