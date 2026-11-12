import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { factualLogicalFingerprintV1, PostgresFactualStore, type PersistFactualInputV1 } from "../factualPersistence";
import { claimKeyV1, DeterministicEvidenceCorroboratorV1 } from "../evidenceCorroboration";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);

test("News Core N3-C append-only factual persistence, PIT, idempotence and security", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 8 });
  const attestorPool = new Pool({ connectionString: DB_URL, max: 2 });
  const readerPool = new Pool({ connectionString: DB_URL, max: 2 });
  const store = new PostgresFactualStore(pool, "news_factual_writer");
  const readerStore = new PostgresFactualStore(readerPool, "news_service");
  const suffix = randomUUID().replaceAll("-", "");
  const sourceId = `n3c-source-${suffix}`;
  const publicationId = `n3c-publication-${suffix}`;
  const publicationRevisionId = `${publicationId}:revision:1`;
  const knownOne = new Date(Date.now() - 3000).toISOString();
  const knownTwo = new Date(Date.now() - 1000).toISOString();
  const sourceDocumentRef = `https://www.sec.gov/Archives/edgar/data/1/n3c-${suffix}.htm`;
  type Life = "ACTIVE" | "CORRECTED" | "RETRACTED";
  const proposal = (statement: string, asKnownAt: string, lifecycleStatus: Life = "ACTIVE") => ({ contractVersion: "news-fact-classification-v1" as const, taxonomyVersion: "news-fact-taxonomy-v1" as const, ruleSetVersion: "deterministic-rule-v1" as const, category: "LEGAL_REGULATORY" as const, claimType: "EVENT_OCCURRENCE" as const, statement, subjectRef: null, objectRef: null, occurredAt: knownOne, scheduledFor: null, confirmationStatus: "REPORTED" as const, lifecycleStatus, polarity: "AFFIRMATIVE" as const, publicationRevisionId, evidenceIds: ["evidence-n3a"], evidenceRefs: [{ evidenceId: "evidence-n3a", sourceDocumentRef, contentLocator: "body:p1" }], dependencyAsKnownAt: asKnownAt, proposedAt: asKnownAt, ruleId: "rule-legal-regulatory", justification: "structured fixture", qualityFlags: [], inputFingerprint: "n3a-input" });
  const evidence = (asKnownAt: string, claimKey: string) => [{ evidenceId: "evidence-n3a", evidenceKind: "N3A_PROPOSAL" as const, claimKey, publicationRevisionId, sourceDocumentRef, contentLocator: "body:p1", provenanceRef: `prov:${suffix}`, asKnownAt }];
  const input = (statement: string, asKnownAt: string, lifecycleStatus: Life = "ACTIVE"): PersistFactualInputV1 => {
    const factualProposal = proposal(statement, asKnownAt, lifecycleStatus);
    const claimKey = claimKeyV1(factualProposal);
    const corroborationInput = { contractVersion: "news-evidence-corroboration-v1" as const, ruleSetVersion: "evidence-corroboration-rule-v1" as const, proposal: factualProposal, claimKey, claimIdentities: [{ claimKey, canonicalClaimId: `canonical:${suffix}`, publicationRevisionId, statementFingerprint: `statement:${statement}`, asKnownAt }], claimEquivalences: [], cutoffAsKnownAt: asKnownAt, evidence: [{ evidenceId: "evidence-n3b", claimKey, originId: "origin-1", sourceDocumentRef, publicationRevisionId, provenanceRef: `prov:${suffix}`, contentLocator: "body:p1", statementHash: `hash:${statement}`, support: "SUPPORTS" as const, asKnownAt, availableAsKnownAt: asKnownAt, proposalEvidenceId: "evidence-n3a" }], verificationProofs: [], origins: [{ originId: "origin-1", sourceDocumentRef, publicationRevisionId, publisherRef: "fixture", editorialGroupRef: null, sourceKind: "SECONDARY" as const, provenanceRef: `prov:${suffix}`, availableAsKnownAt: asKnownAt, competence: [{ claimKey, status: "UNKNOWN" as const, basis: "IDENTIFIED_REPORT" as const, evidenceRefs: [] }] }], independence: [], evaluatedAt: asKnownAt };
    const corroboration = new DeterministicEvidenceCorroboratorV1().evaluate(corroborationInput);
    return { attestationId: "pending", canonicalClaimId: `canonical:${suffix}`, proposal: factualProposal, corroborationInput, corroboration, evidence: evidence(asKnownAt, claimKey), dependencies: [{ dependencyType: "N2_PUBLICATION_REVISION" as const, dependencyRef: publicationRevisionId, asKnownAt }, { dependencyType: "N3A_PROPOSAL" as const, dependencyRef: factualProposal.inputFingerprint, asKnownAt }, { dependencyType: "N3B_EVALUATION" as const, dependencyRef: corroboration.fingerprint, asKnownAt }] };
  };
  const attest = async (value: PersistFactualInputV1): Promise<PersistFactualInputV1> => {
    const client = await attestorPool.connect();
    try {
      await client.query("begin");
      const payload = { canonicalClaimId: value.canonicalClaimId, taxonomyVersion: value.proposal.taxonomyVersion, category: value.proposal.category, logicalFingerprint: factualLogicalFingerprintV1(value), ruleSetVersion: value.proposal.ruleSetVersion, claimType: value.proposal.claimType, statement: value.proposal.statement, subjectRef: value.proposal.subjectRef, objectRef: value.proposal.objectRef, occurredAt: value.proposal.occurredAt, scheduledFor: value.proposal.scheduledFor, confirmationStatus: value.corroboration.confirmationStatus, lifecycleStatus: value.corroboration.lifecycleStatus, polarity: value.corroboration.polarity, focalClaimKey: value.corroboration.claimKey, publicationRevisionId: value.proposal.publicationRevisionId, qualityFlags: value.proposal.qualityFlags, evidence: value.evidence, dependencies: value.dependencies, relation: value.relation ?? null };
      await client.query("set local role news_pipeline_verifier");
      const verificationId = (await client.query<{ register_verified_fact_pipeline_v1: string }>("select news_core.register_verified_fact_pipeline_v1($1::jsonb) register_verified_fact_pipeline_v1", [JSON.stringify(payload)])).rows[0].register_verified_fact_pipeline_v1;
      await client.query("commit");
      await client.query("begin"); await client.query("set local role news_factual_attestor");
      const id = (await client.query<{ issue_fact_attestation_v1: string }>("select news_core.issue_fact_attestation_v1($1::jsonb) issue_fact_attestation_v1", [JSON.stringify({ ...payload, verificationId })])).rows[0].issue_fact_attestation_v1;
      await client.query("commit"); return { ...value, attestationId: id };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  };
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
    await admin.query(await readFile(migration("20261112170000_news_core_n3c_factual_writer_boundary.sql"), "utf8"));
    await admin.query("set role news_factual_attestor");
    await assert.rejects(admin.query("select news_core.issue_fact_attestation_v1($1::jsonb)", [JSON.stringify({ canonicalClaimId: "forged", logicalFingerprint: "arbitrary", publicationRevisionId, evidence: [], dependencies: [], verificationId: "not-verified" })]), /NEWS_FACT_PIPELINE_ATTESTATION_UNVERIFIED/);
    await admin.query("reset role");
    const beforeFirstCommit = new Date(Date.now() - 1000).toISOString();
    const first = await store.persist(await attest(input("The company was fined.", knownOne)));
    assert.equal(first.inserted, true);
    const firstCommitted = await admin.query<{ committed_at: Date }>("select committed_at from news_core.fact_revisions where fact_revision_id=$1", [first.factRevisionId]);
    const afterFirstCommit = new Date(firstCommitted.rows[0].committed_at.valueOf() + 1).toISOString();
    assert.equal((await store.readAsOf(afterFirstCommit)).length, 1);
    assert.equal((await store.readAsOf(beforeFirstCommit)).length, 0);
    const sameTransactionInput = await attest(input("same transaction must fail", knownTwo));
    const sameTransactionClient = await pool.connect();
    try {
      await sameTransactionClient.query("begin"); await sameTransactionClient.query("set local role news_factual_writer");
      const samePayload = { attestationId: sameTransactionInput.attestationId, canonicalClaimId: sameTransactionInput.canonicalClaimId, taxonomyVersion: sameTransactionInput.proposal.taxonomyVersion, category: sameTransactionInput.proposal.category, logicalFingerprint: factualLogicalFingerprintV1(sameTransactionInput), ruleSetVersion: sameTransactionInput.proposal.ruleSetVersion, claimType: sameTransactionInput.proposal.claimType, statement: sameTransactionInput.proposal.statement, subjectRef: sameTransactionInput.proposal.subjectRef, objectRef: sameTransactionInput.proposal.objectRef, occurredAt: sameTransactionInput.proposal.occurredAt, scheduledFor: sameTransactionInput.proposal.scheduledFor, confirmationStatus: sameTransactionInput.corroboration.confirmationStatus, lifecycleStatus: sameTransactionInput.corroboration.lifecycleStatus, polarity: sameTransactionInput.corroboration.polarity, focalClaimKey: sameTransactionInput.corroboration.claimKey, publicationRevisionId: sameTransactionInput.proposal.publicationRevisionId, qualityFlags: sameTransactionInput.proposal.qualityFlags, evidence: sameTransactionInput.evidence, dependencies: sameTransactionInput.dependencies, relation: sameTransactionInput.relation ?? null, seal: false };
      const staged = (await sameTransactionClient.query<{ fact_revision_id: string }>("select * from news_core.persist_fact_revision_v1($1::jsonb)", [JSON.stringify(samePayload)])).rows[0];
      await assert.rejects(sameTransactionClient.query("select * from news_core.publish_fact_revision_v1($1,$2)", [staged.fact_revision_id, sameTransactionInput.attestationId]), /NEWS_FACT_STAGE_PUBLISH_SAME_TRANSACTION/);
      await sameTransactionClient.query("rollback");
    } finally { sameTransactionClient.release(); }
    assert.deepEqual(await store.persist(await attest(input("The company was fined.", knownOne))), { ...first, inserted: false });
    const concurrent = await Promise.all([store.persist(await attest(input("A second factual revision.", knownOne))), store.persist(await attest(input("A third factual revision.", knownOne)))]);
    assert.deepEqual(concurrent.map(result => result.revisionNo).sort(), [2, 3]);
    const correctedInput: PersistFactualInputV1 = { ...input("The company was fined, later corrected.", knownTwo, "CORRECTED"), relation: { relatedRevisionId: first.factRevisionId!, relationType: "CORRECTS" as const } };
    const corrected = await store.persist(await attest(correctedInput));
    assert.equal(corrected.inserted, true);
    assert.equal((await store.readAsOf(afterFirstCommit))[0].lifecycleStatus, "ACTIVE");
    assert.equal((await store.readAsOf(new Date(Date.now() + 1000).toISOString()))[0].lifecycleStatus, "CORRECTED");
    const openInput = input("transaction remains open", knownTwo);
    const openWrite = attest(openInput).then(value => store.persist(value, "none", 250));
    await new Promise(resolve => setTimeout(resolve, 50));
    const cutoffWhileOpen = new Date().toISOString();
    assert.equal((await readerStore.readAsOf(cutoffWhileOpen)).some(row => row.statement === "transaction remains open"), false);
    await openWrite;
    assert.equal((await readerStore.readAsOf(cutoffWhileOpen)).some(row => row.statement === "transaction remains open"), false);
    const futureInput = input("future dependency", knownOne);
    await assert.rejects(store.persist(await attest({ ...futureInput, dependencies: futureInput.dependencies.map(dependency => dependency.dependencyType === "N3B_EVALUATION" ? { ...dependency, asKnownAt: new Date(Date.now() + 60_000).toISOString() } : dependency) })), /NEWS_FACT_FUTURE_DEPENDENCY/);
    await assert.rejects(store.persist(await attest({ ...input("invalid evidence", knownOne), evidence: [{ ...evidence(knownOne, claimKeyV1(proposal("invalid evidence", knownOne)))[0], sourceDocumentRef: "https://wrong.example/document" }] })), /NEWS_FACT_N3A_EVIDENCE_MISMATCH/);
    const forgedDispute = input("forged dispute", knownTwo);
    await assert.rejects(store.persist({ ...forgedDispute, corroboration: { ...forgedDispute.corroboration, confirmationStatus: "DISPUTED", fingerprint: "arbitrary" }, dependencies: forgedDispute.dependencies.map(dependency => dependency.dependencyType === "N3B_EVALUATION" ? { ...dependency, dependencyRef: "arbitrary" } : dependency) }), /NEWS_FACT_CORROBORATION_RESULT_MISMATCH/);
    const forgedRetraction = input("forged retraction", knownTwo);
    await assert.rejects(store.persist({ ...forgedRetraction, proposal: { ...forgedRetraction.proposal, lifecycleStatus: "RETRACTED" }, corroboration: { ...forgedRetraction.corroboration, lifecycleStatus: "RETRACTED", polarity: "NEGATIVE" } }), /NEWS_FACT_CORROBORATION_INPUT_MISMATCH/);
    await assert.rejects(store.persist(await attest(input("rollback probe", knownTwo)), "before-commit"), /INJECTED_FAILURE_BEFORE_COMMIT/);
    const crashedInput = await attest(input("post commit crash", knownTwo));
    await assert.rejects(store.persist(crashedInput, "after-commit"), /INJECTED_FAILURE_AFTER_COMMIT/);
    const pendingRevisionId = (await admin.query<{ fact_revision_id: string }>("select fact_revision_id from news_core.fact_revisions where fact_event_id=$1 and statement=$2", [`canonical:${suffix}`, "post commit crash"])).rows[0].fact_revision_id;
    const heldPublish = await pool.connect();
    try {
      await heldPublish.query("begin"); await heldPublish.query("set local role news_factual_writer");
      await heldPublish.query("select * from news_core.publish_fact_revision_v1($1,$2)", [pendingRevisionId, crashedInput.attestationId]);
      const cutoffDuringPublish = new Date().toISOString();
      assert.equal((await readerStore.readAsOf(cutoffDuringPublish)).some(row => row.factRevisionId === pendingRevisionId), false);
      await heldPublish.query("commit");
      assert.equal((await readerStore.readAsOf(cutoffDuringPublish)).some(row => row.factRevisionId === pendingRevisionId), false);
    } finally { heldPublish.release(); }
    const visibilityClient = await pool.connect();
    try { await visibilityClient.query("begin"); await visibilityClient.query("set local role news_factual_writer"); await visibilityClient.query("select * from news_core.make_fact_revision_visible_v1($1,$2)", [pendingRevisionId, crashedInput.attestationId]); await visibilityClient.query("commit"); } finally { visibilityClient.release(); }
    assert.equal((await store.persist(crashedInput)).inserted, false);
    assert.equal((await admin.query<{ n: number }>("select count(*)::int n from news_core.fact_revisions where fact_event_id=$1", [first.factEventId])).rows[0].n, 6);
    await assert.rejects(admin.query("update news_core.fact_revisions set statement='tampered' where fact_revision_id=$1", [first.factRevisionId]), /NEWS_FACT_HISTORY_APPEND_ONLY/);
    await assert.rejects(admin.query("insert into news_core.fact_revision_evidence values ($1,'late','N3A_PROPOSAL',$2,$3,$4,'late','late',$5)", [first.factRevisionId, claimKeyV1(proposal("The company was fined.", knownOne)), publicationRevisionId, sourceDocumentRef, knownOne]), /NEWS_FACT_REVISION_FINALIZED/);
    await admin.query("set role news_service");
    await assert.rejects(admin.query("insert into news_core.fact_events values ('forged','forged','news-fact-taxonomy-v1','LEGAL_REGULATORY')"), /permission denied/);
    await assert.rejects(admin.query("select * from news_core.fact_revisions"), /permission denied/);
    await assert.rejects(admin.query("select * from news_core.finalize_fact_revision($1)", [first.factRevisionId]), /permission denied/);
    await admin.query("reset role");
    await admin.query("set role news_reader");
    await assert.rejects(admin.query("select * from news_core.fact_revisions"), /permission denied/);
    assert.ok((await admin.query("select * from news_core.read_fact_revisions_as_of($1)", [new Date(Date.now() + 1000).toISOString()])).rows.length >= 1);
    await admin.query("reset role");
    const security = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='news_core' and c.relname='fact_revisions'");
    assert.deepEqual(security.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
  } finally { await admin.query("reset role").catch(() => undefined); await Promise.all([store.close(), readerStore.close(), attestorPool.end(), admin.end()]); }
});
