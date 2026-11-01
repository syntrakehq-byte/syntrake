import { fetchDailySeries, fetchDailySeriesR3E1Once, type DailySeries, type ProviderUsageHeaders } from "./twelveData";

export type RealCallResult = Readonly<{ series: DailySeries; usage: ProviderUsageHeaders }>;

/** Manual, process-scoped, one-symbol rehearsal. No scheduler or public route uses this. */
export async function runTwelveDataRealOnce(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  instrument: Parameters<typeof fetchDailySeries>[0]["instrument"];
  sourceAlias: NonNullable<Parameters<typeof fetchDailySeries>[0]["sourceAlias"]>;
  asOf: string;
  checkoutSha: string;
  transport?: Parameters<typeof fetchDailySeries>[0]["transport"];
}>): Promise<RealCallResult> {
  let usage: ProviderUsageHeaders = { remaining: null, used: null };
  const series = await fetchDailySeriesR3E1Once({
    env: input.env, instrument: input.instrument, sourceAlias: input.sourceAlias,
    asOf: input.asOf, outputSize: 1,
    transport: input.transport,
    checkoutSha: input.checkoutSha,
    onResponseHeaders: headers => { usage = headers; },
  });
  return { series, usage };
}
