import { instrumentIdentity } from "./identity";
import type { DynamicMarketQuote } from "./dynamicMarketGateway";

/**
 * Provider-neutral request contract shared by Investing and future Trading.
 * The caller MUST obtain these identities from verified, owned server data;
 * this service must never be exposed with arbitrary browser-supplied holdings.
 */
export type MarketConsumer = "INVESTING" | "TRADING";
export type MarketConsumerInstrument = Readonly<{
  kind: "EQUITY" | "ETF" | "FX";
  symbol: string;
  mic: string | null;
  currency: string;
  name: string;
}>;
export type MarketConsumerQuotesRequest = Readonly<{
  consumer: MarketConsumer;
  instruments: readonly MarketConsumerInstrument[];
  interval: "1day" | "1hour" | "1min";
}>;
export type MarketConsumerQuoteRow = Readonly<{
  instrument: MarketConsumerInstrument;
  status: "AVAILABLE" | "UNAVAILABLE";
  data: DynamicMarketQuote | null;
}>;
export type MarketConsumerQuotesResponse = Readonly<{
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  interval: "1day";
  consumer: MarketConsumer;
  results: readonly MarketConsumerQuoteRow[];
}>;

export type MarketConsumerReader = Readonly<{
  readInstrument(instrument: MarketConsumerInstrument): Promise<DynamicMarketQuote>;
}>;

const MAX_INSTRUMENTS = 20;

/**
 * Run a bounded, best-effort batch through the SAME Market Core gateway used by
 * the rest of the site. The gateway owns provider calls, freshness and cache.
 * A Trading 1min/1hour request is never silently satisfied with a daily close.
 * No background job, browser session, database write or ledger mutation.
 */
export async function readMarketDataForCoreConsumer(
  request: MarketConsumerQuotesRequest,
  core: MarketConsumerReader,
): Promise<MarketConsumerQuotesResponse> {
  if (!request || (request.consumer !== "INVESTING" && request.consumer !== "TRADING") ||
      !Array.isArray(request.instruments) ||
      request.instruments.length === 0 ||
      request.instruments.length > MAX_INSTRUMENTS ||
      request.interval !== "1day") {
    throw new Error("MARKET_CONSUMER_REQUEST_UNSUPPORTED");
  }
  const keys: string[] = [];
  for (const instrument of request.instruments) {
    if (!instrument || typeof instrument.name !== "string" ||
        instrument.name.trim().length === 0 || instrument.name.length > 160 ||
        /[\x00-\x1f]/.test(instrument.name)) throw new Error("MARKET_CONSUMER_INSTRUMENT_INVALID");
    try {
      const identity = instrumentIdentity({
        kind: instrument.kind, symbol: instrument.symbol,
        mic: instrument.mic, currency: instrument.currency,
      });
      keys.push(identity.key);
    } catch {
      throw new Error("MARKET_CONSUMER_INSTRUMENT_INVALID");
    }
  }

  // A duplicate holding from another consumer is fetched at most once within
  // the request; the underlying gateway additionally coalesces concurrent reads.
  const unique = new Map<string, MarketConsumerInstrument>();
  request.instruments.forEach((instrument, index) => {
    if (!unique.has(keys[index])) unique.set(keys[index], instrument);
  });
  const resolved = new Map<string, DynamicMarketQuote | null>();
  // Sequential reads bound the free-provider credit burst. Failure of one
  // instrument does not turn a valid quote for another into a fabricated value.
  for (const [key, instrument] of unique) {
    try {
      const quote = await core.readInstrument(instrument);
      if (quote.status !== "AVAILABLE" || quote.interval !== "1day" ||
          quote.kind !== instrument.kind || quote.symbol !== instrument.symbol ||
          quote.mic !== instrument.mic || quote.currency !== instrument.currency) {
        resolved.set(key, null);
      } else {
        resolved.set(key, quote);
      }
    } catch {
      resolved.set(key, null);
    }
  }
  const results: MarketConsumerQuoteRow[] = request.instruments.map((instrument, index) => {
    const data = resolved.get(keys[index]) ?? null;
    return { instrument, status: data ? "AVAILABLE" : "UNAVAILABLE", data };
  });
  const available = results.filter(row => row.status === "AVAILABLE").length;
  return Object.freeze({
    status: available === 0 ? "UNAVAILABLE" : available === results.length ? "AVAILABLE" : "PARTIAL",
    interval: "1day", consumer: request.consumer,
    results: Object.freeze(results),
  });
}
