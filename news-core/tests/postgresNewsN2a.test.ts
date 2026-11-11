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
  const scope = `n2a-scope-${suffix}`;
  const sourceId = `n2a-source-${suffix}`;
  try {
    await admin.connect();
    const version = await admin.query<{ v: string }>("select current_setting('server_version') v");
    assert.match(version.rows[0].v, /^17\./);
    await admin.query(await readFile(n1Migration, "utf8"));
    await store.ensureSource(sourceId, "n2a-provider");
    const now = new Date().toISOString();
    await store.ingestAdministrative({
      publications: [{ publicationId, sourceId, originFingerprint: `origin-${publicationId}`, externalId: publicationId, originalUrl: "https://www.sec.gov/Archives/edgar/data/1/n2a.htm", title: "Original filing", publishedAt: null, firstSeenAt: now, ingestedAt: null, asKnownAt: null, form: "8-K" }],
      observations: [{ observationId: `observation-${publicationId}`, providerKey: "n2a-provider", providerObservationKey: `observation-${publicationId}`, publicationId, observedAt: now, retrievedAt: now, publisherKey: "n2a" }],
      checkpoint: { sourceId, collectionScopeKey: scope, cursor: JSON.stringify({ watermark: `2026-01-01:${suffix}` }), updatedAt: now },
    });
    await admin.query(await readFile(n2Migration, "utf8"));

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
    await assert.rejects(admin.query("update news_core.publication_revisions set title='mutated' where publication_revision_id=$1", [revision2.revision.publicationRevisionId]), /NEWS_REVISION_IMMUTABLE/);
    const cutoffBeforeCorrection = new Date(Date.parse(after2[1].asKnownAt!) - 1).toISOString();
    assert.deepEqual((await store.readPublicationRevisionsAsOf(cutoffBeforeCorrection, publicationId)).map(row => row.revisionNo), [1], "T12 excludes a future correction");

    const revision3 = { ...revision2, revision: { ...revision2.revision, publicationRevisionId: `${publicationId}:revision:3`, revisionNo: 3, title: "Rolled-back candidate", supersedesRevisionId: revision2.revision.publicationRevisionId }, provenance: { ...revision2.provenance, provenanceId: `${publicationId}:provenance:3`, publicationRevisionId: `${publicationId}:revision:3`, providerObservationKey: `observation-${publicationId}:revision-3` } } satisfies NewsRevisionInput;
    await assert.rejects(store.ingestPublicationRevision(revision3, { failurePoint: "before-commit" }), /INJECTED_FAILURE_BEFORE_COMMIT/);
    assert.deepEqual((await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), publicationId)).map(row => row.revisionNo), [1, 2], "T24 rollback leaves no partial revision");
    assert.equal((await admin.query("select count(*)::int n from news_core.publication_revisions where publication_revision_id=$1", [revision3.revision.publicationRevisionId])).rows[0].n, 0);

    const revision4 = { ...revision3, revision: { ...revision3.revision, publicationRevisionId: `${publicationId}:revision:4`, revisionNo: 4, title: "Clock-conflict filing", publishedAt: "2099-01-01T00:00:00.000Z", qualityFlags: ["SOURCE_CLOCK_CONFLICT"], supersedesRevisionId: revision2.revision.publicationRevisionId }, provenance: { ...revision3.provenance, provenanceId: `${publicationId}:provenance:4`, publicationRevisionId: `${publicationId}:revision:4`, providerObservationKey: `observation-${publicationId}:revision-4` } } satisfies NewsRevisionInput;
    await store.ingestPublicationRevision(revision4);
    const after4 = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 5_000).toISOString(), publicationId);
    assert.equal(after4.find(row => row.revisionNo === 4)?.publishedAt, "2099-01-01T00:00:00.000Z", "T28 preserves source time without using it as PIT availability");

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
    await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id like $1", [`${publicationId}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revisions where publication_id=$1", [publicationId]).catch(() => undefined);
    await admin.query("delete from news_core.observations where publication_id=$1", [publicationId]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id=$1", [publicationId]).catch(() => undefined);
    await admin.query("delete from news_core.checkpoints where collection_scope_key=$1", [scope]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id=$1", [sourceId]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
