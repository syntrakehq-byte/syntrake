import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import { registerSecTarget, runNewsExecutorOnce } from "../autonomousExecutor";

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
function secResponse(cik: string, accession = "0000000001-00-000001"): Response {
  return new Response(JSON.stringify({ cik, filings: { recent: {
    form: ["8-K"], accessionNumber: [accession], filingDate: ["2026-01-04"], primaryDocument: ["notice.htm"], primaryDocDescription: ["Controlled SEC filing"],
  } } }), { status: 200, headers: { "content-type": "application/json" } });
}
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const testCik = (suffix: string, offset: number) => String((parseInt(suffix.slice(0, 8), 16) + offset) % 10_000_000_000).padStart(10, "0");

test("News Core PostgreSQL N1 real PG17 atomic/idempotent/leased path", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: no mocked PG test" }, async (t) => {
  const admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  const poolA = new Pool({ connectionString: DB_URL, max: 4 });
  const poolB = new Pool({ connectionString: DB_URL, max: 4 });
  const servicePool = new Pool({ connectionString: DB_URL, max: 1 });
  const timeoutPool = new Pool({ connectionString: DB_URL, max: 1 });
  poolA.on("error", () => undefined);
  timeoutPool.on("error", () => undefined);
  timeoutPool.on("connect", client => client.on("error", () => undefined));
  const storeA = new PostgresNewsStore(poolA); const storeB = new PostgresNewsStore(poolB);
  const serviceStore = new PostgresNewsStore(servicePool);
  const timeoutStore = new PostgresNewsStore(timeoutPool);
  const suffix = randomUUID().replaceAll("-", "");
  const scopeA = `pg-test-a-${suffix}`; const scopeB = `pg-test-b-${suffix}`;
  try {
    const version = await admin.query<{ v: string }>("select current_setting('server_version') v");
    assert.match(version.rows[0].v, /^17\./);
    await admin.query(await readFile(migration, "utf8"));
    const serviceConnection = await servicePool.connect();
    await serviceConnection.query("set role news_service"); serviceConnection.release();
    await storeA.ensureSource("sec-edgar", "sec");

    await t.test("independent scopes and rollback before commit", async () => {
      await assert.rejects(storeA.ingestAdministrative(batch(scopeA, "rollback", "2026-01-01:0000000001"), { failurePoint: "before-commit" }), /INJECTED_FAILURE_BEFORE_COMMIT/);
      assert.equal(await storeA.getCheckpoint(scopeA), null);
      const retry = await storeA.ingestAdministrative(batch(scopeA, "rollback", "2026-01-01:0000000001"));
      assert.deepEqual(retry, { insertedPublications: 1, insertedObservations: 1 });
      await storeA.ingestAdministrative(batch(scopeB, "other", "2026-01-02:0000000001"));
      assert.equal((await storeA.getCheckpoint(scopeA))?.cursor?.includes("2026-01-01"), true);
      assert.equal((await storeA.getCheckpoint(scopeB))?.cursor?.includes("2026-01-02"), true);
    });

    await t.test("commit ACK loss replay is exactly once and PIT has no future rows", async () => {
      const before = new Date().toISOString();
      const committed = await storeA.ingestAdministrative(batch(scopeA, "ack-loss", "2026-01-03:0000000001"));
      assert.deepEqual(committed, { insertedPublications: 1, insertedObservations: 1 });
      const replay = await storeB.ingestAdministrative(batch(scopeA, "ack-loss", "2026-01-03:0000000001"));
      assert.deepEqual(replay, { insertedPublications: 0, insertedObservations: 0 });
      const after = new Date().toISOString();
      const visible = await storeA.readAsOf(before);
      assert.equal(visible.some(row => row.externalId === "ack-loss"), false);
      assert.equal((await storeA.readAsOf(new Date(Date.parse(after) + 1_500).toISOString())).filter(row => row.externalId === "ack-loss").length, 1);
      const count = await admin.query("select count(*)::int n from news_core.observations where provider_observation_key=$1", [`${scopeA}:ack-loss`]);
      assert.equal(count.rows[0].n, 1);
    });

    await t.test("effective news_service completes ingest, finalization, checkpoint and recovery", async () => {
      const scope = `service-${suffix}`;
      const source = `service-source-${suffix}`;
      await serviceStore.ensureSource(source, "sec");
      const serviceBatch = { ...batch(scope, "service", "2026-01-03:0000000002"), checkpoint: { ...batch(scope, "service", "2026-01-03:0000000002").checkpoint, sourceId: source } };
      const committed = await serviceStore.ingestAdministrative(serviceBatch);
      assert.deepEqual(committed, { insertedPublications: 1, insertedObservations: 1 });
      const state = await admin.query<{ visibility_state: string; frontier: number | null }>("select visibility_state,visibility_frontier_id frontier from news_core.publications where publication_id=$1", [`pg-test-${scope}-service`]);
      assert.equal(state.rows[0].visibility_state, "COMMITTED"); assert.ok(state.rows[0].frontier);
      const replay = await serviceStore.ingestAdministrative(serviceBatch);
      assert.deepEqual(replay, { insertedPublications: 0, insertedObservations: 0 });
    });

    await t.test("expired worker is fenced before data/checkpoint commit", async () => {
      const scope = `fence-${suffix}`;
      await storeA.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000000005", parameters: {}, nextRunAt: new Date(0).toISOString() });
      const old = await storeA.claimNext("worker-old", 1, scope); assert.ok(old);
      await wait(1_100);
      const fresh = await storeB.claimNext("worker-new", 60, scope); assert.ok(fresh);
      const oldLease = { executionId: old!.executionId, collectionScopeKey: scope, workerId: "worker-old", leaseSeconds: 1 } as const;
      await assert.rejects(storeA.ingest(batch(scope, "fenced", "2026-01-04:0000000001"), { lease: oldLease }), /NEWS_LEASE_LOST/);
      assert.equal(await storeA.getCheckpoint(scope), null);
      const freshLease = { executionId: fresh!.executionId, collectionScopeKey: scope, workerId: "worker-new", leaseSeconds: 60 } as const;
      await storeB.ingest(batch(scope, "fenced", "2026-01-04:0000000001"), { lease: freshLease });
      await storeB.finish(freshLease, true);
    });

    await t.test("executor uses the real SEC adapter, heartbeat and timeout cancellation", async () => {
      const cik = testCik(suffix, 6);
      const scope = await registerSecTarget(storeA, cik);
      await storeA.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: cik, parameters: {}, nextRunAt: new Date(0).toISOString() });
      const result = await runNewsExecutorOnce({
        store: storeA, workerId: `long-${suffix}`, secUserAgent: "SYNTRAKE test operator test@example.invalid", leaseSeconds: 1,
        collectionScopeKey: scope,
        heartbeatIntervalMs: 150, fetchTimeoutMs: 5000,
        fetchImpl: async (_input, init) => { await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 1_500); init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("ABORTED")); }, { once: true }); }); return secResponse(cik); },
      });
      assert.equal(result.ingested, 1);
      const rows = await storeA.readAsOf(new Date(Date.now() + 2_000).toISOString());
      assert.ok(rows.some(row => row.externalId === "0000000001-00-000001" && row.originFingerprint.includes(cik)));
    });

    await t.test("heartbeat loss aborts the SEC call and does not ACK a takeover", async () => {
      const cik = testCik(suffix, 7);
      const scope = await registerSecTarget(storeA, cik);
      await storeA.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: cik, parameters: {}, nextRunAt: new Date(0).toISOString() });
      let takeover: Awaited<ReturnType<PostgresNewsStore["claimNext"]>> = null;
      const result = runNewsExecutorOnce({
        store: storeA, workerId: "reused-worker", secUserAgent: "SYNTRAKE test operator test@example.invalid", leaseSeconds: 1, collectionScopeKey: scope,
        heartbeatIntervalMs: 150, fetchTimeoutMs: 5000,
        fetchImpl: async (_input, init) => { await wait(350); await admin.query("update news_core.collection_targets set lease_until=clock_timestamp()-interval '1 second' where collection_scope_key=$1", [scope]); takeover = await storeB.claimNext("reused-worker", 60); await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 1_500); init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("ABORTED")); }, { once: true }); }); return secResponse(cik, "0000000001-00-000002"); },
      });
      await assert.rejects(result, /NEWS_LEASE_LOST/);
      assert.ok(takeover);
      const takeoverLease = { executionId: takeover!.executionId, collectionScopeKey: scope, workerId: "reused-worker", leaseSeconds: 60 } as const;
      await storeB.finish(takeoverLease, true);
    });

    await t.test("finish is one transaction and crash recovery cannot touch a new lease", async () => {
      const scope = `finish-${suffix}`;
      await storeA.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000000008", parameters: {}, nextRunAt: new Date(0).toISOString() });
      const old = await storeA.claimNext("finish-worker", 1, scope); assert.ok(old);
      const oldLease = { executionId: old!.executionId, collectionScopeKey: scope, workerId: "finish-worker", leaseSeconds: 1 } as const;
      await assert.rejects(storeA.finish(oldLease, true, undefined, "after-execution-update"), /INJECTED_FAILURE_DURING_FINISH/);
      await admin.query("update news_core.collection_targets set lease_until=clock_timestamp()-interval '1 second' where collection_scope_key=$1", [scope]);
      const fresh = await storeB.claimNext("finish-worker", 60, scope); assert.ok(fresh);
      assert.deepEqual(await storeA.finish(oldLease, true), { status: "STALE" });
      const state = await admin.query<{ state: string }>("select state from news_core.executions where execution_id=$1", [fresh!.executionId]);
      assert.equal(state.rows[0].state, "RUNNING");
      await storeB.finish({ executionId: fresh!.executionId, collectionScopeKey: scope, workerId: "finish-worker", leaseSeconds: 60 }, true);
    });

    await t.test("PIT cutoff between insert and commit cannot see pending data", async () => {
      const scope = `pit-delay-${suffix}`; const delayedId = `delayed-${suffix}`;
      const cutoff = new Date().toISOString();
      const pendingBatch = batch(scope, delayedId, "2026-01-05:0000000001");
      const pending = storeA.ingestAdministrative(pendingBatch, { failurePoint: "delay-before-commit", delayBeforeCommitMs: 350 });
      try {
        await wait(80);
        assert.equal((await storeB.readAsOf(cutoff)).some(row => row.externalId === delayedId), false);
        await pending;
        assert.equal((await storeB.readAsOf(cutoff)).some(row => row.externalId === delayedId), false);
        assert.equal((await storeB.readAsOf(new Date(Date.now() + 2_000).toISOString())).filter(row => row.externalId === delayedId).length, 1);
      } finally { await pending.catch(() => undefined); }
    });

    await t.test("PIT frontier is assigned at the finalization boundary", async () => {
      const scope = `pit-finalize-${suffix}`; const delayedId = `finalize-${suffix}`;
      let cutoff = ""; let frontierCreated!: () => void;
      const frontierCreatedPromise = new Promise<void>(resolve => { frontierCreated = resolve; });
      const pending = storeA.ingestAdministrative(batch(scope, delayedId, "2026-01-06:0000000001"), {
        failurePoint: "delay-before-finalize-commit", delayBeforeCommitMs: 350,
        onFinalizeFrontierCreated: async () => { cutoff = new Date().toISOString(); frontierCreated(); },
      });
      try {
        await frontierCreatedPromise;
        assert.equal((await storeB.readAsOf(cutoff)).some(row => row.externalId === delayedId), false);
        await pending;
        assert.equal((await storeB.readAsOf(cutoff)).some(row => row.externalId === delayedId), false);
        assert.equal((await storeB.readAsOf(new Date(Date.now() + 2_000).toISOString())).filter(row => row.externalId === delayedId).length, 1);
      } finally { await pending.catch(() => undefined); }
    });

    await t.test("PG17 proves no look-ahead with a conservative frontier after seal pause", async () => {
      const scope = `pit-seal-gap-${suffix}`; const delayedId = `seal-gap-${suffix}`;
      let releaseCommit!: () => void;
      const commitReleased = new Promise<void>(resolve => { releaseCommit = resolve; });
      let sealed!: (publishedAt: string) => void;
      const sealedPromise = new Promise<string>(resolve => { sealed = resolve; });
      const pending = storeA.ingestAdministrative(batch(scope, delayedId, "2026-01-06:0000000002"), {
        onFinalizeSealedBeforeCommit: async publishedAt => { sealed(publishedAt); await commitReleased; },
      });
      const conservativeFrontier = await sealedPromise;
      const cutoff = new Date().toISOString();
      try {
        assert.ok(Date.parse(conservativeFrontier) > Date.parse(cutoff));
        assert.equal((await storeB.readAsOf(cutoff)).some(row => row.externalId === delayedId), false);
        releaseCommit();
        await pending;
        assert.equal((await storeB.readAsOf(cutoff)).some(row => row.externalId === delayedId), false);
        assert.equal((await storeB.readAsOf(new Date(Date.parse(conservativeFrontier) + 1).toISOString())).some(row => row.externalId === delayedId), true);
      } finally {
        releaseCommit();
        await pending.catch(() => undefined);
      }
    });

    await t.test("transaction timeout aborts finalization and recovery remains idempotent", async () => {
      const scope = `pit-timeout-${suffix}`; const delayedId = `timeout-${suffix}`;
      await assert.rejects(timeoutStore.ingestAdministrative(batch(scope, delayedId, "2026-01-06:0000000003"), {
        onFinalizeSealedBeforeCommit: async () => { await wait(1_500); },
      }));
      const recovered = await storeB.getCheckpoint(scope);
      assert.ok(recovered);
      const replay = await storeB.ingestAdministrative(batch(scope, delayedId, "2026-01-06:0000000003"));
      assert.deepEqual(replay, { insertedPublications: 0, insertedObservations: 0 });
      assert.equal((await storeB.readAsOf(new Date(Date.now() + 5_000).toISOString())).filter(row => row.externalId === delayedId).length, 1);
    });

    await t.test("observation PIT uses both publication and observation frontiers", async () => {
      const scope = `pit-observation-${suffix}`; const publicationSuffix = `observation-${suffix}`;
      const first = batch(scope, publicationSuffix, "2026-01-07:0000000001");
      await storeA.ingestAdministrative(first);
      const firstFrontier = await admin.query<{ published_at: Date }>(
        `select f.published_at from news_core.observations o
         join news_core.visibility_frontiers f on f.frontier_id=o.visibility_frontier_id
         where o.provider_observation_key=$1`, [`${scope}:${publicationSuffix}`],
      );
      assert.equal(firstFrontier.rowCount, 1);
      const second = batch(scope, publicationSuffix, "2026-01-08:0000000001");
      second.observations[0].observationId = `obs-2-${scope}`;
      second.observations[0].providerObservationKey = `${scope}:${publicationSuffix}:second`;
      second.observations[0].observedAt = new Date(Date.now() + 10).toISOString();
      second.observations[0].retrievedAt = second.observations[0].observedAt;
      await storeA.ingestAdministrative(second, { failurePoint: "delay-before-finalize-commit", delayBeforeCommitMs: 250 });
      const secondFrontier = await admin.query<{ published_at: Date }>(
        `select f.published_at from news_core.observations o
         join news_core.visibility_frontiers f on f.frontier_id=o.visibility_frontier_id
         where o.provider_observation_key=$1`, [`${scope}:${publicationSuffix}:second`],
      );
      assert.equal(secondFrontier.rowCount, 1);
      const t1 = firstFrontier.rows[0].published_at.getTime();
      const t2 = secondFrontier.rows[0].published_at.getTime();
      assert.ok(t2 > t1);
      const between = new Date(t1 + Math.max(1, Math.floor((t2 - t1) / 2))).toISOString();
      const historical = await admin.query<{ "observationId": string }>("select * from news_core.read_observations_as_of($1::timestamptz)", [between]);
      const expectedIds = [first.observations[0].observationId, second.observations[0].observationId];
      assert.deepEqual(historical.rows.map(row => row.observationId).filter(id => expectedIds.includes(id)), [first.observations[0].observationId]);
      const current = await admin.query<{ "observationId": string }>("select * from news_core.read_observations_as_of($1::timestamptz)", [new Date(t2 + 1).toISOString()]);
      assert.deepEqual(current.rows.map(row => row.observationId).filter(id => expectedIds.includes(id)).sort(), expectedIds.sort());
    });

    await t.test("crash after durable staging recovers as service and VACUUM preserves PIT", async () => {
      const scope = `recover-pit-${suffix}`;
      const recoveredId = `recover-${suffix}`;
      const staged = batch(scope, recoveredId, "2026-01-06:0000000001");
      await assert.rejects(storeA.ingestAdministrative(staged, { failurePoint: "after-commit-before-finalize" }), /INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE/);
      const future = new Date(Date.now() + 2_000).toISOString();
      await admin.query("set role news_reader");
      try {
        await assert.rejects(admin.query("select * from news_core.publications"), /permission denied/);
        assert.equal((await admin.query("select * from news_core.read_publications_as_of($1::timestamptz)", [future])).rows.some(row => row.externalId === recoveredId), false);
      } finally { await admin.query("reset role"); }
      await serviceStore.getCheckpoint(scope);
      const replay = await serviceStore.ingestAdministrative(staged);
      assert.deepEqual(replay, { insertedPublications: 0, insertedObservations: 0 });
      const beforeVacuum = await serviceStore.readAsOf(future);
      assert.equal(beforeVacuum.filter(row => row.externalId === recoveredId).length, 1);
      await admin.query("vacuum (analyze) news_core.publications");
      await admin.query("vacuum (analyze) news_core.visibility_frontiers");
      const afterVacuum = await serviceStore.readAsOf(future);
      assert.deepEqual(afterVacuum.filter(row => row.externalId === recoveredId), beforeVacuum.filter(row => row.externalId === recoveredId));
    });

    await t.test("two instances serialize leases and expired lease recovers", async () => {
      await storeA.upsertTarget({ collectionScopeKey: `lease-${suffix}`, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000000001", parameters: {} });
      const first = await storeA.claimNext("worker-a", 60, `lease-${suffix}`);
      assert.ok(first);
      const second = await storeB.claimNext("worker-b", 60, `lease-${suffix}`);
      assert.equal(second, null);
      const firstLease = { executionId: first!.executionId, collectionScopeKey: first!.collectionScopeKey, workerId: "worker-a", leaseSeconds: 60 } as const;
      assert.equal(await storeA.heartbeat(firstLease), true);
      await storeA.finish(firstLease, true);
      const recoverScope = `lease-recover-${suffix}`;
      await storeA.upsertTarget({ collectionScopeKey: recoverScope, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000000002", parameters: {} });
      const abandoned = await storeA.claimNext("worker-abandoned", 60, recoverScope);
      assert.ok(abandoned);
      await admin.query("update news_core.collection_targets set lease_until=clock_timestamp()-interval '1 second' where collection_scope_key=$1", [recoverScope]);
      const recovered = await storeB.claimNext("worker-recovered", 60, recoverScope);
      assert.equal(recovered?.collectionScopeKey, recoverScope);
      const abandonedLease = { executionId: abandoned!.executionId, collectionScopeKey: recoverScope, workerId: "worker-abandoned", leaseSeconds: 60 } as const;
      await storeA.finish(abandonedLease, true);
      const stillRunning = await admin.query<{ state: string }>("select state from news_core.executions where execution_id=$1", [recovered!.executionId]);
      assert.equal(stillRunning.rows[0].state, "RUNNING");
      const recoveredLease = { executionId: recovered!.executionId, collectionScopeKey: recoverScope, workerId: "worker-recovered", leaseSeconds: 60 } as const;
      await storeB.finish(recoveredLease, true);
    });

    await t.test("least privilege is verified through effective reader/service roles", async () => {
      const privileges = await admin.query<{ public_select: boolean; reader_select: boolean; service_insert: boolean }>(
        `select has_table_privilege('public','news_core.publications','select') public_select,
         has_table_privilege('news_reader','news_core.publications','select') reader_select,
         has_table_privilege('news_service','news_core.publications','insert') service_insert`,
      );
      assert.deepEqual(privileges.rows[0], { public_select: false, reader_select: false, service_insert: true });
      const parameter = await admin.query<{ can_set: boolean }>("select has_parameter_privilege('news_service','transaction_timeout','SET') can_set");
      assert.equal(parameter.rows[0].can_set, false);
      await admin.query("set role news_service");
      try {
        await admin.query("begin");
        await admin.query("set local transaction_timeout='0'");
        assert.equal((await admin.query("show transaction_timeout")).rows[0].transaction_timeout, "0");
        await admin.query("rollback");
        await admin.query("begin");
        assert.equal((await admin.query("select set_config('transaction_timeout','0',true) as value")).rows[0].value, "0");
        await admin.query("rollback");
      } finally { await admin.query("reset role"); }
      await admin.query("set role news_reader");
      try {
        assert.equal((await admin.query("select * from news_core.read_publications_as_of($1::timestamptz)", [new Date(Date.now() + 2_000).toISOString()])).rowCount > 0, true);
        await assert.rejects(admin.query("select count(*) from news_core.publications"), /permission denied/);
        await assert.rejects(admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,form) values ('denied','sec-edgar','denied','denied','https://www.sec.gov/Archives/edgar/data/1/denied','denied',clock_timestamp(),'8-K')"), /permission denied/);
      } finally { await admin.query("reset role"); }
      await admin.query("set role news_service");
      try {
        await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'sec','SEC_EDGAR')", [`role-source-${suffix}`]);
        await assert.rejects(admin.query("delete from news_core.sources where source_id=$1", [`role-source-${suffix}`]), /permission denied/);
      } finally { await admin.query("reset role"); }
    });
  } finally {
    await admin.query("delete from news_core.executions where collection_scope_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.collection_targets where collection_scope_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.observations where provider_observation_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id like $1", [`pg-test-%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.checkpoints where collection_scope_key like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id like $1", [`role-source-${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id like $1", [`service-source-${suffix}`]).catch(() => undefined);
    await Promise.all([storeA.close(), storeB.close(), serviceStore.close(), timeoutStore.close(), admin.end()]);
  }
});
