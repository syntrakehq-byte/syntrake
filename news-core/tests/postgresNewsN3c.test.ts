import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresFactualStore, type PersistFactualInputV1 } from "../factualPersistence";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);

test("News Core N3-C append-only factual persistence, PIT, idempotence and security", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 8 });
  const store = new PostgresFactualStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const sourceId = `n3c-source-${suffix}`;
  const publicationId = `n3c-publication-${suffix}`;
  const publicationRevisionId = `${publicationId}:revision:1`;
  const knownOne = "2026-01-01T00:00:00.000Z";
  const knownTwo = "2026-01-02T00:00:00.000Z";
  const sourceDocumentRef = `https://www.sec.gov/Archives/edgar/data/1/n3c-${suffix}.htm`;
  type Life = "ACTIVE" | "CORRECTED" | "RETRACTED";
  const proposal = (statement: string, asKnownAt: string, lifecycleStatus: Life = "ACTIVE") => ({ contractVersion: "news-fact-classification-v1" as const, taxonomyVersion: "news-fact-taxonomy-v1" as const, ruleSetVersion: "deterministic-rule-v1" as const, category: "LEGAL_REGULATORY" as const, claimType: "EVENT_OCCURRENCE" as const, statement, subjectRef: null, objectRef: null, occurredAt: knownOne, scheduledFor: null, confirmationStatus: "REPORTED" as const, lifecycleStatus, polarity: "AFFIRMATIVE" as const, publicationRevisionId, evidenceIds: ["evidence-n3a"], evidenceRefs: [{ evidenceId: "evidence-n3a", sourceDocumentRef, contentLocator: "body:p1" }], dependencyAsKnownAt: asKnownAt, proposedAt: asKnownAt, ruleId: "rule-legal-regulatory", justification: "structured fixture", qualityFlags: [], inputFingerprint: "n3a-input" });
  const evidence = (asKnownAt: string) => [{ evidenceId: "evidence-n3a", evidenceKind: "N3A_PROPOSAL" as const, claimKey: "claim-focal", publicationRevisionId, sourceDocumentRef, contentLocator: "body:p1", provenanceRef: `prov:${suffix}`, asKnownAt }];
  const input = (statement: string, asKnownAt: string, lifecycleStatus: Life = "ACTIVE"): PersistFactualInputV1 => ({ canonicalClaimId: `canonical:${suffix}`, proposal: proposal(statement, asKnownAt, lifecycleStatus), corroboration: { contractVersion: "news-evidence-corroboration-v1", ruleSetVersion: "evidence-corroboration-rule-v1", claimKey: "claim-focal", canonicalClaimId: `canonical:${suffix}`, confirmationStatus: "REPORTED", lifecycleStatus, polarity: "AFFIRMATIVE", supportingOriginIds: ["origin-1"], contestingOriginIds: [], countedEditorialGroups: [], independence: "UNKNOWN", reasons: ["fixture"], evaluatedAt: asKnownAt, fingerprint: `corroboration:${statement}` }, evidence: evidence(asKnownAt), dependencies: [{ dependencyType: "N2_PUBLICATION_REVISION", dependencyRef: publicationRevisionId, asKnownAt }, { dependencyType: "N3A_PROPOSAL", dependencyRef: `proposal:${statement}`, asKnownAt }, { dependencyType: "N3B_EVALUATION", dependencyRef: `evaluation:${statement}`, asKnownAt }] });
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(migration("20261111150000_news_core_postgres_n1.sql"), "utf8"));
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n3c-fixture','SEC_EDGAR')", [sourceId]);
    const frontier = await admin.query<{ frontier_id: string }>("insert into news_core.visibility_frontiers(published_at) values ($1) returning frontier_id", [knownOne]);
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,'N3C fixture',$6,$6,$6,'8-K','COMMITTED',$7)", [publicationId, sourceId, `origin:${suffix}`, publicationId, sourceDocumentRef, knownOne, frontier.rows[0].frontier_id]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n3c-fixture',$1,$2,$3,$3,'n3c','COMMITTED',$4)", [`observation:${suffix}`, publicationId, knownOne, frontier.rows[0].frontier_id]);
    await admin.query(await readFile(migration("20261111170000_news_core_n2a_revisions.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112120000_news_core_n3c_factual_persistence.sql"), "utf8"));
    const first = await store.persist(input("The company was fined.", knownOne));
    assert.equal(first.inserted, true);
    assert.equal((await store.readAsOf("2026-01-01T00:00:01.000Z")).length, 1);
    assert.equal((await store.readAsOf("2025-12-31T23:59:59.000Z")).length, 0);
    assert.deepEqual(await store.persist(input("The company was fined.", knownOne)), { ...first, inserted: false });
    const concurrent = await Promise.all([store.persist(input("The company was fined.", knownOne)), store.persist(input("The company was fined.", knownOne))]);
    assert.equal(concurrent.filter(result => result.inserted).length, 0);
    const corrected = await store.persist({ ...input("The company was fined, later corrected.", knownTwo, "CORRECTED"), relation: { relatedRevisionId: first.factRevisionId!, relationType: "CORRECTS" } });
    assert.equal(corrected.inserted, true);
    assert.equal((await store.readAsOf("2026-01-01T12:00:00.000Z"))[0].lifecycleStatus, "ACTIVE");
    assert.equal((await store.readAsOf("2026-01-02T00:00:01.000Z"))[0].lifecycleStatus, "CORRECTED");
    await assert.rejects(store.persist({ ...input("future dependency", knownOne), dependencies: [{ dependencyType: "N3B_EVALUATION", dependencyRef: "future", asKnownAt: knownTwo }] }), /NEWS_FACT_FUTURE_DEPENDENCY/);
    await assert.rejects(store.persist({ ...input("invalid evidence", knownOne), evidence: [{ ...evidence(knownOne)[0], sourceDocumentRef: "https://wrong.example/document" }] }), /NEWS_FACT_EVIDENCE_REFERENCE_INVALID/);
    await assert.rejects(store.persist(input("rollback probe", knownTwo), "before-commit"), /INJECTED_FAILURE_BEFORE_COMMIT/);
    assert.equal((await admin.query<{ n: number }>("select count(*)::int n from news_core.fact_revisions where fact_event_id=$1", [first.factEventId])).rows[0].n, 2);
    await assert.rejects(admin.query("update news_core.fact_revisions set statement='tampered' where fact_revision_id=$1", [first.factRevisionId]), /NEWS_FACT_HISTORY_APPEND_ONLY/);
    const security = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='news_core' and c.relname='fact_revisions'");
    assert.deepEqual(security.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
  } finally { await Promise.all([store.close(), admin.end()]); }
});
