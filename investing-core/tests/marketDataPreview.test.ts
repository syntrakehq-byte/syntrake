import test from "node:test";
import assert from "node:assert/strict";
import { createTwelveDataCatalogConnector } from "../../market-data-core/twelveDataCatalog";
import { previewInvestingDeclaredHolding, parseInvestingDeclaredHolding } from "../marketDataPreview";
import type { CatalogSource } from "../../market-data-core/instrumentDiscovery";

const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "investing-preview-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "internal-preview", storageAllowed: true, sharingAllowed: false };
const priceEnv = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/r3-market-data-core-20261030", VERCEL_GIT_COMMIT_SHA: "a".repeat(40), SYNTRAKE_R3_PREVIEW_APPROVED_SHA: "a".repeat(40), SYNTRAKE_R3_PROVIDER_ENABLED: "enabled", SYNTRAKE_TWELVE_DATA_API_KEY: "offline-test-key-1234" };
const connector = createTwelveDataCatalogConnector({
  env: { TWELVE_DATA_API_KEY: "offline-only" },
  source,
  transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" }] }), { status: 200 }),
});
const price = (rights: { query: boolean; display: boolean } = { query: true, display: true }) => ({
  env: priceEnv, quotaRemaining: 1, estimatedCredits: 1,
  rights: { policyId: "preview-rights", query: rights.query, display: rights.display, retentionUntil: null },
  transport: async () => new Response(JSON.stringify({ status: "ok", meta: { symbol: "AAPL", interval: "1day", currency: "USD", exchange_timezone: "America/New_York", type: "Common Stock", mic_code: "XNGS" }, values: [{ datetime: "2026-01-02", open: "100.00", high: "110.00", low: "90.00", close: "100.50", volume: "42" }] }), { status: 200 }),
});

test("Investing parses a declared fractional Apple holding without creating a ledger row", async () => {
  const result = await previewInvestingDeclaredHolding("Tenho 0.96 ações da Apple.", { connector, source, price: price() });
  assert.deepEqual(result.declaration, { query: { name: "Apple" }, quantity: "0.96" });
  assert.equal(result.status, "READY");
  assert.equal(result.identityVerified, false);
  assert.equal(result.providerKey, "TWELVE_DATA");
  assert.equal(result.positionValue, "96.48");
  assert.equal(result.quantityAtoms, 960000000000n);
});

test("Investing requires explicit selection for ambiguity and blocks rights or quota violations", async () => {
  const ambiguousConnector = createTwelveDataCatalogConnector({
    env: { TWELVE_DATA_API_KEY: "offline-only" }, source,
    transport: async () => new Response(JSON.stringify({ status: "ok", data: [
      { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNAS", currency: "USD", instrument_type: "Common Stock" },
      { symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", currency: "USD", instrument_type: "Common Stock" },
    ] }), { status: 200 }),
  });
  const ambiguous = await previewInvestingDeclaredHolding("Tenho 0.96 ações da Apple.", { connector: ambiguousConnector, source, price: price() });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  assert.equal(ambiguous.positionValue, null);
  const blocked = await previewInvestingDeclaredHolding("Tenho 0.96 ações da Apple.", { connector, source, price: price({ query: true, display: false }) });
  assert.equal(blocked.status, "ROUTING_BLOCKED");
  assert.throws(() => parseInvestingDeclaredHolding("Tenho ações da Apple."), /INVESTING_DECLARATION_INVALID/);
});
