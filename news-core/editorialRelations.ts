export type EditorialMatchStatus = "EXACT" | "AMBIGUOUS" | "UNRESOLVED" | "REVIEW_REQUIRED";
export type EditorialRelationType = "SAME_ORIGIN" | "REPUBLICATION" | "TRANSLATION" | "POSSIBLE_DUPLICATE";
export type StructuralEventRelationType = "RELATED" | "SAME_STRUCTURAL_ORIGIN" | "POSSIBLE_RELATION";

export type EditorialEvidence = Readonly<{
  evidenceId: string;
  evidenceKind: "OFFICIAL_SOURCE" | "PROVIDER_SOURCE" | "SYNDICATION_METADATA" | "PUBLICATION_TEXT";
  sourceRef: string;
  observedAt: string;
  verified: boolean;
}>;

export type EditorialGroupResolutionV1 = Readonly<{
  contractVersion: "news-editorial-relations-v1";
  resolverVersion: string;
  groupId: string;
  operation: "ACTIVE" | "SEPARATED";
  status: EditorialMatchStatus;
  relationType: EditorialRelationType;
  reason: string;
  publicationRevisionIds: readonly string[];
  evidence: readonly EditorialEvidence[];
}>;

export type StructuralEventLinkResolutionV1 = Readonly<{
  contractVersion: "news-structural-event-links-v1";
  resolverVersion: string;
  structuralEventId: string;
  operation: "ACTIVE" | "SEPARATED";
  status: EditorialMatchStatus;
  relationType: StructuralEventRelationType;
  reason: string;
  publicationRevisionIds: readonly string[];
  evidence: readonly EditorialEvidence[];
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function validIso(value: unknown): value is string { return typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now(); }
function validSourceRef(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512; }

function validateEvidence(evidence: readonly EditorialEvidence[]): void {
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error("NEWS_EDITORIAL_EVIDENCE_REQUIRED");
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!validId(item.evidenceId) || !["OFFICIAL_SOURCE", "PROVIDER_SOURCE", "SYNDICATION_METADATA", "PUBLICATION_TEXT"].includes(item.evidenceKind) || !validSourceRef(item.sourceRef) || !validIso(item.observedAt) || typeof item.verified !== "boolean" || ids.has(item.evidenceId)) throw new Error("NEWS_EDITORIAL_EVIDENCE_INVALID");
    ids.add(item.evidenceId);
  }
}

function validateMembers(members: readonly string[]): void {
  if (!Array.isArray(members) || members.length < 2 || members.some(member => !validId(member)) || new Set(members).size !== members.length) throw new Error("NEWS_EDITORIAL_MEMBERS_INVALID");
}

export function validateEditorialGroupResolution(result: EditorialGroupResolutionV1): EditorialGroupResolutionV1 {
  if (result.contractVersion !== "news-editorial-relations-v1" || !validId(result.resolverVersion) || !validId(result.groupId) || !validId(result.reason) || !["ACTIVE", "SEPARATED"].includes(result.operation)) throw new Error("NEWS_EDITORIAL_RESOLUTION_INVALID");
  if (!["EXACT", "AMBIGUOUS", "UNRESOLVED", "REVIEW_REQUIRED"].includes(result.status) || !["SAME_ORIGIN", "REPUBLICATION", "TRANSLATION", "POSSIBLE_DUPLICATE"].includes(result.relationType)) throw new Error("NEWS_EDITORIAL_RESOLUTION_INVALID");
  validateMembers(result.publicationRevisionIds);
  validateEvidence(result.evidence);
  if (result.operation === "SEPARATED" && result.status === "EXACT") throw new Error("NEWS_EDITORIAL_SEPARATION_EXACT_INVALID");
  if (result.status === "EXACT" && result.relationType === "POSSIBLE_DUPLICATE") throw new Error("NEWS_EDITORIAL_EXACT_UNSUPPORTED");
  if (result.status === "EXACT" && !result.evidence.some(item => item.verified && item.evidenceKind !== "PUBLICATION_TEXT")) throw new Error("NEWS_EDITORIAL_EXACT_EVIDENCE_REQUIRED");
  return result;
}

export function validateStructuralEventLinkResolution(result: StructuralEventLinkResolutionV1): StructuralEventLinkResolutionV1 {
  if (result.contractVersion !== "news-structural-event-links-v1" || !validId(result.resolverVersion) || !validId(result.structuralEventId) || !validId(result.reason) || !["ACTIVE", "SEPARATED"].includes(result.operation)) throw new Error("NEWS_EVENT_LINK_RESOLUTION_INVALID");
  if (!["EXACT", "AMBIGUOUS", "UNRESOLVED", "REVIEW_REQUIRED"].includes(result.status) || !["RELATED", "SAME_STRUCTURAL_ORIGIN", "POSSIBLE_RELATION"].includes(result.relationType)) throw new Error("NEWS_EVENT_LINK_RESOLUTION_INVALID");
  validateMembers(result.publicationRevisionIds);
  validateEvidence(result.evidence);
  return result;
}

export function stableEditorialFingerprint(result: EditorialGroupResolutionV1 | StructuralEventLinkResolutionV1): string {
  return JSON.stringify({ ...result, publicationRevisionIds: [...result.publicationRevisionIds].sort(), evidence: [...result.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) });
}
