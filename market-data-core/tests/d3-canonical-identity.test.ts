import test from "node:test";
import assert from "node:assert/strict";
import { resolveCanonicalIdentity, type CanonicalIdentity } from "../canonicalIdentityResolver";
import { type CatalogCandidate, type CatalogSource } from "../instrumentDiscovery";

const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "snap-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "catalog-cache", storageAllowed: true, sharingAllowed: false };
const listing = { listingRef: "listing-xnas", ticker: "AAPL", mic: "XNAS", micRole: "OPERATING" as const, tradingCurrency: "USD", validity: { validFrom: "1980-12-12", validTo: null } };
const identity: CanonicalIdentity = {
  issuerRef: "issuer-apple", instrumentRef: "instrument-apple", listingRef: "listing-xnas", assetClass: "EQUITY", denominationCurrency: "USD", listing, validity: listing.validity,
  aliases: [{ providerKey: "TWELVE_DATA", providerReference: "AAPL", listingRef: "listing-xnas", validity: listing.validity }],
  identifiers: [
    { evidenceId: "ev-cik", type: "CIK", value: "0000320193", scope: "ISSUER", source: "D1_REGISTRY", issuerRef: "issuer-apple", instrumentRef: null, listingRef: null, validity: listing.validity },
    { evidenceId: "ev-isin", type: "ISIN", value: "US0378331005", scope: "INSTRUMENT", source: "D1_REGISTRY", issuerRef: null, instrumentRef: "instrument-apple", listingRef: null, validity: listing.validity },
    { evidenceId: "ev-figi", type: "FIGI", value: "BBG000B9XRY4", scope: "LISTING", source: "D1_REGISTRY", issuerRef: null, instrumentRef: "instrument-apple", listingRef: "listing-xnas", validity: listing.validity },
  ],
};
function d2Candidate(overrides: Partial<CatalogCandidate> = {}): CatalogCandidate { return { issuer: null, instrument: null, listing, providerReference: { providerKey: "TWELVE_DATA", providerReference: "AAPL", identifierType: "PROVIDER_NATIVE", scope: "LISTING", source, validity: listing.validity }, identifiers: [{ type: "PROVIDER_NATIVE", value: "AAPL", scope: "LISTING", source, evidenceKind: "PROVIDER_CATALOG", strength: "STRONG", verified: false, validity: listing.validity, marketMic: "XNAS" }], source, ...overrides }; }

test("D3 resolves a genuine D2 partial candidate only through D1 trusted aliases and evidence", () => {
  const result = resolveCanonicalIdentity({ candidate: d2Candidate(), registry: [identity], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "EXACT"); assert.deepEqual(result.evidence[0].evidenceIds, ["ev-cik", "ev-isin", "ev-figi"]);
});

test("D3 rejects candidate-supplied verified flags and identifier values that disagree with D1", () => {
  const forged = d2Candidate({ identifiers: [{ type: "CIK", value: "0001067983", scope: "ISSUER", source, evidenceKind: "OFFICIAL_REGISTRY", strength: "STRONG", verified: true, validity: listing.validity, marketMic: null }, { type: "ISIN", value: "US5949181045", scope: "INSTRUMENT", source, evidenceKind: "IDENTIFIER_RECORD", strength: "STRONG", verified: true, validity: listing.validity, marketMic: null }, { type: "FIGI", value: "BBG000BLNNH6", scope: "LISTING", source, evidenceKind: "EXCHANGE_REFERENCE", strength: "STRONG", verified: true, validity: listing.validity, marketMic: "XNAS" }] });
  assert.notEqual(resolveCanonicalIdentity({ candidate: forged, registry: [identity], asOf: "2026-11-01T00:00:00Z" }).status, "EXACT");
});

test("D3 requires all three trusted scopes and never treats issuer evidence as listing proof", () => {
  const incomplete = { ...identity, identifiers: identity.identifiers.slice(0, 2) };
  const result = resolveCanonicalIdentity({ candidate: d2Candidate(), registry: [incomplete], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "REVIEW_REQUIRED");
});

test("D3 separates AAPL XNAS from XNGS and unknown MIC roles", () => {
  const xngs = { ...listing, listingRef: "listing-xngs", mic: "XNGS", micRole: null };
  const result = resolveCanonicalIdentity({ candidate: d2Candidate({ listing: xngs, identifiers: d2Candidate().identifiers.map(e => ({ ...e, marketMic: "XNGS" })) }), registry: [identity], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "UNRESOLVED");
});

test("D3 validates as-of and every trusted period, including listing and evidence", () => {
  assert.equal(resolveCanonicalIdentity({ candidate: d2Candidate(), registry: [identity], asOf: "2026-02-30T00:00:00Z" }).status, "REVIEW_REQUIRED");
  const expired = { ...identity, identifiers: identity.identifiers.map(e => ({ ...e, validity: { validFrom: "1980-12-12", validTo: "2025-01-01" } })) };
  assert.equal(resolveCanonicalIdentity({ candidate: d2Candidate(), registry: [expired], asOf: "2026-11-01T00:00:00Z" }).status, "REVIEW_REQUIRED");
});

test("D3 handles ticker rename and delisting without look-ahead", () => {
  const renamed = { ...identity, listing: { ...listing, ticker: "AAPL2" }, aliases: [{ ...identity.aliases[0], validity: { validFrom: "2025-01-01", validTo: null } }] };
  assert.equal(resolveCanonicalIdentity({ candidate: d2Candidate(), registry: [renamed], asOf: "2026-11-01T00:00:00Z" }).status, "UNRESOLVED");
  const delisted = { ...identity, validity: { validFrom: "1980-12-12", validTo: "2025-01-01" }, listing: { ...listing, validity: { validFrom: "1980-12-12", validTo: "2025-01-01" } } };
  assert.equal(resolveCanonicalIdentity({ candidate: d2Candidate(), registry: [delisted], asOf: "2026-11-01T00:00:00Z" }).status, "REVIEW_REQUIRED");
});
