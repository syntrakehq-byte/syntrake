import { describe, expect, it } from "vitest";

import {
  resolveTradingHistoricalInstrument,
  TRADING_BACKTEST_BASE_INSTRUMENTS,
} from "@/lib/trading/backtest";

describe("trading research expansion instruments", () => {
  it("resolves staged crypto candidates without adding them to default sweeps", () => {
    const sol = resolveTradingHistoricalInstrument("SOLUSD");
    const bnb = resolveTradingHistoricalInstrument("BNBUSD");
    const xrp = resolveTradingHistoricalInstrument("XRPUSD");

    expect(sol.localDataset?.symbol).toBe("SOLUSDT");
    expect(bnb.localDataset?.symbol).toBe("BNBUSDT");
    expect(xrp.localDataset?.symbol).toBe("XRPUSDT");
    expect(TRADING_BACKTEST_BASE_INSTRUMENTS.map((item) => item.instrument)).not.toContain("SOLUSD");
    expect(TRADING_BACKTEST_BASE_INSTRUMENTS.map((item) => item.instrument)).not.toContain("BNBUSD");
    expect(TRADING_BACKTEST_BASE_INSTRUMENTS.map((item) => item.instrument)).not.toContain("XRPUSD");
  });

  it("resolves the Syntrake staged forex, metals, and index candidates", () => {
    expect(resolveTradingHistoricalInstrument("AUDUSD").dataSymbols[0]?.symbol).toBe("AUD/USD");
    expect(resolveTradingHistoricalInstrument("USDCHF").dataSymbols[0]?.symbol).toBe("USD/CHF");
    expect(resolveTradingHistoricalInstrument("NZDUSD").dataSymbols[0]?.symbol).toBe("NZD/USD");
    expect(resolveTradingHistoricalInstrument("AUDJPY").dataSymbols[0]?.symbol).toBe("AUD/JPY");
    expect(resolveTradingHistoricalInstrument("XAGUSD").dataSymbols[0]?.symbol).toBe("XAG/USD");
    expect(resolveTradingHistoricalInstrument("GER40").dataSymbols.map((item) => item.symbol)).toEqual([
      "GDAXI",
      "GRXEUR",
    ]);
  });
});
