import {
  normalizeCatalogCandidate,
  type CatalogCandidate,
  type IdentifierEvidence,
  type ListingCandidate,
  type TemporalValidity,
} from "./instrumentDiscovery";

export type CanonicalResolutionStatus = "EXACT" | "AMBIGUOUS" | "UNRESOLVED" | "REVIEW_REQUIRED";
export type CanonicalReasonCode =
  | "CANONICAL_MATCH"
  | "MULTIPLE_CANONICAL_MATCHES"
  | "NO_CANONICAL_MATCH"
  | "CANONICAL_EVIDENCE_INSUFFICIENT"
  | "CANONICAL_CONFLICT"
  | "CANONICAL_OUTSIDE_VALIDITY";

export type CanonicalIdentity = Readonly<{
  issuerRef: string;
  instrumentRef: string;
  listingRef: string;
  assetClass: "EQUITY" | "ETF" | "FX";
  denominationCurrency: string;
  listing: ListingCandidate;
  identifiers: readonly IdentifierEvidence[];
  validity: TemporalValidity;
}>;

export type ResolutionEvidence = Readonly<{
  providerKey: string;
  providerReference: string;
  canonicalListingRef: string;
  evidenceTypes: readonly string[];
}>;

export type CanonicalResolution = Readonly<{
  status: CanonicalResolutionStatus;
  reasonCode: CanonicalReasonCode;
  identity: CanonicalIdentity | null;
  candidate: CatalogCandidate | null;
  evidence: readonly ResolutionEvidence[];
}>;

function dateInWindow(asOf: string, validity: TemporalValidity): boolean {
  const day = asOf.slice(0, 10);
  return (validity.validFrom === null || day >= validity.validFrom) &&
    (validity.validTo === null || day < validity.validTo);
}

function evidenceFor(candidate: CatalogCandidate, identity: CanonicalIdentity): ResolutionEvidence | null {
  const verified = candidate.identifiers.filter(e => e.verified && (e.evidenceKind === "OFFICIAL_REGISTRY" || e.evidenceKind === "EXCHANGE_REFERENCE" || e.evidenceKind === "IDENTIFIER_RECORD"));
  const issuer = candidate.issuer?.issuerRef === identity.issuerRef && verified.some(e => e.scope === "ISSUER" && ["CIK", "LEI"].includes(e.type));
  const instrument = candidate.instrument?.instrumentRef === identity.instrumentRef && verified.some(e => e.scope === "INSTRUMENT" && ["ISIN", "FIGI"].includes(e.type));
  const listing = candidate.listing?.listingRef === identity.listingRef && verified.some(e => e.scope === "LISTING" && ["FIGI", "TICKER", "PROVIDER_NATIVE"].includes(e.type));
  if (!issuer || !instrument || !listing) return null;
  return Object.freeze({ providerKey: candidate.providerReference.providerKey, providerReference: candidate.providerReference.providerReference, canonicalListingRef: identity.listingRef, evidenceTypes: Object.freeze([...new Set(verified.map(e => e.type))]) });
}

function compatible(candidate: CatalogCandidate, identity: CanonicalIdentity, asOf: string): boolean {
  const listing = candidate.listing;
  if (!listing || !dateInWindow(asOf, listing.validity) || !dateInWindow(asOf, identity.validity)) return false;
  if (listing.ticker !== identity.listing.ticker || listing.tradingCurrency !== identity.listing.tradingCurrency) return false;
  if (listing.mic !== identity.listing.mic || listing.micRole !== identity.listing.micRole) return false;
  if (candidate.instrument?.assetClass !== identity.assetClass || candidate.instrument?.denominationCurrency !== identity.denominationCurrency) return false;
  return true;
}

export function resolveCanonicalIdentity(input: Readonly<{
  candidate: CatalogCandidate;
  registry: readonly CanonicalIdentity[];
  asOf: string;
}>): CanonicalResolution {
  const candidate = normalizeCatalogCandidate(input.candidate);
  const eligible = input.registry.filter(identity => compatible(candidate, identity, input.asOf));
  const matches = eligible.map(identity => ({ identity, evidence: evidenceFor(candidate, identity) })).filter(x => x.evidence !== null);
  const evidence = Object.freeze(matches.map(x => x.evidence!));
  if (matches.length === 1) return Object.freeze({ status: "EXACT", reasonCode: "CANONICAL_MATCH", identity: matches[0].identity, candidate, evidence });
  if (matches.length > 1) return Object.freeze({ status: "AMBIGUOUS", reasonCode: "MULTIPLE_CANONICAL_MATCHES", identity: null, candidate, evidence });
  if (eligible.length > 0) return Object.freeze({ status: "REVIEW_REQUIRED", reasonCode: "CANONICAL_EVIDENCE_INSUFFICIENT", identity: null, candidate, evidence });
  if (input.registry.some(identity => candidate.listing?.listingRef === identity.listingRef && !dateInWindow(input.asOf, identity.validity))) return Object.freeze({ status: "REVIEW_REQUIRED", reasonCode: "CANONICAL_OUTSIDE_VALIDITY", identity: null, candidate, evidence });
  return Object.freeze({ status: "UNRESOLVED", reasonCode: "NO_CANONICAL_MATCH", identity: null, candidate, evidence });
}
