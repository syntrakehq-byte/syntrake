import test from "node:test";
import assert from "node:assert/strict";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { CatalogConnectorError, type CatalogConnector } from "../catalogConnector";
import { createDiscoveryResult, normalizeCatalogCandidate, type CatalogSource } from "../instrumentDiscovery";

const sourceA: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "td-1", snapshotVersion: "1", observedAt: "2026-11-01T00:00:00Z", licensePolicyId: "catalog-cache", storageAllowed: true, sharingAllowed: false };
const sourceB: CatalogSource = { ...sourceA, providerKey: "SIMULATED_B", snapshotId: "b-1", licensePolicyId: "catalog-b" };
const row = (symbol: string, mic: string, micRole?: "OPERATING" | "SEGMENT") => ({ symbol, instrument_name: "Apple Inc.", exchange: mic === "XNAS" ? "NASDAQ" : "Nasdaq Global Select Market", mic_code: mic, ...(micRole === undefined ? {} : { mic_role: micRole }), exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" });
const response = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const transportFor = (value: Response) => async () => value;

test("D2 Twelve Data adapter separates XNAS and XNGS and never returns EXACT", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: transportFor(response(200, { status: "ok", data: [row("AAPL", "XNAS"), row("AAPL", "XNGS")] })) });
  const result = await connector.search({ ticker: "AAPL" });
  assert.equal(result.status, "AMBIGUOUS");
  assert.deepEqual(result.candidates.map(x => [x.listing?.mic, x.listing?.micRole]), [["XNAS", null], ["XNGS", null]]);
  assert.notEqual(result.status, "EXACT");
});

test("D2 supports independent simulated providers with distinct references", async () => {
  const a = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: transportFor(response(200, { status: "ok", data: [row("AAPL", "XNAS")] })) });
  const bCandidate = normalizeCatalogCandidate({ issuer: null, instrument: null, descriptiveName: "Apple Inc.", descriptiveAssetClass: "EQUITY", descriptiveCurrency: "USD", listing: { listingRef: "sim-b-listing", ticker: "APPLE", mic: "XNAS", micRole: null, tradingCurrency: "USD", validity: { validFrom: null, validTo: null } }, providerReference: { providerKey: sourceB.providerKey, providerReference: "APPLE.NASDAQ", identifierType: "PROVIDER_NATIVE", scope: "LISTING", source: sourceB, validity: { validFrom: null, validTo: null } }, identifiers: [{ type: "PROVIDER_NATIVE", value: "APPLE.NASDAQ", scope: "LISTING", source: sourceB, evidenceKind: "PROVIDER_CATALOG", strength: "STRONG", verified: false, validity: { validFrom: null, validTo: null }, marketMic: "XNAS" }], source: sourceB });
  const b: CatalogConnector = { providerKey: "SIMULATED_B", search: async query => createDiscoveryResult(query, [bCandidate]), lookup: async () => createDiscoveryResult({ ticker: "APPLE" }, [bCandidate]) };
  const [left, right] = await Promise.all([a.search({ ticker: "AAPL", marketMic: "XNAS" }), b.search({ ticker: "APPLE", marketMic: "XNAS" })]);
  assert.equal(left.candidates[0].providerReference.providerReference, "AAPL");
  assert.equal(right.candidates[0].providerReference.providerReference, "APPLE.NASDAQ");
  assert.notEqual(left.candidates[0].source.providerKey, right.candidates[0].source.providerKey);
  assert.equal(left.status, "REVIEW_REQUIRED");
});

test("D2 rejects invalid identity, malformed responses and licensing before conversion", async () => {
  const badMic = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: transportFor(response(200, { status: "ok", data: [{ ...row("AAPL", "XNGS"), mic_role: "NOT_A_ROLE" }] })) });
  await assert.rejects(badMic.search({ ticker: "AAPL" }), (error: unknown) => error instanceof CatalogConnectorError && error.code === "INVALID_PROVIDER_RESPONSE");
  const malformed = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: async () => new Response("not-json", { status: 200 }) });
  await assert.rejects(malformed.search({ ticker: "AAPL" }), (error: unknown) => error instanceof CatalogConnectorError && error.code === "INVALID_PROVIDER_RESPONSE");
  assert.throws(() => createTwelveDataCatalogConnector({ env: {}, source: { ...sourceA, storageAllowed: false }, transport: transportFor(response(200, { status: "ok", data: [] })) }), (error: unknown) => error instanceof CatalogConnectorError && error.code === "LICENSE_BLOCKED");
});

test("D2 classifies HTTP failures, rate limits and absent results without retries", async () => {
  const statuses = [[400, "INVALID_REQUEST"], [404, "INVALID_REQUEST"], [422, "INVALID_REQUEST"], [500, "PROVIDER_UNAVAILABLE"]] as const;
  for (const [status, code] of statuses) {
    let calls = 0;
    const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: async () => { calls++; return response(status, {}); } });
    await assert.rejects(connector.search({ ticker: "AAPL" }), (error: unknown) => error instanceof CatalogConnectorError && error.code === code && error.status === status);
    assert.equal(calls, 1);
  }
  const limited = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: transportFor(response(429, {}, { "retry-after": "12" })) });
  await assert.rejects(limited.search({ ticker: "AAPL" }), (error: unknown) => error instanceof CatalogConnectorError && error.code === "RATE_LIMITED" && error.retryAfterSeconds === 12);
  const empty = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: transportFor(response(200, { status: "ok", data: [] })) });
  assert.equal((await empty.search({ ticker: "MISSING" })).status, "UNRESOLVED");
});

test("D2 lookup does not invoke price adapters or establish identity", async () => {
  let requested = "";
  const connector: CatalogConnector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: async url => { requested = url; return response(200, { status: "ok", data: [row("AAPL", "XNAS")] }); } });
  const result = await connector.lookup("AAPL", "LISTING");
  assert.match(requested, /symbol=AAPL/);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.candidates[0].providerReference.identifierType, "PROVIDER_NATIVE");
});

test("D2 maps name, ticker and market filters to documented symbol_search parameters", async () => {
  const urls: string[] = [];
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceA, transport: async url => { urls.push(url); return response(200, { status: "ok", data: [row("AAPL", "XNGS")] }); } });
  await connector.search({ name: "Apple Inc.", marketMic: "XNGS" });
  await connector.search({ ticker: "AAPL", marketMic: "XNGS" });
  assert.match(urls[0], /symbol=Apple\+Inc\.&outputsize=100/);
  assert.match(urls[1], /symbol=AAPL&outputsize=100/);
  for (const url of urls) {
    assert.doesNotMatch(url, /[?&](search|mic_code|currency)=/);
  }
});

test("D2 refuses live fallback and preserves provider identity", () => {
  assert.throws(() => createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "present-but-never-used" }, source: sourceA }), (error: unknown) => error instanceof CatalogConnectorError && error.code === "PROVIDER_UNAVAILABLE");
  assert.throws(() => createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source: sourceB, transport: transportFor(response(200, { status: "ok", data: [] })) }), (error: unknown) => error instanceof CatalogConnectorError && error.code === "INVALID_REQUEST");
});
