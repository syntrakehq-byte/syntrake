import { canonicalIdentity, resolveProviderAlias } from "../market-data-core/identity";
import { runTwelveDataRealOnce } from "../market-data-core/realTwelveDataOnce";
import { execFileSync } from "node:child_process";

if (process.env.PRODUCTION === "true" || process.env.VERCEL_ENV === "production") {
  throw new Error("R3E1_REAL_CALL_FORBIDDEN_IN_PRODUCTION");
}
const instrument = canonicalIdentity({
  instrument: { instrumentId: "90000000-0000-0000-0000-000000000001", issuerId: "90000000-0000-0000-0000-000000000002", kind: "EQUITY", denominationCurrency: "USD" },
  listing: { listingId: "90000000-0000-0000-0000-000000000003", instrumentId: "90000000-0000-0000-0000-000000000001", mic: "XNAS", tradingCurrency: "USD", ticker: "AAPL", validFrom: "1980-12-12", validTo: null },
});
const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(checkoutSha)) throw new Error("R3E1_CHECKOUT_SHA_INVALID");
const alias = resolveProviderAlias("TWELVE_DATA", "AAPL", "2026-01-01", [{
  provider: "TWELVE_DATA", providerReference: "AAPL", instrumentId: "90000000-0000-0000-0000-000000000001", listingId: "90000000-0000-0000-0000-000000000003", validFrom: "1980-12-12", validTo: null,
}]);
if (alias.status !== "EXACT") throw new Error("R3E1_ALIAS_NOT_EXACT");
const result = await runTwelveDataRealOnce({ env: process.env, checkoutSha, instrument, sourceAlias: alias, asOf: "2026-01-01" });
console.log(JSON.stringify({ provider: result.series.provider, symbol: "AAPL", mic: "XNAS", currency: "USD", interval: "1day", marketDate: result.series.candles.at(-1)?.marketDate, usage: result.usage }));
