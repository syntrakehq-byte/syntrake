import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import type { GlobalNewsItem } from "../globalNewsAdapter";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";
import type { EditorialGroupResolutionV1, StructuralEventLinkResolutionV1 } from "../editorialRelations";
import type { MarketCoreResolutionV1 } from "../entityResolution";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const source = (id: string, host: string): GlobalNewsRegistryEntry => ({ registryVersion: "1.0", sourceId: id, publisherId: `${id}-publisher`, publisher: id, category: "EDITORIAL", geoScope: ["US"], sourceType: "RSS_2", endpoint: `https://${host}/feed.xml`, allowedArticleHosts: [host], rightsPolicyId: "global-news-v1", updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 20 }, storagePolicy: { content: "PERMITTED_TEXT", retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${id}:scope` });
const item = (sourceId: string, host: string, id: string, title: string, summary: string, retrievedAt: string): GlobalNewsItem => ({ sourceId, providerKey: "rss", externalId: id, publicationId: `${sourceId}:${id}`, originalUrl: `https://${host}/story/${id}`, title, summary, publishedAt: "2026-11-16T10:00:00.000Z", updatedAt: null, retrievedAt, publisher: sourceId, rightsPolicyId: "global-news-v1", contentFingerprint: `${sourceId}:${id}:fingerprint`, qualityFlags: [] });

test("N-G5 reuses N2 identity/editorial relations with conservative deduplication and PIT", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 8 });
  const store = new PostgresNewsStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const now = new Date().toISOString();
  const a = source(`ng5-a-${suffix}`, "publisher-a.example");
  const b = source(`ng5-b-${suffix}`, "publisher-b.example");
  const agency = source(`ng5-agency-${suffix}`, "agency.example");
  const first = item(a.sourceId, "publisher-a.example", "event-1", "Company announces facility opening", "The company announced a dividend after opening its facility.", now);
  const independent = item(b.sourceId, "publisher-b.example", "event-1", "Company confirms facility opening", "The company announced a dividend after opening its facility.", now);
  const republication = item(agency.sourceId, "agency.example", "event-1", "Agency: company announces facility opening", "The company announced a dividend after opening its facility.", now);
  const distinct = item(a.sourceId, "publisher-a.example", "event-2", "Company reports an outage", "The company reported an outage at a separate site.", now);
  const revisionIds = [`${first.publicationId}:revision:1`, `${independent.publicationId}:revision:1`, `${republication.publicationId}:revision:1`, `${distinct.publicationId}:revision:1`];
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    for (const name of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql", "20261111180000_news_core_n2b_entity_links.sql", "20261112100000_news_core_n2c_editorial_relations.sql", "20261116130000_news_core_global_persistence.sql", "20261116140000_news_core_ng4_context.sql"]) await admin.query(await readFile(migration(name), "utf8"));

    await store.ingestGlobalBatch(a, [first]);
    await store.ingestGlobalBatch(b, [independent]);
    await store.ingestGlobalBatch(agency, [republication]);
    await store.ingestGlobalBatch(a, [distinct]);
    assert.deepEqual(await store.ingestGlobalBatch(a, [first]), { insertedPublications: 0, insertedObservations: 0 }, "same-source replay must deduplicate");

    const group: EditorialGroupResolutionV1 = { contractVersion: "news-editorial-relations-v1", resolverVersion: "ng5-editorial-v1", groupId: `ng5-origin-${suffix}`, operation: "ACTIVE", status: "EXACT", relationType: "REPUBLICATION", reason: "AGENCY_SYNDICATION_VERIFIED", publicationRevisionIds: [revisionIds[0], revisionIds[2]], evidence: [{ evidenceId: "agency-link", evidenceKind: "SYNDICATION_METADATA", sourceRef: "https://agency.example/metadata/event-1", observedAt: now, verified: true }] };
    const groupBefore = new Date(Date.now() - 1).toISOString();
    const grouped = await store.ingestEditorialGroup(group);
    assert.equal((await store.readEditorialGroupsAsOf(groupBefore)).filter(row => row.groupId === group.groupId).length, 0);
    const groupAfter = (await store.readEditorialGroupsAsOf(new Date(Date.now() + 2_000).toISOString())).filter(row => row.groupId === group.groupId);
    assert.equal(groupAfter.length, 2);
    assert.deepEqual(new Set(groupAfter.map(row => row.publicationRevisionId)), new Set([revisionIds[0], revisionIds[2]]));
    assert.deepEqual(await store.ingestEditorialGroup(group), { inserted: false, editorialGroupRevisionId: grouped.editorialGroupRevisionId });

    const eventLink: StructuralEventLinkResolutionV1 = { contractVersion: "news-structural-event-links-v1", resolverVersion: "ng5-event-v1", structuralEventId: `ng5-event-${suffix}`, operation: "ACTIVE", status: "REVIEW_REQUIRED", relationType: "SAME_STRUCTURAL_ORIGIN", reason: "TWO_SOURCES_REPORT_SAME_EVENT", publicationRevisionIds: [revisionIds[0], revisionIds[1]], evidence: [{ evidenceId: "cross-source-match", evidenceKind: "PUBLICATION_TEXT", sourceRef: "fixture:matching-claims", observedAt: now, verified: false }] };
    await store.ingestStructuralEventLinks(eventLink);
    const eventRead = (await store.readStructuralEventLinksAsOf(new Date(Date.now() + 2_000).toISOString())).filter(row => row.structuralEventId === eventLink.structuralEventId);
    assert.equal(eventRead.length, 2);
    assert.equal(eventRead.every(row => row.matchStatus === "REVIEW_REQUIRED"), true, "same event relation must not imply confirmation");
    assert.equal((await store.readStructuralEventLinksAsOf(new Date(Date.parse(String(eventRead[0].asKnownAt)) - 1).toISOString())).filter(row => row.structuralEventId === eventLink.structuralEventId).length, 0);
    assert.equal((await store.readEditorialGroupsAsOf(new Date(Date.now() + 2_000).toISOString())).filter(row => row.publicationRevisionId === revisionIds[1]).length, 0, "independent corroboration is not an editorial duplicate");
    assert.equal((await store.readEditorialGroupsAsOf(new Date(Date.now() + 2_000).toISOString())).filter(row => row.publicationRevisionId === revisionIds[3]).length, 0, "distinct event must not be merged");

    const correctedAt = new Date(Date.now() + 1_000).toISOString();
    await store.ingestPublicationRevision({ revision: { publicationRevisionId: `${first.publicationId}:revision:2`, publicationId: first.publicationId, revisionNo: 2, title: "Company corrects facility report", publishedAt: first.publishedAt, form: "GLOBAL_RSS_2", contentFingerprint: "corrected", contentExcerpt: "The company corrected the facility report.", sourceDocumentRef: first.originalUrl, qualityFlags: [], supersedesRevisionId: revisionIds[0] }, provenance: { provenanceId: `${first.publicationId}:provenance:2`, publicationRevisionId: `${first.publicationId}:revision:2`, sourceId: a.sourceId, providerKey: "rss", providerObservationKey: `${a.sourceId}:event-1`, originalUrl: first.originalUrl, sourceDocumentRef: first.originalUrl, retrievedAt: correctedAt, qualityFlags: [] } });
    const history = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 4_000).toISOString(), first.publicationId);
    assert.equal(history.length, 2);
    assert.equal(history[0].contentExcerpt, first.summary);
    assert.equal(history[1].contentExcerpt, "The company corrected the facility report.");

    const ambiguous: MarketCoreResolutionV1 = { contractVersion: "market-core-identity-v1", resolverVersion: "ng5-entity-v1", status: "AMBIGUOUS", selectedCandidateRef: null, reason: "SAME_NAME_MULTIPLE_ISSUERS", candidates: [
      { candidateRef: "issuer-one", targetScope: "ISSUER", relationType: "MENTION", issuerId: "issuer-one", instrumentId: null, listingId: null, evidence: [{ evidenceId: "entity-one", evidenceKind: "PUBLICATION_TEXT", sourceRef: "fixture:entity-one", observedAt: now, verified: false }] },
      { candidateRef: "issuer-two", targetScope: "ISSUER", relationType: "MENTION", issuerId: "issuer-two", instrumentId: null, listingId: null, evidence: [{ evidenceId: "entity-two", evidenceKind: "PUBLICATION_TEXT", sourceRef: "fixture:entity-two", observedAt: now, verified: false }] },
    ] };
    const entity = await store.ingestEntityResolution(revisionIds[0], ambiguous);
    const entityRows = (await store.readEntityLinksAsOf(new Date(Date.now() + 2_000).toISOString(), first.publicationId)).filter(row => row.entityLinkRevisionId === entity.entityLinkRevisionId);
    assert.equal(entityRows.length, 1);
    assert.equal(entityRows[0].identityStatus, "AMBIGUOUS");
    assert.equal(entityRows[0].issuerId, null, "ambiguous identity must not select an issuer");
    console.log(`N_G5_PROOF group=${group.groupId} event=${eventLink.structuralEventId} dedup=replay-zero correction=pit-history entity=ambiguous`);
  } finally {
    await admin.query("delete from news_core.entity_link_evidence where entity_link_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.entity_link_candidates where entity_link_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.entity_link_revisions where entity_link_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_event_link_evidence where publication_event_link_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_event_link_members where publication_event_link_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_event_link_revisions where publication_event_link_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.editorial_group_evidence where editorial_group_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.editorial_group_members where editorial_group_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.editorial_group_revisions where editorial_group_revision_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id=any($1::text[])", [revisionIds]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revisions where publication_revision_id=any($1::text[])", [revisionIds]).catch(() => undefined);
    await admin.query("delete from news_core.observations where publication_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id like $1", [`%${suffix}%`]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
