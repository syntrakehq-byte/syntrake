import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "pg";
import { readJointMarketNewsPitV1 } from "../marketNewsPitAdapter";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const MARKET_ROOT = process.env.N0_MARKET_CORE_CHECKOUT;
const sql = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);

test("T33: real Market and News readers share one PostgreSQL PIT cutoff", { skip: !DB_URL || !MARKET_ROOT ? "PG17 and the real Market Core checkout are required" : false }, async () => {
  assert.ok(DB_URL && MARKET_ROOT);
  const databaseName = `n0_t33_${randomUUID().replaceAll("-", "")}`;
  const provisioner = new Client({ connectionString: DB_URL }); await provisioner.connect();
  await provisioner.query(`create database "${databaseName}"`);
  const dbUrl = new URL(DB_URL); dbUrl.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: dbUrl.toString() }); await client.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const old = "2026-11-15T09:30:00.000Z"; const ingested = "2026-11-15T10:00:00.000Z"; const newsOldKnown = "2026-11-15T10:05:00.000Z"; const future = "2026-11-15T11:00:00.000Z"; const beforeFuture = "2026-11-15T10:30:00.000Z"; const afterFuture = "2026-11-15T11:30:00.000Z";
  const marketSql = path.join(MARKET_ROOT, "supabase", "release-candidates", "20261031150000_r3b_market_core_candidate.sql");
  try {
    await client.query(await readFile(marketSql, "utf8"));
    await client.query(await readFile(sql("20261111150000_news_core_postgres_n1.sql"), "utf8"));
    await client.query(await readFile(sql("20261111170000_news_core_n2a_revisions.sql"), "utf8"));
    await client.query(await readFile(sql("20261112120000_news_core_n3c_factual_persistence.sql"), "utf8"));
    await client.query(await readFile(sql("20261112150000_news_core_n5_read_api.sql"), "utf8"));

    const provider = randomUUID(), policy = randomUUID(), issuer = randomUUID(), instrument = randomUUID(), listing = randomUUID(), observation = randomUUID(), marketRev1 = randomUUID(), marketRev2 = randomUUID();
    await client.query("insert into market_core.providers values ($1,'N0_T33',$2)", [provider, "ACTIVE"]);
    await client.query("insert into market_core.license_policies values ($1,'N0_T33',true,true,null)", [policy]);
    await client.query("insert into market_core.issuers values ($1,'N0 T33 Issuer')", [issuer]);
    await client.query("insert into market_core.instruments values ($1,$2,'EQUITY','USD')", [instrument, issuer]);
    await client.query("insert into market_core.listings values ($1,$2,'XNAS','USD','N0T33','2020-01-01',null)", [listing, instrument]);
    await client.query("insert into market_core.market_observations values ($1,$2,$3,$4,'1day','2026-11-15','UTC','none',$5)", [observation, listing, provider, policy, old]);
    await client.query("insert into market_core.market_observation_revisions values ($1,$2,$3,null,$4,100,110,90,105,100,$5,$6,$7,null,'{}')", [marketRev1, observation, listing, "a".repeat(64), old, ingested, old]);
    await client.query("insert into market_core.market_observation_revisions values ($1,$2,$3,$4,$5,100,120,90,115,100,$6,$7,$8,null,'{}')", [marketRev2, observation, listing, marketRev1, "b".repeat(64), future, future, future]);

    const source = `source-${suffix}`, publication = `publication-${suffix}`, publicationRevision = `${publication}:revision:1`, event = `event-${suffix}`, fact1 = `${event}:revision:1`, fact2 = `${event}:revision:2`;
    await client.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'N0_T33','SEC_EDGAR')", [source]);
    const frontier = (await client.query<{ frontier_id: number }>("insert into news_core.visibility_frontiers(published_at) values ($1) returning frontier_id", [old])).rows[0].frontier_id;
    await client.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$1,'https://www.sec.gov/t33','T33 fixture',$4,$5,$6,'8-K','COMMITTED',$7)", [publication, source, `origin-${suffix}`, old, ingested, newsOldKnown, frontier]);
    await client.query("insert into news_core.publication_revisions(publication_revision_id,publication_id,revision_no,title,published_at,form,content_fingerprint,source_document_ref,quality_flags,supersedes_revision_id,ingested_at,as_known_at,visibility_state,visibility_frontier_id) values ($1,$2,1,'T33 fixture',null,'8-K','a','https://www.sec.gov/t33','[]'::jsonb,null,$3,$4,'COMMITTED',$5)", [publicationRevision, publication, ingested, newsOldKnown, frontier]);
    await client.query("insert into news_core.fact_events values ($1,$1,'news-fact-taxonomy-v1','LEGAL_REGULATORY')", [event]);
    await client.query("insert into news_core.fact_revisions(fact_revision_id,fact_event_id,revision_no,logical_fingerprint,rule_set_version,claim_type,statement,confirmation_status,lifecycle_status,polarity,focal_claim_key,publication_revision_id,as_known_at,committed_at,pit_visibility_state,finalized_at) values ($1,$2,1,'c','deterministic-rule-v1','EVENT_OCCURRENCE','old factual row','REPORTED','ACTIVE','AFFIRMATIVE','claim',$3,$4,$4,'DURABLE',$4)", [fact1, event, publicationRevision, newsOldKnown]);
    await client.query("insert into news_core.fact_revisions(fact_revision_id,fact_event_id,revision_no,logical_fingerprint,rule_set_version,claim_type,statement,confirmation_status,lifecycle_status,polarity,focal_claim_key,publication_revision_id,as_known_at,committed_at,pit_visibility_state,finalized_at,supersedes_revision_id) values ($1,$2,2,'d','deterministic-rule-v1','EVENT_CORRECTION','future factual row','REPORTED','CORRECTED','AFFIRMATIVE','claim',$3,$4,$4,'DURABLE',$4,$5)", [fact2, event, publicationRevision, future, fact1]);

    const before = await readJointMarketNewsPitV1(client, listing, beforeFuture);
    assert.deepEqual(before.market.revisionIds, [marketRev1]);
    assert.deepEqual(before.news.revisionIds, [fact1]);
    const beforeAny = await readJointMarketNewsPitV1(client, listing, "2026-11-15T08:00:00.000Z");
    assert.deepEqual(beforeAny.market.revisionIds, []);
    assert.deepEqual(beforeAny.news.revisionIds, []);
    const after = await readJointMarketNewsPitV1(client, listing, afterFuture);
    assert.deepEqual(after.market.revisionIds, [marketRev2]);
    assert.deepEqual(after.news.revisionIds, [fact2]);
    assert.equal(before.market.contract, "market-data-envelope-v1"); assert.equal(before.news.contract, "news-envelope-v1");
    console.log(`N0_T33_JOINT_PIT_PROOF pg17=true cutoffBefore=${before.market.revisionIds[0]}:${before.news.revisionIds[0]} cutoffAfter=${after.market.revisionIds[0]}:${after.news.revisionIds[0]} lookaheadRejected=true contractsSeparate=true`);
  } finally { await client.end(); await provisioner.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]).catch(() => undefined); await provisioner.query(`drop database if exists "${databaseName}"`); await provisioner.end(); }
});
