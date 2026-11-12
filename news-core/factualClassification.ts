import { createHash } from "node:crypto";

export const FACT_CLASSIFICATION_CONTRACT_V1 = "news-fact-classification-v1" as const;
export const FACT_TAXONOMY_V1 = "news-fact-taxonomy-v1" as const;
export const DETERMINISTIC_RULES_V1 = "deterministic-rule-v1" as const;

export type FactCategoryV1 =
  | "EARNINGS"
  | "GUIDANCE_CHANGE"
  | "DIVIDEND_ANNOUNCEMENT"
  | "MERGER_ACQUISITION"
  | "MANAGEMENT_CHANGE"
  | "LEGAL_REGULATORY"
  | "CENTRAL_BANK_DECISION"
  | "MACROECONOMIC_RELEASE"
  | "ETF_FUND_CHANGE"
  | "OPERATIONAL_DISRUPTION"
  | "GEOPOLITICAL_EVENT"
  | "OTHER_REPORTED_EVENT";

export type ClaimTypeV1 =
  | "EVENT_OCCURRENCE"
  | "DECLARATION"
  | "SCHEDULED_EVENT"
  | "DENIAL"
  | "DOCUMENT_OBSERVATION";

export type ConfirmationStatusV1 = "PRIMARY_CONFIRMED" | "CORROBORATED" | "REPORTED" | "UNVERIFIED" | "DISPUTED";
export type LifecycleStatusV1 = "ACTIVE" | "CORRECTED" | "RETRACTED";
export type PolarityV1 = "AFFIRMATIVE" | "NEGATIVE" | "UNKNOWN";
export type EvidenceKindV1 = "STRUCTURED_FIELD" | "DOCUMENT_EXCERPT";

export type CommittedPublicationRevisionV1 = Readonly<{
  publicationRevisionId: string;
  publicationId: string;
  revisionNo: number;
  title: string;
  form: string;
  sourceDocumentRef: string;
  contentFingerprint: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  asKnownAt: string;
  qualityFlags: readonly string[];
  visibilityState: "COMMITTED";
}>;

export type ClassificationEvidenceV1 = Readonly<{
  evidenceId: string;
  publicationRevisionId: string;
  kind: EvidenceKindV1;
  sourceDocumentRef: string;
  contentLocator: string;
  excerpt: string | null;
  excerptHash: string | null;
  structuredField: string | null;
  structuredValue: string | null;
  observedAt: string;
  retrievedAt: string;
  asKnownAt: string;
  provenanceRef: string;
}>;

export type ClassificationInputV1 = Readonly<{
  contractVersion: typeof FACT_CLASSIFICATION_CONTRACT_V1;
  taxonomyVersion: typeof FACT_TAXONOMY_V1;
  ruleSetVersion: typeof DETERMINISTIC_RULES_V1;
  publicationRevision: CommittedPublicationRevisionV1;
  evidence: readonly ClassificationEvidenceV1[];
  proposedAt: string;
}>;

export type ClassificationProposalV1 = Readonly<{
  contractVersion: typeof FACT_CLASSIFICATION_CONTRACT_V1;
  taxonomyVersion: typeof FACT_TAXONOMY_V1;
  ruleSetVersion: typeof DETERMINISTIC_RULES_V1;
  category: FactCategoryV1;
  claimType: ClaimTypeV1;
  statement: string;
  subjectRef: string | null;
  objectRef: string | null;
  occurredAt: string | null;
  scheduledFor: string | null;
  confirmationStatus: ConfirmationStatusV1;
  lifecycleStatus: LifecycleStatusV1;
  polarity: PolarityV1;
  publicationRevisionId: string;
  evidenceIds: readonly string[];
  evidenceRefs: readonly { evidenceId: string; sourceDocumentRef: string; contentLocator: string }[];
  dependencyAsKnownAt: string;
  proposedAt: string;
  ruleId: string;
  justification: string;
  qualityFlags: readonly string[];
  inputFingerprint: string;
}>;

export type DocumentaryObservationV1 = Readonly<{
  publicationRevisionId: string;
  sourceDocumentRef: string;
  form: string;
  evidenceIds: readonly string[];
  inputFingerprint: string;
  reason: string;
}>;

export type ClassificationResultV1 = Readonly<{
  proposals: readonly ClassificationProposalV1[];
  documentaryObservations: readonly DocumentaryObservationV1[];
  refusalReasons: readonly string[];
}>;

export interface FactClassifierV1 {
  classify(input: ClassificationInputV1): ClassificationResultV1;
}

type Rule = Readonly<{
  id: string;
  category: FactCategoryV1;
  claimType: ClaimTypeV1;
  pattern: RegExp;
  futurePattern?: RegExp;
  negativePattern?: RegExp;
  statement: (text: string) => string;
}>;

const RULES: readonly Rule[] = [
  { id: "N3A-MANAGEMENT-APPOINTMENT-001", category: "MANAGEMENT_CHANGE", claimType: "DECLARATION", pattern: /\b(?:appoints?|names?|named|appointed)\b.{0,100}\b(?:as|to be)\b\s+(?:the\s+)?(?:chief executive officer|ceo|chief financial officer|cfo|chair(?:man|woman)?|director|president)\b/i, statement: text => text },
  { id: "N3A-DIVIDEND-DECLARED-001", category: "DIVIDEND_ANNOUNCEMENT", claimType: "DECLARATION", pattern: /\b(?:declares?|declared|announces?|announced)\b.{0,100}\bdividend\b/i, statement: text => text },
  { id: "N3A-MA-ANNOUNCED-001", category: "MERGER_ACQUISITION", claimType: "DECLARATION", pattern: /\b(?:announces?|announced|agrees?|agreed|enter(?:s|ed) into|expects?|expected|plans?)\b.{0,120}\b(?:acqui(?:re|red|sition)|merger|takeover|combination)\b/i, futurePattern: /\b(?:to acquire|will acquire|plans? to acquire|expects? to (?:acquire|complete))\b/i, statement: text => text },
  { id: "N3A-GUIDANCE-CHANGE-001", category: "GUIDANCE_CHANGE", claimType: "DECLARATION", pattern: /\b(?:raises?|raised|lowers?|lowered|updates?|updated|revises?|revised)\b.{0,80}\bguidance\b/i, statement: text => text },
  { id: "N3A-EARNINGS-REPORTED-001", category: "EARNINGS", claimType: "DECLARATION", pattern: /\b(?:reports?|reported|announces?|announced)\b.{0,100}\b(?:earnings|revenue|net income|profit|loss)\b/i, statement: text => text },
  { id: "N3A-CENTRAL-BANK-DECISION-001", category: "CENTRAL_BANK_DECISION", claimType: "DECLARATION", pattern: /\b(?:raises?|raised|cuts?|cut|holds?|held|maintains?|maintained)\b.{0,80}\b(?:interest rate|policy rate|rates)\b/i, statement: text => text },
  { id: "N3A-LEGAL-REGULATORY-001", category: "LEGAL_REGULATORY", claimType: "EVENT_OCCURRENCE", pattern: /\b(?:fined|sanctioned|charged|sued|settled|convicted|approved by|cleared by|ordered by)\b/i, statement: text => text },
  { id: "N3A-OPERATIONAL-DISRUPTION-001", category: "OPERATIONAL_DISRUPTION", claimType: "EVENT_OCCURRENCE", pattern: /\b(?:outage|disruption|suspends?|suspended|halted|shutdown|service interruption)\b/i, statement: text => text },
  { id: "N3A-MACRO-RELEASE-001", category: "MACROECONOMIC_RELEASE", claimType: "DECLARATION", pattern: /\b(?:released?|release of|published?)\b.{0,100}\b(?:inflation|gdp|gross domestic product|unemployment|cpi|pmi)\b/i, statement: text => text },
  { id: "N3A-ETF-CHANGE-001", category: "ETF_FUND_CHANGE", claimType: "DECLARATION", pattern: /\b(?:etf|fund)\b.{0,100}\b(?:holdings|rebalanced|launched|launches|changed|changes)\b/i, statement: text => text },
  { id: "N3A-GEOPOLITICAL-001", category: "GEOPOLITICAL_EVENT", claimType: "EVENT_OCCURRENCE", pattern: /\b(?:ceasefire|sanctions?|invasion|military operation|armed conflict|treaty)\b/i, statement: text => text },
];

const ISO = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const CATEGORY = new Set<FactCategoryV1>(RULES.map(rule => rule.category).concat(["OTHER_REPORTED_EVENT"]));
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
const normalizedText = (text: string): string => text.replace(/\s+/g, " ").trim();
const hasFutureLanguage = (text: string, rule: Rule): boolean => Boolean(rule.futurePattern?.test(text) || /\b(?:will|plans? to|expects? to|scheduled to|set to)\b/i.test(text));
const hasNegativeLanguage = (text: string): boolean => /\b(?:denies?|denied|rejects?|rejected|not|no|never)\b/i.test(text);

function validateInput(input: ClassificationInputV1): void {
  if (input.contractVersion !== FACT_CLASSIFICATION_CONTRACT_V1 || input.taxonomyVersion !== FACT_TAXONOMY_V1 || input.ruleSetVersion !== DETERMINISTIC_RULES_V1) throw new Error("N3A_CONTRACT_VERSION_UNSUPPORTED");
  const revision = input.publicationRevision;
  if (revision.visibilityState !== "COMMITTED" || !revision.publicationRevisionId || !revision.sourceDocumentRef || !ISO(revision.ingestedAt) || !ISO(revision.asKnownAt) || !ISO(input.proposedAt)) throw new Error("N3A_REVISION_NOT_COMMITTED");
  if (Date.parse(revision.ingestedAt) > Date.parse(revision.asKnownAt)) throw new Error("N3A_REVISION_TIME_INVALID");
  const ids = new Set<string>();
  for (const evidence of input.evidence) {
    if (ids.has(evidence.evidenceId) || evidence.publicationRevisionId !== revision.publicationRevisionId || !evidence.sourceDocumentRef || !evidence.contentLocator || !evidence.provenanceRef || !ISO(evidence.observedAt) || !ISO(evidence.retrievedAt) || !ISO(evidence.asKnownAt)) throw new Error("N3A_EVIDENCE_INVALID");
    if (evidence.kind === "DOCUMENT_EXCERPT" && (!evidence.excerpt || !evidence.excerptHash)) throw new Error("N3A_EXCERPT_REQUIRED");
    if (evidence.kind === "STRUCTURED_FIELD" && (!evidence.structuredField || evidence.structuredValue === null)) throw new Error("N3A_STRUCTURED_FIELD_REQUIRED");
    if (evidence.kind === "STRUCTURED_FIELD" && (evidence.structuredField === "occurredAt" || evidence.structuredField === "scheduledFor") && !ISO(evidence.structuredValue)) throw new Error("N3A_STRUCTURED_DATE_INVALID");
    if (Date.parse(evidence.asKnownAt) < Date.parse(revision.asKnownAt)) throw new Error("N3A_EVIDENCE_PRECEDES_REVISION");
    if (evidence.excerpt && evidence.excerptHash !== sha256(evidence.excerpt)) throw new Error("N3A_EXCERPT_HASH_MISMATCH");
    ids.add(evidence.evidenceId);
  }
  if (Date.parse(input.proposedAt) < Math.max(Date.parse(revision.asKnownAt), ...input.evidence.map(evidence => Date.parse(evidence.asKnownAt)))) throw new Error("N3A_PROPOSAL_PRECEDES_DEPENDENCY");
}

export class DeterministicFactClassifierV1 implements FactClassifierV1 {
  classify(input: ClassificationInputV1): ClassificationResultV1 {
    validateInput(input);
    const revision = input.publicationRevision;
    const evidenceText = input.evidence.filter(evidence => evidence.kind === "DOCUMENT_EXCERPT" && evidence.excerpt).map(evidence => evidence.excerpt as string).join(" ");
    const documentaryEvidence = input.evidence.filter(evidence => evidence.kind === "STRUCTURED_FIELD" && evidence.structuredField === "document-observation");
    const documentaryObservations = documentaryEvidence.length > 0 || input.evidence.some(evidence => evidence.kind === "STRUCTURED_FIELD" && evidence.structuredField === "form")
      ? [{ publicationRevisionId: revision.publicationRevisionId, sourceDocumentRef: revision.sourceDocumentRef, form: revision.form, evidenceIds: input.evidence.filter(evidence => evidence.kind === "STRUCTURED_FIELD").map(evidence => evidence.evidenceId), inputFingerprint: sha256(stable(input)), reason: "document-observation-only" }]
      : [];
    if (!evidenceText) return { proposals: [], documentaryObservations, refusalReasons: ["N3A_FACTUAL_EXCERPT_UNAVAILABLE"] };

    const text = normalizedText(evidenceText);
    const proposals: ClassificationProposalV1[] = [];
    for (const rule of RULES) {
      if (!rule.pattern.test(text)) continue;
      const future = hasFutureLanguage(text, rule);
      const negative = hasNegativeLanguage(text);
      const evidenceRefs = input.evidence.filter(evidence => evidence.kind === "DOCUMENT_EXCERPT" && evidence.excerpt).map(evidence => ({ evidenceId: evidence.evidenceId, sourceDocumentRef: evidence.sourceDocumentRef, contentLocator: evidence.contentLocator }));
      const dependencyAsKnownAt = new Date(Math.max(Date.parse(revision.asKnownAt), ...input.evidence.map(evidence => Date.parse(evidence.asKnownAt)))).toISOString();
      const scheduledFor = input.evidence.find(evidence => evidence.kind === "STRUCTURED_FIELD" && evidence.structuredField === "scheduledFor")?.structuredValue ?? null;
      const occurredAt = input.evidence.find(evidence => evidence.kind === "STRUCTURED_FIELD" && evidence.structuredField === "occurredAt")?.structuredValue ?? null;
      const proposalBase = { contractVersion: FACT_CLASSIFICATION_CONTRACT_V1, taxonomyVersion: FACT_TAXONOMY_V1, ruleSetVersion: DETERMINISTIC_RULES_V1, category: rule.category, claimType: future ? "SCHEDULED_EVENT" as const : negative ? "DENIAL" as const : rule.claimType, statement: rule.statement(text), subjectRef: null, objectRef: null, occurredAt: future ? null : occurredAt, scheduledFor: future ? scheduledFor : null, confirmationStatus: "REPORTED" as const, lifecycleStatus: "ACTIVE" as const, polarity: negative ? "NEGATIVE" as const : "AFFIRMATIVE" as const, publicationRevisionId: revision.publicationRevisionId, evidenceIds: evidenceRefs.map(evidence => evidence.evidenceId), evidenceRefs, dependencyAsKnownAt, proposedAt: input.proposedAt, ruleId: rule.id, justification: `Matched ${rule.id} against a persisted document excerpt.`, qualityFlags: [...revision.qualityFlags], inputFingerprint: "" };
      proposals.push({ ...proposalBase, inputFingerprint: sha256(stable(proposalBase)) });
    }
    return { proposals, documentaryObservations, refusalReasons: proposals.length === 0 ? ["N3A_NO_CONTROLLED_RULE_MATCH"] : [] };
  }
}

export function assertFactCategoryV1(value: unknown): asserts value is FactCategoryV1 {
  if (typeof value !== "string" || !CATEGORY.has(value as FactCategoryV1)) throw new Error("N3A_UNKNOWN_TAXONOMY_CATEGORY");
}

export function excerptHashV1(excerpt: string): string { return sha256(excerpt); }
