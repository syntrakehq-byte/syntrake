import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import { PostgresFactualStore } from "../factualPersistence";
import { NewsConsumptionApiV1 } from "../n5Api";
import { registerGlobalTarget, runNewsExecutorOnce } from "../autonomousExecutor";
import { fetchAndParseRegisteredSource } from "../globalNewsCollector";
import { NEWS_DAILY_EDITORIAL_CANDIDATES_V1 } from "../globalNewsEditorialSources";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";
import type { GlobalNewsItem } from "../globalNewsAdapter";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_DAILY_EDITORIAL_LIVE === "1";

test("daily world and business publishers: live RSS to PostgreSQL17 to N5", {
  skip: !enabled || !DB_URL ? "RUN_DAILY_EDITORIAL_LIVE=1 and real PG17 required" : false,
}, async () => {
  assert.ok(DB_URL);
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 4 });
  const readerPool = new Pool({ connectionString: DB_URL, max: 2 });
  const store = new PostgresNewsStore(pool);
  const factual = new PostgresFactualStore(readerPool, "news_reader");
  const api = new NewsConsumptionApiV1({ news: store, factual }, "0123456789abcdef", "expansion-test-credential");
  const results: Array<{ sourceId: string; status: "PASS" | "FAIL"; stage: string; items: number; persisted: number; n5: number; error: string | null; pgCode: string | null }> = [];
  try {
    await admin.connect();
    const version = (await admin.query<{ version: string }>("select current_setting('server_version') version")).rows[0].version;
    assert.ok(version.startsWith("17."), "PostgreSQL 17 required");
    // This is a replay-safe CI schema, never a production migration.
    await admin.query(await readFile(new URL("../../supabase/migrations/20261117200000_news_core_ng8_operational_state.sql", import.meta.url), "utf8"));
    for (const base of NEWS_DAILY_EDITORIAL_CANDIDATES_V1) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const source: GlobalNewsRegistryEntry = {
        ...base,
        sourceId: base.sourceId + "-" + suffix,
        publisherId: base.publisherId + "-" + suffix,
        checkpointScope: base.checkpointScope + "-" + suffix,
      };
      let items: readonly GlobalNewsItem[] = [];
      let persisted = 0;
      let stage = "FETCH";
      try {
        items = await fetchAndParseRegisteredSource(source);
        assert.ok(items.length > 0, "feed returned zero valid items");
        assert.ok(items.every(item => item.sourceId === source.sourceId));
        stage = "REGISTER";
        await registerGlobalTarget(store, source);
        stage = "EXECUTOR";
        const result = await runNewsExecutorOnce({
          store, workerId: "expansion-" + source.sourceId,
          secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE expansion CI/1.0 security@syntrake.com",
          globalSources: [source], globalRetrieve: async () => items,
          collectionScopeKey: source.checkpointScope, leaseSeconds: 60,
        });
        assert.equal(result.claimed, true);
        stage = "COUNT";
        const count = (await admin.query<{ count: number }>(
          "select count(*)::int count from news_core.publications where source_id=$1", [source.sourceId],
        )).rows[0].count;
        assert.ok(count > 0, "no publication persisted");
        persisted = count;
        stage = "REPLAY";
        await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(),lease_until=null where collection_scope_key=$1", [source.checkpointScope]);
        const replay = await runNewsExecutorOnce({
          store, workerId: "replay-" + source.sourceId,
          secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE expansion CI/1.0 security@syntrake.com",
          globalSources: [source], globalRetrieve: async () => items,
          collectionScopeKey: source.checkpointScope, leaseSeconds: 60,
        });
        assert.equal(replay.claimed, true);
        const replayCount = (await admin.query<{ count: number }>(
          "select count(*)::int count from news_core.publications where source_id=$1", [source.sourceId],
        )).rows[0].count;
        assert.equal(replayCount, count, "second collection must be idempotent");
        stage = "N5";
        // Query only at real database clock time. N1's PIT visibility frontier
        // may intentionally lag behind commit; never use future cutoffs.
        let n5Count = 0;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const cutoff = (await admin.query<{ cutoff: string }>(
            "select clock_timestamp()::timestamptz::text cutoff",
          )).rows[0].cutoff;
          const page = await api.discoverNews(
            { serviceId: "news_reader", credential: "expansion-test-credential" },
            { asOf: cutoff, filters: { sourceIds: [source.sourceId] }, limit: 10 },
          );
          if (page.status !== "AVAILABLE") throw new Error("NEWS_EXPANSION_N5_UNAVAILABLE");
          n5Count = page.data.length;
          if (n5Count > 0) {
            assert.ok(page.data.every(row => row.sourceId === source.sourceId));
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (n5Count === 0) throw new Error("NEWS_EXPANSION_N5_PIT_NOT_VISIBLE");
        results.push({ sourceId: base.sourceId, status: "PASS", stage: "COMPLETE", items: items.length, persisted, n5: n5Count, error: null, pgCode: null });
      } catch (error) {
        const raw = error instanceof Error ? error.message : "UNKNOWN";
        // Do not log URLs, downloaded content, stack traces or credentials.
        const sanitized = /^[A-Z][A-Z0-9_]{4,90}$/.test(raw) ? raw : "SOURCE_INTEGRATION_FAILED";
        const pgCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
        results.push({ sourceId: base.sourceId, status: "FAIL", stage, items: items.length, persisted, n5: 0, error: sanitized, pgCode });
      }
    }
    for (const row of results) console.log("DAILY_EDITORIAL_RECEIPT " + JSON.stringify(row));
    assert.ok(results.filter(row => row.status === "PASS").length >= 2,
      "Fewer than two daily publisher feeds delivered real news to PostgreSQL and N5: " + JSON.stringify(results));
  } finally {
    await store.close();
    await factual.close();
    await admin.end();
  }
});
