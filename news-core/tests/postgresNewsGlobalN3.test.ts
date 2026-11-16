import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import type { GlobalNewsItem } from "../globalNewsAdapter";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const source = (id: string, host: string): GlobalNewsRegistryEntry => ({ registryVersion: "1.0", sourceId: id, publisherId: `${id}-publisher`, publisher: id, category: "CENTRAL_BANK", geoScope: ["EU"], sourceType: "RSS_2", endpoint: `https://${host}/feed.xml`, allowedArticleHosts: [host], rightsPolicyId: "official-metadata-v1", updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 50 }, storagePolicy: { content: "METADATA_ONLY", retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${id}-press` });
const item = (sourceId: string, host: string, suffix: string, retrievedAt: string): GlobalNewsItem => ({ sourceId, providerKey: "rss", externalId: `${sourceId}-${suffix}`, publicationId: `${sourceId}-${suffix}-publication`, originalUrl: `https://${host}/release/${suffix}`, title: `${sourceId} release ${suffix}`, summary: null, publishedAt: "2026-11-16T10:00:00.000Z", updatedAt: null, retrievedAt, publisher: sourceId, rightsPolicyId: "official-metadata-v1", contentFingerprint: `${sourceId}-${suffix}-fingerprint`, qualityFlags: [] });

test("N-G3 persists three global sources with replay, independent checkpoints, revisions and PIT", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const pool = new Pool({ connectionString: DB_URL, max: 4 });
  const store = new PostgresNewsStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const now = new Date().toISOString();
  const ecb = source(`ecb-${suffix}`, "www.ecb.europa.eu");
  const fed = source(`fed-${suffix}`, "www.federalreserve.gov");
  const sec = source(`sec-${suffix}`, "www.sec.gov");
  const ecbItem = item(ecb.sourceId, ecb.allowedArticleHosts[0], "one", now);
  try {
    const client = await pool.connect();
    try {
      const version = await client.query<{ v: string }>("select current_setting('server_version') v");
      assert.match(version.rows[0].v, /^17\./);
      for (const name of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql", "20261116130000_news_core_global_persistence.sql"]) await client.query(await readFile(migration(name), "utf8"));
    } finally { client.release(); }
    const before = new Date().toISOString();
    for (const [entry, suffixPart] of [[ecb, "one"], [fed, "one"], [sec, "one"]] as const) await store.ingestGlobalBatch(entry, [item(entry.sourceId, entry.allowedArticleHosts[0], suffixPart, now)]);
    const replay = await store.ingestGlobalBatch(ecb, [ecbItem]);
    assert.deepEqual(replay, { insertedPublications: 0, insertedObservations: 0 });
    assert.equal((await store.readAsOf(before)).filter(row => row.sourceId.endsWith(suffix)).length, 0);
    const visible = await store.readAsOf(new Date(Date.now() + 2_000).toISOString());
    assert.equal(visible.filter(row => row.sourceId.endsWith(suffix)).length, 3);
    assert.ok(await store.getCheckpoint(ecb.checkpointScope));
    assert.ok(await store.getCheckpoint(fed.checkpointScope));
    assert.ok(await store.getCheckpoint(sec.checkpointScope));
    const revisedAt = new Date(Date.now() + 2_000).toISOString();
    const revision = await store.ingestPublicationRevision({ revision: { publicationRevisionId: `${ecbItem.publicationId}:revision:2`, publicationId: ecbItem.publicationId, revisionNo: 2, title: "ECB corrected release", publishedAt: ecbItem.publishedAt, form: "GLOBAL_RSS_2", contentFingerprint: "corrected-fingerprint", sourceDocumentRef: ecbItem.originalUrl, qualityFlags: [], supersedesRevisionId: `${ecbItem.publicationId}:revision:1` }, provenance: { provenanceId: `${ecbItem.publicationId}:provenance:2`, publicationRevisionId: `${ecbItem.publicationId}:revision:2`, sourceId: ecb.sourceId, providerKey: "rss", providerObservationKey: `${ecb.sourceId}:one`, originalUrl: ecbItem.originalUrl, sourceDocumentRef: ecbItem.originalUrl, retrievedAt: revisedAt, qualityFlags: [] } });
    assert.equal(revision.inserted, true);
    const history = await store.readPublicationRevisionsAsOf(new Date(Date.now() + 4_000).toISOString(), ecbItem.publicationId);
    assert.equal(history.length, 2);
    assert.equal(history[1].title, "ECB corrected release");
  } finally { await store.close(); }
});
