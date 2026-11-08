import type { Client } from "pg";
import { resolveProviderAlias, type AliasResolution } from "./identity";
import type { MarketDataDemand } from "./onDemandMarketData";
import type { AuthorizedTwelveDataContext } from "./onDemandTwelveData";

type Env = Readonly<Record<string, string | undefined>>;
type ReaderFactory = (env: Env) => Client;

type Row = Readonly<{
  provider_id: string;
  listing_id: string;
  instrument_id: string;
  provider_reference: string;
  alias_valid_from: string | null;
  alias_valid_to: string | null;
  rights_policy_id: string;
  display_allowed: boolean;
  cache_allowed: boolean;
  retention_until: Date | string | null;
}>;

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/**
 * Resolve Twelve Data authorization from the canonical registry, not from the
 * ticker supplied by HTTP. The query is read-only; credit reservation and
 * persistence remain separate capabilities.
 */
export function createOnDemandTwelveDataAuthorizer(input: Readonly<{
  env: Env;
  readerFactory: ReaderFactory;
  clock?: () => Date;
  creditReserved?: (demand: MarketDataDemand, row: Row) => Promise<boolean>;
  purgeVerified?: (demand: MarketDataDemand, row: Row) => Promise<boolean>;
}>): (demand: MarketDataDemand) => Promise<AuthorizedTwelveDataContext | null> {
  return async demand => {
    const now = (input.clock ?? (() => new Date()))();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf()) ||
        !UUID.test(demand.instrument.instrumentId ?? "") ||
        !UUID.test(demand.instrument.listingId ?? "")) return null;

    const client = input.readerFactory(input.env);
    await client.connect();
    let row: Row | undefined;
    try {
      await client.query("SET ROLE market_core_reader");
      const result = await client.query<Row>(
        "SELECT p.provider_id::text AS provider_id, l.listing_id::text AS listing_id, " +
        "l.instrument_id::text AS instrument_id, a.provider_reference, " +
        "a.valid_from::text AS alias_valid_from, a.valid_to::text AS alias_valid_to, " +
        "lp.rights_policy_id::text AS rights_policy_id, lp.display_allowed, " +
        "lp.cache_allowed, lp.retention_until " +
        "FROM market_core.providers p " +
        "JOIN market_core.provider_aliases a ON a.provider_id=p.provider_id " +
        "JOIN market_core.license_policies lp ON lp.rights_policy_id=$3::uuid " +
        "JOIN market_core.listings l ON l.listing_id=a.listing_id " +
        "WHERE p.provider_key='TWELVE_DATA' AND p.status='ACTIVE' " +
        "AND l.listing_id=$1::uuid AND l.instrument_id=$2::uuid " +
        "AND a.valid_from <= $4::date AND (a.valid_to IS NULL OR a.valid_to > $4::date) " +
        "LIMIT 2",
        [demand.instrument.listingId, demand.instrument.instrumentId,
          demand.rightsPolicyId, now.toISOString().slice(0, 10)],
      );
      if (result.rows.length !== 1) return null;
      row = result.rows[0];
    } finally {
      await client.end().catch(() => {});
    }

    const retention = asDate(row.retention_until);
    if (row.rights_policy_id !== demand.rightsPolicyId ||
        row.listing_id !== demand.instrument.listingId ||
        row.instrument_id !== demand.instrument.instrumentId ||
        !UUID.test(row.provider_id) || !retention || retention <= now ||
        !row.cache_allowed || (demand.requiresDisplay && !row.display_allowed)) return null;

    const alias: AliasResolution = resolveProviderAlias("TWELVE_DATA",
      row.provider_reference, now.toISOString().slice(0, 10), [{
        provider: "TWELVE_DATA",
        providerReference: row.provider_reference,
        instrumentId: row.instrument_id,
        listingId: row.listing_id,
        validFrom: row.alias_valid_from,
        validTo: row.alias_valid_to,
      }]);
    if (alias.status !== "EXACT") return null;

    const creditReserved = await (input.creditReserved?.(demand, row) ?? Promise.resolve(false));
    const purgeVerified = await (input.purgeVerified?.(demand, row) ?? Promise.resolve(false));
    return {
      alias,
      asOfMarketDate: now.toISOString().slice(0, 10),
      policyId: row.rights_policy_id,
      queryAllowed: true,
      displayAllowed: row.display_allowed,
      cacheAllowed: row.cache_allowed,
      retentionUntil: retention.toISOString(),
      creditReserved,
      purgeVerified,
    };
  };
}
