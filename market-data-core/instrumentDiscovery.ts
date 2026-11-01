/**
 * D0 domain contracts only.
 *
 * This module deliberately does not perform network discovery, persistence,
 * provider selection or D3 entity matching. A ticker can produce candidates,
 * but cannot by itself establish a canonical financial identity.
 */
export type DiscoveryStatus = "EXACT" | "AMBIGUOUS" | "UNRESOLVED" | "REVIEW_REQUIRED";
export type IdentifierScope = "ISSUER" | "INSTRUMENT" | "LISTING";
export type IdentifierType = "ISIN" | "FIGI" | "CIK" | "LEI" | "PROVIDER_NATIVE" | "TICKER";
export type MicRole = "OPERATING" | "SEGMENT";
export type CandidateEvidenceKind = "PROVIDER_CATALOG" | "OFFICIAL_REGISTRY" | "EXCHANGE_REFERENCE" | "IDENTIFIER_RECORD";
export type EvidenceStrength = "STRONG" | "SUPPORTING";

export type TemporalValidity = Readonly<{
  validFrom: string | null;
  validTo: string | null;
}>;

export type CatalogSource = Readonly<{
  providerKey: string;
  snapshotId: string;
  snapshotVersion: string;
  observedAt: string;
  licensePolicyId: string;
  storageAllowed: boolean;
  sharingAllowed: boolean;
}>;

export type IdentifierEvidence = Readonly<{
  type: IdentifierType;
  value: string;
  scope: IdentifierScope;
  source: CatalogSource;
  evidenceKind: CandidateEvidenceKind;
  strength: EvidenceStrength;
  verified: boolean;
  validity: TemporalValidity;
  marketMic: string | null;
}>;

export type IssuerCandidate = Readonly<{
  issuerRef: string;
  legalName: string;
}>;

export type InstrumentCandidate = Readonly<{
  instrumentRef: string;
  assetClass: "EQUITY" | "ETF" | "FX";
  denominationCurrency: string;
}>;

export type ListingCandidate = Readonly<{
  listingRef: string;
  ticker: string;
  mic: string | null;
  micRole: MicRole | null;
  tradingCurrency: string;
  validity: TemporalValidity;
}>;

export type ProviderInstrumentReference = Readonly<{
  providerKey: string;
  providerReference: string;
  identifierType: "PROVIDER_NATIVE" | "TICKER";
  scope: "INSTRUMENT" | "LISTING";
  source: CatalogSource;
  validity: TemporalValidity;
}>;

export type CatalogCandidate = Readonly<{
  issuer: IssuerCandidate | null;
  instrument: InstrumentCandidate | null;
  listing: ListingCandidate | null;
  providerReference: ProviderInstrumentReference;
  identifiers: readonly IdentifierEvidence[];
  source: CatalogSource;
}>;

export type CatalogQuery = Readonly<{
  name?: string;
  ticker?: string;
  identifiers?: readonly Readonly<{ type: IdentifierType; value: string; scope?: IdentifierScope }>[];
  marketMic?: string;
  assetClass?: "EQUITY" | "ETF" | "FX";
  currency?: string;
}>;

export type DiscoveryResult = Readonly<{
  status: DiscoveryStatus;
  query: CatalogQuery;
  candidates: readonly CatalogCandidate[];
  reason: string;
}>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CURRENCY = /^[A-Z]{3}$/;
const MIC = /^[A-Z0-9]{4}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UUID_OR_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function clean(value: string): string { return value.trim().replace(/\s+/g, " "); }
function upper(value: string): string { return clean(value).toUpperCase(); }
function validDate(value: string | null): boolean {
  if (value === null) return true;
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function validWindow(window: TemporalValidity): boolean {
  return validDate(window.validFrom) && validDate(window.validTo) &&
    (window.validFrom === null || window.validTo === null || window.validFrom < window.validTo);
}
function validSource(source: CatalogSource): boolean {
  return REF.test(source.providerKey) && REF.test(source.snapshotId) &&
    clean(source.snapshotVersion).length > 0 && ISO_TIMESTAMP.test(source.observedAt) &&
    REF.test(source.licensePolicyId);
}

export function normalizeCatalogQuery(input: CatalogQuery): CatalogQuery {
  const query: CatalogQuery = {
    ...(input.name === undefined ? {} : { name: clean(input.name) }),
    ...(input.ticker === undefined ? {} : { ticker: upper(input.ticker) }),
    ...(input.identifiers === undefined ? {} : { identifiers: input.identifiers.map(x => ({ type: x.type, value: upper(x.value), ...(x.scope === undefined ? {} : { scope: x.scope }) })) }),
    ...(input.marketMic === undefined ? {} : { marketMic: upper(input.marketMic) }),
    ...(input.assetClass === undefined ? {} : { assetClass: input.assetClass }),
    ...(input.currency === undefined ? {} : { currency: upper(input.currency) }),
  };
  if (!query.name && !query.ticker && (!query.identifiers || query.identifiers.length === 0)) throw new Error("DISCOVERY_QUERY_EMPTY");
  if (query.marketMic !== undefined && !MIC.test(query.marketMic)) throw new Error("DISCOVERY_QUERY_MIC_INVALID");
  if (query.currency !== undefined && !CURRENCY.test(query.currency)) throw new Error("DISCOVERY_QUERY_CURRENCY_INVALID");
  if (query.ticker !== undefined && !REF.test(query.ticker)) throw new Error("DISCOVERY_QUERY_TICKER_INVALID");
  for (const identifier of query.identifiers ?? []) {
    if (!(identifier.type === "ISIN" || identifier.type === "FIGI" || identifier.type === "CIK" || identifier.type === "LEI" || identifier.type === "PROVIDER_NATIVE" || identifier.type === "TICKER") || !REF.test(identifier.value)) throw new Error("DISCOVERY_QUERY_IDENTIFIER_INVALID");
  }
  return Object.freeze(query);
}

export function normalizeCatalogCandidate(input: CatalogCandidate): CatalogCandidate {
  if (!input || !input.source || !validSource(input.source) || !input.providerReference ||
      input.providerReference.providerKey !== input.source.providerKey ||
      !REF.test(input.providerReference.providerReference) || !validWindow(input.providerReference.validity) ||
      !validSource(input.providerReference.source) || input.providerReference.source.snapshotId !== input.source.snapshotId) throw new Error("DISCOVERY_CANDIDATE_SOURCE_INVALID");
  if (input.listing) {
    if (!REF.test(input.listing.listingRef) || !REF.test(input.listing.ticker) || !MIC.test(input.listing.mic ?? "XXXX") && input.listing.mic !== null ||
        input.listing.mic === null && input.listing.micRole !== null || !validWindow(input.listing.validity) || !CURRENCY.test(input.listing.tradingCurrency)) throw new Error("DISCOVERY_CANDIDATE_LISTING_INVALID");
  }
  if (input.instrument && (!REF.test(input.instrument.instrumentRef) || !CURRENCY.test(input.instrument.denominationCurrency))) throw new Error("DISCOVERY_CANDIDATE_INSTRUMENT_INVALID");
  if (input.issuer && (!REF.test(input.issuer.issuerRef) || !clean(input.issuer.legalName))) throw new Error("DISCOVERY_CANDIDATE_ISSUER_INVALID");
  if (input.identifiers.length === 0) throw new Error("DISCOVERY_CANDIDATE_EVIDENCE_MISSING");
  for (const evidence of input.identifiers) {
    if (!REF.test(evidence.value) || !validSource(evidence.source) || evidence.source.snapshotId !== input.source.snapshotId || !validWindow(evidence.validity) || !MIC.test(evidence.marketMic ?? "XXXX") && evidence.marketMic !== null) throw new Error("DISCOVERY_CANDIDATE_EVIDENCE_INVALID");
    if (input.listing?.mic !== null && input.listing?.mic !== undefined && evidence.marketMic !== null && evidence.marketMic !== input.listing.mic) throw new Error("DISCOVERY_CANDIDATE_IDENTITY_CONTRADICTION");
  }
  return Object.freeze({
    ...input,
    issuer: input.issuer && Object.freeze({ ...input.issuer, issuerRef: clean(input.issuer.issuerRef), legalName: clean(input.issuer.legalName) }),
    instrument: input.instrument && Object.freeze({ ...input.instrument, instrumentRef: clean(input.instrument.instrumentRef), denominationCurrency: upper(input.instrument.denominationCurrency) }),
    listing: input.listing && Object.freeze({ ...input.listing, listingRef: clean(input.listing.listingRef), ticker: upper(input.listing.ticker), tradingCurrency: upper(input.listing.tradingCurrency) }),
    identifiers: Object.freeze(input.identifiers.map(e => Object.freeze({ ...e, value: upper(e.value), marketMic: e.marketMic === null ? null : upper(e.marketMic) }))),
  });
}

function hasVerifiableIdentity(candidate: CatalogCandidate): boolean {
  return candidate.issuer !== null && candidate.instrument !== null && candidate.listing !== null &&
    candidate.identifiers.some(e => e.verified && e.strength === "STRONG" && e.scope !== "LISTING" || e.verified && e.strength === "STRONG" && e.scope === "LISTING");
}

/** Conservative D0 classification. It intentionally does not perform D3 matching. */
export function createDiscoveryResult(queryInput: CatalogQuery, rawCandidates: readonly CatalogCandidate[]): DiscoveryResult {
  const query = normalizeCatalogQuery(queryInput);
  const candidates = rawCandidates.map(normalizeCatalogCandidate);
  if (candidates.length === 0) return Object.freeze({ status: "UNRESOLVED", query, candidates, reason: "NO_CATALOG_CANDIDATES" });
  if (candidates.length > 1) return Object.freeze({ status: "AMBIGUOUS", query, candidates, reason: "MULTIPLE_CATALOG_CANDIDATES" });
  if (!hasVerifiableIdentity(candidates[0])) return Object.freeze({ status: "REVIEW_REQUIRED", query, candidates, reason: "VERIFIABLE_IDENTITY_EVIDENCE_REQUIRED" });
  if (!candidates[0].source.storageAllowed) return Object.freeze({ status: "REVIEW_REQUIRED", query, candidates, reason: "CATALOG_STORAGE_NOT_LICENSED" });
  return Object.freeze({ status: "EXACT", query, candidates, reason: "ONE_VERIFIED_CANDIDATE" });
}
