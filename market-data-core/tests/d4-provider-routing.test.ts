import test from "node:test";
import assert from "node:assert/strict";
import { routeProvider } from "../providerRouter";
import type { ProviderCapability, RoutingRequest } from "../providerCapabilities";
import type { CanonicalResolution } from "../canonicalIdentityResolver";
import { resolveCanonicalIdentity } from "../canonicalIdentityResolver";
import type { CatalogCandidate, CatalogSource } from "../instrumentDiscovery";

const rights = { policyId: "rights-a", query: true, store: true, display: true, retain: true, share: false, valid: { validFrom: "2020-01-01", validTo: null } } as const;
const base = (providerKey: string, credits: number | null, overrides: Partial<ProviderCapability> = {}): ProviderCapability => ({ providerKey, service: "MARKET_DATA", assetClasses: ["EQUITY"], markets: [{ mic: "XNAS", role: "OPERATING" }], currencies: ["USD"], coverage: { validFrom: "2020-01-01", validTo: null }, granularities: ["1day"], adjustments: ["none"], operational: "AVAILABLE", quality: { coverage: "KNOWN", freshness: "KNOWN", integrity: "KNOWN", score: 90 }, rights, cost: { nativeUnit: `${providerKey}-credits`, nativeAmount: credits, economic: credits === null ? null : { currency: "USD", amount: credits }, knowledge: credits === null ? "UNKNOWN" : "KNOWN" }, quota: { nativeUnit: `${providerKey}-credits`, remaining: 10, knowledge: "KNOWN" }, source: { sourceId: `${providerKey}-source`, observedAt: "2025-01-01T00:00:00Z", snapshotId: `${providerKey}-snapshot` }, ...overrides });
const identity = { issuerRef: "issuer-a", instrumentRef: "instrument-a", instrumentIssuerRef: "issuer-a", listingRef: "listing-a", assetClass: "EQUITY", denominationCurrency: "USD", listing: { listingRef: "listing-a", ticker: "AAPL", mic: "XNAS", micRole: "OPERATING", tradingCurrency: "USD", validity: { validFrom: "2020-01-01", validTo: null } }, identifiers: [], aliases: [], validity: { validFrom: "2020-01-01", validTo: null } } as const;
const exact: CanonicalResolution = { status: "EXACT", reasonCode: "CANONICAL_MATCH", identity, candidate: null, evidence: [] };
const request = (overrides: Partial<RoutingRequest> = {}): RoutingRequest => ({ identity: exact, service: "MARKET_DATA", mic: "XNAS", micRole: "OPERATING", assetClass: "EQUITY", currency: "USD", from: "2025-01-01", to: "2025-01-02", granularity: "1day", adjustment: "none", asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: true, retain: true, share: false, policyId: "rights-a" }, quality: { requireCoverage: true, requireFreshness: true, requireIntegrity: true, minScore: 80 }, maxEconomicCost: { currency: "USD", amount: 10 }, ...overrides });

test("D4 chooses the cheapest eligible provider deterministically", () => {
  const result = routeProvider(request(), [base("PROVIDER_A", 5), base("PROVIDER_B", 2)]);
  assert.equal(result.status, "READY");
  assert.equal(result.selected?.providerKey, "PROVIDER_B");
  assert.equal(result.alternatives[0]?.providerKey, "PROVIDER_A");
  assert.equal(result.routingDecisionKey, routeProvider(request(), [base("PROVIDER_B", 2), base("PROVIDER_A", 5)]).routingDecisionKey);
});

test("D4 consumes an EXACT result produced by D3 rather than a hand-made resolution", () => {
  const source: CatalogSource = { providerKey: "PROVIDER_A", snapshotId: "snap-a", snapshotVersion: "1", observedAt: "2025-01-01T00:00:00Z", licensePolicyId: "rights-a", storageAllowed: true, sharingAllowed: false };
  const candidate: CatalogCandidate = { issuer: null, instrument: null, listing: { listingRef: "provider-listing", ticker: "AAPL", mic: "XNAS", micRole: "OPERATING", tradingCurrency: "USD", validity: { validFrom: "2020-01-01", validTo: null } }, providerReference: { providerKey: "PROVIDER_A", providerReference: "AAPL", identifierType: "TICKER", scope: "LISTING", source, validity: { validFrom: "2020-01-01", validTo: null } }, identifiers: [{ type: "TICKER", value: "AAPL", scope: "LISTING", source, evidenceKind: "PROVIDER_CATALOG", strength: "SUPPORTING", verified: false, validity: { validFrom: "2020-01-01", validTo: null }, marketMic: "XNAS" }], source };
  const trusted = (type: "CIK" | "ISIN" | "FIGI", value: string, scope: "ISSUER" | "INSTRUMENT" | "LISTING", evidenceId: string) => ({ evidenceId, type, value, scope, source: "D1_REGISTRY" as const, verified: true, sourceId: "registry-source", snapshotId: "registry-snapshot", rightsPolicyId: "rights-a", observedAt: "2025-01-01T00:00:00Z", issuerRef: scope === "ISSUER" ? "issuer-a" : null, instrumentRef: scope === "ISSUER" ? null : "instrument-a", listingRef: scope === "LISTING" ? "listing-a" : null, validity: { validFrom: "2020-01-01", validTo: null } });
  const d3 = resolveCanonicalIdentity({ candidate, asOf: "2026-01-01T00:00:00Z", registry: [{ ...identity, aliases: [{ providerKey: "PROVIDER_A", providerReference: "AAPL", listingRef: "listing-a", observedAt: "2025-01-01T00:00:00Z", validity: { validFrom: "2020-01-01", validTo: null } }], identifiers: [trusted("CIK", "0000320193", "ISSUER", "ev-issuer"), trusted("ISIN", "US0378331005", "INSTRUMENT", "ev-instrument"), trusted("FIGI", "BBG000B9XRY4", "LISTING", "ev-listing")] }] });
  assert.equal(d3.status, "EXACT");
  assert.equal(routeProvider(request({ identity: d3 }), [base("PROVIDER_A", 2)]).status, "READY");
});

test("D4 excludes partial coverage, different MICs and unsupported adjustments", () => {
  assert.equal(routeProvider(request(), [base("PARTIAL", 1, { markets: [{ mic: "XNGS", role: "SEGMENT" }] })]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request({ mic: "XNGS", micRole: "SEGMENT" }), [base("XNAS", 1)]).status, "IDENTITY_UNRESOLVED");
  assert.equal(routeProvider(request({ adjustment: "dividends" }), [base("NO_ADJUSTMENT", 1)]).status, "NO_ELIGIBLE_PROVIDER");
});

test("D4 fails closed for unresolved identity and never promotes it", () => {
  const unresolved = { ...exact, status: "REVIEW_REQUIRED", identity: null, reasonCode: "CANONICAL_EVIDENCE_INSUFFICIENT" } as CanonicalResolution;
  const result = routeProvider(request({ identity: unresolved }), [base("PROVIDER_A", 1)]);
  assert.equal(result.status, "IDENTITY_UNRESOLVED");
  assert.equal(result.selected, null);
});

test("D4 rejects a request for XNGS when D3 resolved AAPL/XNAS", () => {
  const result = routeProvider(request({ mic: "XNGS", micRole: "SEGMENT" }), [base("XNGS", 1, { markets: [{ mic: "XNGS", role: "SEGMENT" }] })]);
  assert.equal(result.status, "IDENTITY_UNRESOLVED");
});

test("D4 keeps denomination USD separate from listing trading EUR", () => {
  const euroIdentity = { ...exact, identity: { ...identity, listing: { ...identity.listing, tradingCurrency: "EUR" } } } as CanonicalResolution;
  assert.equal(routeProvider(request({ identity: euroIdentity, currency: "USD" }), [base("USD_PRICE", 1)]).status, "IDENTITY_UNRESOLVED");
  assert.equal(routeProvider(request({ identity: euroIdentity, currency: "EUR" }), [base("EUR_PRICE", 1, { currencies: ["EUR"], rights: { ...rights } })]).status, "READY");
});

test("D4 routes catalog discovery without requiring an EXACT identity", () => {
  const result = routeProvider(request({ service: "CATALOG_DISCOVERY", identity: null }), [base("CATALOG_A", 1, { service: "CATALOG_DISCOVERY" })]);
  assert.equal(result.status, "READY");
});

test("D4 blocks rights, unknown cost, quotas and operational backoff", () => {
  assert.equal(routeProvider(request(), [base("NO_STORE", 1, { rights: { ...rights, store: false } })]).status, "LICENSE_BLOCKED");
  assert.equal(routeProvider(request(), [base("UNKNOWN_COST", null)]).status, "COST_UNKNOWN");
  assert.equal(routeProvider(request(), [base("NO_QUOTA", 1, { quota: { nativeUnit: "NO_QUOTA-credits", remaining: 0, knowledge: "KNOWN" } })]).status, "QUOTA_UNAVAILABLE");
  assert.equal(routeProvider(request(), [base("BACKOFF", 1, { operational: "BACKOFF" })]).status, "PROVIDER_UNAVAILABLE");
});

test("D4 blocks unknown quality, future sources, invalid numbers, units and dates", () => {
  assert.equal(routeProvider(request(), [base("LOW_QUALITY", 1, { quality: { coverage: "UNKNOWN", freshness: "KNOWN", integrity: "KNOWN", score: 20 } })]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request(), [base("FUTURE", 1, { source: { sourceId: "future-source", snapshotId: "future-snapshot", observedAt: "2027-01-01T00:00:00Z" } })]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request(), [base("NEGATIVE", -1)]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request(), [base("NAN", Number.NaN)]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request({ maxEconomicCost: { currency: "USD", amount: 1 } }), [base("OVER_LIMIT", 2)]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request({ from: "2025-02-30" }), [base("BAD_DATE", 1)]).status, "IDENTITY_UNRESOLVED");
});

test("D4 does not compare native provider credits and preserves historical coverage", () => {
  const incomparable = routeProvider(request({ maxEconomicCost: null }), [base("EXPENSIVE_NATIVE", 1, { cost: { nativeUnit: "provider-a-credits", nativeAmount: 1, economic: null, knowledge: "KNOWN" }, quota: { nativeUnit: "provider-a-credits", remaining: 5, knowledge: "KNOWN" } }), base("CHEAP_NATIVE", 2, { cost: { nativeUnit: "provider-b-credits", nativeAmount: 2, economic: null, knowledge: "KNOWN" }, quota: { nativeUnit: "provider-b-credits", remaining: 5, knowledge: "KNOWN" } })]);
  assert.equal(incomparable.status, "READY");
  assert.match(incomparable.justification, /not comparable/);
  const historicalIdentity = { ...exact, identity: { ...identity, validity: { validFrom: "2010-01-01", validTo: null }, listing: { ...identity.listing, validity: { validFrom: "2010-01-01", validTo: null } } } } as CanonicalResolution;
  const historical = routeProvider(request({ identity: historicalIdentity, from: "2019-01-01", to: "2019-12-31", asOf: "2026-01-01T00:00:00Z" }), [base("HISTORICAL", 1, { coverage: { validFrom: "2010-01-01", validTo: "2020-01-01" }, rights: { ...rights, valid: { validFrom: "2010-01-01", validTo: null } } })]);
  assert.equal(historical.status, "READY");
});

test("D4 does not reserve credits, call HTTP or execute fallback", () => {
  const result = routeProvider(request(), [base("A", 1, { quota: { nativeUnit: "A-credits", remaining: null, knowledge: "UNKNOWN" } }), base("B", null)]);
  assert.notEqual(result.status, "READY");
  assert.equal(result.selected, null);
  assert.equal(result.alternatives.length, 0);
  assert.notEqual(routeProvider(request({ rights: { ...request().rights, display: false } }), [base("A", 1)]).routingDecisionKey, result.routingDecisionKey);
});
