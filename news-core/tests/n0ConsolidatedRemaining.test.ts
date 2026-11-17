import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import { runNewsExecutorOnce } from "../autonomousExecutor";
import { fetchSecFilings } from "../secAdapter";
import { fetchSafeExternal } from "../sourceSecurity";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const n1 = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const n2a = new URL("../../supabase/migrations/20261111170000_news_core_n2a_revisions.sql", import.meta.url);
const A = "0000320193";
const B = "0000789019";

async function liveReplay(cik: string): Promise<{ externalId: string; externalIds: string[]; fetchImpl: typeof fetch }> {
  const userAgent = "SYNTRAKE N0 consolidated rehearsal security@syntrake.com";
  const live = await fetchSafeExternal(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  assert.equal(live.ok, true, `SEC live response must be successful for ${cik}`);
  const payload = await live.json() as Record<string, unknown>;
  assert.equal(payload.cik, cik, `SEC live payload must identify ${cik}`);
  const payloadJson = JSON.stringify(payload);
  const fetchImpl: typeof fetch = async () => new Response(payloadJson, { status: 200, headers: { "content-type": "application/json" } });
  const parsed = await fetchSecFilings({ cik, userAgent, fetchImpl, now: new Date("2026-11-15T07:00:00.000Z") });
  assert.ok(parsed.publications.length > 0, `SEC live payload must contain filings for ${cik}`);
  return { externalId: parsed.publications[0].externalId, externalIds: parsed.publications.map(item => item.externalId), fetchImpl };
}

function administrativeBatch(scope: string, publicationId: string, publishedAt: string | null) {
  const now = new Date().toISOString();
  return {
    publications: [{ publicationId, sourceId: "sec-edgar", originFingerprint: publicationId, externalId: publicationId, originalUrl: `https://www.sec.gov/Archives/edgar/data/1/${publicationId}.htm`, title: "Clock rehearsal", publishedAt, firstSeenAt: now, ingestedAt: null, asKnownAt: null, form: "8-K" }],
    observations: [{ observationId: `observation-${publicationId}`, providerKey: "sec", providerObservationKey: `${scope}:${publicationId}`, publicationId, observedAt: now, retrievedAt: now, publisherKey: "sec-edgar" }],
    checkpoint: { sourceId: "sec-edgar", collectionScopeKey: scope, cursor: JSON.stringify({ publicationId }), updatedAt: now },
  };
}

test("N0 consolidated local rehearsal: T15, T27 partial recovery and T28 clock/PIT integrity", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 6 });
  const store = new PostgresNewsStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const scopeA = `n0-consolidated-a-${suffix}`;
  const scopeB = `n0-consolidated-b-${suffix}`;
  const clockScope = `n0-consolidated-clock-${suffix}`;
  const clockFuture = `n0-consolidated-future-${suffix}`;
  const clockPast = `n0-consolidated-past-${suffix}`;
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query("drop function if exists news_core.read_publication_revisions_as_of(timestamptz,text)");
    await admin.query(await readFile(n1, "utf8"));
    await admin.query(await readFile(n2a, "utf8"));
    await admin.query(await readFile(new URL("../../supabase/migrations/20261116140000_news_core_ng4_context.sql", import.meta.url), "utf8"));
    await store.ensureSource("sec-edgar", "sec");
    const liveA = await liveReplay(A);
    const liveB = await liveReplay(B);
    assert.ok(liveA.externalIds.length > 1, "T27 requires multiple eligible publications in the recovered SEC batch");
    assert.ok(liveB.externalIds.length > 1, "T15 requires multiple SEC publications per independent CIK");

    await store.upsertTarget({ collectionScopeKey: scopeA, sourceId: "sec-edgar", providerKey: "sec", entityKey: A, parameters: { forms: ["8-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });
    await store.upsertTarget({ collectionScopeKey: scopeB, sourceId: "sec-edgar", providerKey: "sec", entityKey: B, parameters: { forms: ["8-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });

    let sourceAvailable = false;
    let sourceBAvailable = false;
    const failedA = runNewsExecutorOnce({ store, workerId: `n0-consolidated-a-${suffix}`, collectionScopeKey: scopeA, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: async () => { if (!sourceAvailable) throw new Error("SOURCE_TEMPORARILY_UNAVAILABLE_A"); return liveA.fetchImpl("https://data.sec.gov"); } });
    const failedB = runNewsExecutorOnce({ store, workerId: `n0-consolidated-b-${suffix}`, collectionScopeKey: scopeB, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: async () => { if (!sourceBAvailable) throw new Error("SOURCE_TEMPORARILY_UNAVAILABLE_B"); return liveB.fetchImpl("https://data.sec.gov"); } });
    await assert.rejects(failedA, /SOURCE_TEMPORARILY_UNAVAILABLE_A/);
    await assert.rejects(failedB, /SOURCE_TEMPORARILY_UNAVAILABLE_B/);
    assert.equal(await store.getCheckpoint(scopeA), null, "T27 partial outage must not advance checkpoint");
    assert.equal(await store.getCheckpoint(scopeB), null, "T15 simultaneous outage must not advance checkpoint B");
    sourceAvailable = true;
    sourceBAvailable = true;
    // Let the normal retry/backoff clock expire: do not clear leases or schedule recovery as DB admin.
    const deadline = Date.now() + 20_000;
    while (true) {
      const due = await admin.query<{ due_count: number }>(
        "select count(*)::int due_count from news_core.collection_targets where collection_scope_key=any($1::text[]) and next_run_at <= clock_timestamp() and (lease_until is null or lease_until < clock_timestamp())",
        [[scopeA, scopeB]],
      );
      if (due.rows[0].due_count === 2) break;
      assert.ok(Date.now() < deadline, "both failed CIK partitions must become retryable through natural backoff");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await Promise.all([
      runNewsExecutorOnce({ store, workerId: `n0-consolidated-a-recovery-${suffix}`, collectionScopeKey: scopeA, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: liveA.fetchImpl }),
      runNewsExecutorOnce({ store, workerId: `n0-consolidated-b-recovery-${suffix}`, collectionScopeKey: scopeB, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: liveB.fetchImpl }),
    ]);
    assert.ok((await store.getCheckpoint(scopeA))?.cursor);
    assert.ok((await store.getCheckpoint(scopeB))?.cursor);
    assert.equal((await admin.query("select count(*)::int n from news_core.checkpoints where collection_scope_key=any($1::text[])", [[scopeA, scopeB]])).rows[0].n, 2, "T15 must keep two CIK checkpoints independent");
    const distinctExternalIds = new Set([...liveA.externalIds, ...liveB.externalIds]);
    assert.equal((await admin.query("select count(*)::int n from news_core.publications where external_id=any($1::text[])", [[...distinctExternalIds]])).rows[0].n, distinctExternalIds.size);

    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_owner=null, lease_until=null, active_execution_id=null where collection_scope_key=any($1::text[])", [[scopeA, scopeB]]);
    await Promise.all([
      runNewsExecutorOnce({ store, workerId: `n0-consolidated-replay-a-${suffix}`, collectionScopeKey: scopeA, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: liveA.fetchImpl }),
      runNewsExecutorOnce({ store, workerId: `n0-consolidated-replay-b-${suffix}`, collectionScopeKey: scopeB, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: liveB.fetchImpl }),
    ]);
    assert.equal((await admin.query("select count(*)::int n from news_core.publications where external_id=any($1::text[])", [[...distinctExternalIds]])).rows[0].n, distinctExternalIds.size, "T15/T27 concurrent replay must remain idempotent");

    await store.ingestAdministrative(administrativeBatch(clockScope, clockFuture, "2099-01-01T00:00:00.000Z"));
    await store.ingestAdministrative(administrativeBatch(clockScope, clockPast, "2020-01-01T00:00:00.000Z"));
    const revisions = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 60_000).toISOString(), clockFuture);
    assert.equal(revisions.length, 1);
    assert.ok(revisions[0].qualityFlags.includes("SOURCE_CLOCK_CONFLICT"), "T28 future source clock must be flagged");
    assert.ok(Date.parse(revisions[0].asKnownAt!) >= Date.parse(revisions[0].ingestedAt!), "T28 asKnownAt cannot precede durable ingestion");
    const pastRevisions = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 60_000).toISOString(), clockPast);
    assert.equal(pastRevisions.length, 1);
    assert.ok(!pastRevisions[0].qualityFlags.includes("SOURCE_CLOCK_CONFLICT"), "past source time is not itself a conflict");
    const beforeAvailability = await store.readPublicationRevisionsAsOf(new Date(Date.parse(revisions[0].asKnownAt!) - 1).toISOString(), clockFuture);
    assert.equal(beforeAvailability.length, 0, "T28 PIT must hide knowledge before asKnownAt");
    console.log(`N0_CONSOLIDATED_PROOF T15=STRONG_LOCAL cikA=${A} cikB=${B} publicationsA=${liveA.externalIds.length} publicationsB=${liveB.externalIds.length} simultaneousFailure=verified scheduledRecovery=natural_backoff replayReset=administrative replayDuplicates=0 T27=BACKFILL_LOCAL recovered=${liveA.externalIds.length} outage=checkpoint_unchanged_then_recovered T28=PARTIAL_PASS futureFlag=SOURCE_CLOCK_CONFLICT asKnownAtPIT=verified`);
  } finally {
    for (const publicationId of [clockFuture, clockPast]) {
      await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id like $1", [`${publicationId}%`]).catch(() => undefined);
      await admin.query("delete from news_core.publication_revisions where publication_id=$1", [publicationId]).catch(() => undefined);
      await admin.query("delete from news_core.observations where publication_id=$1", [publicationId]).catch(() => undefined);
      await admin.query("delete from news_core.publications where publication_id=$1", [publicationId]).catch(() => undefined);
    }
    await admin.query("delete from news_core.checkpoints where collection_scope_key=any($1::text[])", [[scopeA, scopeB, clockScope]]).catch(() => undefined);
    await admin.query("delete from news_core.executions where collection_scope_key=any($1::text[])", [[scopeA, scopeB]]).catch(() => undefined);
    await admin.query("delete from news_core.collection_targets where collection_scope_key=any($1::text[])", [[scopeA, scopeB]]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
