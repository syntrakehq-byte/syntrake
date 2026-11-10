import { MarketDataError, instrumentIdentity } from "./identity";
import { isG3HostedPreviewReady } from "./g3HostedPreviewExecutor";
import { fetchDailySeriesR3E1Once } from "./twelveData";

type Env = Readonly<Record<string, string | undefined>>;
type FetchSeries = typeof fetchDailySeriesR3E1Once;

/**
 * Explicit, single-click, Preview-only probe using the existing Twelve Data
 * parser and private API credential. No persistence and no price disclosure.
 * It is a diagnostic, not a replacement for the canonical Market Data pipeline.
 */
export async function runPersonalMarketProbe(
  env: Env,
  fetchSeries: FetchSeries = fetchDailySeriesR3E1Once,
): Promise<Readonly<{
  status: "PROVIDER_VALIDATED";
  provider: "TWELVE_DATA";
  symbol: "AAPL";
  mic: "XNGS";
  currency: "USD";
  marketDate: string;
  observationCount: number;
  providerCalls: 1;
  persisted: false;
  displayed: false;
}>> {
  const sha = env.G3G_DEPLOYMENT_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (!isG3HostedPreviewReady(env) ||
      env.G3G_WORKER_MODE !== "disabled" ||
      env.SYNTRAKE_G3_PROVIDER_ENABLED !== "disabled" ||
      env.SYNTRAKE_R3E1_REHEARSAL_LICENSE_CONFIRMED !== "confirm-query-no-display" ||
      env.SYNTRAKE_R3E1_APPROVED_SHA !== sha ||
      env.SYNTRAKE_R3E1_REAL_CALL_ENABLED !== "confirm-once") {
    throw new MarketDataError("DISABLED");
  }

  const series = await fetchSeries({
    env,
    instrument: instrumentIdentity({
      kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD",
    }),
    outputSize: 1,
    checkoutSha: sha,
    rights: { policyId: "preview-personal-probe", display: false, retentionUntil: null },
  });
  const latest = series.candles.at(-1);
  if (!latest || series.provider !== "TWELVE_DATA" || series.candles.length !== 1 ||
      latest.marketDate.length !== 10) {
    throw new MarketDataError("INVALID_PROVIDER_RESPONSE");
  }
  return {
    status: "PROVIDER_VALIDATED",
    provider: "TWELVE_DATA",
    symbol: "AAPL",
    mic: "XNGS",
    currency: "USD",
    marketDate: latest.marketDate,
    observationCount: series.candles.length,
    providerCalls: 1,
    persisted: false,
    displayed: false,
  };
}
