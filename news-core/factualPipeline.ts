import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { fetchSafeExternal } from "./sourceSecurity";
import { DeterministicFactClassifierV1, excerptHashV1, type ClassificationInputV1 } from "./factualClassification";
import { claimKeyV1, DeterministicEvidenceCorroboratorV1, type CorroborationInputV1 } from "./evidenceCorroboration";
import { factualLogicalFingerprintV1, PostgresFactualStore, type PersistFactualInputV1 } from "./factualPersistence";
import { PostgresNewsStore } from "./postgresStore";
import type { NewsPublication } from "./contracts";

export type FactualPipelineOutcomeV1 = Readonly<{
  publicationId: string;
  status: "PERSISTED" | "REFUSED";
  reason: string;
  factEventId?: string;
  confirmationStatus?: string;
  documentSha256?: string;
}>;

export type FactualPipelineOptionsV1 = Readonly<{
  news: PostgresNewsStore;
  verifierPool: Pool;
  attestorPool: Pool;
  writerPool: Pool;
  userAgent: string;
  maxDocuments?: number;
}>;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const stripDocument = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const controlledExcerpt = (text: string): string | undefined => text.split(/(?<=[.!?])\s+/).map(value => value.trim()).find(value => value.length >= 20 && value.length <= 1200 && /(?:\b(?:declares?|declared|announces?|announced)\b.{0,100}\bdividend\b|\b(?:reports?|reported|announces?|announced)\b.{0,100}\b(?:earnings|revenue|net income|profit|loss)\b|\b(?:was|were|is|are|has|have|had|received|fined|sanctioned|charged|sued|settled|convicted|approved|cleared|ordered)\b.{0,80}\b(?:fine|fined|sanction|sanctioned|charge|charged|lawsuit|sued|settlement|settled|convicted|approved|cleared|order|ordered)\b|\b(?:signed|declared|announced|imposed|lifted|entered|occurred|began|continued|reported)\b.{0,80}\b(?:ceasefire|sanctions?|invasion|military operation|armed conflict|treaty)\b)/i.test(value));

export class NewsFactualPipelineV1 {
  private readonly factual: PostgresFactualStore;
  private readonly verifier: DeterministicFactClassifierV1;
  private readonly corroborator: DeterministicEvidenceCorroboratorV1;
  constructor(private readonly options: FactualPipelineOptionsV1) {
    this.factual = new PostgresFactualStore(options.writerPool, "news_factual_writer");
    this.verifier = new DeterministicFactClassifierV1();
    this.corroborator = new DeterministicEvidenceCorroboratorV1();
  }

  async close(): Promise<void> {
    await Promise.all([this.options.verifierPool.end(), this.options.attestorPool.end(), this.options.writerPool.end()]);
  }

  private async attest(payload: Record<string, unknown>): Promise<string> {
    const verification = await this.options.verifierPool.query<{ id: string }>("select news_core.register_verified_fact_pipeline_v1($1::jsonb) id", [JSON.stringify(payload)]);
    const verificationId = verification.rows[0]?.id;
    if (!verificationId) throw new Error("NEWS_FACT_PIPELINE_VERIFICATION_UNAVAILABLE");
    const attestation = await this.options.attestorPool.query<{ id: string }>("select news_core.issue_fact_attestation_v1($1::jsonb) id", [JSON.stringify({ ...payload, verificationId })]);
    const attestationId = attestation.rows[0]?.id;
    if (!attestationId) throw new Error("NEWS_FACT_ATTESTATION_UNAVAILABLE");
    return attestationId;
  }

  private async processOne(publication: NewsPublication, signal?: AbortSignal): Promise<FactualPipelineOutcomeV1> {
    if (publication.form !== "8-K") return { publicationId: publication.publicationId, status: "REFUSED", reason: "FACTUAL_DOCUMENT_FORM_UNSUPPORTED" };
    try {
      const response = await fetchSafeExternal(publication.originalUrl, { headers: { "User-Agent": this.options.userAgent, Accept: "text/html" }, signal: signal ?? AbortSignal.timeout(20_000) });
      if (!response.ok) return { publicationId: publication.publicationId, status: "REFUSED", reason: "FACTUAL_DOCUMENT_UNAVAILABLE" };
      const body = await response.text();
      const excerpt = controlledExcerpt(stripDocument(body));
      if (!excerpt) return { publicationId: publication.publicationId, status: "REFUSED", reason: "N3A_NO_CONTROLLED_RULE_MATCH", documentSha256: sha256(body) };
      const retrievedAt = new Date().toISOString();
      const asOf = new Date(Date.now() + 3_000).toISOString();
      const revisions = await this.options.news.readPublicationRevisionsAsOf(asOf, publication.publicationId);
      const prior = revisions[0];
      if (!prior) return { publicationId: publication.publicationId, status: "REFUSED", reason: "N2_PUBLICATION_REVISION_UNAVAILABLE", documentSha256: sha256(body) };
      const documentFingerprint = sha256(body);
      const matchingRevision = revisions.find(item => item.contentFingerprint === documentFingerprint && item.sourceDocumentRef === publication.originalUrl);
      const revisionId = matchingRevision?.publicationRevisionId ?? `${publication.publicationId}:revision:${prior.revisionNo + 1}`;
      if (!matchingRevision) await this.options.news.ingestPublicationRevision({ revision: { publicationRevisionId: revisionId, publicationId: publication.publicationId, revisionNo: prior.revisionNo + 1, title: publication.title, publishedAt: publication.publishedAt, form: publication.form, contentFingerprint: documentFingerprint, sourceDocumentRef: publication.originalUrl, qualityFlags: [], supersedesRevisionId: prior.publicationRevisionId }, provenance: { provenanceId: `${publication.publicationId}:provenance:${prior.revisionNo + 1}`, publicationRevisionId: revisionId, sourceId: publication.sourceId, providerKey: "sec", providerObservationKey: `${publication.externalId}:document`, originalUrl: publication.originalUrl, sourceDocumentRef: publication.originalUrl, retrievedAt, qualityFlags: [] } });
      const firstRevision = (await this.options.news.readPublicationRevisionsAsOf(new Date(Date.now() + 3_000).toISOString(), publication.publicationId)).find(item => item.publicationRevisionId === revisionId);
      const availabilityDelay = firstRevision?.asKnownAt ? Date.parse(firstRevision.asKnownAt) - Date.now() + 100 : 1_500;
      if (availabilityDelay > 0 && availabilityDelay <= 5_000) await new Promise(resolve => setTimeout(resolve, availabilityDelay));
      if (availabilityDelay > 5_000) return { publicationId: publication.publicationId, status: "REFUSED", reason: "N2_DOCUMENT_AVAILABILITY_FUTURE" , documentSha256: sha256(body) };
      const revision = (await this.options.news.readPublicationRevisionsAsOf(new Date(Date.now() + 3_000).toISOString(), publication.publicationId)).find(item => item.publicationRevisionId === revisionId);
      if (!revision?.asKnownAt || !revision.ingestedAt) return { publicationId: publication.publicationId, status: "REFUSED", reason: "N2_DOCUMENT_REVISION_NOT_COMMITTED", documentSha256: sha256(body) };
      const evidenceId = `sec-document-excerpt-${publication.externalId}`;
      const classificationInput: ClassificationInputV1 = { contractVersion: "news-fact-classification-v1", taxonomyVersion: "news-fact-taxonomy-v1", ruleSetVersion: "deterministic-rule-v1", publicationRevision: { ...revision, contentFingerprint: sha256(body), visibilityState: "COMMITTED" }, evidence: [{ evidenceId, publicationRevisionId: revisionId, kind: "DOCUMENT_EXCERPT", sourceDocumentRef: publication.originalUrl, contentLocator: "document:text:live-sec", excerpt, excerptHash: excerptHashV1(excerpt), hashSemantics: "LOCAL_CONTENT_HASH_ONLY", structuredField: null, structuredValue: null, structuredAuthority: null, observedAt: retrievedAt, retrievedAt, asKnownAt: revision.asKnownAt, provenanceRef: `${publication.publicationId}:provenance:2` }], proposedAt: revision.asKnownAt };
      const classification = this.verifier.classify(classificationInput);
      if (classification.proposals.length === 0) return { publicationId: publication.publicationId, status: "REFUSED", reason: classification.refusalReasons[0] ?? "N3A_REFUSED", documentSha256: sha256(body) };
      const proposal = classification.proposals[0];
      const claimKey = claimKeyV1(proposal);
      const corroborationInput: CorroborationInputV1 = { contractVersion: "news-evidence-corroboration-v1", ruleSetVersion: "evidence-corroboration-rule-v1", proposal, claimKey, claimIdentities: [{ claimKey, canonicalClaimId: `sec:${publication.externalId}`, publicationRevisionId: revisionId, statementFingerprint: sha256(proposal.statement), asKnownAt: proposal.proposedAt }], claimEquivalences: [], cutoffAsKnownAt: proposal.proposedAt, evaluatedAt: revision.asKnownAt, evidence: [{ evidenceId: `n3b-${evidenceId}`, claimKey, originId: "sec-edgar-primary", sourceDocumentRef: publication.originalUrl, publicationRevisionId: revisionId, provenanceRef: `${publication.publicationId}:provenance:2`, contentLocator: "document:text:live-sec", statementHash: sha256(proposal.statement), support: "SUPPORTS", asKnownAt: revision.asKnownAt, availableAsKnownAt: revision.asKnownAt, proposalEvidenceId: evidenceId }], verificationProofs: [], origins: [{ originId: "sec-edgar-primary", sourceDocumentRef: publication.originalUrl, publicationRevisionId: revisionId, publisherRef: "sec-edgar", editorialGroupRef: null, sourceKind: "PRIMARY", provenanceRef: `${publication.publicationId}:provenance:2`, availableAsKnownAt: revision.asKnownAt, competence: [{ claimKey, status: "UNKNOWN", basis: "IDENTIFIED_REPORT", evidenceRefs: [] }] }], independence: [] };
      const corroboration = this.corroborator.evaluate(corroborationInput);
      const persistInput: PersistFactualInputV1 = { attestationId: "pending", canonicalClaimId: `sec:${publication.externalId}`, proposal, corroborationInput, corroboration, evidence: [{ evidenceId, evidenceKind: "N3A_PROPOSAL", claimKey, publicationRevisionId: revisionId, sourceDocumentRef: publication.originalUrl, contentLocator: "document:text:live-sec", provenanceRef: `${publication.publicationId}:provenance:2`, asKnownAt: revision.asKnownAt }], dependencies: [{ dependencyType: "N2_PUBLICATION_REVISION", dependencyRef: revisionId, asKnownAt: revision.asKnownAt }, { dependencyType: "N3A_PROPOSAL", dependencyRef: proposal.inputFingerprint, asKnownAt: proposal.proposedAt }, { dependencyType: "N3B_EVALUATION", dependencyRef: corroboration.fingerprint, asKnownAt: corroborationInput.evaluatedAt }] };
      const payload: Record<string, unknown> = { canonicalClaimId: persistInput.canonicalClaimId, taxonomyVersion: proposal.taxonomyVersion, category: proposal.category, logicalFingerprint: factualLogicalFingerprintV1(persistInput), ruleSetVersion: proposal.ruleSetVersion, claimType: proposal.claimType, statement: proposal.statement, subjectRef: proposal.subjectRef, objectRef: proposal.objectRef, occurredAt: proposal.occurredAt, scheduledFor: proposal.scheduledFor, confirmationStatus: corroboration.confirmationStatus, lifecycleStatus: corroboration.lifecycleStatus, polarity: corroboration.polarity, focalClaimKey: claimKey, publicationRevisionId: revisionId, qualityFlags: proposal.qualityFlags, evidence: persistInput.evidence, dependencies: persistInput.dependencies, relation: null };
      const attestationId = await this.attest(payload);
      const persisted = await this.factual.persist({ ...persistInput, attestationId });
      return { publicationId: publication.publicationId, status: "PERSISTED", reason: "FACTUAL_PIPELINE_COMPLETED", factEventId: persisted.factEventId, confirmationStatus: corroboration.confirmationStatus, documentSha256: sha256(body) };
    } catch (error) {
      return { publicationId: publication.publicationId, status: "REFUSED", reason: error instanceof Error ? error.message : "FACTUAL_PIPELINE_REFUSED" };
    }
  }

  async processPublications(publications: readonly NewsPublication[], signal?: AbortSignal): Promise<readonly FactualPipelineOutcomeV1[]> {
    const outcomes: FactualPipelineOutcomeV1[] = [];
    for (const publication of publications.slice(0, this.options.maxDocuments ?? 20)) {
      if (signal?.aborted) throw new Error("NEWS_EXECUTION_CANCELLED");
      outcomes.push(await this.processOne(publication, signal));
    }
    return outcomes;
  }
}
