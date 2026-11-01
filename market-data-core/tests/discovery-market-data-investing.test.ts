import test from "node:test";
import assert from "node:assert/strict";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { discoverMarketDataForInvesting } from "../discoveryMarketDataInvesting";
import type { CatalogSource } from "../instrumentDiscovery";
import type { CanonicalIdentity } from "../canonicalIdentityResolver";
import type { ProviderCapability } from "../providerCapabilities";

const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "r3-int-1", snapshotVersion: "1", observedAt: "2026-01-01T00:00:00Z", licensePolicyId: "r3-rights", storageAllowed: true, sharingAllowed: false };
const ids = { issuer: "issuer-a", instrument: "instrument-a", listing: "listing-a" };
const identity: CanonicalIdentity = {
  issuerRef: ids.issuer, instrumentRef: ids.instrument, instrumentIssuerRef: ids.issuer, listingRef: ids.listing,
  assetClass: "EQUITY", denominationCurrency: "USD", validity: { validFrom: "2020-01-01", validTo: null },
  listing: { listingRef: ids.listing, ticker: "AAPL", mic: "XNGS", micRole: null, tradingCurrency: "USD", validity: { validFrom: "2020-01-01", validTo: null } },
  aliases: [{ providerKey: "TWELVE_DATA", providerReference: "AAPL", listingRef: ids.listing, observedAt: "2025-01-01T00:00:00Z", validity: { validFrom: "2020-01-01", validTo: null } }],
  identifiers: [
    { evidenceId: "issuer-evidence", type: "CIK", value: "0000320193", scope: "ISSUER", source: "D1_REGISTRY", verified: true, sourceId: "registry", snapshotId: "registry-1", rightsPolicyId: "r3-rights", observedAt: "2025-01-01T00:00:00Z", issuerRef: ids.issuer, instrumentRef: null, listingRef: null, validity: { validFrom: "2020-01-01", validTo: null } },
    { evidenceId: "instrument-evidence", type: "ISIN", value: "US0378331005", scope: "INSTRUMENT", source: "D1_REGISTRY", verified: true, sourceId: "registry", snapshotId: "registry-1", rightsPolicyId: "r3-rights", observedAt: "2025-01-01T00:00:00Z", issuerRef: null, instrumentRef: ids.instrument, listingRef: null, validity: { validFrom: "2020-01-01", validTo: null } },
    { evidenceId: "listing-evidence", type: "FIGI", value: "BBG000B9XRY4", scope: "LISTING", source: "D1_REGISTRY", verified: true, sourceId: "registry", snapshotId: "registry-1", rightsPolicyId: "r3-rights", observedAt: "2025-01-01T00:00:00Z", issuerRef: null, instrumentRef: ids.instrument, listingRef: ids.listing, validity: { validFrom: "2020-01-01", validTo: null } },
  ],
};
const capability: ProviderCapability = { providerKey: "TWELVE_DATA", service: "MARKET_DATA", assetClasses: ["EQUITY"], markets: [{ mic: "XNGS", role: null }], currencies: ["USD"], coverage: { validFrom: "2020-01-01", validTo: null }, granularities: ["1day"], adjustments: ["none"], operational: "AVAILABLE", quality: { coverage: "KNOWN", freshness: "KNOWN", integrity: "KNOWN", score: 95 }, rights: { policyId: "r3-rights", query: true, store: true, display: false, retain: true, share: false, valid: { validFrom: "2020-01-01", validTo: null } }, cost: { nativeUnit: "TWELVE_DATA_CREDITS", nativeAmount: 1, economic: null, knowledge: "KNOWN" }, quota: { nativeUnit: "TWELVE_DATA_CREDITS", remaining: 1, knowledge: "KNOWN" }, source: { sourceId: "cap-source", snapshotId: "cap-1", observedAt: "2025-01-01T00:00:00Z" } };
const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" }] }), { status: 200 }) });
const onboarding = { connector, query: { name: "Apple" }, source, asOf: "2026-01-01T00:00:00Z", persistence: { persist: async () => ({ candidateId: "candidate-1", state: "PERSISTED" as const }) }, loadRegistry: async () => [identity] };
const routing = { service: "MARKET_DATA" as const, from: "2025-01-02", to: "2025-01-02", granularity: "1day" as const, adjustment: "none" as const, asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: false, retain: true, share: false, policyId: "r3-rights" }, quality: { requireCoverage: true, requireFreshness: true, requireIntegrity: true, minScore: 80 }, maxEconomicCost: null };
const claim = { job_id: "00000000-0000-0000-0000-000000000001", demand_key: "demand", listing_id: ids.listing, provider_id: "provider-id", rights_policy_id: "r3-rights", provider_key: "TWELVE_DATA", estimated_credits: "1", valid_from: "2020-01-01", valid_to: null };

test("R3 composition discovers Apple by name, resolves XNGS, routes and values 0.96 without ledger writes", async () => {
  let calls = 0;
  const result = await discoverMarketDataForInvesting({ onboarding, capabilities: [capability], routing, claim, selectedProviderId: "provider-id", quantity: "0.96", provider: async () => { calls++; return { status: "AVAILABLE", value: [{ close: "100.50" }] }; } });
  assert.equal(result.status, "READY");
  assert.equal(result.candidates[0].listing?.mic, "XNGS");
  assert.equal(result.providerKey, "TWELVE_DATA");
  assert.equal(result.quantityAtoms, 960000000000n);
  assert.equal(result.close, "100.50");
  assert.equal(result.positionValue, "96.48");
  assert.equal(calls, 1);
});

test("R3 composition fails closed when discovery is unresolved, and for quota or claim mismatch", async () => {
  const ambiguousConnector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNAS", currency: "USD", instrument_type: "Common Stock" }, { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" }] }), { status: 200 }) });
  const unresolved = await discoverMarketDataForInvesting({ onboarding: { ...onboarding, connector: ambiguousConnector, query: { ticker: "AAPL" }, loadRegistry: async () => [] }, capabilities: [capability], routing, claim, selectedProviderId: "provider-id", quantity: "0.96", provider: async () => { throw new Error("must-not-call"); } });
  assert.equal(unresolved.status, "REVIEW_REQUIRED");
  const blocked = await discoverMarketDataForInvesting({ onboarding, capabilities: [{ ...capability, quota: { ...capability.quota, remaining: 0 } }], routing, claim, selectedProviderId: "provider-id", quantity: "0.96", provider: async () => { throw new Error("must-not-call"); } });
  assert.equal(blocked.status, "ROUTING_BLOCKED");
  const mismatched = await discoverMarketDataForInvesting({ onboarding, capabilities: [capability], routing, claim: { ...claim, listing_id: "other-listing" }, selectedProviderId: "provider-id", quantity: "0.96", provider: async () => { throw new Error("must-not-call"); } });
  assert.equal(mismatched.status, "ROUTING_BLOCKED");
});
