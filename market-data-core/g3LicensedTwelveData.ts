import type { Client } from "pg";
import { canonicalIdentity, resolveProviderAlias, type AliasResolution, type InstrumentIdentity } from "./identity";
import type { OfflineProvider } from "./offlinePipeline";
import { createTwelveDataOfflineProvider } from "./twelveDataProvider";
import { isG3PreviewProviderReady } from "./gate";

type Claim = Parameters<OfflineProvider>[0];
type Env = Readonly<Record<string, string | undefined>>;
type ReaderFactory = () => Promise<Client>;

/** Must come from independently reviewed provider entitlement, never from API results. */
export type StorageAttestation = Readonly<{
  provider: "TWELVE_DATA";
  rightsPolicyId: string;
  scope: "internal-non-display";
  evidenceReference: string;
  retentionUntil: string; // explicit deadline provided by entitlement review
  reviewedAt: string;
  purgeVerified: true; // a separate physical-deletion rehearsal is mandatory
}>;

export type LicensedG3Source = Readonly<{
  instrument: InstrumentIdentity;
  sourceAlias: AliasResolution;
  asOf: string;
  retentionUntil: string;
}>;

type RegistryRow = Readonly<{
  instrument_id: string;
  issuer_id: string | null;
  asset_class: "EQUITY" | "ETF" | "FX";
  denomination_currency: string;
  listing_id: string;
  mic: string | null;
  trading_currency: string;
  ticker: string;
  listing_valid_from: string;
  listing_valid_to: string | null;
  provider_reference: string;
  alias_valid_from: string | null;
  alias_valid_to: string | null;
  cache_allowed: boolean;
  display_allowed: boolean;
  retention_until: Date | string | null;
}>;

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const STRICT_EVIDENCE = /^twelvedata:(?:contract|license|support-confirmation):[A-Za-z0-9._:-]{8,160}$/;

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function checkAttestation(attestation: StorageAttestation | null, claim: Claim, now: Date): string {
  if (!attestation ||
      attestation.provider !== "TWELVE_DATA" ||
      attestation.scope !== "internal-non-display" ||
      attestation.purgeVerified !== true ||
      attestation.rightsPolicyId !== claim.rights_policy_id ||
      !UUID.test(attestation.rightsPolicyId) ||
      !STRICT_EVIDENCE.test(attestation.evidenceReference) ||
      !UTC.test(attestation.reviewedAt) || !UTC.test(attestation.retentionUntil) ||
      Date.parse(attestation.reviewedAt) > now.valueOf() ||
      Date.parse(attestation.retentionUntil) <= now.valueOf()) {
    throw new Error("G3_STORAGE_RIGHTS_UNVERIFIED");
  }
  return new Date(attestation.retentionUntil).toISOString();
}

/**
 * A separate read-only identity resolves a registry listing by exact alias and
 * provider. The ingest LOGIN never receives SELECT over full registry tables.
 */
export async function resolveLicensedG3Source(
  claim: Claim,
  input: Readonly<{
    readerFactory: ReaderFactory;
    attestation: StorageAttestation | null;
    clock?: () => Date;
  }>,
): Promise<LicensedG3Source> {
  const now = (input.clock ?? (() => new Date()))();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error("G3_INVALID_CLOCK");
  const retentionUntil = checkAttestation(input.attestation, claim, now);
  if (!UUID.test(claim.provider_id) || !UUID.test(claim.listing_id)) {
    throw new Error("G3_REGISTRY_IDENTITY_REQUIRED");
  }
  const asOf = now.toISOString().slice(0, 10);
  const client = await input.readerFactory();
  try {
    await client.connect();
    await client.query("SET ROLE market_core_reader");
    const { rows } = await client.query<RegistryRow>(`
      SELECT i.instrument_id::text, i.issuer_id::text,
             i.asset_class, btrim(i.denomination_currency) AS denomination_currency,
             l.listing_id::text, btrim(l.mic) AS mic,
             btrim(l.trading_currency) AS trading_currency,
             l.ticker, l.valid_from::text AS listing_valid_from,
             l.valid_to::text AS listing_valid_to, a.provider_reference,
             a.valid_from::text AS alias_valid_from,
             a.valid_to::text AS alias_valid_to,
             lp.cache_allowed, lp.display_allowed, lp.retention_until
      FROM market_core.providers p
      JOIN market_core.provider_aliases a ON a.provider_id = p.provider_id
      JOIN market_core.listings l ON l.listing_id = a.listing_id
      JOIN market_core.instruments i ON i.instrument_id = l.instrument_id
      JOIN market_core.license_policies lp ON lp.rights_policy_id = $3::uuid
      WHERE p.provider_id = $1::uuid AND p.provider_key = 'TWELVE_DATA'
        AND p.status = 'ACTIVE' AND l.listing_id = $2::uuid
        AND l.valid_from <= $4::date
        AND (l.valid_to IS NULL OR l.valid_to > $4::date)
        AND a.valid_from <= $4::date
        AND (a.valid_to IS NULL OR a.valid_to > $4::date)
      LIMIT 2
    `, [claim.provider_id, claim.listing_id, claim.rights_policy_id, asOf]);
    if (rows.length !== 1) throw new Error("G3_REGISTRY_NOT_EXACT");
    const row = rows[0];
    const persistedUntil = iso(row.retention_until);
    if (!row.cache_allowed || row.display_allowed || !persistedUntil ||
        Date.parse(persistedUntil) <= now.valueOf() ||
        Date.parse(persistedUntil) > Date.parse(retentionUntil)) {
      throw new Error("G3_STORAGE_RIGHTS_UNVERIFIED");
    }
    const instrument = canonicalIdentity({
      instrument: {
        instrumentId: row.instrument_id, issuerId: row.issuer_id,
        kind: row.asset_class, denominationCurrency: row.denomination_currency,
      },
      listing: {
        listingId: row.listing_id, instrumentId: row.instrument_id,
        mic: row.mic, tradingCurrency: row.trading_currency,
        ticker: row.ticker, validFrom: row.listing_valid_from, validTo: row.listing_valid_to,
      },
    });
    const sourceAlias = resolveProviderAlias("TWELVE_DATA", row.provider_reference, asOf, [{
      provider: "TWELVE_DATA", providerReference: row.provider_reference,
      instrumentId: instrument.instrumentId, listingId: instrument.listingId,
      validFrom: row.alias_valid_from, validTo: row.alias_valid_to,
    }]);
    if (sourceAlias.status !== "EXACT") throw new Error("G3_REGISTRY_NOT_EXACT");
    return { instrument, sourceAlias, asOf, retentionUntil: persistedUntil };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Licensed provider bridge: validated entitlement -> canonical PIT registry ->
 * one pre-existing R3 Twelve Data adapter -> R3-C append-only ingestion.
 * This bridge contains no endpoint, scheduler or elevated database credentials.
 */
export function createLicensedG3TwelveDataProvider(input: Readonly<{
  env: Env;
  readerFactory: ReaderFactory;
  attestation: StorageAttestation | null;
  transport?: Parameters<typeof createTwelveDataOfflineProvider>[0]["transport"];
  clock?: () => Date;
}>): OfflineProvider {
  return async claim => {
    if (!isG3PreviewProviderReady(input.env)) throw new Error("G3_PROVIDER_DISABLED");
    const source = await resolveLicensedG3Source(claim, input);
    const provider = createTwelveDataOfflineProvider({
      env: input.env,
      resolve: async () => source,
      outputSize: 1,
      transport: input.transport,
      clock: input.clock,
    });
    const envelope = await provider(claim);
    return {
      ...envelope,
      rights: {
        policyId: claim.rights_policy_id,
        display: false,
        retentionUntil: source.retentionUntil,
      },
    };
  };
}
