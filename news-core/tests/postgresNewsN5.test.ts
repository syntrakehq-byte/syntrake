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
  const suffix = randomUUID().replaceAll("-", ""); const sourceId = `n5-source-${suffix}`; const publicationId = `n5-publication-${suffix}`; const revisionId = `${publicationId}:revision:1`; const eventId = `n5-event-${suffix}`; const factRevisionId = `${eventId}:revision:1`; const document = `https://www.sec.gov/Archives/edgar/data/1/n5-${suffix}.htm`; const known = new Date(Date.now() - 2000).toISOString();
  try {
    await admin.connect(); assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(migration("20261111150000_news_core_postgres_n1.sql"), "utf8"));
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n5-fixture','SEC_EDGAR')", [sourceId]);
    const frontier = await admin.query<{ frontier_id: string }>("insert into news_core.visibility_frontiers(published_at) values ($1) returning frontier_id", [known]);
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,'N5 official fixture',$6,$6,$6,'8-K','COMMITTED',$7)", [publicationId, sourceId, `origin:${suffix}`, publicationId, document, known, frontier.rows[0].frontier_id]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n5-fixture',$1,$2,$3,$3,'n5','COMMITTED',$4)", [`obs:${suffix}`, publicationId, known, frontier.rows[0].frontier_id]);
    await admin.query(await readFile(migration("20261111170000_news_core_n2a_revisions.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112120000_news_core_n3c_factual_persistence.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112150000_news_core_n5_read_api.sql"), "utf8"));
    await admin.query("insert into news_core.fact_events(fact_event_id,canonical_claim_id,taxonomy_version,category) values ($1,$2,'news-fact-taxonomy-v1','LEGAL_REGULATORY')", [eventId, `claim:${suffix}`]);
    await admin.query("insert into news_core.fact_revisions(fact_revision_id,fact_event_id,revision_no,logical_fingerprint,rule_set_version,claim_type,statement,occurred_at,confirmation_status,lifecycle_status,polarity,focal_claim_key,publication_revision_id) values ($1,$2,1,$3,'deterministic-rule-v1','EVENT_OCCURRENCE','The company was fined.',null,'REPORTED','ACTIVE','AFFIRMATIVE',$4,$5)", [factRevisionId, eventId, `fp:${suffix}`, `claim-key:${suffix}`, revisionId]);
    await admin.query("insert into news_core.fact_revision_evidence values ($1,$2,'N3A_PROPOSAL',$3,$4,$5,'body:p1',$6,$7)", [factRevisionId, `evidence:${suffix}`, `claim-key:${suffix}`, revisionId, document, `prov:${suffix}`, known]);
    await admin.query("set role news_factual_writer"); await admin.query("select * from news_core.finalize_fact_revision($1)", [factRevisionId]); await admin.query("reset role");
    const committed = (await admin.query<{ committed_at: Date }>("select committed_at from news_core.fact_revisions where fact_revision_id=$1", [factRevisionId])).rows[0].committed_at;
    const visibleAsOf = new Date(committed.valueOf() + 1).toISOString();
    const api = new NewsConsumptionApiV1({ news, factual }, "0123456789abcdef", "n5-test-credential"); const auth = { serviceId: "news_reader" as const, credential: "n5-test-credential" };
    const discovered = await api.discoverNews(auth, { asOf: visibleAsOf, filters: { sourceIds: [sourceId], forms: ["8-K"] } }); assert.ok(discovered.data.some(row => row.publicationRevisionId === revisionId));
    const events = await api.getNewsEvents(auth, { asOf: visibleAsOf, targets: [eventId] }); const eventRow = events.data.find(row => row.factRevisionId === factRevisionId); assert.ok(eventRow); assert.equal(eventRow.confirmationStatus, "REPORTED");
    const evidence = await api.getEventEvidence(auth, { eventId, asOf: visibleAsOf }); assert.equal(evidence.data[0].sourceDocumentRef, document);
    const history = await api.getNewsHistory(auth, { targets: [eventId], asOf: visibleAsOf }); assert.equal(history.data.length, 1);
    const before = await api.getNewsEvents(auth, { asOf: new Date(Date.parse(known) - 1000).toISOString() }); assert.equal(before.data.some(row => row.factRevisionId === factRevisionId), false);
    await admin.query("set role news_service"); await assert.rejects(admin.query("select * from news_core.fact_revisions"), /permission denied/); await admin.query("reset role");
  } finally { await admin.query("reset role").catch(() => undefined); await Promise.all([news.close(), factual.close(), admin.end()]); }
});
