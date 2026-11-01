import { execFileSync } from "node:child_process";
import { createTwelveDataCatalogConnector } from "../market-data-core/twelveDataCatalog";
import { fetchDailySeriesR3E1Once } from "../market-data-core/twelveData";
import { instrumentIdentity } from "../market-data-core/identity";
import { quantityToAtoms } from "../investing-core/portfolio/portfolioImportDraft";

const MAX_CALLS = 2;
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const env = process.env;
if (env.PRODUCTION === "true" || env.VERCEL_ENV !== "preview") throw new Error("R3_REHEARSAL_REQUIRES_PREVIEW");
if (env.SYNTRAKE_R3E1_REHEARSAL_LICENSE_CONFIRMED !== "confirm-query-no-display") throw new Error("R3_REHEARSAL_LICENSE_NOT_CONFIRMED");
if (env.SYNTRAKE_R3E1_REAL_CALL_ENABLED !== "confirm-once" || env.SYNTRAKE_R3E1_APPROVED_SHA !== sha || env.SYNTRAKE_R3E1_APPROVED_ENV !== "preview") throw new Error("R3_REHEARSAL_OPERATOR_GATE_CLOSED");
if (!env.SYNTRAKE_TWELVE_DATA_API_KEY || !/^[A-Za-z0-9_-]{16,128}$/.test(env.SYNTRAKE_TWELVE_DATA_API_KEY)) throw new Error("R3_REHEARSAL_CREDENTIAL_MISSING");

let calls = 0;
const transport = async (url: string, init: RequestInit): Promise<Response> => {
  calls += 1;
  if (calls > MAX_CALLS) throw new Error("R3_REHEARSAL_CALL_LIMIT");
  return fetch(url, init);
};
async function main(): Promise<void> {
const source = { providerKey: "TWELVE_DATA", snapshotId: `rehearsal-${sha.slice(0, 12)}`, snapshotVersion: "1", observedAt: new Date().toISOString(), licensePolicyId: "operator-confirmed-query-no-display", storageAllowed: true, sharingAllowed: false } as const;
const connector = createTwelveDataCatalogConnector({ env, source, transport });
const discovery = await connector.search({ ticker: "AAPL" });
if (discovery.candidates.length !== 1) throw new Error("R3_REHEARSAL_SELECTION_REQUIRED");
const candidate = discovery.candidates[0];
if (!candidate.listing?.mic || candidate.listing.ticker !== "AAPL" || candidate.listing.tradingCurrency !== "USD") throw new Error("R3_REHEARSAL_DISCOVERY_IDENTITY_INVALID");
const instrument = instrumentIdentity({ kind: candidate.descriptiveAssetClass ?? "EQUITY", symbol: candidate.listing.ticker, mic: candidate.listing.mic, currency: candidate.listing.tradingCurrency });
const series = await fetchDailySeriesR3E1Once({ env, instrument, outputSize: 1, transport, checkoutSha: sha, rights: { policyId: "operator-confirmed-query-no-display", display: false, retentionUntil: null } });
if (series.envelope.rights.display) throw new Error("R3_REHEARSAL_DISPLAY_MUST_REMAIN_DISABLED");
const close = series.candles.at(-1)?.close;
if (!close) throw new Error("R3_REHEARSAL_CLOSE_MISSING");
const quantity = quantityToAtoms("0.96");
const [whole, fraction = ""] = close.split(".");
const priceAtoms = BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
const valueAtoms = priceAtoms * quantity / 1_000_000_000_000n;
console.log(JSON.stringify({ calls, provider: series.provider, symbol: candidate.listing.ticker, mic: candidate.listing.mic, currency: candidate.listing.tradingCurrency, marketDate: series.candles.at(-1)?.marketDate, close, quantity: "0.96", value: `${valueAtoms / 1_000_000_000_000n}.${(valueAtoms % 1_000_000_000_000n).toString().padStart(12, "0").replace(/0+$/, "")}`, display: series.envelope.rights.display }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "R3_REHEARSAL_FAILED"); process.exitCode = 1; });
