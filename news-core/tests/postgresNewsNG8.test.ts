import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import { PostgresFactualStore } from "../factualPersistence";
import { NewsConsumptionApiV1 } from "../n5Api";
import { runNewsExecutorOnce, registerGlobalTarget } from "../autonomousExecutor";
import { fetchAndParseRegisteredSource } from "../globalNewsCollector";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const source = (sourceId: string, publisher: string, endpoint: string): GlobalNewsRegistryEntry => ({
  registryVersion: "1.0", sourceId, publisherId: sourceId, publisher, category: publisher === "SEC" ? "REGULATOR" : "CENTRAL_BANK",
  geoScope: [publisher === "ECB" ? "EU" : publisher === "BoE" ? "UK" : "US"], sourceType: "RSS_2", endpoint,
  allowedArticleHosts: [new URL(endpoint).hostname], rightsPolicyId: `${sourceId}-metadata-v1`,
  updatePolicy: { minIntervalSeconds: 15, maxItemsPerCycle: 50 }, storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" },
  status: "ACTIVE", checkpointScope: `${sourceId}:ng8:${randomUUID()}`,
});

test("N-G8 real multisource executor persists, replays, fences and exposes state through N5", { skip: !DB_URL || !process.env.RUN_GLOBAL_NEWS_NG8 && "RUN_GLOBAL_NEWS_NG8=1 required for real-source N-G8 rehearsal" }, async () => {
  assert.ok(DB_URL);
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 4 });
  const readerPool = new Pool({ connectionString: DB_URL, max: 2 });
  const store = new PostgresNewsStore(pool);
  const readerFactual = new PostgresFactualStore(readerPool, "news_reader");
  const suffix = randomUUID().replaceAll("-", "");
  const sources = [
    source(`ng8-ecb-${suffix}`, "ECB", "https://www.ecb.europa.eu/rss/press.html"),
    source(`ng8-boe-${suffix}`, "BoE", "https://www.bankofengland.co.uk/rss/news"),
    source(`ng8-sec-${suffix}`, "SEC", "https://www.sec.gov/rss/news/press.xml"),
  ];
  const userAgent = process.env.SEC_USER_AGENT ?? "SYNTRAKE N-G8 CI/1.0 security@syntrake.com";
  try {
    await admin.connect();
    assert.match((await admin.query<{ version: string }>("select current_setting('server_version') version")).rows[0].version, /^17\./);
    await admin.query(await readFile(migration("20261117200000_news_core_ng8_operational_state.sql"), "utf8"));
    for (const entry of sources) await registerGlobalTarget(store, entry);
    const retrieve = (entry: GlobalNewsRegistryEntry, signal?: AbortSignal) => fetchAndParseRegisteredSource(entry, signal);
    for (const entry of sources) {
      const result = await runNewsExecutorOnce({ store, workerId: `ng8-cycle-1-${entry.sourceId}`, secUserAgent: userAgent, leaseSeconds: 60, globalSources: [entry], globalRetrieve: retrieve, collectionScopeKey: entry.checkpointScope });
      assert.equal(result.claimed, true);
    }
    const firstCounts = await admin.query<{ source_id: string; n: number }>("select source_id,count(*)::int n from news_core.publications where source_id=any($1::text[]) group by source_id", [sources.map(item => item.sourceId)]);
    assert.equal(firstCounts.rowCount, 3);
    assert.ok(firstCounts.rows.every(row => row.n > 0));
    for (const entry of sources) {
      await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(),lease_until=null where collection_scope_key=$1", [entry.checkpointScope]);
      const result = await runNewsExecutorOnce({ store, workerId: `ng8-cycle-2-${entry.sourceId}`, secUserAgent: userAgent, leaseSeconds: 60, globalSources: [entry], globalRetrieve: retrieve, collectionScopeKey: entry.checkpointScope });
      assert.equal(result.claimed, true);
    }
    const secondCounts = await admin.query<{ source_id: string; n: number }>("select source_id,count(*)::int n from news_core.publications where source_id=any($1::text[]) group by source_id", [sources.map(item => item.sourceId)]);
    assert.deepEqual(secondCounts.rows.sort((a, b) => a.source_id.localeCompare(b.source_id)), firstCounts.rows.sort((a, b) => a.source_id.localeCompare(b.source_id)), "replay must not duplicate publications");
    const state = await store.readGlobalOperationalState(sources[0].sourceId, sources[0].checkpointScope);
    assert.ok(state); assert.equal(Number(state.cycles), 2); assert.equal(state.coverage, "KNOWN"); assert.equal(state.health, "HEALTHY");
    const api = new NewsConsumptionApiV1({ news: store, factual: readerFactual }, "0123456789abcdef", "ng8-reader-credential");
    const asOf = (await admin.query<{ cutoff: string }>("select clock_timestamp()::timestamptz::text cutoff")).rows[0].cutoff;
    const page = await api.discoverNews({ serviceId: "news_reader", credential: "ng8-reader-credential" }, { asOf, filters: { sourceIds: sources.map(item => item.sourceId) }, limit: 5 });
    assert.equal(page.status, "AVAILABLE"); assert.ok(page.data.length > 0); assert.ok(page.data.every(row => sources.some(entry => entry.sourceId === row.sourceId)));
    const failing = source(`ng8-failing-${suffix}`, "BoE", "https://www.bankofengland.co.uk/rss/news");
    await registerGlobalTarget(store, failing);
    await assert.rejects(runNewsExecutorOnce({ store, workerId: `ng8-failing-${suffix}`, secUserAgent: userAgent, globalSources: [failing], globalRetrieve: async () => { throw new Error("GLOBAL_NEWS_SOURCE_FAILED"); }, collectionScopeKey: failing.checkpointScope }));
    const failedState = await store.readGlobalOperationalState(failing.sourceId, failing.checkpointScope);
    assert.ok(failedState === null || failedState.health === "ERROR", "source failure must not be reported as healthy");
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(),lease_until=null where collection_scope_key=$1", [sources[0].checkpointScope]);
    const leaseA = await store.claimNext(`ng8-fence-a-${suffix}`, 1, sources[0].checkpointScope); assert.ok(leaseA);
    await admin.query("update news_core.collection_targets set lease_until=clock_timestamp()-interval '1 second' where collection_scope_key=$1", [sources[0].checkpointScope]);
    const leaseB = await store.claimNext(`ng8-fence-b-${suffix}`, 60, sources[0].checkpointScope); assert.ok(leaseB);
    assert.equal((await store.finish({ executionId: leaseA!.executionId, collectionScopeKey: leaseA!.collectionScopeKey, workerId: `ng8-fence-a-${suffix}`, leaseSeconds: 1 }, true)).status, "STALE");
    assert.equal((await store.finish({ executionId: leaseB!.executionId, collectionScopeKey: leaseB!.collectionScopeKey, workerId: `ng8-fence-b-${suffix}`, leaseSeconds: 60 }, false, new Error("N-G8 test cleanup"))).status, "FINISHED");
  } finally { await store.close(); await readerFactual.close(); await admin.end(); }
});
