import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { NewsConsumptionApiV1 } from "../n5Api";
import { PostgresNewsStore } from "../postgresStore";
import { PostgresFactualStore } from "../factualPersistence";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);

test("N5 PostgreSQL 17 read API is PIT, role-scoped, paginated and append-only compatible", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const newsPool = new Pool({ connectionString: DB_URL, max: 2 });
  const factualPool = new Pool({ connectionString: DB_URL, max: 2 });
  const news = new PostgresNewsStore(newsPool);
  const factual = new PostgresFactualStore(factualPool, "news_service");
    const suffix = randomUUID().replaceAll("-", ""); const sourceId = `n5-source-${suffix}`; const publicationId = `n5-publication-${suffix}`; const revisionId = `${publicationId}:revision:1`; const eventId = `claim:n5-event-${suffix}`; const factRevisionId = `${eventId}:revision:1`; const document = `https://www.sec.gov/Archives/edgar/data/1/n5-${suffix}.htm`; const known = new Date(Date.now() - 2000).toISOString();
  try {
    await admin.connect(); assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(migration("20261111150000_news_core_postgres_n1.sql"), "utf8"));
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n5-fixture','SEC_EDGAR')", [sourceId]);
    const frontier = await admin.query<{ frontier_id: string }>("insert into news_core.visibility_frontiers(published_at) values ($1) returning frontier_id", [known]);
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,'N5 official fixture',$6,$6,$6,'8-K','COMMITTED',$7)", [publicationId, sourceId, `origin:${suffix}`, publicationId, document, known, frontier.rows[0].frontier_id]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n5-fixture',$1,$2,$3,$3,'n5','COMMITTED',$4)", [`obs:${suffix}`, publicationId, known, frontier.rows[0].frontier_id]);
    await admin.query(await readFile(migration("20261111170000_news_core_n2a_revisions.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112120000_news_core_n3c_factual_persistence.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112170000_news_core_n3c_factual_writer_boundary.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112150000_news_core_n5_read_api.sql"), "utf8"));
    const persistFixture = async (statement: string, fingerprint: string, publicationRevisionId: string, evidenceId: string, evidenceKnown = known) => {
      await admin.query("set role news_factual_writer");
      await admin.query("select * from news_core.persist_fact_revision_v1($1::jsonb)", [JSON.stringify({ canonicalClaimId: eventId, taxonomyVersion: "news-fact-taxonomy-v1", category: "LEGAL_REGULATORY", logicalFingerprint: fingerprint, ruleSetVersion: "deterministic-rule-v1", claimType: statement.includes("corrected") ? "EVENT_CORRECTION" : "EVENT_OCCURRENCE", statement, subjectRef: null, objectRef: null, occurredAt: null, scheduledFor: null, confirmationStatus: "REPORTED", lifecycleStatus: "ACTIVE", polarity: "AFFIRMATIVE", focalClaimKey: `claim-key:${suffix}`, publicationRevisionId, qualityFlags: [], evidence: [{ evidenceId, evidenceKind: "N3A_PROPOSAL", claimKey: `claim-key:${suffix}`, publicationRevisionId, sourceDocumentRef: statement.includes("corrected") ? `${document}:corrected` : document, contentLocator: "body:p1", provenanceRef: `prov:${suffix}`, asKnownAt: evidenceKnown }], dependencies: [{ dependencyType: "N2_PUBLICATION_REVISION", dependencyRef: publicationRevisionId, asKnownAt: evidenceKnown }, { dependencyType: "N3A_PROPOSAL", dependencyRef: fingerprint, asKnownAt: evidenceKnown }, { dependencyType: "N3B_EVALUATION", dependencyRef: fingerprint, asKnownAt: evidenceKnown }], relation: null, seal: true })]);
      await admin.query("reset role");
    };
    await persistFixture("The company was fined.", `fp:${suffix}`, revisionId, `evidence:${suffix}`);
    const committed = (await admin.query<{ committed_at: Date }>("select committed_at from news_core.fact_revisions where fact_revision_id=$1", [factRevisionId])).rows[0].committed_at;
    const visibleAsOf = new Date(committed.valueOf() + 1).toISOString();
    const api = new NewsConsumptionApiV1({ news, factual }, "0123456789abcdef", "n5-test-credential"); const auth = { serviceId: "news_reader" as const, credential: "n5-test-credential" };
    const discovered = await api.discoverNews(auth, { asOf: visibleAsOf, filters: { sourceIds: [sourceId], forms: ["8-K"] } }); assert.ok(discovered.data.some(row => row.publicationRevisionId === revisionId));
    const events = await api.getNewsEvents(auth, { asOf: visibleAsOf, targets: [eventId] }); const eventRow = events.data.find(row => row.factRevisionId === factRevisionId); assert.ok(eventRow); assert.equal(eventRow.confirmationStatus, "REPORTED");
    const evidence = await api.getEventEvidence(auth, { eventId, asOf: visibleAsOf }); assert.equal(evidence.data[0].sourceDocumentRef, document);
    const history = await api.getNewsHistory(auth, { targets: [eventId], asOf: visibleAsOf }); assert.equal(history.data.length, 1);
    const before = await api.getNewsEvents(auth, { asOf: new Date(Date.parse(known) - 1000).toISOString() }); assert.equal(before.data.some(row => row.factRevisionId === factRevisionId), false);
    const publicationRevision2Id = `${publicationId}:revision:2`;
    await news.ingestPublicationRevision({ revision: { publicationRevisionId: publicationRevision2Id, publicationId, revisionNo: 2, title: "N5 corrected fixture", publishedAt: null, form: "8-K", contentFingerprint: `corrected:${suffix}`, sourceDocumentRef: `${document}:corrected`, qualityFlags: [], supersedesRevisionId: revisionId }, provenance: { provenanceId: `${publicationId}:provenance:2`, publicationRevisionId: publicationRevision2Id, sourceId, providerKey: "n5-fixture", providerObservationKey: `obs:${suffix}:revision:2`, originalUrl: `${document}:corrected`, sourceDocumentRef: `${document}:corrected`, retrievedAt: new Date().toISOString(), qualityFlags: [] } });
    const publication2Known = (await admin.query<{ as_known_at: Date }>("select as_known_at from news_core.publication_revisions where publication_revision_id=$1", [publicationRevision2Id])).rows[0].as_known_at;
    const factRevision2Id = `${eventId}:revision:2`;
    await persistFixture("The company was fined, later corrected.", `fp2:${suffix}`, publicationRevision2Id, `evidence2:${suffix}`, publicationRevision2Known.toISOString());
    const fact2Committed = (await admin.query<{ committed_at: Date }>("select committed_at from news_core.fact_revisions where fact_revision_id=$1", [factRevision2Id])).rows[0].committed_at;
    await new Promise(resolve => setTimeout(resolve, 3000));
    const afterSecond = new Date(Date.now() - 500).toISOString();
    const oldTypeAfter = await api.getNewsEvents(auth, { asOf: afterSecond, targets: [eventId], eventTypes: ["EVENT_OCCURRENCE"] }); assert.equal(oldTypeAfter.data.length, 0);
    const newTypeAfter = await api.getNewsEvents(auth, { asOf: afterSecond, targets: [eventId], eventTypes: ["EVENT_CORRECTION"] }); assert.deepEqual(newTypeAfter.data.map(row => row.factRevisionId), [factRevision2Id]);
    const oldTypeBefore = await api.getNewsEvents(auth, { asOf: visibleAsOf, targets: [eventId], eventTypes: ["EVENT_OCCURRENCE"] }); assert.deepEqual(oldTypeBefore.data.map(row => row.factRevisionId), [factRevisionId]);
    const oldPublicationAfter = await api.discoverNews(auth, { asOf: afterSecond, query: "N5 official fixture", filters: { sourceIds: [sourceId] } }); assert.equal(oldPublicationAfter.data.some(row => row.publicationRevisionId === revisionId), false);
    const newPublicationAfter = await api.discoverNews(auth, { asOf: afterSecond, query: "N5 corrected fixture", filters: { sourceIds: [sourceId] } }); assert.deepEqual(newPublicationAfter.data.map(row => row.publicationRevisionId), [publicationRevision2Id]);
    const fullHistory = await api.getNewsHistory(auth, { targets: [eventId], asOf: afterSecond, limit: 1 }); assert.equal(fullHistory.data.length, 1); assert.ok(fullHistory.nextCursor);
    const historyPage2 = await api.getNewsHistory(auth, { targets: [eventId], asOf: afterSecond, limit: 1, cursor: fullHistory.nextCursor }); assert.equal(historyPage2.data.length, 1); assert.notEqual(historyPage2.data[0].factRevisionId, fullHistory.data[0].factRevisionId);
    await admin.query("set role news_service"); await assert.rejects(admin.query("select * from news_core.fact_revisions"), /permission denied/); await admin.query("reset role");
  } finally { await admin.query("reset role").catch(() => undefined); await Promise.all([news.close(), factual.close(), admin.end()]); }
});
