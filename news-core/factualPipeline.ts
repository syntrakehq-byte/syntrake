import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { fetchSafeExternal, fetchSafeExternalFromAllowedHosts } from "./sourceSecurity";
import { DeterministicFactClassifierV1, excerptHashV1, factRuleCategoriesV1, isGlobalAnalysisFactRelevantV1, type ClassificationInputV1 } from "./factualClassification";
import { claimKeyV1, DeterministicEvidenceCorroboratorV1, type CorroborationInputV1 } from "./evidenceCorroboration";
import { factualLogicalFingerprintV1, PostgresFactualStore, type PersistFactualInputV1 } from "./factualPersistence";
import { PostgresNewsStore } from "./postgresStore";
import type { NewsPublication, NewsPublicationRevision } from "./contracts";

export type FactualPipelineOutcomeV1 = Readonly<{
  publicationId: string;
  status: "PERSISTED" | "REFUSED" | "FAILED_RETRYABLE";
  reason: string;
  factEventId?: string;
  confirmationStatus?: string;
  documentSha256?: string;
  canonicalClaimId?: string;
}>;

export type FactualPipelineOptionsV1 = Readonly<{
  news: PostgresNewsStore;
  verifierPool: Pool;
  attestorPool: Pool;
  writerPool: Pool;
  userAgent: string;
  maxDocuments?: number;
  processingHoldMs?: number;
}>;

/** Selects only committed revisions known at the publication's own frontier. */
export function selectGlobalRevisionAtKnownAtV1(revisions: readonly NewsPublicationRevision[], asKnownAt: string | null): NewsPublicationRevision | null {
  if (!asKnownAt || !Number.isFinite(Date.parse(asKnownAt))) return null;
  const cutoff = Date.parse(asKnownAt);
  return revisions
    .filter(revision => revision.ingestedAt !== null && revision.asKnownAt !== null && Date.parse(revision.asKnownAt) <= cutoff)
    .slice()
    .sort((left, right) => (left.revisionNo - right.revisionNo) || left.publicationRevisionId.localeCompare(right.publicationRevisionId))
    .at(-1) ?? null;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const stripDocument = (html: string): string => html
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<!--[\s\S]*$/g, " ")
  .replace(/-->/g, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\s+/g, " ")
  .trim();
const controlledExcerpt = (text: string): string | undefined => text.split(/(?<=[.!?])\s+/).map(value => value.trim()).find(value => value.length >= 20 && value.length <= 1200 && /(?:\b(?:declares?|declared|announces?|announced)\b.{0,100}\bdividend\b|\b(?:reports?|reported|announces?|announced)\b.{0,100}\b(?:earnings|revenue|net income|profit|loss)\b|\b(?:was|were|is|are|has|have|had|received|fined|sanctioned|charged|sued|settled|convicted|approved|cleared|ordered)\b.{0,80}\b(?:fine|fined|sanction|sanctioned|charge|charged|lawsuit|sued|settlement|settled|convicted|approved|cleared|order|ordered)\b|\b(?:signed|declared|announced|imposed|lifted|entered|occurred|began|continued|reported)\b.{0,80}\b(?:ceasefire|sanctions?|invasion|military operation|armed conflict|treaty)\b|\b(?:raised|lowered|held|maintained|set|increased|decreased)\b.{0,100}\b(?:interest|policy|funds?|rate|rates|threshold|inflation|unemployment|GDP|gross domestic product|CPI|consumer price)\b|\b(?:released?|published?)\b.{0,100}\b(?:economic|employment|inflation|unemployment|GDP|CPI|price)\b|\b(?:today\s+)?(?:announced|reported|released|published)\b.{0,200}\b(?:threshold|CPI|inflation|employment|unemployment|GDP|rate|rates|price index)\b|\b(?:increase|decrease|rise|fall|change)\b.{0,100}\b(?:threshold|CPI|inflation|employment|unemployment|GDP|rate|rates|price index)\b)/i.test(value));
// An official headline or site navigation is not a document excerpt.
export function isOfficialBodyExcerptV1(value: string, title: string): boolean {
  const clean = value.replace(/\s+/g, " ").trim();
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  return clean.length >= 20 && clean.length <= 1200 &&
    clean.toLowerCase() !== normalizedTitle.toLowerCase() &&
    !/\b(?:cookies?|toggle search|search the site|skip to main content|subscribe to|privacy preferences|our use of cookies|enable javascript)\b/i.test(clean) &&
    factRuleCategoriesV1(clean).some(category => isGlobalAnalysisFactRelevantV1(category, clean));
}
export function selectOfficialFactExcerptV1(html: string, title: string): string | undefined {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|header|nav|footer|aside|script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(cleaned)?.[1];
  const article = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(cleaned)?.[1];
  const regions = [...new Set([main, article, cleaned].filter((x): x is string => Boolean(x)))];
  for (const region of regions) {
    const candidates = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)]
      .flatMap(match => stripDocument(match[1]).split(/(?<=[.!?])\s+/))
      .map(value => value.trim()).filter(value => isOfficialBodyExcerptV1(value, title));
    if (/\b(?:bank rate|policy rate|interest rate|overnight rate|cash rate|federal funds rate)\b/i.test(title)) {
      const rate = candidates.find(value => factRuleCategoriesV1(value).includes("CENTRAL_BANK_DECISION"));
      if (rate) return rate;
    }
    if (candidates.length) return candidates[0];
  }
  return undefined;
}
const OFFICIAL_PRIMARY_SOURCES = new Set(["eu-ecb-press", "uk-boe-news", "us-sec-press", "ca-boc-press", "au-rba-press", "us-bls-latest", "us-fed-press"]);
const OFFICIAL_DOCUMENT_HOSTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "eu-ecb-press": new Set(["www.ecb.europa.eu", "ecb.europa.eu"]),
  "uk-boe-news": new Set(["www.bankofengland.co.uk", "bankofengland.co.uk"]),
  "us-sec-press": new Set(["www.sec.gov", "sec.gov"]),
  "ca-boc-press": new Set(["www.bankofcanada.ca", "bankofcanada.ca"]),
  "au-rba-press": new Set(["www.rba.gov.au", "rba.gov.au"]),
  "us-bls-latest": new Set(["www.bls.gov", "bls.gov"]),
  "us-fed-press": new Set(["www.federalreserve.gov", "federalreserve.gov"]),
};

export class NewsFactualPipelineV1 {
  readonly maxDocuments: number;
  private readonly factual: PostgresFactualStore;
  private readonly verifier: DeterministicFactClassifierV1;
  private readonly corroborator: DeterministicEvidenceCorroboratorV1;
  constructor(private readonly options: FactualPipelineOptionsV1) {
    this.maxDocuments = options.maxDocuments ?? 20;
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

  /** Process content already obtained by an approved non-SEC adapter. The
   * adapter's excerpt is the only factual document input; title/URL alone are
   * deliberately insufficient. This uses the same N3-A -> N3-B -> N3-C path
   * as SEC and never upgrades a global publication beyond REPORTED. */
  private async processGlobalOne(publication: NewsPublication, signal?: AbortSignal, assertActive?: () => void): Promise<FactualPipelineOutcomeV1> {
    const canonicalClaimId = `global:${publication.sourceId}:${publication.externalId}`;
    const documentCutoff = new Date().toISOString();
    if (!publication.asKnownAt || !Number.isFinite(Date.parse(publication.asKnownAt)) || Date.parse(publication.asKnownAt) > Date.parse(documentCutoff)) {
      return { publicationId: publication.publicationId, canonicalClaimId, status: "FAILED_RETRYABLE", reason: "N2_PUBLICATION_AS_KNOWN_AT_UNAVAILABLE" };
    }
    const revisions = await this.options.news.readPublicationRevisionsAsOf(documentCutoff, publication.publicationId);
    let revision = selectGlobalRevisionAtKnownAtV1(revisions, documentCutoff);
    if (!revision?.asKnownAt || !revision.ingestedAt) return { publicationId: publication.publicationId, canonicalClaimId, status: "FAILED_RETRYABLE", reason: "N2_PUBLICATION_REVISION_UNAVAILABLE" };
    let revisionExcerpt = revision.contentExcerpt?.trim();
    if (OFFICIAL_PRIMARY_SOURCES.has(publication.sourceId) &&
        (!revisionExcerpt || !revision.qualityFlags.includes("OFFICIAL_DOCUMENT_FETCHED") ||
          !isOfficialBodyExcerptV1(revisionExcerpt, publication.title))) {
      revisionExcerpt = undefined;
      const allowedHosts = OFFICIAL_DOCUMENT_HOSTS[publication.sourceId];
      if (!allowedHosts) return { publicationId: publication.publicationId, canonicalClaimId, status: "REFUSED", reason: "N3A_OFFICIAL_DOCUMENT_HOST_UNREGISTERED" };
      const response = await fetchSafeExternalFromAllowedHosts(publication.originalUrl, allowedHosts, { headers: { "User-Agent": this.options.userAgent, Accept: "text/html,application/xhtml+xml" }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
      if (!response.ok) return { publicationId: publication.publicationId, canonicalClaimId, status: "FAILED_RETRYABLE", reason: "NEWS_FACTUAL_FETCH_RETRYABLE_HTTP_" + response.status };
      if (response.ok) {
        const body = await response.text();
        const documentExcerpt = selectOfficialFactExcerptV1(body, publication.title);
        if (documentExcerpt) {
          const documentFingerprint = sha256(body);
          // A publisher may change harmless HTML chrome on every request. The
          // durable factual unit is the controlled excerpt; do not create a
          // new revision merely because an otherwise identical document hash
          // changed outside that excerpt.
          if (revision.contentExcerpt !== documentExcerpt) {
            const nextRevisionNo = revision.revisionNo + 1;
            const revisionId = `${publication.publicationId}:revision:${nextRevisionNo}`;
            await this.options.news.ingestPublicationRevision({
              revision: { publicationRevisionId: revisionId, publicationId: publication.publicationId, revisionNo: nextRevisionNo, title: publication.title, publishedAt: publication.publishedAt, form: publication.form, contentFingerprint: documentFingerprint, contentExcerpt: documentExcerpt, sourceDocumentRef: publication.originalUrl, qualityFlags: [...new Set([...revision.qualityFlags, "OFFICIAL_DOCUMENT_FETCHED", "OFFICIAL_DOCUMENT_BODY_V1"])], supersedesRevisionId: revision.publicationRevisionId },
              provenance: { provenanceId: `${publication.publicationId}:provenance:${nextRevisionNo}`, publicationRevisionId: revisionId, sourceId: publication.sourceId, providerKey: `global-${publication.sourceId}`, providerObservationKey: `${publication.sourceId}:${publication.externalId}:document`, originalUrl: publication.originalUrl, sourceDocumentRef: publication.originalUrl, retrievedAt: new Date().toISOString(), qualityFlags: ["OFFICIAL_DOCUMENT_FETCHED"] },
            });
            let committedRevision = await this.options.news.readPublicationRevisionById(revisionId);
            const revisionDeadline = Date.now() + 7_000;
            while (committedRevision?.asKnownAt && Date.parse(committedRevision.asKnownAt) > Date.now() && Date.now() < revisionDeadline && !signal?.aborted) {
              await new Promise(resolve => setTimeout(resolve, 100));
              committedRevision = await this.options.news.readPublicationRevisionById(revisionId);
            }
            revision = committedRevision;
            if (!revision?.asKnownAt || Date.parse(revision.asKnownAt) > Date.now()) return { publicationId: publication.publicationId, canonicalClaimId, status: "FAILED_RETRYABLE", reason: "N3A_OFFICIAL_REVISION_COMMIT_RETRYABLE" };
          }
          revisionExcerpt = documentExcerpt;
        }
      }
    }
    if (!revisionExcerpt) return { publicationId: publication.publicationId, canonicalClaimId, status: "REFUSED", reason: "N3A_FACTUAL_EXCERPT_UNAVAILABLE" };
    const evidenceId = `global-document-excerpt-${publication.sourceId}-${publication.externalId}`;
    const provenanceRef = `${publication.publicationId}:provenance:${revision.revisionNo}`;
    const classificationInput: ClassificationInputV1 = {
      contractVersion: "news-fact-classification-v1", taxonomyVersion: "news-fact-taxonomy-v1", ruleSetVersion: "deterministic-rule-v1",
      publicationRevision: { ...revision, contentFingerprint: revision.contentFingerprint, visibilityState: "COMMITTED" },
      evidence: [{ evidenceId, publicationRevisionId: revision.publicationRevisionId, kind: "DOCUMENT_EXCERPT", sourceDocumentRef: revision.sourceDocumentRef, contentLocator: "publication:contentExcerpt", excerpt: revisionExcerpt, excerptHash: excerptHashV1(revisionExcerpt), hashSemantics: "LOCAL_CONTENT_HASH_ONLY", structuredField: null, structuredValue: null, structuredAuthority: null, observedAt: revision.asKnownAt, retrievedAt: revision.asKnownAt, asKnownAt: revision.asKnownAt, provenanceRef }],
      proposedAt: revision.asKnownAt,
    };
    const classification = this.verifier.classify(classificationInput);
    if (classification.proposals.length === 0) return { publicationId: publication.publicationId, canonicalClaimId, status: "REFUSED", reason: classification.refusalReasons[0] ?? "N3A_REFUSED" };
    const proposal = classification.proposals.find(candidate => isGlobalAnalysisFactRelevantV1(candidate.category, candidate.statement));
    if (!proposal) return { publicationId: publication.publicationId, canonicalClaimId, status: "REFUSED", reason: "N3A_GLOBAL_ANALYSIS_RELEVANCE_INSUFFICIENT" };
    assertActive?.();
    const claimKey = claimKeyV1(proposal);
    const corroborationInput: CorroborationInputV1 = { contractVersion: "news-evidence-corroboration-v1", ruleSetVersion: "evidence-corroboration-rule-v1", proposal, claimKey,
      claimIdentities: [{ claimKey, canonicalClaimId, publicationRevisionId: revision.publicationRevisionId, statementFingerprint: sha256(proposal.statement), asKnownAt: proposal.proposedAt }], claimEquivalences: [], cutoffAsKnownAt: proposal.proposedAt, evaluatedAt: revision.asKnownAt,
      evidence: [{ evidenceId: `n3b-${evidenceId}`, claimKey, originId: `${publication.sourceId}-origin`, sourceDocumentRef: revision.sourceDocumentRef, publicationRevisionId: revision.publicationRevisionId, provenanceRef, contentLocator: "publication:contentExcerpt", statementHash: sha256(proposal.statement), support: "SUPPORTS", asKnownAt: revision.asKnownAt, availableAsKnownAt: revision.asKnownAt, proposalEvidenceId: evidenceId }],
      verificationProofs: [],
      origins: [{ originId: `${publication.sourceId}-origin`, sourceDocumentRef: revision.sourceDocumentRef, publicationRevisionId: revision.publicationRevisionId, publisherRef: publication.sourceId, editorialGroupRef: null, sourceKind: OFFICIAL_PRIMARY_SOURCES.has(publication.sourceId) ? "PRIMARY" : "SECONDARY", provenanceRef, availableAsKnownAt: revision.asKnownAt, competence: [{ claimKey, status: "UNKNOWN", basis: "IDENTIFIED_REPORT", evidenceRefs: [] }] }], independence: [] };
    const corroboration = this.corroborator.evaluate(corroborationInput);
    const persistInput: PersistFactualInputV1 = { attestationId: "pending", canonicalClaimId, proposal, corroborationInput, corroboration,
      evidence: [{ evidenceId, evidenceKind: "N3A_PROPOSAL", claimKey, publicationRevisionId: revision.publicationRevisionId, sourceDocumentRef: revision.sourceDocumentRef, contentLocator: "publication:contentExcerpt", provenanceRef, asKnownAt: revision.asKnownAt }],
      dependencies: [{ dependencyType: "N2_PUBLICATION_REVISION", dependencyRef: revision.publicationRevisionId, asKnownAt: revision.asKnownAt }, { dependencyType: "N3A_PROPOSAL", dependencyRef: proposal.inputFingerprint, asKnownAt: proposal.proposedAt }, { dependencyType: "N3B_EVALUATION", dependencyRef: corroboration.fingerprint, asKnownAt: corroborationInput.evaluatedAt }] };
    const payload: Record<string, unknown> = { canonicalClaimId, taxonomyVersion: proposal.taxonomyVersion, category: proposal.category, logicalFingerprint: factualLogicalFingerprintV1(persistInput), ruleSetVersion: proposal.ruleSetVersion, claimType: proposal.claimType, statement: proposal.statement, subjectRef: proposal.subjectRef, objectRef: proposal.objectRef, occurredAt: proposal.occurredAt, scheduledFor: proposal.scheduledFor, confirmationStatus: corroboration.confirmationStatus, lifecycleStatus: corroboration.lifecycleStatus, polarity: corroboration.polarity, focalClaimKey: claimKey, publicationRevisionId: revision.publicationRevisionId, qualityFlags: proposal.qualityFlags, evidence: persistInput.evidence, dependencies: persistInput.dependencies, relation: null };
    const attestationId = await this.attest(payload);
    assertActive?.();
    const persisted = await this.factual.persist({ ...persistInput, attestationId });
    return { publicationId: publication.publicationId, canonicalClaimId, status: "PERSISTED", reason: "FACTUAL_PIPELINE_COMPLETED", factEventId: persisted.factEventId, confirmationStatus: corroboration.confirmationStatus };
  }

  private async processOne(publication: NewsPublication, signal?: AbortSignal, assertActive?: () => void): Promise<FactualPipelineOutcomeV1> {
    assertActive?.();
    if (publication.sourceId !== "sec-edgar") return await this.processGlobalOne(publication, signal, assertActive);
    if (publication.form !== "8-K") return { publicationId: publication.publicationId, canonicalClaimId: `sec:${publication.externalId}`, status: "REFUSED", reason: "FACTUAL_DOCUMENT_FORM_UNSUPPORTED" };
    try {
      const response = await fetchSafeExternal(publication.originalUrl, { headers: { "User-Agent": this.options.userAgent, Accept: "text/html" }, signal: signal ?? AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`NEWS_FACTUAL_FETCH_RETRYABLE_HTTP_${response.status}`);
      const body = await response.text();
      const holdMs = Math.max(0, Math.min(this.options.processingHoldMs ?? 0, 60_000));
      if (holdMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, holdMs);
          const abort = () => { clearTimeout(timer); reject(new Error("NEWS_EXECUTION_CANCELLED")); };
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
        });
      }
      const excerpt = controlledExcerpt(stripDocument(body));
      if (!excerpt) return { publicationId: publication.publicationId, canonicalClaimId: `sec:${publication.externalId}`, status: "REFUSED", reason: "N3A_NO_CONTROLLED_RULE_MATCH", documentSha256: sha256(body) };
      const retrievedAt = new Date().toISOString();
      // The document must be evaluated against a real PIT frontier. Never
      // look into the future to make a just-fetched revision selectable.
      // The publication frontier may precede the N2 revision frontier created
      // during the same durable ingest. Use the actual retrieval instant,
      // never a synthetic future cutoff, to select that committed revision.
      const asOf = retrievedAt;
      let revisions = await this.options.news.readPublicationRevisionsAsOf(asOf, publication.publicationId);
      // N1/N2 finalization can assign a durable frontier just after the
      // executor starts. Poll only with the current wall-clock cutoff; never
      // manufacture a future PIT value and never turn this race into REFUSED.
      const revisionDeadline = Date.now() + 3_000;
      while (revisions.length === 0 && Date.now() < revisionDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        revisions = await this.options.news.readPublicationRevisionsAsOf(new Date().toISOString(), publication.publicationId);
      }
      const prior = revisions[0];
      if (!prior) throw new Error("NEWS_FACTUAL_N2_AVAILABILITY_RETRYABLE");
      const documentFingerprint = sha256(body);
      const matchingRevision = revisions.find(item => item.contentFingerprint === documentFingerprint && item.sourceDocumentRef === publication.originalUrl);
      const revisionId = matchingRevision?.publicationRevisionId ?? `${publication.publicationId}:revision:${prior.revisionNo + 1}`;
      if (!matchingRevision) await this.options.news.ingestPublicationRevision({ revision: { publicationRevisionId: revisionId, publicationId: publication.publicationId, revisionNo: prior.revisionNo + 1, title: publication.title, publishedAt: publication.publishedAt, form: publication.form, contentFingerprint: documentFingerprint, sourceDocumentRef: publication.originalUrl, qualityFlags: [], supersedesRevisionId: prior.publicationRevisionId }, provenance: { provenanceId: `${publication.publicationId}:provenance:${prior.revisionNo + 1}`, publicationRevisionId: revisionId, sourceId: publication.sourceId, providerKey: "sec", providerObservationKey: `${publication.externalId}:document`, originalUrl: publication.originalUrl, sourceDocumentRef: publication.originalUrl, retrievedAt, qualityFlags: [] } });
      const firstRevision = (await this.options.news.readPublicationRevisionsAsOf(new Date().toISOString(), publication.publicationId)).find(item => item.publicationRevisionId === revisionId);
      const availabilityDelay = firstRevision?.asKnownAt ? Date.parse(firstRevision.asKnownAt) - Date.now() + 100 : 1_500;
      if (availabilityDelay > 0 && availabilityDelay <= 5_000) await new Promise(resolve => setTimeout(resolve, availabilityDelay));
      if (availabilityDelay > 5_000) throw new Error("NEWS_FACTUAL_N2_AVAILABILITY_RETRYABLE");
      const revision = (await this.options.news.readPublicationRevisionsAsOf(new Date().toISOString(), publication.publicationId)).find(item => item.publicationRevisionId === revisionId);
      if (!revision?.asKnownAt || !revision.ingestedAt) throw new Error("NEWS_FACTUAL_N2_COMMIT_RETRYABLE");
      const provenanceRef = `${publication.publicationId}:provenance:${revision.revisionNo}`;
      const evidenceId = `sec-document-excerpt-${publication.externalId}`;
      const classificationInput: ClassificationInputV1 = { contractVersion: "news-fact-classification-v1", taxonomyVersion: "news-fact-taxonomy-v1", ruleSetVersion: "deterministic-rule-v1", publicationRevision: { ...revision, contentFingerprint: sha256(body), visibilityState: "COMMITTED" }, evidence: [{ evidenceId, publicationRevisionId: revisionId, kind: "DOCUMENT_EXCERPT", sourceDocumentRef: publication.originalUrl, contentLocator: "document:text:live-sec", excerpt, excerptHash: excerptHashV1(excerpt), hashSemantics: "LOCAL_CONTENT_HASH_ONLY", structuredField: null, structuredValue: null, structuredAuthority: null, observedAt: revision.asKnownAt, retrievedAt: revision.asKnownAt, asKnownAt: revision.asKnownAt, provenanceRef }], proposedAt: revision.asKnownAt };
      const classification = this.verifier.classify(classificationInput);
      if (classification.proposals.length === 0) return { publicationId: publication.publicationId, canonicalClaimId: `sec:${publication.externalId}`, status: "REFUSED", reason: classification.refusalReasons[0] ?? "N3A_REFUSED", documentSha256: sha256(body) };
      const proposal = classification.proposals[0];
      assertActive?.();
      const claimKey = claimKeyV1(proposal);
      const corroborationInput: CorroborationInputV1 = { contractVersion: "news-evidence-corroboration-v1", ruleSetVersion: "evidence-corroboration-rule-v1", proposal, claimKey, claimIdentities: [{ claimKey, canonicalClaimId: `sec:${publication.externalId}`, publicationRevisionId: revisionId, statementFingerprint: sha256(proposal.statement), asKnownAt: proposal.proposedAt }], claimEquivalences: [], cutoffAsKnownAt: proposal.proposedAt, evaluatedAt: revision.asKnownAt, evidence: [{ evidenceId: `n3b-${evidenceId}`, claimKey, originId: "sec-edgar-primary", sourceDocumentRef: publication.originalUrl, publicationRevisionId: revisionId, provenanceRef, contentLocator: "document:text:live-sec", statementHash: sha256(proposal.statement), support: "SUPPORTS", asKnownAt: revision.asKnownAt, availableAsKnownAt: revision.asKnownAt, proposalEvidenceId: evidenceId }], verificationProofs: [], origins: [{ originId: "sec-edgar-primary", sourceDocumentRef: publication.originalUrl, publicationRevisionId: revisionId, publisherRef: "sec-edgar", editorialGroupRef: null, sourceKind: "PRIMARY", provenanceRef, availableAsKnownAt: revision.asKnownAt, competence: [{ claimKey, status: "UNKNOWN", basis: "IDENTIFIED_REPORT", evidenceRefs: [] }] }], independence: [] };
      const corroboration = this.corroborator.evaluate(corroborationInput);
      const persistInput: PersistFactualInputV1 = { attestationId: "pending", canonicalClaimId: `sec:${publication.externalId}`, proposal, corroborationInput, corroboration, evidence: [{ evidenceId, evidenceKind: "N3A_PROPOSAL", claimKey, publicationRevisionId: revisionId, sourceDocumentRef: publication.originalUrl, contentLocator: "document:text:live-sec", provenanceRef, asKnownAt: revision.asKnownAt }], dependencies: [{ dependencyType: "N2_PUBLICATION_REVISION", dependencyRef: revisionId, asKnownAt: revision.asKnownAt }, { dependencyType: "N3A_PROPOSAL", dependencyRef: proposal.inputFingerprint, asKnownAt: proposal.proposedAt }, { dependencyType: "N3B_EVALUATION", dependencyRef: corroboration.fingerprint, asKnownAt: corroborationInput.evaluatedAt }] };
      const payload: Record<string, unknown> = { canonicalClaimId: persistInput.canonicalClaimId, taxonomyVersion: proposal.taxonomyVersion, category: proposal.category, logicalFingerprint: factualLogicalFingerprintV1(persistInput), ruleSetVersion: proposal.ruleSetVersion, claimType: proposal.claimType, statement: proposal.statement, subjectRef: proposal.subjectRef, objectRef: proposal.objectRef, occurredAt: proposal.occurredAt, scheduledFor: proposal.scheduledFor, confirmationStatus: corroboration.confirmationStatus, lifecycleStatus: corroboration.lifecycleStatus, polarity: corroboration.polarity, focalClaimKey: claimKey, publicationRevisionId: revisionId, qualityFlags: proposal.qualityFlags, evidence: persistInput.evidence, dependencies: persistInput.dependencies, relation: null };
      const attestationId = await this.attest(payload);
      assertActive?.();
      const persisted = await this.factual.persist({ ...persistInput, attestationId });
      return { publicationId: publication.publicationId, canonicalClaimId: `sec:${publication.externalId}`, status: "PERSISTED", reason: "FACTUAL_PIPELINE_COMPLETED", factEventId: persisted.factEventId, confirmationStatus: corroboration.confirmationStatus, documentSha256: sha256(body) };
    } catch (error) {
      throw error;
    }
  }

  async processPublications(publications: readonly NewsPublication[], signal?: AbortSignal, assertActive?: () => void): Promise<readonly FactualPipelineOutcomeV1[]> {
    const outcomes: FactualPipelineOutcomeV1[] = [];
    for (const publication of publications.slice(0, this.options.maxDocuments ?? publications.length)) {
      if (signal?.aborted) throw new Error("NEWS_EXECUTION_CANCELLED");
      try { outcomes.push(await this.processOne(publication, signal, assertActive)); }
      catch (error) {
        outcomes.push({
          publicationId: publication.publicationId,
          canonicalClaimId: publication.sourceId === "sec-edgar"
            ? `sec:${publication.externalId}`
            : `global:${publication.sourceId}:${publication.externalId}`,
          status: "FAILED_RETRYABLE",
          reason: error instanceof Error ? error.message : "NEWS_FACTUAL_RETRYABLE_FAILURE",
        });
      }
    }
    return outcomes;
  }
}
