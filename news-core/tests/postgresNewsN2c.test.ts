import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import type { EditorialGroupResolutionV1, StructuralEventLinkResolutionV1 } from "../editorialRelations";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const n1 = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const n2a = new URL("../../supabase/migrations/20261111170000_news_core_n2a_revisions.sql", import.meta.url);
const n2b = new URL("../../supabase/migrations/20261111180000_news_core_n2b_entity_links.sql", import.meta.url);
const n2c = new URL("../../supabase/migrations/20261112100000_news_core_n2c_editorial_relations.sql", import.meta.url);

test("News Core N2-C conservative editorial equivalence, structural many-to-many and PIT", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 8 });
  const store = new PostgresNewsStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const sourceId = `n2c-source-${suffix}`;
  const publicationIds = [1, 2, 3].map(n => `n2c-publication-${n}-${suffix}`);
  const revisionIds = publicationIds.map(id => `${id}:revision:1`);
  const scope = `n2c-scope-${suffix}`;
  const now = new Date().toISOString();
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(n1, "utf8"));
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n2c-fixture','SEC_EDGAR')", [sourceId]);
    for (const [index, publicationId] of publicationIds.entries()) {
      const frontier = await admin.query<{ frontier_id: string; published_at: Date }>("insert into news_core.visibility_frontiers default values returning frontier_id,published_at");
      await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,'8-K','COMMITTED',$9)", [publicationId, sourceId, `origin-${publicationId}`, publicationId, `https://www.sec.gov/Archives/edgar/data/1/n2c-${index}.htm`, "Same editorial title", now, frontier.rows[0].published_at, frontier.rows[0].frontier_id]);
      await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n2c-fixture',$2,$3,$4,$4,'n2c','COMMITTED',$5)", [`observation-${publicationId}`, `observation-${publicationId}`, publicationId, now, frontier.rows[0].frontier_id]);
    }
    await admin.query(await readFile(n2a, "utf8"));
    await admin.query(await readFile(n2b, "utf8"));
    await admin.query(await readFile(n2c, "utf8"));

    const exactGroup: EditorialGroupResolutionV1 = {
      contractVersion: "news-editorial-relations-v1", resolverVersion: "fixture-editorial-v1", groupId: `origin-group-${suffix}`, operation: "ACTIVE", status: "EXACT", relationType: "REPUBLICATION", reason: "SYNDICATION_METADATA_MATCH",
      publicationRevisionIds: revisionIds.slice(0, 2), evidence: [{ evidenceId: "syndication-proof", evidenceKind: "SYNDICATION_METADATA", sourceRef: "https://publisher.example/syndication/1", observedAt: now, verified: true }],
    };
    const exact = await store.ingestEditorialGroup(exactGroup);
    assert.equal(exact.inserted, true);
    const afterExact = await store.readEditorialGroupsAsOf(new Date(Date.now() + 10_000).toISOString());
    assert.equal(afterExact.filter(row => row.groupId === exactGroup.groupId).length, 2);
    const beforeExact = new Date(Math.min(...afterExact.filter(row => row.groupId === exactGroup.groupId).map(row => Date.parse(String(row.asKnownAt)))) - 1).toISOString();
    assert.equal((await store.readEditorialGroupsAsOf(beforeExact)).filter(row => row.groupId === exactGroup.groupId).length, 0);
    assert.deepEqual(await store.ingestEditorialGroup(exactGroup), { inserted: false, editorialGroupRevisionId: exact.editorialGroupRevisionId });

    const ambiguousGroup: EditorialGroupResolutionV1 = {
      contractVersion: "news-editorial-relations-v1", resolverVersion: "fixture-editorial-v1", groupId: `ambiguous-group-${suffix}`, operation: "ACTIVE", status: "AMBIGUOUS", relationType: "POSSIBLE_DUPLICATE", reason: "SAME_TITLE_DIFFERENT_ORIGIN",
      publicationRevisionIds: revisionIds.slice(1), evidence: [{ evidenceId: "title-only", evidenceKind: "PUBLICATION_TEXT", sourceRef: "fixture:title", observedAt: now, verified: false }],
    };
    await store.ingestEditorialGroup(ambiguousGroup);
    const ambiguousRead = (await store.readEditorialGroupsAsOf(new Date(Date.now() + 10_000).toISOString())).filter(row => row.groupId === ambiguousGroup.groupId);
    assert.equal(ambiguousRead.length, 2);
    assert.deepEqual(new Set(ambiguousRead.map(row => row.matchStatus)), new Set(["AMBIGUOUS"]));
    await assert.rejects(store.ingestEditorialGroup({ ...ambiguousGroup, status: "EXACT", relationType: "POSSIBLE_DUPLICATE", reason: "UNSUPPORTED_EXACT" }), /NEWS_EDITORIAL_EXACT_UNSUPPORTED/);

    const eventOne: StructuralEventLinkResolutionV1 = {
      contractVersion: "news-structural-event-links-v1", resolverVersion: "fixture-event-v1", structuralEventId: `event-one-${suffix}`, operation: "ACTIVE", status: "REVIEW_REQUIRED", relationType: "RELATED", reason: "STRUCTURAL_RELATION_REVIEW",
      publicationRevisionIds: revisionIds.slice(0, 2), evidence: [{ evidenceId: "event-proof-one", evidenceKind: "PROVIDER_SOURCE", sourceRef: "provider:event-one", observedAt: now, verified: true }],
    };
    const eventTwo: StructuralEventLinkResolutionV1 = { ...eventOne, structuralEventId: `event-two-${suffix}`, publicationRevisionIds: [revisionIds[0], revisionIds[2]], evidence: [{ evidenceId: "event-proof-two", evidenceKind: "PROVIDER_SOURCE", sourceRef: "provider:event-two", observedAt: now, verified: true }] };
    await store.ingestStructuralEventLinks(eventOne);
    await store.ingestStructuralEventLinks(eventTwo);
    const eventRead = await store.readStructuralEventLinksAsOf(new Date(Date.now() + 10_000).toISOString());
    assert.equal(eventRead.filter(row => row.publicationRevisionId === revisionIds[0]).length, 2, "one publication may relate to multiple structural events");

    const separated: EditorialGroupResolutionV1 = { ...exactGroup, operation: "SEPARATED", status: "REVIEW_REQUIRED", reason: "ORIGIN_CONFLICT_REQUIRES_SEPARATION", evidence: [{ evidenceId: "separation-proof", evidenceKind: "OFFICIAL_SOURCE", sourceRef: "https://publisher.example/correction/1", observedAt: now, verified: true }] };
    await store.ingestEditorialGroup(separated);
    assert.equal((await store.readEditorialGroupsAsOf(new Date(Date.now() + 10_000).toISOString())).filter(row => row.groupId === exactGroup.groupId).length, 0);
    assert.equal((await store.readEditorialGroupHistoryAsOf(new Date(Date.now() + 10_000).toISOString())).filter(row => row.groupId === exactGroup.groupId).length, 4);

    const crashEvent: StructuralEventLinkResolutionV1 = { ...eventOne, structuralEventId: `event-crash-${suffix}`, reason: "RECOVERY_PROBE" };
    await assert.rejects(store.ingestStructuralEventLinks(crashEvent, { failurePoint: "after-commit-before-finalize" }), /INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE/);
    assert.equal((await admin.query("select count(*)::int n from news_core.publication_event_link_revisions where structural_event_id=$1 and visibility_state='PENDING'", [crashEvent.structuralEventId])).rows[0].n, 1);
    await store.getCheckpoint(scope);
    assert.equal((await store.readStructuralEventLinksAsOf(new Date(Date.now() + 10_000).toISOString())).filter(row => row.structuralEventId === crashEvent.structuralEventId).length, 2);

    await admin.query("set role news_reader");
    await assert.rejects(admin.query("select * from news_core.editorial_group_revisions"), /permission denied/);
    const readerRows = await admin.query("select * from news_core.read_editorial_groups_as_of($1::timestamptz,$2::text)", [new Date(Date.now() + 10_000).toISOString(), revisionIds[0]]);
    assert.equal(readerRows.rows.length, 0, "separated effective group is not exposed to reader");
    await admin.query("reset role");
  } finally {
    await admin.query("reset role").catch(() => undefined);
    await admin.query("delete from news_core.publication_event_link_evidence where publication_event_link_revision_id in (select publication_event_link_revision_id from news_core.publication_event_link_revisions where structural_event_id like $1)", [`%${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_event_link_members where publication_event_link_revision_id in (select publication_event_link_revision_id from news_core.publication_event_link_revisions where structural_event_id like $1)", [`%${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_event_link_revisions where structural_event_id like $1", [`%${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.editorial_group_evidence where editorial_group_revision_id in (select editorial_group_revision_id from news_core.editorial_group_revisions where group_id like $1)", [`%${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.editorial_group_members where editorial_group_revision_id in (select editorial_group_revision_id from news_core.editorial_group_revisions where group_id like $1)", [`%${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.editorial_group_revisions where group_id like $1", [`%${suffix}`]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id=any($1::text[])", [revisionIds]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revisions where publication_revision_id=any($1::text[])", [revisionIds]).catch(() => undefined);
    await admin.query("delete from news_core.observations where publication_id=any($1::text[])", [publicationIds]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id=any($1::text[])", [publicationIds]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id=$1", [sourceId]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
