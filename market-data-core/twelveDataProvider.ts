import { fetchDailySeries, type DailySeries } from "./twelveData";
import type { AliasResolution, InstrumentIdentity } from "./identity";
import type { OfflineProvider } from "./offlinePipeline";

export type TwelveDataRegistryResolution = Readonly<{
  instrument: InstrumentIdentity;
  sourceAlias: AliasResolution;
  asOf: string;
}>;

/**
 * Adapts the R3-A Twelve Data contract to the single R3-C OfflineProvider
 * seam. Registry resolution is deliberately injected: the worker never turns
 * a ticker into an owned identity and the pipeline remains the only writer.
 */
export function createTwelveDataOfflineProvider(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  resolve: (claim: Parameters<OfflineProvider>[0]) => Promise<TwelveDataRegistryResolution>;
  outputSize?: number;
  transport?: Parameters<typeof fetchDailySeries>[0]["transport"];
  clock?: Parameters<typeof fetchDailySeries>[0]["clock"];
}>): OfflineProvider {
  return async claim => {
    const resolved = await input.resolve(claim);
    if (
      resolved.instrument.listingId !== claim.listing_id ||
      resolved.sourceAlias.listingId !== claim.listing_id ||
      resolved.instrument.instrumentId !== resolved.sourceAlias.instrumentId
    ) {
      throw new Error("OFFLINE_PROVIDER_IDENTITY_MISMATCH");
    }
    const series: DailySeries = await fetchDailySeries({
      env: input.env,
      instrument: resolved.instrument,
      sourceAlias: resolved.sourceAlias,
      asOf: resolved.asOf,
      outputSize: input.outputSize ?? 1,
      ...(input.transport ? { transport: input.transport } : {}),
      ...(input.clock ? { clock: input.clock } : {}),
    });
    const candle = series.candles[series.candles.length - 1];
    if (!candle) throw new Error("OFFLINE_PROVIDER_NOT_AVAILABLE");
    return {
      ...series.envelope,
      provider: "TWELVE_DATA" as const,
      instrument: resolved.instrument,
      value: [candle],
      marketDate: candle.marketDate,
      rights: { policyId: claim.rights_policy_id, display: false, retentionUntil: null },
    };
  };
}
