import test from "node:test";
import assert from "node:assert/strict";
import { routeProvider } from "../providerRouter";
import type { ProviderCapability, RoutingRequest } from "../providerCapabilities";
import type { CanonicalResolution } from "../canonicalIdentityResolver";

const rights = { policyId: "rights-a", query: true, store: true, display: true, retain: true, share: false, valid: { validFrom: "2020-01-01", validTo: null } } as const;
const base = (providerKey: string, credits: number | null, overrides: Partial<ProviderCapability> = {}): ProviderCapability => ({ providerKey, service: "MARKET_DATA", assetClasses: ["EQUITY"], markets: [{ mic: "XNAS", role: "OPERATING" }], currencies: ["USD"], coverage: { validFrom: "2020-01-01", validTo: null }, granularities: ["1day"], adjustments: ["none"], operational: "AVAILABLE", quality: { coverage: "KNOWN", freshness: "KNOWN", integrity: "KNOWN", score: 90 }, rights, cost: { currency: "USD", credits, knowledge: credits === null ? "UNKNOWN" : "KNOWN" }, quota: { remaining: 10, knowledge: "KNOWN" }, source: { sourceId: `${providerKey}-source`, observedAt: "2026-01-01T00:00:00Z", snapshotId: `${providerKey}-snapshot` }, ...overrides });
const identity = { issuerRef: "issuer-a", instrumentRef: "instrument-a", instrumentIssuerRef: "issuer-a", listingRef: "listing-a", assetClass: "EQUITY", denominationCurrency: "USD", listing: { listingRef: "listing-a", ticker: "AAPL", mic: "XNAS", micRole: "OPERATING", tradingCurrency: "USD", validity: { validFrom: "2020-01-01", validTo: null } }, identifiers: [], aliases: [], validity: { validFrom: "2020-01-01", validTo: null } } as const;
const exact: CanonicalResolution = { status: "EXACT", reasonCode: "CANONICAL_MATCH", identity, candidate: null, evidence: [] };
const request = (overrides: Partial<RoutingRequest> = {}): RoutingRequest => ({ identity: exact, service: "MARKET_DATA", mic: "XNAS", micRole: "OPERATING", assetClass: "EQUITY", currency: "USD", from: "2025-01-01", to: "2025-01-02", granularity: "1day", adjustment: "none", asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: true, retain: true, share: false, policyId: "rights-a" }, maxCredits: 10, ...overrides });

test("D4 chooses the cheapest eligible provider deterministically", () => {
  const result = routeProvider(request(), [base("PROVIDER_A", 5), base("PROVIDER_B", 2)]);
  assert.equal(result.status, "READY");
  assert.equal(result.selected?.providerKey, "PROVIDER_B");
  assert.equal(result.alternatives[0]?.providerKey, "PROVIDER_A");
  assert.equal(result.demandKey, routeProvider(request(), [base("PROVIDER_B", 2), base("PROVIDER_A", 5)]).demandKey);
});

test("D4 excludes partial coverage, different MICs and unsupported adjustments", () => {
  assert.equal(routeProvider(request(), [base("PARTIAL", 1, { markets: [{ mic: "XNGS", role: "SEGMENT" }] })]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request({ mic: "XNGS", micRole: "SEGMENT" }), [base("XNAS", 1)]).status, "NO_ELIGIBLE_PROVIDER");
  assert.equal(routeProvider(request({ adjustment: "dividends" }), [base("NO_ADJUSTMENT", 1)]).status, "NO_ELIGIBLE_PROVIDER");
});

test("D4 fails closed for unresolved identity and never promotes it", () => {
  const unresolved = { ...exact, status: "REVIEW_REQUIRED", identity: null, reasonCode: "CANONICAL_EVIDENCE_INSUFFICIENT" } as CanonicalResolution;
  const result = routeProvider(request({ identity: unresolved }), [base("PROVIDER_A", 1)]);
  assert.equal(result.status, "IDENTITY_UNRESOLVED");
  assert.equal(result.selected, null);
});

test("D4 blocks rights, unknown cost, quotas and operational backoff", () => {
  assert.equal(routeProvider(request(), [base("NO_STORE", 1, { rights: { ...rights, store: false } })]).status, "LICENSE_BLOCKED");
  assert.equal(routeProvider(request(), [base("UNKNOWN_COST", null)]).status, "COST_UNKNOWN");
  assert.equal(routeProvider(request(), [base("NO_QUOTA", 1, { quota: { remaining: 0, knowledge: "KNOWN" } })]).status, "QUOTA_UNAVAILABLE");
  assert.equal(routeProvider(request(), [base("BACKOFF", 1, { operational: "BACKOFF" })]).status, "PROVIDER_UNAVAILABLE");
});

test("D4 does not reserve credits, call HTTP or execute fallback", () => {
  const result = routeProvider(request(), [base("A", 1, { quota: { remaining: 0, knowledge: "UNKNOWN" } }), base("B", null)]);
  assert.notEqual(result.status, "READY");
  assert.equal(result.selected, null);
  assert.equal(result.alternatives.length, 0);
  assert.notEqual(routeProvider(request({ rights: { ...request().rights, display: false } }), [base("A", 1)]).demandKey, result.demandKey);
});
