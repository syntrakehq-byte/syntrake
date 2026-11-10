import type { Client } from "pg";
import { createG3PreviewClient } from "./g3PreviewPinnedClients";
import { instrumentIdentity, type InstrumentIdentity } from "./identity";
import { loadInvestingMarketDataFromPostgres } from "./investingMarketDataHttp";
import { createOnDemandMarketDataGateway, type MarketDataDemand, type MarketDataGatewayDependencies } from "./onDemandMarketData";
import { createOnDemandTwelveDataSource } from "./onDemandTwelveData";
import { createOnDemandTwelveDataAuthorizer } from "./onDemandAuthorization";
import type { Actor } from "../investing-core/contracts";

type Env = Readonly<Record<string, string | undefined>>;
const BRANCH = "feat/g3g-preview-hosted-worker-20261108";
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Shared on-demand API is Preview-only until its license and integration gates are reviewed. */
export function isSharedMarketDataPreviewEnabled(env: Env): boolean {
  return env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === BRANCH &&
    !!env.VERCEL_GIT_COMMIT_SHA && SHA.test(env.VERCEL_GIT_COMMIT_SHA) &&
    env.G3G_APPROVED_SHA === env.VERCEL_GIT_COMMIT_SHA &&
    env.G3G_ON_DEMAND_MODE === "enabled" &&
    env.G3G_WORKER_MODE === "disabled";
}

/** Uses the single restricted, host-pinned and CA-verified Preview reader identity. */
async function withReader<T>(env: Env, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = createG3PreviewClient(env, "reader");
  await client.connect();
  try {
    await client.query("SET ROLE market_core_reader");
    return await operation(client);
  } finally {
    await client.end();
  }
}

type RegistryRow = {
  listing_id: string; instrument_id: string; ticker: string; mic: string;
  trading_currency: string; asset_class: "EQUITY" | "ETF" | "FX";
  rights_policy_id: string; display_allowed: boolean; cache_allowed: boolean;
  retention_until: Date | string | null;
};

export async function resolveSharedMarketDemand(
  listingId: string, _actor: Actor, env: Env,
  withClient: typeof withReader = withReader,
): Promise<MarketDataDemand | null> {
  if (!isSharedMarketDataPreviewEnabled(env) || !UUID.test(listingId) ||
      !UUID.test(env.G3G_ON_DEMAND_RIGHTS_POLICY_ID ?? "")) return null;
  const row = await withClient(env, async client => {
    const result = await client.query<RegistryRow>(
      "SELECT l.listing_id::text, l.instrument_id::text, l.ticker, l.mic::text AS mic, " +
      "l.trading_currency::text AS trading_currency, i.asset_class, " +
      "lp.rights_policy_id::text, lp.display_allowed, lp.cache_allowed, lp.retention_until " +
      "FROM market_core.listings l " +
      "JOIN market_core.instruments i ON i.instrument_id=l.instrument_id " +
      "JOIN market_core.license_policies lp ON lp.rights_policy_id=$2::uuid " +
      "WHERE l.listing_id=$1::uuid AND l.valid_from <= current_date " +
      "AND (l.valid_to IS NULL OR l.valid_to > current_date) LIMIT 1",
      [listingId, env.G3G_ON_DEMAND_RIGHTS_POLICY_ID],
    );
    return result.rows[0] ?? null;
  });
  if (!row || !row.display_allowed || !row.cache_allowed ||
      (row.retention_until !== null &&
        new Date(row.retention_until).getTime() <= Date.now())) return null;

  const instrument: InstrumentIdentity = {
    ...instrumentIdentity({ kind: row.asset_class, symbol: row.ticker,
      mic: row.asset_class === "FX" ? null : row.mic, currency: row.trading_currency }),
    instrumentId: row.instrument_id,
    listingId: row.listing_id,
    key: "instrument:" + row.instrument_id + ":listing:" + row.listing_id,
  };
  return {
    instrument, rightsPolicyId: row.rights_policy_id, requiresDisplay: true,
    interval: "1day", adjustment: "none", maxAgeMs: 24 * 60 * 60 * 1000,
  };
}

/**
 * Reuses the existing PIT historical reader and rights checks instead of
 * introducing a second SQL implementation of canonical price selection.
 */
export function createSharedMarketGateway(
  actor: Actor, env: Env,
  overrides: Partial<MarketDataGatewayDependencies> = {},
): ReturnType<typeof createOnDemandMarketDataGateway> {
  const source = createOnDemandTwelveDataSource({
    env,
    // Authorization is resolved from the canonical PG registry. The default
    // capability callbacks remain closed without independent evidence.
    authorize: createOnDemandTwelveDataAuthorizer({
      env,
      readerFactory: input => createG3PreviewClient(input, "reader"),
      creditReserved: async () => env.G3G_CREDIT_RESERVATION === "enabled",
      purgeVerified: async () => env.G3G_PURGE_ATTESTATION === "verified",
    }),
  });
  const deps: MarketDataGatewayDependencies = {
    readCached: overrides.readCached ?? (async demand => {
      const clock = new Date();
      const to = clock.toISOString().slice(0, 10);
      const start = new Date(clock.getTime() - 21 * 86400000).toISOString().slice(0, 10);
      const result = await loadInvestingMarketDataFromPostgres({
        listingId: demand.instrument.listingId!, startDate: start, endDate: to,
        asOf: clock.toISOString(), interval: "1day", adjustment: "none",
      }, actor, {
        ...env, MARKET_DATA_G3C_APPROVED_RIGHTS_POLICY_ID: demand.rightsPolicyId,
      }, input => createG3PreviewClient(input, "reader"));
      return result.status === "AVAILABLE" ? result.current : null;
    }),
    fetchAuthorized: overrides.fetchAuthorized ?? source,
    // Only a properly licensed provider can supply a write adapter; this API
    // cannot bypass the Coordinator or directly write observations.
    storeAuthorized: overrides.storeAuthorized ?? (async () => {
      throw new Error("G3G_PERSISTENCE_NOT_AUTHORIZED");
    }),
    clock: overrides.clock,
  };
  return createOnDemandMarketDataGateway(deps);
}
