import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { DeterministicFactClassifierV1, excerptHashV1, type ClassificationInputV1, type ClassificationProposalV1 } from "../factualClassification";
import { claimKeyV1, DeterministicEvidenceCorroboratorV1, type CorroborationInputV1 } from "../evidenceCorroboration";
import { factualLogicalFingerprintV1, PostgresFactualStore, type PersistFactualInputV1 } from "../factualPersistence";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

test("News Core N3-D end-to-end circuit, roles, PIT and pending revision recovery", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 4 });
  const readerPool = new Pool({ connectionString: DB_URL, max: 2 });
  const store = new PostgresFactualStore(pool, "news_factual_writer");
  const reader = new PostgresFactualStore(readerPool, "news_service");
  const suffix = randomUUID().replaceAll("-", "");
  const sourceId = `n3d-source-${suffix}`;
  const publicationId = `n3d-publication-${suffix}`;
  const publicationRevisionId = `${publicationId}:revision:1`;
  const sourceDocumentRef = `https://www.sec.gov/Archives/edgar/data/1/n3d-${suffix}.htm`;
  const base = Date.now() - 5000;
  const at = (offset: number) => new Date(base + offset).toISOString();
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(migration("20261111150000_news_core_postgres_n1.sql"), "utf8"));
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n3d-fixture','SEC_EDGAR')", [sourceId]);
    const frontier = await admin.query<{ frontier_id: string }>("insert into news_core.visibility_frontiers(published_at) values ($1) returning frontier_id", [at(0)]);
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,'N3-D committed source',$6,$6,$6,'8-K','COMMITTED',$7)", [publicationId, sourceId, `origin:${suffix}`, publicationId, sourceDocumentRef, at(0), frontier.rows[0].frontier_id]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n3d-fixture',$1,$2,$3,$3,'n3d','COMMITTED',$4)", [`observation:${suffix}`, publicationId, at(0), frontier.rows[0].frontier_id]);
    await admin.query(await readFile(migration("20261111170000_news_core_n2a_revisions.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112120000_news_core_n3c_factual_persistence.sql"), "utf8"));
    await admin.query(await readFile(migration("20261112170000_news_core_n3c_factual_writer_boundary.sql"), "utf8"));

    const excerpt = "The company was fined.";
    const classificationInput: ClassificationInputV1 = {
      contractVersion: "news-fact-classification-v1", taxonomyVersion: "news-fact-taxonomy-v1", ruleSetVersion: "deterministic-rule-v1",
      publicationRevision: { publicationRevisionId, publicationId, revisionNo: 1, title: "N3-D committed source", form: "8-K", sourceDocumentRef, contentFingerprint: sha256(excerpt), publishedAt: at(0), ingestedAt: at(0), asKnownAt: at(0), qualityFlags: [], visibilityState: "COMMITTED" },
      evidence: [{ evidenceId: "n3d-excerpt", publicationRevisionId, kind: "DOCUMENT_EXCERPT", sourceDocumentRef, contentLocator: "body:p1", excerpt, excerptHash: excerptHashV1(excerpt), hashSemantics: "LOCAL_CONTENT_HASH_ONLY", structuredField: null, structuredValue: null, structuredAuthority: null, observedAt: at(0), retrievedAt: at(100), asKnownAt: at(200), provenanceRef: `prov:${suffix}` }],
      proposedAt: at(300),
    };
    const classification = new DeterministicFactClassifierV1().classify(classificationInput);
    assert.equal(classification.proposals.length, 1);
    const proposal = classification.proposals[0] as ClassificationProposalV1;
    assert.equal(proposal.category, "LEGAL_REGULATORY");
    assert.equal(proposal.claimType, "EVENT_OCCURRENCE");
    assert.equal(proposal.occurredAt, null);

    const claimKey = claimKeyV1(proposal);
    const corroborationInput: CorroborationInputV1 = {
      contractVersion: "news-evidence-corroboration-v1", ruleSetVersion: "evidence-corroboration-rule-v1", proposal, claimKey,
      claimIdentities: [{ claimKey, canonicalClaimId: `canonical:${suffix}`, publicationRevisionId, statementFingerprint: sha256(proposal.statement), asKnownAt: at(300) }],
      claimEquivalences: [], cutoffAsKnownAt: at(300), evaluatedAt: at(400),
      evidence: [{ evidenceId: "n3d-evidence", claimKey, originId: "n3d-origin", sourceDocumentRef, publicationRevisionId, provenanceRef: `prov:${suffix}`, contentLocator: "body:p1", statementHash: sha256(proposal.statement), support: "SUPPORTS", asKnownAt: at(200), availableAsKnownAt: at(200), proposalEvidenceId: "n3d-excerpt" }],
      verificationProofs: [],
      origins: [{ originId: "n3d-origin", sourceDocumentRef, publicationRevisionId, publisherRef: "n3d-fixture", editorialGroupRef: null, sourceKind: "SECONDARY", provenanceRef: `prov:${suffix}`, availableAsKnownAt: at(200), competence: [{ claimKey, status: "UNKNOWN", basis: "IDENTIFIED_REPORT", evidenceRefs: [] }] }],
      independence: [],
    };
    const corroboration = new DeterministicEvidenceCorroboratorV1().evaluate(corroborationInput);
    assert.equal(corroboration.confirmationStatus, "REPORTED");
    const persistInput: PersistFactualInputV1 = {
      attestationId: "pending",
      canonicalClaimId: `canonical:${suffix}`, proposal, corroborationInput, corroboration,
      evidence: [{ evidenceId: "n3d-excerpt", evidenceKind: "N3A_PROPOSAL", claimKey, publicationRevisionId, sourceDocumentRef, contentLocator: "body:p1", provenanceRef: `prov:${suffix}`, asKnownAt: at(200) }],
      dependencies: [
        { dependencyType: "N2_PUBLICATION_REVISION", dependencyRef: publicationRevisionId, asKnownAt: at(0) },
        { dependencyType: "N3A_PROPOSAL", dependencyRef: proposal.inputFingerprint, asKnownAt: at(300) },
        { dependencyType: "N3B_EVALUATION", dependencyRef: corroboration.fingerprint, asKnownAt: at(400) },
      ],
    };
    const attestationPayload = { canonicalClaimId: persistInput.canonicalClaimId, taxonomyVersion: proposal.taxonomyVersion, category: proposal.category, logicalFingerprint: factualLogicalFingerprintV1(persistInput), ruleSetVersion: proposal.ruleSetVersion, claimType: proposal.claimType, statement: proposal.statement, subjectRef: proposal.subjectRef, objectRef: proposal.objectRef, occurredAt: proposal.occurredAt, scheduledFor: proposal.scheduledFor, confirmationStatus: corroboration.confirmationStatus, lifecycleStatus: corroboration.lifecycleStatus, polarity: corroboration.polarity, focalClaimKey: corroboration.claimKey, publicationRevisionId: proposal.publicationRevisionId, qualityFlags: proposal.qualityFlags, evidence: persistInput.evidence, dependencies: persistInput.dependencies, relation: null };
    await admin.query("set role news_pipeline_verifier");
    const verificationId = (await admin.query<{ register_verified_fact_pipeline_v1: string }>("select news_core.register_verified_fact_pipeline_v1($1::jsonb) register_verified_fact_pipeline_v1", [JSON.stringify(attestationPayload)])).rows[0].register_verified_fact_pipeline_v1;
    await admin.query("reset role");
    await admin.query("set role news_factual_attestor");
    const attestationId = (await admin.query<{ issue_fact_attestation_v1: string }>("select news_core.issue_fact_attestation_v1($1::jsonb) issue_fact_attestation_v1", [JSON.stringify({ ...attestationPayload, verificationId })])).rows[0].issue_fact_attestation_v1;
    await admin.query("reset role");
    const persistedInput = { ...persistInput, attestationId };
    const before = new Date().toISOString();
    const pending = await store.persist(persistedInput, "after-commit").catch(error => error as Error);
    assert.match((pending as Error).message, /INJECTED_FAILURE_AFTER_COMMIT/);
    const pendingRow = await admin.query<{ finalized_at: Date | null }>("select finalized_at from news_core.fact_revisions where fact_event_id=$1 order by revision_no desc limit 1", [`canonical:${suffix}`]);
    assert.equal(pendingRow.rows[0].finalized_at, null);
    const persisted = await store.persist(persistedInput);
    assert.equal(persisted.inserted, false);
    const row = (await admin.query<{ as_known_at: Date; committed_at: Date }>("select as_known_at,committed_at from news_core.fact_revisions where fact_revision_id=$1", [persisted.factRevisionId])).rows[0];
    assert.ok(row.as_known_at.valueOf() >= row.committed_at.valueOf() - 1000);
    assert.ok(row.as_known_at.valueOf() > Date.parse(proposal.proposedAt), "derived knowledge must not be copied from proposal time");
    assert.equal((await reader.readAsOf(before)).some(item => item.factRevisionId === persisted.factRevisionId), false);
    assert.equal((await reader.readAsOf(new Date(row.committed_at.valueOf() + 1000).toISOString())).find(item => item.factRevisionId === persisted.factRevisionId)?.confirmationStatus, "REPORTED");

    const roles = await admin.query<{ rolname: string; rolcanlogin: boolean; rolinherit: boolean }>("select rolname,rolcanlogin,rolinherit from pg_roles where rolname in ('news_service','news_reader','news_factual_writer') order by rolname");
    assert.deepEqual(roles.rows.map(role => role.rolname), ["news_factual_writer", "news_reader", "news_service"]);
    assert.ok(roles.rows.every(role => role.rolcanlogin === false));
    assert.equal((await admin.query("select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname='news_factual_writer'")).rows[0].n, 0);
    await admin.query("set role news_service");
    await assert.rejects(admin.query("select * from news_core.fact_revisions"), /permission denied/);
    await assert.rejects(admin.query("select * from news_core.finalize_fact_revision($1)", [persisted.factRevisionId]), /permission denied/);
    await admin.query("reset role");

    await store.persist(persistedInput);
    assert.equal((await admin.query<{ n: number }>("select count(*)::int n from news_core.fact_revisions where fact_event_id=$1", [persisted.factEventId])).rows[0].n, 1);

    const writerBypass = await admin.query<{ can_insert: boolean; can_execute: boolean }>("select has_table_privilege('news_factual_writer','news_core.fact_revisions','INSERT') can_insert, has_function_privilege('news_factual_writer','news_core.finalize_fact_revision(text)','EXECUTE') can_execute");
    assert.deepEqual(writerBypass.rows[0], { can_insert: false, can_execute: false });
    assert.equal((await admin.query("select has_function_privilege('news_factual_writer','news_core.persist_fact_revision_v1(jsonb)','EXECUTE') can_execute")).rows[0].can_execute, true);
  } finally {
    await admin.query("reset role").catch(() => undefined);
    await Promise.all([store.close(), reader.close(), admin.end()]);
  }
});
