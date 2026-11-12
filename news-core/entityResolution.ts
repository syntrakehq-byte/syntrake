export type EntityTargetScope = "ISSUER" | "INSTRUMENT" | "LISTING";
export type EntityMatchStatus = "EXACT" | "AMBIGUOUS" | "UNRESOLVED" | "REVIEW_REQUIRED";
export type EntityRelationType = "DIRECT" | "MENTION" | "SUBSIDIARY" | "INDIRECT_EXPOSURE";

export type EntityResolutionQuery = Readonly<{
  publicationId: string;
  publicationRevisionId: string;
  title: string;
  sourceDocumentRef: string;
  publishedAt: string | null;
}>;

export type EntityEvidence = Readonly<{
  evidenceId: string;
  evidenceKind: "OFFICIAL_REGISTRY" | "EXCHANGE_REFERENCE" | "PROVIDER_CATALOG" | "PUBLICATION_TEXT";
  sourceRef: string;
  observedAt: string;
  verified: boolean;
}>;

export type EntityCandidate = Readonly<{
  candidateRef: string;
  targetScope: EntityTargetScope;
  relationType: EntityRelationType;
  issuerId: string | null;
  instrumentId: string | null;
  listingId: string | null;
  evidence: readonly EntityEvidence[];
}>;

/** Versioned, read-only boundary compatible with Market Core main D0 contracts. */
export type MarketCoreResolutionV1 = Readonly<{
  contractVersion: "market-core-identity-v1";
  resolverVersion: string;
  status: EntityMatchStatus;
  selectedCandidateRef: string | null;
  reason: string;
  candidates: readonly EntityCandidate[];
}>;

export interface MarketCoreIdentityResolverV1 {
  readonly contractVersion: "market-core-identity-v1";
  readonly resolverVersion: string;
  resolve(query: EntityResolutionQuery): Promise<MarketCoreResolutionV1>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function validIso(value: unknown): value is string { return typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)); }

export function validateEntityResolution(query: EntityResolutionQuery, result: MarketCoreResolutionV1): MarketCoreResolutionV1 {
  if (!validId(query.publicationId) || !validId(query.publicationRevisionId) || !query.title || !/^https:\/\//.test(query.sourceDocumentRef)) throw new Error("NEWS_ENTITY_QUERY_INVALID");
  if (result.contractVersion !== "market-core-identity-v1" || !validId(result.resolverVersion) || !validId(result.reason) || !Array.isArray(result.candidates)) throw new Error("NEWS_ENTITY_RESOLUTION_INVALID");
  if (!["EXACT", "AMBIGUOUS", "UNRESOLVED", "REVIEW_REQUIRED"].includes(result.status)) throw new Error("NEWS_ENTITY_RESOLUTION_INVALID");
  if (result.status === "EXACT" && !validId(result.selectedCandidateRef)) throw new Error("NEWS_ENTITY_EXACT_SELECTION_INVALID");
  if (result.status !== "EXACT" && result.selectedCandidateRef !== null) throw new Error("NEWS_ENTITY_EXACT_SELECTION_INVALID");
  const candidateRefs = new Set<string>();
  for (const candidate of result.candidates) {
    if (!validId(candidate.candidateRef) || !["ISSUER", "INSTRUMENT", "LISTING"].includes(candidate.targetScope) || !["DIRECT", "MENTION", "SUBSIDIARY", "INDIRECT_EXPOSURE"].includes(candidate.relationType)) throw new Error("NEWS_ENTITY_CANDIDATE_INVALID");
    if (candidateRefs.has(candidate.candidateRef)) throw new Error("NEWS_ENTITY_CANDIDATE_DUPLICATE");
    candidateRefs.add(candidate.candidateRef);
    if (candidate.targetScope === "ISSUER" && (candidate.instrumentId !== null || candidate.listingId !== null || !validId(candidate.issuerId))) throw new Error("NEWS_ENTITY_SCOPE_INVALID");
    if (candidate.targetScope === "INSTRUMENT" && (candidate.listingId !== null || !validId(candidate.instrumentId) || (candidate.issuerId !== null && !validId(candidate.issuerId)))) throw new Error("NEWS_ENTITY_SCOPE_INVALID");
    if (candidate.targetScope === "LISTING" && (!validId(candidate.instrumentId) || !validId(candidate.listingId) || (candidate.issuerId !== null && !validId(candidate.issuerId)))) throw new Error("NEWS_ENTITY_SCOPE_INVALID");
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) throw new Error("NEWS_ENTITY_EVIDENCE_MISSING");
    const evidenceIds = new Set<string>();
    for (const evidence of candidate.evidence) {
      if (!validId(evidence.evidenceId) || !validId(evidence.sourceRef) || !validIso(evidence.observedAt) || Date.parse(evidence.observedAt) > Date.now() || typeof evidence.verified !== "boolean" || evidenceIds.has(evidence.evidenceId)) throw new Error("NEWS_ENTITY_EVIDENCE_INVALID");
      evidenceIds.add(evidence.evidenceId);
    }
  }
  if (result.status === "EXACT") {
    const selected = result.candidates.find(candidate => candidate.candidateRef === result.selectedCandidateRef);
    if (!selected || !selected.evidence.some(evidence => evidence.verified && evidence.evidenceKind !== "PUBLICATION_TEXT")) throw new Error("NEWS_ENTITY_EXACT_EVIDENCE_REQUIRED");
  }
  return result;
}

export function canonicalCandidate(result: MarketCoreResolutionV1): EntityCandidate | null {
  return result.status === "EXACT" ? result.candidates.find(candidate => candidate.candidateRef === result.selectedCandidateRef) ?? null : null;
}
