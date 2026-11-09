import {
  readMarketDataForCoreConsumer,
  type MarketConsumerInstrument,
  type MarketConsumerQuotesResponse,
  type MarketConsumerReader,
} from "../market-data-core/consumerMarketService";
import type { DynamicMarketQuote } from "../market-data-core/dynamicMarketGateway";

/**
 * Investing consumes the shared Market Core, not a Twelve Data adapter.
 * Portfolio ownership and instrument resolution must be established by the
 * calling Investing server service before invoking this bridge.
 */
export async function readInvestingPortfolioMarketPrices(
  verifiedPositions: readonly MarketConsumerInstrument[],
  marketCore: MarketConsumerReader,
): Promise<MarketConsumerQuotesResponse> {
  return readMarketDataForCoreConsumer(
    { consumer: "INVESTING", instruments: verifiedPositions, interval: "1day" },
    marketCore,
  );
}

/** Used for the authenticated interactive portfolio workflow. */
export async function readInvestingSelectionPrice(
  token: string,
  marketCore: Readonly<{ quoteToken(token: string): Promise<DynamicMarketQuote> }>,
): Promise<DynamicMarketQuote> {
  return marketCore.quoteToken(token);
}
