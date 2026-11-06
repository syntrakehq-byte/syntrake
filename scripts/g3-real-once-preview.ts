import { fetchDailySeries } from "../market-data-core/twelveData";
import { instrumentIdentity, MarketDataError } from "../market-data-core/identity";
import { isG3PreviewProviderReady } from "../market-data-core/gate";

// Temporary one-deployment, one-request internal test. No HTTP route, database
// writes, provider raw response output, retries, or credentials in logs.
async function run(): Promise<void> {
  const env = process.env;
  const authorized = env.SYNTRAKE_G3_REAL_PROBE === "run-one" &&
    isG3PreviewProviderReady(env);
  if (!authorized) {
    const key = env.SYNTRAKE_TWELVE_DATA_API_KEY;
    const safeChecks = {
      preview: env.VERCEL_ENV === "preview",
      branch: env.VERCEL_GIT_COMMIT_REF === "feat/g3e-integrated-rehearsal-20261106",
      sha: env.VERCEL_GIT_COMMIT_SHA === env.SYNTRAKE_G3_APPROVED_SHA,
      scope: env.SYNTRAKE_G3_LICENSE_SCOPE === "internal-non-display",
      format: typeof key === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(key),
      enabled: env.SYNTRAKE_G3_PROVIDER_ENABLED === "enabled",
      probe: env.SYNTRAKE_G3_REAL_PROBE === "run-one",
    };
    console.log("G3_PROVIDER_ONCE SKIPPED checks=" +
      Object.entries(safeChecks).map(([name, passed]) => name + ":" + (passed ? "ok" : "blocked")).join(","));
    return;
  }
  let calls = 0;
  let creditsUsed: string | null = null;
  let creditsLeft: string | null = null;
  const transport = async (url: string, init: RequestInit): Promise<Response> => {
    if (calls >= 1) throw new Error("LIMIT_ONE_REQUEST");
    const u = new URL(url);
    if (u.origin !== "https://api.twelvedata.com" || u.pathname !== "/time_series" ||
        u.searchParams.get("symbol") !== "AAPL" || u.searchParams.get("interval") !== "1day" ||
        u.searchParams.get("outputsize") !== "1" || u.searchParams.get("adjust") !== "none" ||
        u.searchParams.has("apikey") || init.method !== "GET") {
      throw new Error("UNAPPROVED_PROVIDER_REQUEST");
    }
    calls++;
    return fetch(url, init);
  };
  try {
    const result = await fetchDailySeries({
      env,
      instrument: instrumentIdentity({
        kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD",
      }),
      outputSize: 1,
      transport,
      rights: {
        policyId: "g3-internal-preview-single-call-not-redistributable",
        display: false,
        retentionUntil: null,
      },
      onResponseHeaders: h => { creditsUsed = h.used; creditsLeft = h.remaining; },
    });
    if (calls !== 1 || result.provider !== "TWELVE_DATA" ||
        result.candles.length !== 1 || result.envelope.rights.display ||
        result.envelope.value.length !== 1 || result.latency !== "NOT_VERIFIED") {
      throw new Error("INVARIANTS_REJECTED");
    }
    console.log("G3_PROVIDER_ONCE PASS calls=1 provider=TWELVE_DATA interval=1day rights_display=false price_logged=false credits_used=" +
      (creditsUsed ?? "UNKNOWN") + " credits_left=" + (creditsLeft ?? "UNKNOWN"));
  } catch (error: unknown) {
    const code = error instanceof MarketDataError ? error.code :
      error instanceof Error && /^[A-Z_]{3,60}$/.test(error.message) ? error.message : "PROBE_FAILURE";
    console.error("G3_PROVIDER_ONCE BLOCKED calls=" + calls + " code=" + code);
    process.exitCode = 1;
  }
}
void run();
