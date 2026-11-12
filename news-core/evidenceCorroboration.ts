import { createHash } from "node:crypto";
import type { ClassificationProposalV1, PolarityV1 } from "./factualClassification";

export const EVIDENCE_CORROBORATION_CONTRACT_V1 = "news-evidence-corroboration-v1" as const;
export const EVIDENCE_CORROBORATION_RULES_V1 = "evidence-corroboration-rule-v1" as const;
export type ConfirmationStatusV1 = "PRIMARY_CONFIRMED" | "CORROBORATED" | "REPORTED" | "UNVERIFIED" | "DISPUTED";
export type EditorialIndependenceV1 = "PROVEN_DEPENDENT" | "PROVEN_INDEPENDENT" | "UNKNOWN";
export type SourceKindV1 = "PRIMARY" | "SECONDARY" | "REPUBLICATION";
export type ClaimSupportV1 = "SUPPORTS" | "CONTESTS";
export type CompetenceStatusV1 = "COMPETENT" | "NOT_COMPETENT" | "UNKNOWN";

export type ClaimIdentityV1 = Readonly<{ claimKey: string; canonicalClaimId: string; publicationRevisionId: string; statementFingerprint: string; asKnownAt: string }>;
export type ClaimCompetenceV1 = Readonly<{ claimKey: string; status: CompetenceStatusV1; basis: "PRIMARY_RECORD" | "DIRECT_STATEMENT" | "IDENTIFIED_REPORT" | "NO_POSITIVE_BASIS"; evidenceRefs: readonly string[] }>;
export type SourceOriginV1 = Readonly<{ originId: string; sourceDocumentRef: string; publicationRevisionId: string; publisherRef: string; editorialGroupRef: string | null; sourceKind: SourceKindV1; provenanceRef: string; availableAsKnownAt: string; competence: readonly ClaimCompetenceV1[] }>;
export type ClaimEvidenceV1 = Readonly<{ evidenceId: string; claimKey: string; originId: string; sourceDocumentRef: string; publicationRevisionId: string; provenanceRef: string; contentLocator: string; statementHash: string; support: ClaimSupportV1; asKnownAt: string; availableAsKnownAt: string; proposalEvidenceId: string | null }>;
export type VerificationProofV1 = Readonly<{ proofId: string; kind: "ORIGIN_AUTHORITY" | "INDEPENDENCE" | "CLAIM_EQUIVALENCE"; originId: string | null; leftOriginId: string | null; rightOriginId: string | null; claimKeys: readonly string[]; canonicalClaimId: string | null; authorityLevel: "PRIMARY" | "COMPETENT" | null; sourceDocumentRef: string; provenanceRef: string; contentLocator: string; supports: boolean; asKnownAt: string; availableAsKnownAt: string }>;
export type IndependenceEvidenceV1 = Readonly<{ relationId: string; leftOriginId: string; rightOriginId: string; status: EditorialIndependenceV1; basis: "PERSISTED_PROVENANCE" | "EXPLICIT_REPUBLICATION_LINK" | "EXPLICIT_SEPARATE_ORIGIN"; evidenceRefs: readonly string[]; asKnownAt: string }>;
export type ClaimEquivalenceV1 = Readonly<{ relationId: string; leftClaimKey: string; rightClaimKey: string; canonicalClaimId: string; evidenceRefs: readonly string[]; asKnownAt: string }>;

export type CorroborationInputV1 = Readonly<{
  contractVersion: typeof EVIDENCE_CORROBORATION_CONTRACT_V1;
  ruleSetVersion: typeof EVIDENCE_CORROBORATION_RULES_V1;
  proposal: ClassificationProposalV1;
  claimKey: string;
  claimIdentities: readonly ClaimIdentityV1[];
  claimEquivalences: readonly ClaimEquivalenceV1[];
  cutoffAsKnownAt: string;
  evidence: readonly ClaimEvidenceV1[];
  verificationProofs: readonly VerificationProofV1[];
  origins: readonly SourceOriginV1[];
  independence: readonly IndependenceEvidenceV1[];
  evaluatedAt: string;
}>;

export type CorroborationResultV1 = Readonly<{ contractVersion: typeof EVIDENCE_CORROBORATION_CONTRACT_V1; ruleSetVersion: typeof EVIDENCE_CORROBORATION_RULES_V1; claimKey: string; canonicalClaimId: string; confirmationStatus: ConfirmationStatusV1; lifecycleStatus: ClassificationProposalV1["lifecycleStatus"]; polarity: PolarityV1; supportingOriginIds: readonly string[]; contestingOriginIds: readonly string[]; countedEditorialGroups: readonly string[]; independence: EditorialIndependenceV1; reasons: readonly string[]; evaluatedAt: string; fingerprint: string }>;
export interface EvidenceCorroboratorV1 { evaluate(input: CorroborationInputV1): CorroborationResultV1; }

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const stable = (value: unknown): string => { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`; };
const ISO = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const pairKey = (left: string, right: string): string => [left, right].sort().join("::");
const connectedClaimKeys = (input: CorroborationInputV1, claims: Map<string, ClaimIdentityV1>, proofs: Map<string, VerificationProofV1>): Set<string> => {
  const connected = new Set([input.claimKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of input.claimEquivalences.slice().sort((left, right) => `${left.leftClaimKey}:${left.rightClaimKey}`.localeCompare(`${right.leftClaimKey}:${right.rightClaimKey}`))) {
      const left = claims.get(relation.leftClaimKey);
      const right = claims.get(relation.rightClaimKey);
      const visible = left && right && Date.parse(left.asKnownAt) <= Date.parse(input.cutoffAsKnownAt) && Date.parse(right.asKnownAt) <= Date.parse(input.cutoffAsKnownAt) && Date.parse(relation.asKnownAt) <= Date.parse(input.cutoffAsKnownAt) && relation.evidenceRefs.every(ref => { const proof = proofs.get(ref); return Boolean(proof && Date.parse(proof.availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt)); });
      if (visible && (connected.has(relation.leftClaimKey) || connected.has(relation.rightClaimKey))) {
        const before = connected.size;
        connected.add(relation.leftClaimKey);
        connected.add(relation.rightClaimKey);
        changed ||= connected.size !== before;
      }
    }
  }
  return connected;
};

/** Publication-local identity. Cross-publication matching requires ClaimEquivalenceV1. */
export function claimKeyV1(proposal: ClassificationProposalV1): string { return sha256(stable({ category: proposal.category, claimType: proposal.claimType, statement: proposal.statement, subjectRef: proposal.subjectRef, objectRef: proposal.objectRef, occurredAt: proposal.occurredAt, scheduledFor: proposal.scheduledFor, polarity: proposal.polarity, publicationRevisionId: proposal.publicationRevisionId })); }

function validateInput(input: CorroborationInputV1): void {
  if (input.contractVersion !== EVIDENCE_CORROBORATION_CONTRACT_V1 || input.ruleSetVersion !== EVIDENCE_CORROBORATION_RULES_V1) throw new Error("N3B_CONTRACT_VERSION_UNSUPPORTED");
  if (!ISO(input.cutoffAsKnownAt) || !ISO(input.evaluatedAt) || input.claimKey !== claimKeyV1(input.proposal) || Date.parse(input.proposal.dependencyAsKnownAt) > Date.parse(input.cutoffAsKnownAt) || Date.parse(input.proposal.proposedAt) > Date.parse(input.cutoffAsKnownAt)) throw new Error("N3B_CLAIM_IDENTITY_INVALID");
  const claims = new Map(input.claimIdentities.map(claim => [claim.claimKey, claim]));
  const focalClaim = claims.get(input.claimKey);
  if (!focalClaim || focalClaim.publicationRevisionId !== input.proposal.publicationRevisionId || !focalClaim.canonicalClaimId || !ISO(focalClaim.asKnownAt) || Date.parse(focalClaim.asKnownAt) > Date.parse(input.cutoffAsKnownAt)) throw new Error("N3B_CLAIM_IDENTITY_INVALID");
  const origins = new Set<string>();
  for (const origin of input.origins) { if (origins.has(origin.originId) || !origin.originId || !origin.sourceDocumentRef || !origin.publicationRevisionId || !origin.publisherRef || !origin.provenanceRef || !ISO(origin.availableAsKnownAt)) throw new Error("N3B_ORIGIN_INVALID"); origins.add(origin.originId); }
  const proofs = new Map<string, VerificationProofV1>();
  for (const proof of input.verificationProofs) {
    if (proofs.has(proof.proofId) || !proof.proofId || !ISO(proof.asKnownAt) || !ISO(proof.availableAsKnownAt) || Date.parse(proof.asKnownAt) > Date.parse(proof.availableAsKnownAt) || !proof.sourceDocumentRef || !proof.provenanceRef || !proof.contentLocator || !proof.supports) throw new Error("N3B_PROOF_INVALID");
    if (proof.originId && !origins.has(proof.originId) || proof.leftOriginId && !origins.has(proof.leftOriginId) || proof.rightOriginId && !origins.has(proof.rightOriginId)) throw new Error("N3B_PROOF_ORIGIN_INVALID");
    if (proof.kind === "ORIGIN_AUTHORITY" && (!proof.originId || proof.claimKeys.length !== 1)) throw new Error("N3B_AUTHORITY_PROOF_INVALID");
    if (proof.kind === "INDEPENDENCE" && (!proof.leftOriginId || !proof.rightOriginId || proof.leftOriginId === proof.rightOriginId)) throw new Error("N3B_INDEPENDENCE_PROOF_INVALID");
    if (proof.kind === "CLAIM_EQUIVALENCE" && (proof.claimKeys.length !== 2 || !proof.canonicalClaimId)) throw new Error("N3B_EQUIVALENCE_PROOF_INVALID");
    proofs.set(proof.proofId, proof);
  }
  for (const relation of input.claimEquivalences) {
    if (!claims.has(relation.leftClaimKey) || !claims.has(relation.rightClaimKey) || relation.leftClaimKey === relation.rightClaimKey || claims.get(relation.leftClaimKey)?.canonicalClaimId !== relation.canonicalClaimId || claims.get(relation.rightClaimKey)?.canonicalClaimId !== relation.canonicalClaimId || !ISO(relation.asKnownAt) || relation.evidenceRefs.length === 0) throw new Error("N3B_EQUIVALENCE_INVALID");
    for (const ref of relation.evidenceRefs) { const proof = proofs.get(ref); if (!proof || proof.kind !== "CLAIM_EQUIVALENCE" || proof.claimKeys.slice().sort().join("::") !== [relation.leftClaimKey, relation.rightClaimKey].sort().join("::") || proof.canonicalClaimId !== relation.canonicalClaimId) throw new Error("N3B_EQUIVALENCE_PROOF_MISMATCH"); }
  }
  const evidenceIds = new Set<string>();
  for (const evidence of input.evidence) {
    const origin = input.origins.find(item => item.originId === evidence.originId);
    const supportedClaim = claims.get(evidence.claimKey);
    if (evidenceIds.has(evidence.evidenceId) || !origin || !supportedClaim || evidence.publicationRevisionId !== supportedClaim.publicationRevisionId || evidence.sourceDocumentRef !== origin.sourceDocumentRef || evidence.publicationRevisionId !== origin.publicationRevisionId || evidence.provenanceRef !== origin.provenanceRef || !evidence.contentLocator || !evidence.statementHash || !ISO(evidence.asKnownAt) || !ISO(evidence.availableAsKnownAt) || Date.parse(evidence.asKnownAt) > Date.parse(evidence.availableAsKnownAt)) throw new Error("N3B_EVIDENCE_INVALID");
    if (evidence.proposalEvidenceId) { const proposalRef = input.proposal.evidenceRefs.find(ref => ref.evidenceId === evidence.proposalEvidenceId); if (!proposalRef || proposalRef.sourceDocumentRef !== evidence.sourceDocumentRef || proposalRef.contentLocator !== evidence.contentLocator) throw new Error("N3B_PROPOSAL_EVIDENCE_MISMATCH"); }
    const belongsToProposal = evidence.publicationRevisionId === input.proposal.publicationRevisionId && input.proposal.evidenceRefs.some(ref => ref.sourceDocumentRef === evidence.sourceDocumentRef);
    if (belongsToProposal && !evidence.proposalEvidenceId) throw new Error("N3B_PROPOSAL_EVIDENCE_REQUIRED");
    evidenceIds.add(evidence.evidenceId);
  }
  for (const origin of input.origins) for (const competence of origin.competence) if (competence.status === "COMPETENT") { const requiredAuthority = competence.basis === "PRIMARY_RECORD" ? "PRIMARY" : "COMPETENT"; if (!competence.evidenceRefs.length || competence.claimKey !== input.claimKey || competence.evidenceRefs.some(ref => !evidenceIds.has(ref) || !input.evidence.find(evidence => evidence.evidenceId === ref && evidence.originId === origin.originId && evidence.claimKey === input.claimKey && evidence.support === "SUPPORTS")) || ![...proofs.values()].some(proof => proof.kind === "ORIGIN_AUTHORITY" && proof.originId === origin.originId && proof.claimKeys.length === 1 && proof.claimKeys[0] === input.claimKey && proof.authorityLevel === requiredAuthority && proof.sourceDocumentRef === origin.sourceDocumentRef && proof.provenanceRef === origin.provenanceRef && Date.parse(proof.availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt))) throw new Error("N3B_COMPETENCE_PROOF_MISSING"); }
  const relationStatuses = new Map<string, Set<EditorialIndependenceV1>>();
  for (const relation of input.independence) {
    if (!origins.has(relation.leftOriginId) || !origins.has(relation.rightOriginId) || relation.leftOriginId === relation.rightOriginId || !ISO(relation.asKnownAt) || relation.evidenceRefs.length === 0) throw new Error("N3B_INDEPENDENCE_INVALID");
    for (const ref of relation.evidenceRefs) { const proof = proofs.get(ref); if (!proof || proof.kind !== "INDEPENDENCE" || pairKey(proof.leftOriginId as string, proof.rightOriginId as string) !== pairKey(relation.leftOriginId, relation.rightOriginId)) throw new Error("N3B_INDEPENDENCE_PROOF_MISMATCH"); }
    const key = pairKey(relation.leftOriginId, relation.rightOriginId); const statuses = relationStatuses.get(key) ?? new Set<EditorialIndependenceV1>(); statuses.add(relation.status); relationStatuses.set(key, statuses);
  }
  for (const statuses of relationStatuses.values()) if (statuses.size > 1) throw new Error("N3B_INDEPENDENCE_CONTRADICTION");
}

export class DeterministicEvidenceCorroboratorV1 implements EvidenceCorroboratorV1 {
  evaluate(input: CorroborationInputV1): CorroborationResultV1 {
    validateInput(input);
    const origins = new Map(input.origins.map(origin => [origin.originId, origin]));
    const focal = input.claimIdentities.find(claim => claim.claimKey === input.claimKey) as ClaimIdentityV1;
    const validClaimKeys = connectedClaimKeys(input, new Map(input.claimIdentities.map(claim => [claim.claimKey, claim])), new Map(input.verificationProofs.map(proof => [proof.proofId, proof])));
    const validEvidence = input.evidence.filter(evidence => validClaimKeys.has(evidence.claimKey) && Date.parse(evidence.availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt) && Date.parse((origins.get(evidence.originId) as SourceOriginV1).availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt));
    const supportingOriginIds = [...new Set(validEvidence.filter(evidence => evidence.support === "SUPPORTS").map(evidence => evidence.originId))];
    const contestingOriginIds = [...new Set(validEvidence.filter(evidence => evidence.support === "CONTESTS").map(evidence => evidence.originId))];
    const supportOrigins = supportingOriginIds.map(originId => origins.get(originId) as SourceOriginV1);
    const countedEditorialGroups = [...new Set(supportOrigins.map(origin => origin.editorialGroupRef ?? `origin:${origin.originId}`))];
    const proofMap = new Map(input.verificationProofs.map(proof => [proof.proofId, proof]));
    const independentPairs = supportOrigins.flatMap((left, index) => supportOrigins.slice(index + 1).map(right => pairKey(left.originId, right.originId))).filter(key => input.independence.some(relation => relation.status === "PROVEN_INDEPENDENT" && Date.parse(relation.asKnownAt) <= Date.parse(input.cutoffAsKnownAt) && relation.evidenceRefs.every(ref => Date.parse((proofMap.get(ref) as VerificationProofV1).availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt)) && pairKey(relation.leftOriginId, relation.rightOriginId) === key));
    const allPairsIndependent = supportOrigins.length > 1 && countedEditorialGroups.length > 1 && independentPairs.length === (supportOrigins.length * (supportOrigins.length - 1)) / 2;
    const primary = supportOrigins.some(origin => origin.sourceKind === "PRIMARY" && origin.competence.some(item => item.claimKey === input.claimKey && item.status === "COMPETENT" && item.basis === "PRIMARY_RECORD"));
    const confirmationStatus: ConfirmationStatusV1 = contestingOriginIds.length > 0 ? "DISPUTED" : primary ? "PRIMARY_CONFIRMED" : allPairsIndependent ? "CORROBORATED" : supportingOriginIds.length > 0 ? "REPORTED" : "UNVERIFIED";
    const independence: EditorialIndependenceV1 = allPairsIndependent ? "PROVEN_INDEPENDENT" : "UNKNOWN";
    const reasons = confirmationStatus === "PRIMARY_CONFIRMED" ? ["A competent primary origin directly supports the exact claim with resolved authority evidence."] : confirmationStatus === "CORROBORATED" ? ["Equivalent claims have positive PIT-visible evidence of independence and support from distinct editorial origins."] : confirmationStatus === "DISPUTED" ? ["Persisted evidence materially contests the claim; prior support remains represented."] : confirmationStatus === "REPORTED" ? ["An identified source supports the exact claim, but verified primary authority or independent corroboration is insufficient."] : ["No valid pre-cutoff evidence supports the exact claim."];
    const logicalProposal = { contractVersion: input.proposal.contractVersion, taxonomyVersion: input.proposal.taxonomyVersion, ruleSetVersion: input.proposal.ruleSetVersion, category: input.proposal.category, claimType: input.proposal.claimType, statement: input.proposal.statement, subjectRef: input.proposal.subjectRef, objectRef: input.proposal.objectRef, occurredAt: input.proposal.occurredAt, scheduledFor: input.proposal.scheduledFor, confirmationStatus: input.proposal.confirmationStatus, lifecycleStatus: input.proposal.lifecycleStatus, polarity: input.proposal.polarity, publicationRevisionId: input.proposal.publicationRevisionId, evidenceIds: input.proposal.evidenceIds, evidenceRefs: input.proposal.evidenceRefs, dependencyAsKnownAt: input.proposal.dependencyAsKnownAt, ruleId: input.proposal.ruleId, qualityFlags: input.proposal.qualityFlags, inputFingerprint: input.proposal.inputFingerprint };
    const fingerprint = sha256(stable({ contractVersion: input.contractVersion, ruleSetVersion: input.ruleSetVersion, claimKey: input.claimKey, canonicalClaimId: focal.canonicalClaimId, cutoffAsKnownAt: input.cutoffAsKnownAt, proposal: logicalProposal, evidence: [...validEvidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)), proofs: input.verificationProofs.filter(proof => Date.parse(proof.availableAsKnownAt) <= Date.parse(input.cutoffAsKnownAt)).sort((left, right) => left.proofId.localeCompare(right.proofId)), origins: [...input.origins].sort((left, right) => left.originId.localeCompare(right.originId)), independence: input.independence.filter(relation => Date.parse(relation.asKnownAt) <= Date.parse(input.cutoffAsKnownAt)).sort((left, right) => `${left.leftOriginId}:${left.rightOriginId}:${left.status}`.localeCompare(`${right.leftOriginId}:${right.rightOriginId}:${right.status}`)), claimEquivalences: input.claimEquivalences.filter(relation => Date.parse(relation.asKnownAt) <= Date.parse(input.cutoffAsKnownAt)).sort((left, right) => `${left.leftClaimKey}:${left.rightClaimKey}`.localeCompare(`${right.leftClaimKey}:${right.rightClaimKey}`)) }));
    return { contractVersion: input.contractVersion, ruleSetVersion: input.ruleSetVersion, claimKey: input.claimKey, canonicalClaimId: focal.canonicalClaimId, confirmationStatus, lifecycleStatus: input.proposal.lifecycleStatus, polarity: input.proposal.polarity, supportingOriginIds, contestingOriginIds, countedEditorialGroups, independence, reasons, evaluatedAt: input.evaluatedAt, fingerprint };
  }
}
