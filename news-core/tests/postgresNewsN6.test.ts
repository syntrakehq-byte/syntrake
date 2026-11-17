import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { GlobalNewsApiV1 } from "../globalNewsApi";
import { NewsConsumptionApiV1 } from "../n5Api";
import { PostgresNewsStore } from "../postgresStore";
import type { GlobalNewsItem } from "../globalNewsAdapter";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const source = (id: string, content: "METADATA_ONLY" | "PERMITTED_TEXT"): GlobalNewsRegistryEntry => ({ registryVersion: "1.0", sourceId: id, publisherId: `${id}-publisher`, publisher: id, category: "CENTRAL_BANK", geoScope: ["GLOBAL"], sourceType: "RSS_2", endpoint: `https://${id}.example.test/feed.xml`, allowedArticleHosts: [`${id}.example.test`], rightsPolicyId: `${id}-rights`, updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 50 }, storagePolicy: { content, retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${id}:global` });
const item = (sourceId: string, n: number, publishedAt: string, summary: string): GlobalNewsItem => ({ sourceId, providerKey: "rss", externalId: `${sourceId}-${n}`, publicationId: `${sourceId}-publication-${n}`, originalUrl: `https://${sourceId}.example.test/release/${n}`, title: `${sourceId} economic release ${n}`, summary, publishedAt, updatedAt: null, retrievedAt: new Date().toISOString(), publisher: `${sourceId}-publisher`, rightsPolicyId: `${sourceId}-rights`, contentFingerprint: `${sourceId}-hash-${n}`, qualityFlags: [] });

test("N-G6 PostgreSQL 17 global reads enforce rights, PIT, SQL pagination and durable consumer replay", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL }); const pool = new Pool({ connectionString: DB_URL, max: 3 }); const store = new PostgresNewsStore(pool); const suffix = randomUUID().replaceAll("-", "");
  const ecb = source(`ng6-ecb-${suffix}`, "PERMITTED_TEXT"); const fed = source(`ng6-fed-${suffix}`, "METADATA_ONLY");
  try {
    await admin.connect(); assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query("drop function if exists news_core.read_publication_revisions_as_of(timestamptz,text)");
    for (const name of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql", "20261111180000_news_core_n2b_entity_links.sql", "20261116130000_news_core_global_persistence.sql", "20261116140000_news_core_ng4_context.sql", "20261117190000_news_core_ng6_global_read_api.sql", "20261117191000_news_core_ng6_consumer_cursors.sql", "20261117192000_news_core_ng6_incremental_read.sql"]) await admin.query(await readFile(migration(name), "utf8"));
    const before = new Date().toISOString();
    await store.ingestGlobalBatch(ecb, [item(ecb.sourceId, 1, "2026-11-17T09:00:00.000Z", "permitted text")]);
    await store.ingestGlobalBatch(fed, [item(fed.sourceId, 1, "2026-11-17T10:00:00.000Z", "metadata text")]);
    await store.ingestGlobalBatch(ecb, [item(ecb.sourceId, 2, "2026-11-17T11:00:00.000Z", "second text")]);
    const n5 = new NewsConsumptionApiV1({ news: store, factual: {} as never }, "0123456789abcdef", "ng6-test-credential");
    const cursorStore = { claim: (id: string, owner: string, leaseSeconds: number) => store.claimGlobalNewsConsumer(id, owner, leaseSeconds), acknowledge: (id: string, owner: string, expected: string | null, next: string | null) => store.acknowledgeGlobalNewsConsumer(id, owner, expected, next), release: (id: string, owner: string) => store.releaseGlobalNewsConsumer(id, owner), load: (id: string) => store.loadGlobalNewsConsumerCursor(id), save: (id: string, cursor: string | null) => store.saveGlobalNewsConsumerCursor(id, cursor) };
    const api = new GlobalNewsApiV1(n5, undefined, cursorStore); const auth = { serviceId: "news_reader" as const, credential: "ng6-test-credential" };
    const beforeRows = await api.search(auth, { asOf: before }); assert.equal(beforeRows.news.data.length, 0);
    const dbNow = async () => (await admin.query<{ now: Date }>("select clock_timestamp() now")).rows[0].now.toISOString();
    const asOf = await dbNow();
    const first = await api.search(auth, { asOf, limit: 2, sort: "RECENT" }); assert.equal(first.news.data.length, 2); assert.ok(first.news.nextCursor); assert.equal(first.news.data[0].publishedAt, "2026-11-17T11:00:00.000Z");
    assert.equal(first.news.data.find(row => row.sourceDocumentRef.includes(fed.sourceId))?.contentExcerpt, null);
    const permitted = first.news.data.find(row => row.sourceDocumentRef.includes(ecb.sourceId)); assert.equal(permitted?.contentExcerpt, "permitted text");
    const next = await api.search(auth, { cursor: first.news.nextCursor, limit: 2 }); assert.equal(next.news.data.length, 1);
    const consumerId = `ng6-consumer-${suffix}`; let failed = true;
    await assert.rejects(api.consumeIncremental(auth, consumerId, { asOf, limit: 2 }, async page => { assert.equal(page.news.data.length, 2); if (failed) { failed = false; throw new Error("simulated consumer interruption"); } }));
    assert.equal(await store.loadGlobalNewsConsumerCursor(consumerId), null);
    await api.consumeIncremental(auth, consumerId, { asOf: await dbNow(), limit: 2 }, async page => assert.equal(page.news.data.length, 2));
    assert.ok(await store.loadGlobalNewsConsumerCursor(consumerId));
    await store.ingestPublicationRevision({ revision: { publicationRevisionId: `${fed.sourceId}-publication-1:revision:2`, publicationId: `${fed.sourceId}-publication-1`, revisionNo: 2, title: "fed corrected release", publishedAt: "2026-11-17T10:00:00.000Z", form: "GLOBAL_RSS_2", contentFingerprint: "fed-correction", contentExcerpt: null, sourceDocumentRef: `https://${fed.sourceId}.example.test/release/1`, qualityFlags: [], supersedesRevisionId: `${fed.sourceId}-publication-1:revision:1` }, provenance: { provenanceId: `${fed.sourceId}-publication-1:provenance:2`, publicationRevisionId: `${fed.sourceId}-publication-1:revision:2`, sourceId: fed.sourceId, providerKey: "global-rss-2", providerObservationKey: `${fed.sourceId}:${fed.sourceId}-1`, originalUrl: `https://${fed.sourceId}.example.test/release/1`, sourceDocumentRef: `https://${fed.sourceId}.example.test/release/1`, retrievedAt: await dbNow(), qualityFlags: [] } });
    const recovered = await api.consumeIncremental(auth, consumerId, { asOf: await dbNow(), limit: 2 }, async page => { assert.equal(page.news.data.length, 2); assert.ok(page.news.data.some(row => row.title === "fed corrected release")); });
    assert.equal(recovered.news.data.length, 2); assert.notEqual(await store.loadGlobalNewsConsumerCursor(consumerId), null);
    const empty = await api.consumeIncremental(auth, consumerId, { asOf: await dbNow(), limit: 2 }, async page => assert.equal(page.news.data.length, 0));
    assert.equal(empty.news.data.length, 0); const preservedCursor = await store.loadGlobalNewsConsumerCursor(consumerId); assert.notEqual(preservedCursor, null);
    await store.ingestGlobalBatch(ecb, [item(ecb.sourceId, 3, "2026-11-17T12:00:00.000Z", "new after exhaustion")]);
    const discovered = await api.consumeIncremental(auth, consumerId, { asOf: await dbNow(), limit: 2 }, async page => assert.equal(page.news.data.length, 1));
    assert.equal(discovered.news.data[0].title, `${ecb.sourceId} economic release 3`); assert.notEqual(await store.loadGlobalNewsConsumerCursor(consumerId), preservedCursor);
    const expiredOwner = await store.claimGlobalNewsConsumer(consumerId, "expired-owner", 0);
    const activeOwner = await store.claimGlobalNewsConsumer(consumerId, "active-owner", 60);
    await assert.rejects(store.acknowledgeGlobalNewsConsumer(consumerId, "expired-owner", expiredOwner, "forged"), /FENCE_LOST/);
    await store.releaseGlobalNewsConsumer(consumerId, "active-owner");
  } finally { await Promise.all([store.close(), admin.end()]); }
});
