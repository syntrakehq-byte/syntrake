import { MarketDataError, type AliasResolution } from "./identity";
import { isG3PreviewProviderReady, isR3AProviderReady } from "./gate";
import { fetchDailySeries } from "./twelveData";
import type { MarketDataDemand, MarketDataProviderResult } from "./onDemandMarketData";

type Env = Readonly<Record<string, string | undefined>>;

export type AuthorizedTwelveDataContext = Readonly<{
  /** Server-side canonical provider alias: must be PIT exact. */
  alias: AliasResolution;
  asOfMarketDate: string;
  policyId: string;
  queryAllowed: boolean;
  displayAllowed: boolean;
  cacheAllowed: boolean;
  retentionUntil: string | null;
  /** A bounded credit reservation is provided by the existing Coordinator. */
  creditReserved: boolean;
  /** Must be backed by audited deletion/retention evidence, not inferred from API response. */
  purgeVerified: boolean;
}>;

/**
 * Live adapter for the existing validated Twelve Data client. Never starts
 * itself. A caller must supply a server-side registry + license + budget
 * decision; no arbitrary ticker from an HTTP query can authorize a call.
 *
 * In the existing G3 Preview branch only internal non-display requests
 * are licensed; a browser display request is refused before any network.
 */
export function createOnDemandTwelveDataSource(input: Readonly<{
  env: Env;
  authorize: (demand: MarketDataDemand) => Promise<AuthorizedTwelveDataContext | null>;
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  clock?: () => Date;
}>): (demand: MarketDataDemand) => Promise<MarketDataProviderResult | null> {
  return async demand => {
    if (!isG3PreviewProviderReady(input.env) && !isR3AProviderReady(input.env)) {
      throw new MarketDataError("DISABLED");
    }
    if (isG3PreviewProviderReady(input.env) && demand.requiresDisplay) {
      // G3 internal-non-display scope cannot be used to serve browser quotes.
      return null;
    }
    const auth = await input.authorize(demand);
    if (!auth || auth.policyId !== demand.rightsPolicyId || !auth.queryAllowed ||
        !auth.creditReserved || !auth.alias || auth.alias.status !== "EXACT" ||
        auth.alias.instrumentId !== demand.instrument.instrumentId ||
        auth.alias.listingId !== demand.instrument.listingId ||
        demand.requiresDisplay && !auth.displayAllowed) {
      return null;
    }
    const now = (input.clock ?? (() => new Date()))();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf()) ||
        auth.retentionUntil !== null && (!Number.isFinite(Date.parse(auth.retentionUntil)) ||
          Date.parse(auth.retentionUntil) <= now.valueOf())) {
      return null;
    }
    const series = await fetchDailySeries({
      env: input.env, instrument: demand.instrument, sourceAlias: auth.alias,
      asOf: auth.asOfMarketDate, outputSize: 1,
      transport: input.transport, clock: input.clock,
      rights: { policyId: auth.policyId, display: auth.displayAllowed, retentionUntil: auth.retentionUntil },
    });
    const latest = series.candles[series.candles.length - 1];
    if (!latest) throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
    return {
      data: Object.freeze({
        instrument: series.instrument, listingRef: series.instrument.listingId,
        sourceRefs: series.envelope.sourceRefs,
        revisionId: series.envelope.revisionId, price: latest.close,
        currency: series.instrument.currency, marketDate: latest.marketDate,
        asOf: series.envelope.asKnownAt,
        quality: { coverage: series.envelope.quality.coverage, freshness: "UNKNOWN" as const },
        rights: series.envelope.rights, interval: "1day" as const, adjustment: "none" as const,
      }),
      // Query permission != long-term storage permission.
      storageAllowed: auth.cacheAllowed && auth.purgeVerified &&
        auth.retentionUntil !== null && Date.parse(auth.retentionUntil) > now.valueOf(),
    };
  };
}
