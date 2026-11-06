import { fetchDailySeries } from "../market-data-core/twelveData";
import { instrumentIdentity, MarketDataError } from "../market-data-core/identity";
import { isG3PreviewProviderReady } from "../market-data-core/gate";

// Temporary build-time probe: no public route, no persistence, no retries,
// no prices or API credentials in logs. The opt-in is branch and SHA pinned.
async function main(): Promise<void> {
  const env = process.env;
  if (env.SYNTRAKE_G3_REAL_PROBE !== "run-one" || !isG3PreviewProviderReady(env)) {
    const validKey = typeof env.SYNTRAKE_TWELVE_DATA_API_KEY === "string" &&
      /^[A-Za-z0-9_-]{16,128}$/.test(env.SYNTRAKE_TWELVE_DATA_API_KEY);
    const flags = [
      ["probe", env.SYNTRAKE_G3_REAL_PROBE === "run-one"],
      ["preview", env.VERCEL_ENV === "preview"],
      ["branch", env.VERCEL_GIT_COMMIT_REF === "feat/g3e-integrated-rehearsal-20261106"],
      ["sha", /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "") &&
        env.VERCEL_GIT_COMMIT_SHA === env.SYNTRAKE_G3_APPROVED_SHA],
      ["provider", env.SYNTRAKE_G3_PROVIDER_ENABLED === "enabled"],
      ["rights", env.SYNTRAKE_G3_LICENSE_SCOPE === "internal-non-display"],
      ["credential", validKey],
    ] as const;
    console.log("G3_REAL_PROVIDER_PROBE SKIPPED checks=" +
      flags.map(([key, ok]) => key + ":" + (ok ? "ok" : "blocked")).join(","));
    return;
  }
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !== "feat/g3e-integrated-rehearsal-20261106") {
    throw new Error("PREVIEW_ONLY");
  }
  let requests = 0;
  let credits: { used: string | null; remaining: string | null } = {
    used: null, remaining: null,
  };
  const transport = async (url: string, init: RequestInit): Promise<Response> => {
    requests += 1;
    if (requests > 1) throw new Error("PROVIDER_CALL_LIMIT");
    const target = new URL(url);
    if (target.origin !== "https://api.twelvedata.com" ||
        target.pathname !== "/time_series" ||
        target.searchParams.get("interval") !== "1day" ||
        target.searchParams.get("outputsize") !== "1" ||
        target.searchParams.get("symbol") !== "AAPL" ||
        target.searchParams.has("apikey")) {
      throw new Error("PROVIDER_REQUEST_NOT_APPROVED");
    }
    return fetch(url, init);
  };
  try {
    const data = await fetchDailySeries({
      env,
      instrument: instrumentIdentity({
        kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD",
      }),
      outputSize: 1,
      transport,
      rights: {
        policyId: "g3-preview-internal-probe-not-redistributable",
        display: false,
        retentionUntil: null,
      },
      onResponseHeaders: headers => {
        credits = { used: headers.used, remaining: headers.remaining };
      },
    });
    if (requests !== 1 || data.candles.length !== 1 ||
        data.provider !== "TWELVE_DATA" || data.envelope.rights.display ||
        data.latency !== "NOT_VERIFIED" || data.evidence !== "PROVIDER_RESPONSE") {
      throw new Error("PROVIDER_PROBE_INVARIANT");
    }
    console.log("G3_REAL_PROVIDER_PROBE PASS requests=1 source=TWELVE_DATA interval=1day display=false price_logged=false credits_used=" +
      (credits.used ?? "UNKNOWN") + " credits_remaining=" + (credits.remaining ?? "UNKNOWN"));
  } catch (error: unknown) {
    const code = error instanceof MarketDataError ? error.code :
      error instanceof Error && /^[A-Z_]{3,60}$/.test(error.message) ? error.message : "PROBE_FAILURE";
    console.error("G3_REAL_PROVIDER_PROBE BLOCKED requests=" + requests + " code=" + code);
    process.exitCode = 1;
  }
}
void main();
