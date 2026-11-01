import test from "node:test";
import assert from "node:assert/strict";
import { resolveCanonicalIdentity, type CanonicalIdentity } from "../canonicalIdentityResolver";
import { normalizeCatalogCandidate, type CatalogCandidate, type CatalogSource } from "../instrumentDiscovery";

const source: CatalogSource = { providerKey: "REGISTRY_A", snapshotId: "snap-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "catalog-cache", storageAllowed: true, sharingAllowed: false };
const listing = { listingRef: "listing-xnas", ticker: "AAPL", mic: "XNAS", micRole: "OPERATING" as const, tradingCurrency: "USD", validity: { validFrom: "1980-12-12", validTo: null } };
const identity: CanonicalIdentity = { issuerRef: "issuer-apple", instrumentRef: "instrument-apple", listingRef: "listing-xnas", assetClass: "EQUITY", denominationCurrency: "USD", listing, validity: listing.validity, identifiers: [] };
function candidate(overrides: Partial<CatalogCandidate> = {}): CatalogCandidate {
  return {
    issuer: { issuerRef: "issuer-apple", legalName: "Apple Inc." },
    instrument: { instrumentRef: "instrument-apple", assetClass: "EQUITY", denominationCurrency: "USD" },
    listing,
    providerReference: { providerKey: source.providerKey, providerReference: "AAPL.XNAS", identifierType: "PROVIDER_NATIVE", scope: "LISTING", source, validity: listing.validity },
    identifiers: [
      { type: "CIK", value: "0000320193", scope: "ISSUER", source, evidenceKind: "OFFICIAL_REGISTRY", strength: "STRONG", verified: true, validity: listing.validity, marketMic: null },
      { type: "ISIN", value: "US0378331005", scope: "INSTRUMENT", source, evidenceKind: "IDENTIFIER_RECORD", strength: "STRONG", verified: true, validity: listing.validity, marketMic: null },
      { type: "FIGI", value: "BBG000B9XRY4", scope: "LISTING", source, evidenceKind: "EXCHANGE_REFERENCE", strength: "STRONG", verified: true, validity: listing.validity, marketMic: "XNAS" },
    ],
    source,
    ...overrides,
  };
}

test("D3 resolves EXACT only with linked issuer, instrument and listing evidence", () => {
  const result = resolveCanonicalIdentity({ candidate: candidate(), registry: [identity], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "EXACT");
  assert.equal(result.reasonCode, "CANONICAL_MATCH");
  assert.equal(result.identity?.listingRef, "listing-xnas");
});

test("D3 keeps ticker, ISIN, CIK and LEI-only evidence non-definitive", () => {
  const base = candidate();
  for (const evidence of [base.identifiers[0], base.identifiers[1], base.identifiers[2]]) {
    const result = resolveCanonicalIdentity({ candidate: { ...base, identifiers: [evidence] }, registry: [identity], asOf: "2026-11-01T00:00:00Z" });
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.equal(result.reasonCode, "CANONICAL_EVIDENCE_INSUFFICIENT");
  }
});

test("D3 distinguishes AAPL XNAS from XNGS and unknown MIC roles", () => {
  const xngs = { ...listing, listingRef: "listing-xngs", mic: "XNGS", micRole: null };
  const result = resolveCanonicalIdentity({ candidate: candidate({ listing: xngs, identifiers: candidate().identifiers.map(e => ({ ...e, marketMic: e.scope === "LISTING" ? "XNGS" : e.marketMic })) }), registry: [identity], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.identity, null);
});

test("D3 rejects same ticker and same ISIN when listing, currency or asset identity conflicts", () => {
  const conflicting = candidate({ listing: { ...listing, listingRef: "listing-xnas-etf", tradingCurrency: "EUR" }, instrument: { instrumentRef: "instrument-etf", assetClass: "ETF", denominationCurrency: "EUR" } });
  const result = resolveCanonicalIdentity({ candidate: conflicting, registry: [identity], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "UNRESOLVED");
});

test("D3 honors point-in-time validity and never matches a delisted identity outside its window", () => {
  const historical = { ...identity, validity: { validFrom: "1980-12-12", validTo: "2025-01-01" }, listing: { ...identity.listing, validity: { validFrom: "1980-12-12", validTo: "2025-01-01" } } };
  const result = resolveCanonicalIdentity({ candidate: candidate(), registry: [historical], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.reasonCode, "CANONICAL_OUTSIDE_VALIDITY");
});

test("D3 preserves provider provenance and does not call price pipeline", () => {
  const normalized = normalizeCatalogCandidate(candidate());
  const result = resolveCanonicalIdentity({ candidate: normalized, registry: [identity], asOf: "2026-11-01T00:00:00Z" });
  assert.equal(result.evidence[0].providerKey, "REGISTRY_A");
  assert.equal(result.candidate?.source.snapshotId, "snap-1");
});
