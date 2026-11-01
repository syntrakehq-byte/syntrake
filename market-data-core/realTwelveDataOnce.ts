import { MarketDataError } from "./identity";
import { fetchDailySeries, type DailySeries, type ProviderUsageHeaders } from "./twelveData";
import { requireR3E1RealCallReady } from "./gate";

export type RealCallResult = Readonly<{ series: DailySeries; usage: ProviderUsageHeaders }>;
let realCallConsumed = false;

/** Manual, process-scoped, one-symbol rehearsal. No scheduler or public route uses this. */
export async function runTwelveDataRealOnce(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  instrument: Parameters<typeof fetchDailySeries>[0]["instrument"];
  sourceAlias: NonNullable<Parameters<typeof fetchDailySeries>[0]["sourceAlias"]>;
  asOf: string;
  transport?: Parameters<typeof fetchDailySeries>[0]["transport"];
}>): Promise<RealCallResult> {
  requireR3E1RealCallReady(input.env);
  if (realCallConsumed) throw new MarketDataError("INVALID_REQUEST");
  // Consume the one-shot authorization before network I/O; a timeout/error
  // is therefore conservatively treated as potentially billable.
  realCallConsumed = true;
  let usage: ProviderUsageHeaders = { remaining: null, used: null };
  const series = await fetchDailySeries({
    env: input.env, instrument: input.instrument, sourceAlias: input.sourceAlias,
    asOf: input.asOf, outputSize: 1,
    transport: input.transport,
    onResponseHeaders: headers => { usage = headers; },
  });
  return { series, usage };
}
