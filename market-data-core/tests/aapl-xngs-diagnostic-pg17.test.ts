import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { createTwelveDataCatalogConnector } from "../twelveDataCatalog";
import { resolveCanonicalIdentity, type CanonicalIdentity } from "../canonicalIdentityResolver";
import { routeProvider } from "../providerRouter";
import type { CatalogSource } from "../instrumentDiscovery";
import type { ProviderCapability } from "../providerCapabilities";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
const ids = { provider: "a1a10000-0000-0000-0000-000000000001", rights: "a1a10000-0000-0000-0000-000000000002", issuer: "a1a10000-0000-0000-0000-000000000003", instrument: "a1a10000-0000-0000-0000-000000000004", xnas: "a1a10000-0000-0000-0000-000000000005", xngs: "a1a10000-0000-0000-0000-000000000006", source: "a1a10000-0000-0000-0000-000000000007", snapshot: "a1a10000-0000-0000-0000-000000000008", alias: "a1a10000-0000-0000-0000-000000000009" };
const source: CatalogSource = { providerKey: "TWELVE_DATA", snapshotId: "aapl-snapshot", snapshotVersion: "1", observedAt: "2025-01-01T00:00:00Z", licensePolicyId: "aapl-rights", storageAllowed: true, sharingAllowed: false };

async function loadIdentity(listingId: string): Promise<CanonicalIdentity> {
  const listing = (await db.query("SELECT listing_id,ticker,mic,mic_role,trading_currency,to_char(valid_from,'YYYY-MM-DD') AS valid_from,to_char(valid_to,'YYYY-MM-DD') AS valid_to,instrument_id FROM market_core.listings WHERE listing_id=$1", [listingId])).rows[0];
  const chain = (await db.query("SELECT i.issuer_id,i.asset_class,i.denomination_currency FROM market_core.instruments i WHERE i.instrument_id=$1", [listing.instrument_id])).rows[0];
  const aliases = (await db.query("SELECT p.provider_key,a.provider_reference,a.listing_id,to_char(a.valid_from,'YYYY-MM-DD') AS valid_from,to_char(a.valid_to,'YYYY-MM-DD') AS valid_to,to_char(o.known_at,'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS observed_at FROM market_core.provider_aliases a JOIN market_core.providers p ON p.provider_id=a.provider_id JOIN market_core.provider_alias_observations o ON o.provider_alias_id=a.provider_alias_id WHERE a.listing_id=$1", [listingId])).rows;
  const evidence = (await db.query("SELECT ii.identifier_id,ii.identifier_type AS type,ii.identifier_value AS value,ii.identifier_scope AS scope,ii.verified,ii.source_id,ii.snapshot_id,cs.rights_policy_id,to_char(csn.observed_at,'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS observed_at,ii.issuer_id,ii.instrument_id,ii.listing_id FROM market_core.instrument_identifiers ii JOIN market_core.catalog_sources cs USING(source_id) JOIN market_core.catalog_snapshots csn USING(snapshot_id) WHERE (ii.issuer_id=$1 OR ii.instrument_id=$2 OR ii.listing_id=$3) ORDER BY ii.identifier_scope", [chain.issuer_id, listing.instrument_id, listingId])).rows;
  return { issuerRef: chain.issuer_id, instrumentRef: listing.instrument_id, instrumentIssuerRef: chain.issuer_id, listingRef: listingId, assetClass: chain.asset_class, denominationCurrency: chain.denomination_currency, listing: { listingRef: listingId, ticker: listing.ticker, mic: listing.mic, micRole: listing.mic_role, tradingCurrency: listing.trading_currency, validity: { validFrom: listing.valid_from, validTo: listing.valid_to ?? null } }, validity: { validFrom: listing.valid_from, validTo: listing.valid_to ?? null }, aliases: aliases.map(a => ({ providerKey: a.provider_key, providerReference: a.provider_reference, listingRef: a.listing_id, observedAt: a.observed_at, validity: { validFrom: a.valid_from, validTo: a.valid_to ?? null } })), identifiers: evidence.map(e => ({ evidenceId: e.identifier_id, type: e.type, value: e.value, scope: e.scope, source: "D1_REGISTRY" as const, verified: e.verified, sourceId: e.source_id, snapshotId: e.snapshot_id, rightsPolicyId: e.rights_policy_id, observedAt: e.observed_at, issuerRef: e.scope === "ISSUER" ? e.issuer_id : null, instrumentRef: e.scope === "ISSUER" ? null : e.instrument_id, listingRef: e.scope === "LISTING" ? e.listing_id : null, validity: { validFrom: "1980-12-12", validTo: null } })) };
}

before(async () => {
  await db.connect();
  assert.match((await db.query("SELECT current_setting('server_version') AS v")).rows[0].v, /^17\./);
  for (const file of ["supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql", "supabase/release-candidates/20261101110000_r3d1_registry_identifiers_candidate.sql", "supabase/release-candidates/20261101130000_r3d3_canonical_resolution_candidate.sql"]) await db.query(await readFile(resolve(process.cwd(), file), "utf8"));
  await db.query("INSERT INTO market_core.providers VALUES ($1,'TWELVE_DATA','ACTIVE')", [ids.provider]);
  await db.query("INSERT INTO market_core.license_policies VALUES ($1,'aapl-rights',true,true,NULL)", [ids.rights]);
  await db.query("INSERT INTO market_core.issuers VALUES ($1,'Apple Inc.')", [ids.issuer]);
  await db.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [ids.instrument, ids.issuer]);
  await db.query("INSERT INTO market_core.listings(listing_id,instrument_id,mic,mic_role,trading_currency,ticker,valid_from) VALUES ($1,$2,'XNAS','OPERATING','USD','AAPL',DATE '1980-12-12'),($3,$2,'XNGS','SEGMENT','USD','AAPL',DATE '1980-12-12')", [ids.xnas, ids.instrument, ids.xngs]);
  await db.query("INSERT INTO market_core.provider_aliases(provider_alias_id,provider_id,provider_reference,listing_id,valid_from,identifier_type,identifier_scope) VALUES ($1,$2,'AAPL',$3,DATE '1980-12-12','TICKER','LISTING')", [ids.alias, ids.provider, ids.xngs]);
  await db.query("INSERT INTO market_core.provider_alias_observations VALUES ($1,TIMESTAMPTZ '2025-01-01',TIMESTAMPTZ '2025-01-01')", [ids.alias]);
  await db.query("INSERT INTO market_core.catalog_sources VALUES ($1,$2,'AAPL_SOURCE','LISTINGS',$3,true,false,NULL,TIMESTAMPTZ '2025-01-01')", [ids.source, ids.provider, ids.rights]);
  await db.query("INSERT INTO market_core.catalog_snapshots VALUES ($1,$2,'aapl-1',TIMESTAMPTZ '2025-01-01',DATE '1980-12-12',NULL,repeat('a',64),'REVIEW_REQUIRED',TIMESTAMPTZ '2025-01-01')", [ids.snapshot, ids.source]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,issuer_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('a1a10000-0000-0000-0000-000000000011','CIK','0000320193','ISSUER',$1,$2,$3,'OFFICIAL_REGISTRY',true,TIMESTAMPTZ '2025-01-01')", [ids.issuer, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,instrument_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('a1a10000-0000-0000-0000-000000000012','ISIN','US0378331005','INSTRUMENT',$1,$2,$3,'IDENTIFIER_RECORD',true,TIMESTAMPTZ '2025-01-01')", [ids.instrument, ids.source, ids.snapshot]);
  await db.query("INSERT INTO market_core.instrument_identifiers(identifier_id,identifier_type,identifier_value,identifier_scope,listing_id,source_id,snapshot_id,evidence_kind,verified,created_at) VALUES ('a1a10000-0000-0000-0000-000000000013','FIGI','BBG000B9XRY4','LISTING',$1,$2,$3,'EXCHANGE_REFERENCE',true,TIMESTAMPTZ '2025-01-01')", [ids.xngs, ids.source, ids.snapshot]);
});
after(async () => { await db.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await db.query("DROP EXTENSION IF EXISTS btree_gist"); await db.end(); });

test("AAPL discovery preserves XNGS, blocks XNAS-only, and resolves/routs independently verified XNGS", async () => {
  const connector = createTwelveDataCatalogConnector({ env: { TWELVE_DATA_API_KEY: "offline-only" }, source, transport: async () => new Response(JSON.stringify({ status: "ok", data: [{ symbol: "AAPL", instrument_name: "Apple Inc.", exchange: "Nasdaq Global Select Market", mic_code: "XNGS", exchange_timezone: "America/New_York", country: "United States", currency: "USD", instrument_type: "Common Stock", access: "full" }] }), { status: 200 }) });
  const discovered = await connector.search({ ticker: "AAPL" });
  assert.equal(discovered.candidates.length, 1); assert.equal(discovered.candidates[0].listing?.mic, "XNGS"); assert.notEqual(discovered.status, "EXACT");
  const candidate = discovered.candidates[0];
  const xnasOnly = await loadIdentity(ids.xnas);
  const blocked = resolveCanonicalIdentity({ candidate, registry: [xnasOnly], asOf: "2026-01-01T00:00:00Z" });
  assert.notEqual(blocked.status, "EXACT");
  const xngs = await loadIdentity(ids.xngs);
  const resolved = resolveCanonicalIdentity({ candidate: { ...candidate, listing: xngs.listing, identifiers: candidate.identifiers.map(e => ({ ...e, marketMic: "XNGS" })) }, registry: [xngs], asOf: "2026-01-01T00:00:00Z" });
  assert.equal(resolved.status, "EXACT", resolved.reasonCode);
  const capability: ProviderCapability = { providerKey: "TWELVE_DATA", service: "MARKET_DATA", assetClasses: ["EQUITY"], markets: [{ mic: "XNGS", role: "SEGMENT" }], currencies: ["USD"], coverage: { validFrom: "2020-01-01", validTo: null }, granularities: ["1day"], adjustments: ["none"], operational: "AVAILABLE", quality: { coverage: "KNOWN", freshness: "KNOWN", integrity: "KNOWN", score: 90 }, rights: { policyId: ids.rights, query: true, store: true, display: false, retain: true, share: false, valid: { validFrom: "2020-01-01", validTo: null } }, cost: { nativeUnit: "TWELVE_DATA_CREDITS", nativeAmount: 1, economic: null, knowledge: "KNOWN" }, quota: { nativeUnit: "TWELVE_DATA_CREDITS", remaining: 1, knowledge: "KNOWN" }, source: { sourceId: ids.source, snapshotId: ids.snapshot, observedAt: "2025-01-01T00:00:00Z" } };
  const routed = routeProvider({ identity: resolved, service: "MARKET_DATA", mic: "XNGS", micRole: "SEGMENT", assetClass: "EQUITY", currency: "USD", from: "2025-01-02", to: "2025-01-02", granularity: "1day", adjustment: "none", asOf: "2026-01-01T00:00:00Z", rights: { query: true, store: true, display: false, retain: true, share: false, policyId: ids.rights }, quality: { requireCoverage: true, requireFreshness: true, requireIntegrity: true, minScore: 80 }, maxEconomicCost: null }, [capability]);
  assert.equal(routed.status, "READY"); assert.equal(routed.selected?.providerKey, "TWELVE_DATA");
  await db.query("DELETE FROM market_core.instrument_identifiers WHERE identifier_scope='LISTING' AND listing_id=$1", [ids.xngs]);
  const afterEvidenceRemoval = await loadIdentity(ids.xngs);
  assert.notEqual(resolveCanonicalIdentity({ candidate, registry: [afterEvidenceRemoval], asOf: "2026-01-01T00:00:00Z" }).status, "EXACT");
});
