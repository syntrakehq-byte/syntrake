import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore, type NewsRevisionInput } from "../postgresStore";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const n1Migration = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const n2Migration = new URL("../../supabase/migrations/20261111170000_news_core_n2a_revisions.sql", import.meta.url);

test("News Core N2-A PostgreSQL 17 immutable revisions/PIT/concurrency", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 8 });
  const store = new PostgresNewsStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const publicationId = `n2a-publication-${suffix}`;
  const pendingPublicationId = `n2a-pending-${suffix}`;
  const newPublicationId = `n2a-new-${suffix}`;
  const scope = `n2a-scope-${suffix}`;
  const pendingScope = `n2a-pending-scope-${suffix}`;
  const sourceId = `n2a-source-${suffix}`;
  try {
    await admin.connect();
    const version = await admin.query<{ v: string }>("select current_setting('server_version') v");
    assert.match(version.rows[0].v, /^17\./);
    await admin.query(await readFile(n1Migration, "utf8"));
    const now = new Date().toISOString();
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n2a-provider','SEC_EDGAR') on conflict do nothing", [sourceId]);
    const frontier = await admin.query<{ frontier_id: string; published_at: Date }>("insert into news_core.visibility_frontiers default values returning frontier_id,published_at");
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,'8-K','COMMITTED',$9)", [publicationId, sourceId, `origin-${publicationId}`, publicationId, "https://www.sec.gov/Archives/edgar/data/1/n2a.htm", "Original filing", now, frontier.rows[0].published_at, frontier.rows[0].frontier_id]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n2a-provider',$2,$3,$4,$4,'n2a','COMMITTED',$5)", [`observation-${publicationId}`, `observation-${publicationId}`, publicationId, now, frontier.rows[0].frontier_id]);
    const laterFrontier = await admin.query<{ frontier_id: string }>("insert into news_core.visibility_frontiers default values returning frontier_id");
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n2a-provider',$2,$3,$4,$4,'n2a','COMMITTED',$5)", [`observation-later-${publicationId}`, `observation-later-${publicationId}`, publicationId, new Date(Date.now() + 1000).toISOString(), laterFrontier.rows[0].frontier_id]);
    await admin.query("begin");
    const pendingTx = (await admin.query<{ txid: string }>("select txid_current()::text txid")).rows[0].txid;
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,form,visibility_state,pending_transaction_id) values ($1,$2,$3,$4,$5,$6,$7,'8-K','PENDING',$8)", [pendingPublicationId, sourceId, `origin-${pendingPublicationId}`, pendingPublicationId, "https://www.sec.gov/Archives/edgar/data/1/n2a-pending.htm", "Pending filing", now, pendingTx]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,pending_transaction_id) values ($1,'n2a-provider',$2,$3,$4,$4,'n2a','PENDING',$5)", [`observation-${pendingPublicationId}`, `observation-${pendingPublicationId}`, pendingPublicationId, now, pendingTx]);
    await admin.query("commit");
    await admin.query(await readFile(n2Migration, "utf8"));
    await store.ensureSource(sourceId, "n2a-provider");

    const backfilledProvenance = await admin.query<{ provider_observation_key: string | null; visibility_frontier_id: string; visibility_state: string }>("select provider_observation_key,visibility_frontier_id::text,visibility_state from news_core.publication_revision_provenance where publication_revision_id=$1", [`${publicationId}:revision:1`]);
    assert.equal(backfilledProvenance.rows[0].provider_observation_key, null, "later observation is not retroactively attached to revision 1");
    assert.equal(backfilledProvenance.rows[0].visibility_frontier_id, frontier.rows[0].frontier_id, "backfill keeps the publication frontier");

    const pendingRaw = await admin.query<{ visibility_state: string; as_known_at: Date | null }>("select visibility_state,as_known_at from news_core.publication_revisions where publication_id=$1", [pendingPublicationId]);
    assert.deepEqual(pendingRaw.rows[0], { visibility_state: "PENDING", as_known_at: null }, "pending backfill is not promoted by migration");
    await store.getCheckpoint(pendingScope);
    const recoveredPending = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), pendingPublicationId);
    assert.deepEqual(recoveredPending.map(row => row.revisionNo), [1], "pending publication receives and recovers revision 1");

    await store.ingestAdministrative({
      publications: [{ publicationId: newPublicationId, sourceId, originFingerprint: `origin-${newPublicationId}`, externalId: newPublicationId, originalUrl: "https://www.sec.gov/Archives/edgar/data/1/n2a-new.htm", title: "New filing", publishedAt: null, firstSeenAt: now, ingestedAt: null, asKnownAt: null, form: "8-K" }],
      observations: [{ observationId: `observation-${newPublicationId}`, providerKey: "n2a-provider", providerObservationKey: `observation-${newPublicationId}`, publicationId: newPublicationId, observedAt: now, retrievedAt: now, publisherKey: "n2a" }],
      checkpoint: { sourceId, collectionScopeKey: scope, cursor: JSON.stringify({ watermark: `2026-01-01:${suffix}` }), updatedAt: now },
    });
    assert.deepEqual((await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), newPublicationId)).map(row => row.revisionNo), [1], "post-migration publication receives revision 1");

    const original = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), publicationId);
    assert.equal(original.length, 1, "N1 compatibility backfill creates exactly one truthful revision");
    assert.equal(original[0].revisionNo, 1);
    const revision2: NewsRevisionInput = {
      revision: { publicationRevisionId: `${publicationId}:revision:2`, publicationId, revisionNo: 2, title: "Corrected filing", publishedAt: null, form: "8-K", contentFingerprint: "sha256:corrected", sourceDocumentRef: "https://www.sec.gov/Archives/edgar/data/1/n2a-corrected.htm", qualityFlags: [], supersedesRevisionId: original[0].publicationRevisionId },
      provenance: { provenanceId: `${publicationId}:provenance:2`, publicationRevisionId: `${publicationId}:revision:2`, sourceId, providerKey: "n2a-provider", providerObservationKey: `observation-${publicationId}:revision-2`, originalUrl: "https://www.sec.gov/Archives/edgar/data/1/n2a-corrected.htm", sourceDocumentRef: "https://www.sec.gov/Archives/edgar/data/1/n2a-corrected.htm", retrievedAt: new Date().toISOString(), qualityFlags: [] },
    };
    const inserted2 = await store.ingestPublicationRevision(revision2);
    assert.deepEqual(inserted2, { inserted: true, publicationRevisionId: revision2.revision.publicationRevisionId });
    const after2 = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), publicationId);
    assert.deepEqual(after2.map(row => row.revisionNo), [1, 2], "T02 preserves the prior revision");
    assert.ok(after2[1].asKnownAt && after2[0].asKnownAt && Date.parse(after2[1].asKnownAt) > Date.parse(after2[0].asKnownAt));
    assert.equal(typeof after2[1].asKnownAt, "string");
    assert.deepEqual(await store.ingestPublicationRevision(revision2), { inserted: false, publicationRevisionId: revision2.revision.publicationRevisionId }, "identical replay is idempotent");
    await assert.rejects(store.ingestPublicationRevision({ ...revision2, revision: { ...revision2.revision, form: "10-K" } }), /NEWS_REVISION_CONFLICT/);
    await assert.rejects(store.ingestPublicationRevision({ ...revision2, revision: { ...revision2.revision, publishedAt: "2026-01-02T00:00:00.000Z" } }), /NEWS_REVISION_CONFLICT/);
    await assert.rejects(store.ingestPublicationRevision({ ...revision2, provenance: { ...revision2.provenance, originalUrl: "https://www.sec.gov/Archives/edgar/data/1/other.htm" } }), /NEWS_REVISION_PROVENANCE_CONFLICT/);
    await assert.rejects(admin.query("update news_core.publication_revisions set title='mutated' where publication_revision_id=$1", [revision2.revision.publicationRevisionId]), /NEWS_REVISION_IMMUTABLE/);
    const cutoffBeforeCorrection = new Date(Date.parse(after2[1].asKnownAt!) - 1).toISOString();
    assert.deepEqual((await store.readPublicationRevisionsAsOf(cutoffBeforeCorrection, publicationId)).map(row => row.revisionNo), [1], "T12 excludes a future correction");

    const revision3 = { ...revision2, revision: { ...revision2.revision, publicationRevisionId: `${publicationId}:revision:3`, revisionNo: 3, title: "Rolled-back candidate", supersedesRevisionId: revision2.revision.publicationRevisionId }, provenance: { ...revision2.provenance, provenanceId: `${publicationId}:provenance:3`, publicationRevisionId: `${publicationId}:revision:3`, providerObservationKey: `observation-${publicationId}:revision-3` } } satisfies NewsRevisionInput;
    await assert.rejects(store.ingestPublicationRevision(revision3, { failurePoint: "before-commit" }), /INJECTED_FAILURE_BEFORE_COMMIT/);
    assert.deepEqual((await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), publicationId)).map(row => row.revisionNo), [1, 2], "T24 rollback leaves no partial revision");
    assert.equal((await admin.query("select count(*)::int n from news_core.publication_revisions where publication_revision_id=$1", [revision3.revision.publicationRevisionId])).rows[0].n, 0);

    const revision4 = { ...revision3, revision: { ...revision3.revision, publicationRevisionId: `${publicationId}:revision:4`, revisionNo: 4, title: "Clock-conflict filing", publishedAt: "2099-01-01T00:00:00.000Z", qualityFlags: [], supersedesRevisionId: revision2.revision.publicationRevisionId }, provenance: { ...revision3.provenance, provenanceId: `${publicationId}:provenance:4`, publicationRevisionId: `${publicationId}:revision:4`, providerObservationKey: `observation-${publicationId}:revision-4` } } satisfies NewsRevisionInput;
    await store.ingestPublicationRevision(revision4);
    const after4 = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), publicationId);
    assert.equal(after4.find(row => row.revisionNo === 4)?.publishedAt, "2099-01-01T00:00:00.000Z", "T28 preserves source time without using it as PIT availability");
    assert.ok(after4.find(row => row.revisionNo === 4)?.qualityFlags.includes("SOURCE_CLOCK_CONFLICT"), "T28 imposes the clock conflict flag");

    const revision5 = { ...revision4, revision: { ...revision4.revision, publicationRevisionId: `${publicationId}:revision:5`, revisionNo: 5, title: "Concurrent filing", supersedesRevisionId: revision4.revision.publicationRevisionId }, provenance: { ...revision4.provenance, provenanceId: `${publicationId}:provenance:5`, publicationRevisionId: `${publicationId}:revision:5`, providerObservationKey: `observation-${publicationId}:revision-5` } } satisfies NewsRevisionInput;
    const concurrent = await Promise.all([store.ingestPublicationRevision(revision5), store.ingestPublicationRevision(revision5)]);
    assert.deepEqual(concurrent.map(row => row.inserted).sort(), [false, true], "T29 concurrent replay inserts one revision");
    assert.equal((await admin.query("select count(*)::int n from news_core.publication_revisions where publication_id=$1 and revision_no=5", [publicationId])).rows[0].n, 1);

    const revision6 = { ...revision5, revision: { ...revision5.revision, publicationRevisionId: `${publicationId}:revision:6`, revisionNo: 6, title: "Recovered filing", supersedesRevisionId: revision5.revision.publicationRevisionId }, provenance: { ...revision5.provenance, provenanceId: `${publicationId}:provenance:6`, publicationRevisionId: `${publicationId}:revision:6`, providerObservationKey: `observation-${publicationId}:revision-6` } } satisfies NewsRevisionInput;
    await assert.rejects(store.ingestPublicationRevision(revision6, { failurePoint: "after-commit-before-finalize" }), /INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE/);
    assert.equal((await admin.query("select count(*)::int n from news_core.publication_revisions where publication_revision_id=$1 and visibility_state='PENDING'", [revision6.revision.publicationRevisionId])).rows[0].n, 1);
    await store.getCheckpoint(scope);
    const replay6 = await store.ingestPublicationRevision(revision6);
    assert.deepEqual(replay6, { inserted: false, publicationRevisionId: revision6.revision.publicationRevisionId }, "recovery makes post-commit replay idempotent");
    assert.equal((await admin.query("select count(*)::int n from news_core.publication_revisions where publication_revision_id=$1 and visibility_state='COMMITTED'", [revision6.revision.publicationRevisionId])).rows[0].n, 1);
  } finally {
    for (const id of [publicationId, pendingPublicationId, newPublicationId]) {
      await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id like $1", [`${id}%`]).catch(() => undefined);
      await admin.query("delete from news_core.publication_revisions where publication_id=$1", [id]).catch(() => undefined);
      await admin.query("delete from news_core.observations where publication_id=$1", [id]).catch(() => undefined);
      await admin.query("delete from news_core.publications where publication_id=$1", [id]).catch(() => undefined);
    }
    await admin.query("delete from news_core.checkpoints where collection_scope_key in ($1,$2)", [scope, pendingScope]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id=$1", [sourceId]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
