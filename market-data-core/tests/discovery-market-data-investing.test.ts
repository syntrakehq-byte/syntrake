import test from "node:test";
import assert from "node:assert/strict";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { discoverMarketDataForInvesting, discoverMarketDataPreview } from "../discoveryMarketDataInvesting";
import type { CatalogSource } from "../instrumentDiscovery";
import type { CanonicalIdentity } from "../canonicalIdentityResolver";
import type { ProviderCapability } from "../providerCapabilities";

const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "r3-int-1", snapshotVersion: "1", observedAt: "2026-01-01T00:00:00Z", licensePolicyId: "r3-rights", storageAllowed: true, sharingAllowed: false };
const priceEnv = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/r3-market-data-core-20261030", VERCEL_GIT_COMMIT_SHA: "a".repeat(40), SYNTRAKE_R3_PREVIEW_APPROVED_SHA: "a".repeat(40), SYNTRAKE_R3_PROVIDER_ENABLED: "enabled", SYNTRAKE_TWELVE_DATA_API_KEY: "offline-test-key-1234" };
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
  const result = await discoverMarketDataForInvesting({ onboarding, capabilities: [capability], routing, claim, selectedProviderId: "provider-id", provider: async () => { calls++; return { status: "AVAILABLE", provider: "TWELVE_DATA", instrument: { kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD" }, sourceRefs: [{ provider: "TWELVE_DATA", originalSourceId: "time_series:EQUITY:XNGS:AAPL:USD:1day:none", requestId: null, sourceDocumentUri: null }], firstSeenAt: "2026-01-02T20:00:00Z", ingestedAt: "2026-01-02T20:00:00Z", asKnownAt: "2026-01-02T20:00:00Z", revisionId: "rev-1", schemaVersion: "1.0", quality: { flags: ["LATENCY_NOT_VERIFIED"], coverage: "FULL" }, rights: { policyId: "r3-rights", display: true, retentionUntil: null }, marketDate: "2026-01-02", value: [{ marketDate: "2026-01-02", open: "100.00", high: "110.00", low: "90.00", close: "100.50", volume: "42" }] }; } });
  assert.equal(result.status, "READY");
  assert.equal(result.candidates[0].listing?.mic, "XNGS");
  assert.equal(result.providerKey, "TWELVE_DATA");
  assert.equal(result.close, "100.50");
  assert.equal(calls, 1);
});

test("R3 composition fails closed when discovery is unresolved, and for quota or claim mismatch", async () => {
  const ambiguousConnector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNAS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" }, { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" }] }), { status: 200 }) });
  const unresolved = await discoverMarketDataForInvesting({ onboarding: { ...onboarding, connector: ambiguousConnector, query: { ticker: "AAPL" }, loadRegistry: async () => [identity] }, capabilities: [capability], routing, claim, selectedProviderId: "provider-id", provider: async () => { throw new Error("must-not-call"); } });
  assert.equal(unresolved.status, "REVIEW_REQUIRED");
  assert.equal(unresolved.candidates.length, 2);
  const blocked = await discoverMarketDataForInvesting({ onboarding, capabilities: [{ ...capability, quota: { ...capability.quota, remaining: 0 } }], routing, claim, selectedProviderId: "provider-id", provider: async () => { throw new Error("must-not-call"); } });
  assert.equal(blocked.status, "ROUTING_BLOCKED");
  const mismatched = await discoverMarketDataForInvesting({ onboarding, capabilities: [capability], routing, claim: { ...claim, listing_id: "other-listing" }, selectedProviderId: "provider-id", provider: async () => { throw new Error("must-not-call"); } });
  assert.equal(mismatched.status, "ROUTING_BLOCKED");
});

test("R3 preview discovers AAPL with an empty Registry and uses the selected Twelve Data reference", async () => {
  let requested = "";
  const previewConnector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async url => { requested = url; return new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" }] }), { status: 200 }); } });
  const found = await previewConnector.search({ name: "Apple" });
  assert.equal(found.candidates.length, 1);
  const result = await discoverMarketDataPreview({ connector: previewConnector, query: { name: "Apple" }, price: { env: priceEnv, quotaRemaining: 1, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: true, retentionUntil: null }, transport: async url => { assert.match(url, /time_series/); assert.match(url, /symbol=AAPL/); return new Response(JSON.stringify({ status: "ok", meta: { symbol: "AAPL", interval: "1day", currency: "USD", exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNGS" }, values: [{ datetime: "2026-01-02", open: "100.00", high: "110.00", low: "90.00", close: "100.50", volume: "42" }] }), { status: 200 }); } } });
  assert.equal(result.status, "READY");
  assert.equal(result.identityVerified, false);
  assert.match(requested, /symbol=Apple/);
});

test("R3 preview requires explicit confirmation for multiple provider candidates and validates presentation rights", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [
    { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNAS", currency: "USD", instrument_type: "Common Stock" },
    { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" },
  ] }), { status: 200 }) });
  const ambiguous = await discoverMarketDataPreview({ connector, query: { ticker: "AAPL" }, price: { env: priceEnv, quotaRemaining: 1, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: true, retentionUntil: null }, transport: async () => { throw new Error("must-not-call"); } } });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  const blocked = await discoverMarketDataPreview({ connector, query: { ticker: "AAPL", marketMic: "XNGS" }, price: { env: priceEnv, quotaRemaining: 1, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: false, retentionUntil: null } }, selectedCandidateIndex: 0 });
  assert.equal(blocked.status, "ROUTING_BLOCKED");
  const quotaBlocked = await discoverMarketDataPreview({ connector, query: { ticker: "AAPL", marketMic: "XNGS" }, price: { env: priceEnv, quotaRemaining: 0, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: true, retentionUntil: null } }, selectedCandidateIndex: 0 });
  assert.equal(quotaBlocked.status, "ROUTING_BLOCKED");
});

test("R3 preview distinguishes ETF candidates and rejects malformed envelopes", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "SPY", instrument_name: "SPDR S&P 500 ETF Trust", exchange: "NYSE Arca", mic_code: "ARCX", currency: "USD", instrument_type: "ETF" }] }), { status: 200 }) });
  const ready = await discoverMarketDataPreview({ connector, query: { ticker: "SPY", assetClass: "ETF" }, price: { env: priceEnv, quotaRemaining: 1, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: true, retentionUntil: null }, transport: async () => new Response(JSON.stringify({ status: "ok", meta: { symbol: "SPY", interval: "1day", currency: "USD", exchange_timezone: "America/New_York", type: "ETF", mic_code: "ARCX" }, values: [{ datetime: "2026-01-02", open: "100.00", high: "110.00", low: "90.00", close: "100.50", volume: "42" }] }), { status: 200 }) }, selectedCandidateIndex: 0 });
  assert.equal(ready.status, "READY");
  assert.equal(ready.identityVerified, false);
  await assert.rejects(() => discoverMarketDataPreview({ connector, query: { ticker: "SPY", assetClass: "ETF" }, price: { env: priceEnv, quotaRemaining: 1, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: true, retentionUntil: null }, transport: async () => new Response(JSON.stringify({ status: "ok", meta: { symbol: "SPY", interval: "1day", currency: "USD", exchange_timezone: "America/New_York", type: "ETF", mic_code: "ARCX" }, values: [] }), { status: 200 }) }, selectedCandidateIndex: 0 }), /INVALID_PROVIDER_RESPONSE/);
});

test("R3 rejects a price response whose identity differs from the requested listing", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" }] }), { status: 200 }) });
  await assert.rejects(() => discoverMarketDataPreview({ connector, query: { ticker: "AAPL", marketMic: "XNGS" }, price: { env: priceEnv, quotaRemaining: 1, estimatedCredits: 1, rights: { policyId: "preview-rights", query: true, display: true, retentionUntil: null }, transport: async () => new Response(JSON.stringify({ status: "ok", meta: { symbol: "MSFT", interval: "1day", currency: "USD", exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNAS" }, values: [{ datetime: "2026-01-02", open: "100.00", high: "110.00", low: "90.00", close: "100.50", volume: "42" }] }), { status: 200 }) }, selectedCandidateIndex: 0 }), /INVALID_PROVIDER_RESPONSE/);
});
