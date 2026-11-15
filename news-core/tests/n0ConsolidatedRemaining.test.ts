import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import { runNewsExecutorOnce } from "../autonomousExecutor";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const n1 = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const n2a = new URL("../../supabase/migrations/20261111170000_news_core_n2a_revisions.sql", import.meta.url);
const A = "0000320193";
const B = "0000789019";

function response(cik: string, accession: string): Response {
  return new Response(JSON.stringify({ cik, filings: { recent: {
    form: ["8-K"], accessionNumber: [accession], filingDate: ["2026-11-14"],
    primaryDocument: ["notice.htm"], primaryDocDescription: ["Controlled SEC filing"],
  } } }), { status: 200, headers: { "content-type": "application/json" } });
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
    await admin.query(await readFile(n1, "utf8"));
    await admin.query(await readFile(n2a, "utf8"));
    await store.ensureSource("sec-edgar", "sec");

    await store.upsertTarget({ collectionScopeKey: scopeA, sourceId: "sec-edgar", providerKey: "sec", entityKey: A, parameters: { forms: ["8-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });
    await store.upsertTarget({ collectionScopeKey: scopeB, sourceId: "sec-edgar", providerKey: "sec", entityKey: B, parameters: { forms: ["8-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });

    let sourceAvailable = false;
    await assert.rejects(runNewsExecutorOnce({ store, workerId: `n0-consolidated-a-${suffix}`, collectionScopeKey: scopeA, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: async () => { if (!sourceAvailable) throw new Error("SOURCE_TEMPORARILY_UNAVAILABLE"); return response(A, `0000320193-26-${suffix.slice(0, 6)}`); } }), /SOURCE_TEMPORARILY_UNAVAILABLE/);
    assert.equal(await store.getCheckpoint(scopeA), null, "T27 partial outage must not advance checkpoint");
    sourceAvailable = true;
    await runNewsExecutorOnce({ store, workerId: `n0-consolidated-a-recovery-${suffix}`, collectionScopeKey: scopeA, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: async () => response(A, `0000320193-26-${suffix.slice(0, 6)}`) });
    await runNewsExecutorOnce({ store, workerId: `n0-consolidated-b-${suffix}`, collectionScopeKey: scopeB, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: async () => response(B, `0000789019-26-${suffix.slice(0, 6)}`) });
    assert.ok((await store.getCheckpoint(scopeA))?.cursor);
    assert.ok((await store.getCheckpoint(scopeB))?.cursor);
    assert.equal((await admin.query("select count(*)::int n from news_core.checkpoints where collection_scope_key=any($1::text[])", [[scopeA, scopeB]])).rows[0].n, 2, "T15 must keep two CIK checkpoints independent");
    assert.equal((await admin.query("select count(*)::int n from news_core.publications where external_id=any($1::text[])", [[`0000320193-26-${suffix.slice(0, 6)}`, `0000789019-26-${suffix.slice(0, 6)}`]])).rows[0].n, 2);

    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_owner=null, lease_until=null, active_execution_id=null where collection_scope_key=any($1::text[])", [[scopeA, scopeB]]);
    await runNewsExecutorOnce({ store, workerId: `n0-consolidated-replay-${suffix}`, collectionScopeKey: scopeA, secUserAgent: "SYNTRAKE N0 rehearsal security@syntrake.com", fetchImpl: async () => response(A, `0000320193-26-${suffix.slice(0, 6)}`) });
    assert.equal((await admin.query("select count(*)::int n from news_core.publications where external_id=$1", [`0000320193-26-${suffix.slice(0, 6)}`])).rows[0].n, 1, "T15 replay must remain idempotent");

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
    console.log(`N0_CONSOLIDATED_PROOF T15=PARTIAL_PASS cikA=${A} cikB=${B} checkpoints=2 replayDuplicates=0 T27=PARTIAL_PASS outage=checkpoint_unchanged_then_recovered T28=PARTIAL_PASS futureFlag=SOURCE_CLOCK_CONFLICT asKnownAtPIT=verified`);
  } finally {
    for (const publicationId of [clockFuture, clockPast]) {
      await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id like $1", [`${publicationId}%`]).catch(() => undefined);
      await admin.query("delete from news_core.publication_revisions where publication_id=$1", [publicationId]).catch(() => undefined);
      await admin.query("delete from news_core.observations where publication_id=$1", [publicationId]).catch(() => undefined);
      await admin.query("delete from news_core.publications where publication_id=$1", [publicationId]).catch(() => undefined);
    }
    await admin.query("delete from news_core.checkpoints where collection_scope_key=any($1::text[])", [[scopeA, scopeB, clockScope]]).catch(() => undefined);
    await admin.query("delete from news_core.collection_targets where collection_scope_key=any($1::text[])", [[scopeA, scopeB]]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
