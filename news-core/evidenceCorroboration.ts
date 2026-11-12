import { createHash } from "node:crypto";
import type { ClassificationProposalV1, PolarityV1 } from "./factualClassification";

export const EVIDENCE_CORROBORATION_CONTRACT_V1 = "news-evidence-corroboration-v1" as const;
export const EVIDENCE_CORROBORATION_RULES_V1 = "evidence-corroboration-rule-v1" as const;

export type ConfirmationStatusV1 = "PRIMARY_CONFIRMED" | "CORROBORATED" | "REPORTED" | "UNVERIFIED" | "DISPUTED";
export type EditorialIndependenceV1 = "PROVEN_DEPENDENT" | "PROVEN_INDEPENDENT" | "UNKNOWN";
export type SourceKindV1 = "PRIMARY" | "SECONDARY" | "REPUBLICATION";
export type ClaimSupportV1 = "SUPPORTS" | "CONTESTS";
export type CompetenceStatusV1 = "COMPETENT" | "NOT_COMPETENT" | "UNKNOWN";

export type ClaimCompetenceV1 = Readonly<{
  claimKey: string;
  status: CompetenceStatusV1;
  basis: "PRIMARY_RECORD" | "DIRECT_STATEMENT" | "IDENTIFIED_REPORT" | "NO_POSITIVE_BASIS";
  evidenceRefs: readonly string[];
}>;

export type SourceOriginV1 = Readonly<{
  originId: string;
  sourceDocumentRef: string;
  publicationRevisionId: string;
  publisherRef: string;
  editorialGroupRef: string | null;
  sourceKind: SourceKindV1;
  provenanceRef: string;
  availableAsKnownAt: string;
  competence: readonly ClaimCompetenceV1[];
}>;

export type ClaimEvidenceV1 = Readonly<{
  evidenceId: string;
  claimKey: string;
  originId: string;
  sourceDocumentRef: string;
  publicationRevisionId: string;
  provenanceRef: string;
  contentLocator: string;
  statementHash: string;
  support: ClaimSupportV1;
  asKnownAt: string;
  availableAsKnownAt: string;
  proposalEvidenceId: string | null;
}>;

export type IndependenceEvidenceV1 = Readonly<{
  relationId: string;
  leftOriginId: string;
  rightOriginId: string;
  status: EditorialIndependenceV1;
  basis: "PERSISTED_PROVENANCE" | "EXPLICIT_REPUBLICATION_LINK" | "EXPLICIT_SEPARATE_ORIGIN";
  evidenceRefs: readonly string[];
}>;

export type CorroborationInputV1 = Readonly<{
  contractVersion: typeof EVIDENCE_CORROBORATION_CONTRACT_V1;
  ruleSetVersion: typeof EVIDENCE_CORROBORATION_RULES_V1;
  proposal: ClassificationProposalV1;
  claimKey: string;
  cutoffAsKnownAt: string;
  evidence: readonly ClaimEvidenceV1[];
  origins: readonly SourceOriginV1[];
  independence: readonly IndependenceEvidenceV1[];
  evaluatedAt: string;
}>;

export type CorroborationResultV1 = Readonly<{
  contractVersion: typeof EVIDENCE_CORROBORATION_CONTRACT_V1;
  ruleSetVersion: typeof EVIDENCE_CORROBORATION_RULES_V1;
  claimKey: string;
  confirmationStatus: ConfirmationStatusV1;
  lifecycleStatus: ClassificationProposalV1["lifecycleStatus"];
  polarity: PolarityV1;
  supportingOriginIds: readonly string[];
  contestingOriginIds: readonly string[];
  countedEditorialGroups: readonly string[];
  independence: EditorialIndependenceV1;
  reasons: readonly string[];
  evaluatedAt: string;
  fingerprint: string;
}>;

export interface EvidenceCorroboratorV1 {
  evaluate(input: CorroborationInputV1): CorroborationResultV1;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
const ISO = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function claimKeyV1(proposal: ClassificationProposalV1): string {
  return sha256(stable({ category: proposal.category, claimType: proposal.claimType, statement: proposal.statement, subjectRef: proposal.subjectRef, objectRef: proposal.objectRef, occurredAt: proposal.occurredAt, scheduledFor: proposal.scheduledFor, polarity: proposal.polarity, publicationRevisionId: proposal.publicationRevisionId }));
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("::");
}

function validateInput(input: CorroborationInputV1): void {
  if (input.contractVersion !== EVIDENCE_CORROBORATION_CONTRACT_V1 || input.ruleSetVersion !== EVIDENCE_CORROBORATION_RULES_V1) throw new Error("N3B_CONTRACT_VERSION_UNSUPPORTED");
  if (!ISO(input.cutoffAsKnownAt) || !ISO(input.evaluatedAt) || input.claimKey !== claimKeyV1(input.proposal)) throw new Error("N3B_CLAIM_IDENTITY_INVALID");
  const origins = new Set<string>();
  for (const origin of input.origins) {
    if (origins.has(origin.originId) || !origin.originId || !origin.sourceDocumentRef || !origin.publicationRevisionId || !origin.publisherRef || !origin.provenanceRef || !ISO(origin.availableAsKnownAt)) throw new Error("N3B_ORIGIN_INVALID");
    origins.add(origin.originId);
    for (const competence of origin.competence) {
      if (competence.status === "COMPETENT" && competence.evidenceRefs.length === 0) throw new Error("N3B_COMPETENCE_UNSUPPORTED");
    }
  }
  const evidenceIds = new Set<string>();
  for (const evidence of input.evidence) {
    const origin = input.origins.find(item => item.originId === evidence.originId);
    if (evidenceIds.has(evidence.evidenceId) || !origin || evidence.claimKey !== input.claimKey || evidence.sourceDocumentRef !== origin.sourceDocumentRef || evidence.publicationRevisionId !== origin.publicationRevisionId || evidence.provenanceRef !== origin.provenanceRef || !evidence.contentLocator || !evidence.statementHash || !ISO(evidence.asKnownAt) || !ISO(evidence.availableAsKnownAt) || Date.parse(evidence.asKnownAt) > Date.parse(evidence.availableAsKnownAt)) throw new Error("N3B_EVIDENCE_INVALID");
    if (evidence.proposalEvidenceId) {
      const proposalRef = input.proposal.evidenceRefs.find(ref => ref.evidenceId === evidence.proposalEvidenceId);
      if (!proposalRef || proposalRef.sourceDocumentRef !== evidence.sourceDocumentRef || proposalRef.contentLocator !== evidence.contentLocator) throw new Error("N3B_PROPOSAL_EVIDENCE_MISMATCH");
    }
    evidenceIds.add(evidence.evidenceId);
  }
  for (const origin of input.origins) for (const competence of origin.competence) if (competence.status === "COMPETENT" && competence.evidenceRefs.some(reference => !evidenceIds.has(reference))) throw new Error("N3B_COMPETENCE_EVIDENCE_MISSING");
  const pairStatuses = new Map<string, Set<EditorialIndependenceV1>>();
  for (const relation of input.independence) {
    if (!origins.has(relation.leftOriginId) || !origins.has(relation.rightOriginId) || relation.leftOriginId === relation.rightOriginId || relation.evidenceRefs.length === 0) throw new Error("N3B_INDEPENDENCE_EVIDENCE_INVALID");
    const key = pairKey(relation.leftOriginId, relation.rightOriginId);
    const statuses = pairStatuses.get(key) ?? new Set<EditorialIndependenceV1>();
    statuses.add(relation.status);
    pairStatuses.set(key, statuses);
  }
  for (const statuses of pairStatuses.values()) if (statuses.size > 1) throw new Error("N3B_INDEPENDENCE_CONTRADICTION");
}

export class DeterministicEvidenceCorroboratorV1 implements EvidenceCorroboratorV1 {
  evaluate(input: CorroborationInputV1): CorroborationResultV1 {
    validateInput(input);
    const origins = new Map(input.origins.map(origin => [origin.originId, origin]));
    const validEvidence = input.evidence.filter(evidence => Date.parse(evidence.availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt) && Date.parse((origins.get(evidence.originId) as SourceOriginV1).availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt));
    const supportingOriginIds = [...new Set(validEvidence.filter(evidence => evidence.support === "SUPPORTS").map(evidence => evidence.originId))];
    const contestingOriginIds = [...new Set(validEvidence.filter(evidence => evidence.support === "CONTESTS").map(evidence => evidence.originId))];
    const supportOrigins = supportingOriginIds.map(originId => origins.get(originId) as SourceOriginV1);
    const countedEditorialGroups = [...new Set(supportOrigins.map(origin => origin.editorialGroupRef ?? `origin:${origin.originId}`))];
    const validRelations = input.independence.filter(relation => relation.status === "PROVEN_INDEPENDENT");
    const independentPairs = supportOrigins.flatMap((left, index) => supportOrigins.slice(index + 1).map(right => pairKey(left.originId, right.originId))).filter(key => validRelations.some(relation => pairKey(relation.leftOriginId, relation.rightOriginId) === key));
    const allPairsIndependent = supportOrigins.length > 1 && independentPairs.length === (supportOrigins.length * (supportOrigins.length - 1)) / 2 && countedEditorialGroups.length > 1;
    const primary = supportOrigins.some(origin => origin.sourceKind === "PRIMARY" && origin.competence.some(item => item.claimKey === input.claimKey && item.status === "COMPETENT" && ["PRIMARY_RECORD", "DIRECT_STATEMENT"].includes(item.basis)));
    const confirmationStatus: ConfirmationStatusV1 = contestingOriginIds.length > 0 ? "DISPUTED" : primary ? "PRIMARY_CONFIRMED" : allPairsIndependent ? "CORROBORATED" : supportingOriginIds.length > 0 ? "REPORTED" : "UNVERIFIED";
    const independence: EditorialIndependenceV1 = allPairsIndependent ? "PROVEN_INDEPENDENT" : supportOrigins.length > 1 ? "UNKNOWN" : "UNKNOWN";
    const reasons = confirmationStatus === "PRIMARY_CONFIRMED" ? ["A competent primary origin directly supports the exact claim."] : confirmationStatus === "CORROBORATED" ? ["At least two editorial origins have positive evidence of independence and support the exact claim."] : confirmationStatus === "DISPUTED" ? ["Persisted evidence materially contests the claim; prior evidence remains represented in the input."] : confirmationStatus === "REPORTED" ? ["An identified source supports the claim, but primary competence or independent corroboration is insufficient."] : ["No valid pre-cutoff evidence supports the exact claim."];
    const fingerprint = sha256(stable({ contractVersion: input.contractVersion, ruleSetVersion: input.ruleSetVersion, claimKey: input.claimKey, cutoffAsKnownAt: input.cutoffAsKnownAt, proposal: input.proposal, evidence: validEvidence, origins: input.origins, independence: input.independence }));
    return { contractVersion: input.contractVersion, ruleSetVersion: input.ruleSetVersion, claimKey: input.claimKey, confirmationStatus, lifecycleStatus: input.proposal.lifecycleStatus, polarity: input.proposal.polarity, supportingOriginIds, contestingOriginIds, countedEditorialGroups, independence, reasons, evaluatedAt: input.evaluatedAt, fingerprint };
  }
}
