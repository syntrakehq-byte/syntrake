import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);

function batch(scope: string, suffix: string, watermark: string) {
  const now = new Date().toISOString();
  const publicationId = `pg-test-${scope}-${suffix}`;
  return {
    publications: [{ publicationId, sourceId: "sec-edgar", originFingerprint: publicationId, externalId: suffix, originalUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000001/test.htm", title: "SEC test filing", publishedAt: null, firstSeenAt: now, ingestedAt: null, asKnownAt: null, form: "8-K" }],
    observations: [{ observationId: `obs-${publicationId}`, providerKey: "sec", providerObservationKey: `${scope}:${suffix}`, publicationId, observedAt: now, retrievedAt: now, publisherKey: "sec-edgar" }],
    checkpoint: { sourceId: "sec-edgar", collectionScopeKey: scope, cursor: JSON.stringify({ watermark, overlapDays: 7 }), updatedAt: now },
  };
}

test("News Core PostgreSQL N1 real PG17 atomic/idempotent/leased path", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: no mocked PG test" }, async (t) => {
  const admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  const poolA = new Pool({ connectionString: DB_URL, max: 4 });
  const poolB = new Pool({ connectionString: DB_URL, max: 4 });
  const storeA = new PostgresNewsStore(poolA); const storeB = new PostgresNewsStore(poolB);
  const suffix = randomUUID().replaceAll("-", "");
  const scopeA = `pg-test-a-${suffix}`; const scopeB = `pg-test-b-${suffix}`;
  try {
    const version = await admin.query<{ v: string }>("select current_setting('server_version') v");
    assert.match(version.rows[0].v, /^17\./);
    await admin.query(await readFile(migration, "utf8"));
    await storeA.ensureSource("sec-edgar", "sec");

    await t.test("independent scopes and rollback before commit", async () => {
      await assert.rejects(storeA.ingest(batch(scopeA, "rollback", "2026-01-01:0000000001"), "before-commit"), /INJECTED_FAILURE_BEFORE_COMMIT/);
      assert.equal(await storeA.getCheckpoint(scopeA), null);
      const retry = await storeA.ingest(batch(scopeA, "rollback", "2026-01-01:0000000001"));
      assert.deepEqual(retry, { insertedPublications: 1, insertedObservations: 1 });
      await storeA.ingest(batch(scopeB, "other", "2026-01-02:0000000001"));
      assert.equal((await storeA.getCheckpoint(scopeA))?.cursor?.includes("2026-01-01"), true);
      assert.equal((await storeA.getCheckpoint(scopeB))?.cursor?.includes("2026-01-02"), true);
    });

    await t.test("commit ACK loss replay is exactly once and PIT has no future rows", async () => {
      const before = new Date().toISOString();
      const committed = await storeA.ingest(batch(scopeA, "ack-loss", "2026-01-03:0000000001"));
      assert.deepEqual(committed, { insertedPublications: 1, insertedObservations: 1 });
      const replay = await storeB.ingest(batch(scopeA, "ack-loss", "2026-01-03:0000000001"));
      assert.deepEqual(replay, { insertedPublications: 0, insertedObservations: 0 });
      const after = new Date().toISOString();
      const visible = await storeA.readAsOf(before);
      assert.equal(visible.some(row => row.externalId === "ack-loss"), false);
      assert.equal((await storeA.readAsOf(after)).filter(row => row.externalId === "ack-loss").length, 1);
      const count = await admin.query("select count(*)::int n from news_core.observations where provider_observation_key=$1", [`${scopeA}:ack-loss`]);
      assert.equal(count.rows[0].n, 1);
    });

    await t.test("two instances serialize leases and expired lease recovers", async () => {
      await storeA.upsertTarget({ collectionScopeKey: `lease-${suffix}`, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000000001", parameters: {} });
      const first = await storeA.claimNext("worker-a", 60);
      assert.ok(first);
      const second = await storeB.claimNext("worker-b", 60);
      assert.equal(second, null);
      assert.equal(await storeA.heartbeat(first!.collectionScopeKey, "worker-a"), true);
      await storeA.finish(first!.collectionScopeKey, "worker-a", true);
      const recoverScope = `lease-recover-${suffix}`;
      await storeA.upsertTarget({ collectionScopeKey: recoverScope, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000000002", parameters: {} });
      const abandoned = await storeA.claimNext("worker-abandoned", 60);
      assert.ok(abandoned);
      await admin.query("update news_core.collection_targets set lease_until=clock_timestamp()-interval '1 second' where collection_scope_key=$1", [recoverScope]);
      const recovered = await storeB.claimNext("worker-recovered", 60);
      assert.equal(recovered?.collectionScopeKey, recoverScope);
      await storeB.finish(recoverScope, "worker-recovered", true);
    });

    await t.test("least privilege grants are not public", async () => {
      const privileges = await admin.query<{ public_select: boolean; reader_select: boolean; service_insert: boolean }>(
        `select has_table_privilege('public','news_core.publications','select') public_select,
         has_table_privilege('news_reader','news_core.publications','select') reader_select,
         has_table_privilege('news_service','news_core.publications','insert') service_insert`,
      );
      assert.deepEqual(privileges.rows[0], { public_select: false, reader_select: true, service_insert: true });
    });
  } finally {
    await admin.query("delete from news_core.executions where collection_scope_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.collection_targets where collection_scope_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.observations where provider_observation_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id like $1", [`pg-test-%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.checkpoints where collection_scope_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await Promise.all([storeA.close(), storeB.close(), admin.end()]);
  }
});
