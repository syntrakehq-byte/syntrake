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
  descriptiveName?: string;
  descriptiveAssetClass?: "EQUITY" | "ETF" | "FX";
  descriptiveCurrency?: string;
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
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const FIGI = /^[A-Z0-9]{12}$/;
const CIK = /^\d{10}$/;
const LEI = /^[A-Z0-9]{18}\d{2}$/;

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
    REF.test(source.licensePolicyId) && (!source.sharingAllowed || source.storageAllowed);
}
function sameSource(a: CatalogSource, b: CatalogSource): boolean {
  return a.providerKey === b.providerKey && a.snapshotId === b.snapshotId &&
    a.snapshotVersion === b.snapshotVersion && a.observedAt === b.observedAt &&
    a.licensePolicyId === b.licensePolicyId && a.storageAllowed === b.storageAllowed &&
    a.sharingAllowed === b.sharingAllowed;
}
function validIdentifier(type: IdentifierType, value: string, scope: IdentifierScope): boolean {
  if (type === "ISIN") return scope === "INSTRUMENT" && ISIN.test(value);
  if (type === "FIGI") return (scope === "INSTRUMENT" || scope === "LISTING") && FIGI.test(value);
  if (type === "CIK") return scope === "ISSUER" && CIK.test(value);
  if (type === "LEI") return scope === "ISSUER" && LEI.test(value);
  if (type === "TICKER") return scope === "LISTING" && REF.test(value);
  return (scope === "INSTRUMENT" || scope === "LISTING") && REF.test(value);
}
function leiCheckDigit(value: string): boolean {
  if (!LEI.test(value)) return false;
  const expanded = [...value.slice(0, 18)].map(char => /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)).join("") + value.slice(18);
  return BigInt(expanded) % 97n === 1n;
}
function isinCheckDigit(value: string): boolean {
  if (!ISIN.test(value)) return false;
  const expanded = [...value.slice(0, 11)].map(char => /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)).join("");
  let sum = 0;
  [...expanded].reverse().forEach((char, index) => { const n = Number(char) * (index % 2 === 0 ? 2 : 1); sum += Math.floor(n / 10) + n % 10; });
  return (10 - (sum % 10)) % 10 === Number(value[11]);
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
    const scope = identifier.scope ?? (identifier.type === "CIK" || identifier.type === "LEI" ? "ISSUER" : identifier.type === "TICKER" ? "LISTING" : "INSTRUMENT");
    if (!validIdentifier(identifier.type, identifier.value, scope) || identifier.type === "ISIN" && !isinCheckDigit(identifier.value) || identifier.type === "LEI" && !leiCheckDigit(identifier.value)) throw new Error("DISCOVERY_QUERY_IDENTIFIER_INVALID");
  }
  return Object.freeze(query);
}

export function normalizeCatalogCandidate(input: CatalogCandidate): CatalogCandidate {
  if (!input || !input.source || !validSource(input.source) || !input.providerReference ||
      input.providerReference.providerKey !== input.source.providerKey ||
      !REF.test(input.providerReference.providerReference) || !validWindow(input.providerReference.validity) ||
      !validSource(input.providerReference.source) || !sameSource(input.source, input.providerReference.source)) throw new Error("DISCOVERY_CANDIDATE_SOURCE_INVALID");
  if (input.listing) {
    if (!REF.test(input.listing.listingRef) || !REF.test(input.listing.ticker) || !MIC.test(input.listing.mic ?? "XXXX") && input.listing.mic !== null ||
        input.listing.mic === null && input.listing.micRole !== null || !validWindow(input.listing.validity) || !CURRENCY.test(input.listing.tradingCurrency)) throw new Error("DISCOVERY_CANDIDATE_LISTING_INVALID");
  }
  if (input.instrument && (!REF.test(input.instrument.instrumentRef) || !CURRENCY.test(input.instrument.denominationCurrency))) throw new Error("DISCOVERY_CANDIDATE_INSTRUMENT_INVALID");
  if (input.issuer && (!REF.test(input.issuer.issuerRef) || !clean(input.issuer.legalName))) throw new Error("DISCOVERY_CANDIDATE_ISSUER_INVALID");
  if (input.identifiers.length === 0) throw new Error("DISCOVERY_CANDIDATE_EVIDENCE_MISSING");
  for (const evidence of input.identifiers) {
    if (!(evidence.type === "ISIN" || evidence.type === "FIGI" || evidence.type === "CIK" || evidence.type === "LEI" || evidence.type === "PROVIDER_NATIVE" || evidence.type === "TICKER") || !(evidence.scope === "ISSUER" || evidence.scope === "INSTRUMENT" || evidence.scope === "LISTING") || !(evidence.evidenceKind === "PROVIDER_CATALOG" || evidence.evidenceKind === "OFFICIAL_REGISTRY" || evidence.evidenceKind === "EXCHANGE_REFERENCE" || evidence.evidenceKind === "IDENTIFIER_RECORD") || !(evidence.strength === "STRONG" || evidence.strength === "SUPPORTING") || typeof evidence.verified !== "boolean" || !validIdentifier(evidence.type, evidence.value, evidence.scope) || evidence.type === "ISIN" && !isinCheckDigit(evidence.value) || evidence.type === "LEI" && !leiCheckDigit(evidence.value) || !sameSource(input.source, evidence.source) || !validWindow(evidence.validity) || !MIC.test(evidence.marketMic ?? "XXXX") && evidence.marketMic !== null) throw new Error("DISCOVERY_CANDIDATE_EVIDENCE_INVALID");
    if (input.listing?.mic !== null && input.listing?.mic !== undefined && evidence.marketMic !== null && evidence.marketMic !== input.listing.mic) throw new Error("DISCOVERY_CANDIDATE_IDENTITY_CONTRADICTION");
  }
  return Object.freeze({
    ...input,
    issuer: input.issuer && Object.freeze({ ...input.issuer, issuerRef: clean(input.issuer.issuerRef), legalName: clean(input.issuer.legalName) }),
    instrument: input.instrument && Object.freeze({ ...input.instrument, instrumentRef: clean(input.instrument.instrumentRef), denominationCurrency: upper(input.instrument.denominationCurrency) }),
    listing: input.listing && Object.freeze({ ...input.listing, listingRef: clean(input.listing.listingRef), ticker: upper(input.listing.ticker), tradingCurrency: upper(input.listing.tradingCurrency) }),
    ...(input.descriptiveName === undefined ? {} : { descriptiveName: clean(input.descriptiveName) }),
    ...(input.descriptiveCurrency === undefined ? {} : { descriptiveCurrency: upper(input.descriptiveCurrency) }),
    identifiers: Object.freeze(input.identifiers.map(e => Object.freeze({ ...e, value: upper(e.value), marketMic: e.marketMic === null ? null : upper(e.marketMic) }))),
  });
}

function queryMatchesCandidate(query: CatalogQuery, candidate: CatalogCandidate): boolean {
  if (query.ticker !== undefined && candidate.listing?.ticker !== query.ticker) return false;
  if (query.name !== undefined && (candidate.issuer?.legalName ?? candidate.descriptiveName)?.toUpperCase() !== query.name.toUpperCase()) return false;
  if (query.marketMic !== undefined && candidate.listing?.mic !== query.marketMic) return false;
  if (query.assetClass !== undefined && (candidate.instrument?.assetClass ?? candidate.descriptiveAssetClass) !== query.assetClass) return false;
  if (query.currency !== undefined && candidate.listing?.tradingCurrency !== query.currency && (candidate.instrument?.denominationCurrency ?? candidate.descriptiveCurrency) !== query.currency) return false;
  for (const requested of query.identifiers ?? []) {
    const scope = requested.scope ?? (requested.type === "CIK" || requested.type === "LEI" ? "ISSUER" : requested.type === "TICKER" ? "LISTING" : "INSTRUMENT");
    if (!candidate.identifiers.some(e => e.type === requested.type && e.scope === scope && e.value === requested.value)) return false;
  }
  return true;
}

/** Conservative D0 classification. It intentionally does not perform D3 matching. */
export function createDiscoveryResult(queryInput: CatalogQuery, rawCandidates: readonly CatalogCandidate[]): DiscoveryResult {
  const query = normalizeCatalogQuery(queryInput);
  const candidates = rawCandidates.map(normalizeCatalogCandidate);
  if (candidates.length === 0) return Object.freeze({ status: "UNRESOLVED", query, candidates, reason: "NO_CATALOG_CANDIDATES" });
  if (candidates.length > 1) return Object.freeze({ status: "AMBIGUOUS", query, candidates, reason: "MULTIPLE_CATALOG_CANDIDATES" });
  if (!queryMatchesCandidate(query, candidates[0])) return Object.freeze({ status: "REVIEW_REQUIRED", query, candidates, reason: "QUERY_CANDIDATE_MISMATCH" });
  // D0 normalizes candidates and evidence only. Canonical identity resolution
  // (issuer -> instrument -> listing) belongs exclusively to D3.
  return Object.freeze({ status: "REVIEW_REQUIRED", query, candidates, reason: candidates[0].source.storageAllowed ? "CANONICAL_IDENTITY_VERIFICATION_REQUIRED" : "CATALOG_STORAGE_NOT_LICENSED" });
}
