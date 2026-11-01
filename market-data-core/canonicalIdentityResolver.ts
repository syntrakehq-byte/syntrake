import { normalizeCatalogCandidate, type CatalogCandidate, type IdentifierType, type IdentifierScope, type ListingCandidate, type TemporalValidity } from "./instrumentDiscovery";

export type CanonicalResolutionStatus = "EXACT" | "AMBIGUOUS" | "UNRESOLVED" | "REVIEW_REQUIRED";
export type CanonicalReasonCode = "CANONICAL_MATCH" | "MULTIPLE_CANONICAL_MATCHES" | "NO_CANONICAL_MATCH" | "CANONICAL_EVIDENCE_INSUFFICIENT" | "CANONICAL_CONFLICT" | "CANONICAL_OUTSIDE_VALIDITY";

/** Registry-owned evidence. Candidate-supplied verified/evidenceKind flags are never trusted here. */
export type RegistryEvidence = Readonly<{
  evidenceId: string;
  type: IdentifierType;
  value: string;
  scope: IdentifierScope;
  source: "D1_REGISTRY";
  issuerRef: string | null;
  instrumentRef: string | null;
  listingRef: string | null;
  validity: TemporalValidity;
}>;
export type RegistryAlias = Readonly<{ providerKey: string; providerReference: string; listingRef: string; validity: TemporalValidity }>;
export type CanonicalIdentity = Readonly<{ issuerRef: string; instrumentRef: string; listingRef: string; assetClass: "EQUITY" | "ETF" | "FX"; denominationCurrency: string; listing: ListingCandidate; identifiers: readonly RegistryEvidence[]; aliases: readonly RegistryAlias[]; validity: TemporalValidity }>;
export type ResolutionEvidence = Readonly<{ evidenceIds: readonly string[]; providerKey: string; providerReference: string; canonicalListingRef: string }>;
export type CanonicalResolution = Readonly<{ status: CanonicalResolutionStatus; reasonCode: CanonicalReasonCode; identity: CanonicalIdentity | null; candidate: CatalogCandidate | null; evidence: readonly ResolutionEvidence[] }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: string): boolean { if (!ISO_DATE.test(value)) return false; const d = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value; }
function validAsOf(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false; const d = new Date(value); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 19) === value.replace(/\.\d{1,3}Z$/, "Z").slice(0, 19); }
function inWindow(asOf: string, validity: TemporalValidity): boolean { if (!validDay(validity.validFrom ?? "2000-01-01") || (validity.validTo !== null && !validDay(validity.validTo))) return false; const day = asOf.slice(0, 10); return (validity.validFrom === null || day >= validity.validFrom) && (validity.validTo === null || day < validity.validTo); }
function sourceEvidence(identity: CanonicalIdentity, asOf: string): RegistryEvidence[] { return identity.identifiers.filter(e => e.source === "D1_REGISTRY" && inWindow(asOf, e.validity)); }
function aliasFor(candidate: CatalogCandidate, identity: CanonicalIdentity, asOf: string): RegistryAlias | null { const ref = candidate.providerReference; return identity.aliases.find(a => a.providerKey === ref.providerKey && a.providerReference === ref.providerReference && a.listingRef === identity.listingRef && inWindow(asOf, a.validity)) ?? null; }
function candidateEvidenceContradicts(candidate: CatalogCandidate, trusted: readonly RegistryEvidence[], asOf: string): boolean { return candidate.identifiers.some(e => e.verified && inWindow(asOf, e.validity) && trusted.some(t => t.type === e.type && t.scope === e.scope && t.value !== e.value)); }
function completeTrustedEvidence(identity: CanonicalIdentity, trusted: readonly RegistryEvidence[]): boolean {
  const issuer = trusted.some(e => e.scope === "ISSUER" && ["CIK", "LEI"].includes(e.type) && e.issuerRef === identity.issuerRef && e.instrumentRef === null && e.listingRef === null);
  const instrument = trusted.some(e => e.scope === "INSTRUMENT" && ["ISIN", "FIGI"].includes(e.type) && e.issuerRef === null && e.instrumentRef === identity.instrumentRef && e.listingRef === null);
  const listing = trusted.some(e => e.scope === "LISTING" && ["FIGI", "TICKER", "PROVIDER_NATIVE"].includes(e.type) && e.issuerRef === null && e.instrumentRef === identity.instrumentRef && e.listingRef === identity.listingRef);
  return issuer && instrument && listing;
}
function compatible(candidate: CatalogCandidate, identity: CanonicalIdentity, asOf: string): boolean {
  const l = candidate.listing;
  if (!l || !validAsOf(asOf) || !inWindow(asOf, l.validity) || !inWindow(asOf, identity.validity) || !inWindow(asOf, identity.listing.validity)) return false;
  if (l.ticker !== identity.listing.ticker || l.tradingCurrency !== identity.listing.tradingCurrency || l.mic !== identity.listing.mic) return false;
  if (l.micRole !== null && identity.listing.micRole !== null && l.micRole !== identity.listing.micRole) return false;
  if (candidate.instrument && (candidate.instrument.assetClass !== identity.assetClass || candidate.instrument.denominationCurrency !== identity.denominationCurrency)) return false;
  return true;
}
export function resolveCanonicalIdentity(input: Readonly<{ candidate: CatalogCandidate; registry: readonly CanonicalIdentity[]; asOf: string }>): CanonicalResolution {
  const candidate = normalizeCatalogCandidate(input.candidate);
  if (!validAsOf(input.asOf)) return Object.freeze({ status: "REVIEW_REQUIRED", reasonCode: "CANONICAL_CONFLICT", identity: null, candidate, evidence: [] });
  const eligible = input.registry.filter(i => compatible(candidate, i, input.asOf));
  const matches: { identity: CanonicalIdentity; evidence: ResolutionEvidence }[] = [];
  for (const identity of eligible) { const trusted = sourceEvidence(identity, input.asOf); const alias = aliasFor(candidate, identity, input.asOf); if (!alias || candidateEvidenceContradicts(candidate, trusted, input.asOf) || !completeTrustedEvidence(identity, trusted)) continue; matches.push({ identity, evidence: Object.freeze({ evidenceIds: Object.freeze(trusted.map(e => e.evidenceId)), providerKey: candidate.providerReference.providerKey, providerReference: candidate.providerReference.providerReference, canonicalListingRef: identity.listingRef }) }); }
  const evidence = Object.freeze(matches.map(x => x.evidence));
  if (matches.length === 1) return Object.freeze({ status: "EXACT", reasonCode: "CANONICAL_MATCH", identity: matches[0].identity, candidate, evidence });
  if (matches.length > 1) return Object.freeze({ status: "AMBIGUOUS", reasonCode: "MULTIPLE_CANONICAL_MATCHES", identity: null, candidate, evidence });
  const outside = input.registry.some(i => candidate.listing?.listingRef === i.listingRef && !inWindow(input.asOf, i.validity));
  return Object.freeze({ status: outside ? "REVIEW_REQUIRED" : eligible.length ? "REVIEW_REQUIRED" : "UNRESOLVED", reasonCode: outside ? "CANONICAL_OUTSIDE_VALIDITY" : eligible.length ? "CANONICAL_EVIDENCE_INSUFFICIENT" : "NO_CANONICAL_MATCH", identity: null, candidate, evidence });
}
