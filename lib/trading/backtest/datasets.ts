import type { TradingMarketType, TradingSessionProfile, TradingTimeframe } from "@/lib/trading/data";

import type { TradingBacktestDataset, TradingBacktestResult } from "./types";

export type TradingHistoricalDataSource = "twelvedata" | "local_archive";
export type TradingHistoricalSourcePreference = "local_first" | "local_only" | "api_only";

export type TradingHistoricalDataSymbol = {
  symbol: string;
  relation: "direct" | "proxy";
  label?: string | null;
};

export type TradingHistoricalInstrumentConfig = {
  instrument: string;
  dataSymbols: TradingHistoricalDataSymbol[];
  localDataset?: TradingHistoricalLocalDatasetConfig | null;
  marketType: TradingMarketType;
  sessionProfile: TradingSessionProfile;
  source: Extract<TradingHistoricalDataSource, "twelvedata">;
};

export type TradingHistoricalDatasetRequest = {
  instrument: string;
  from: string;
  to: string;
  timeframes?: TradingTimeframe[];
  sourcePreference?: TradingHistoricalSourcePreference;
  localDataRoot?: string | null;
};

export type TradingHistoricalLocalDatasetFormat =
  | "forex_ascii_yearly_m1"
  | "histdata_ascii_yearly_m1"
  | "crypto_binance_monthly_m1"
  | "indices_csv_yearly_m1";

export type TradingHistoricalLocalDatasetConfig = {
  format: TradingHistoricalLocalDatasetFormat;
  symbol: string;
  relation?: TradingHistoricalDataSymbol["relation"];
  label?: string | null;
  pathSegments: string[];
};

export type TradingHistoricalDatasetMetadata = {
  instrument: string;
  dataSymbol: string;
  dataSymbolRelation: TradingHistoricalDataSymbol["relation"];
  dataSymbolLabel?: string | null;
  marketType: TradingMarketType;
  sessionProfile: TradingSessionProfile;
  source: TradingHistoricalDataSource;
  from: string;
  to: string;
  loadedAt: string;
  timeframes: TradingTimeframe[];
  candleCounts: Partial<Record<TradingTimeframe, number>>;
};

export type TradingHistoricalDataset = {
  metadata: TradingHistoricalDatasetMetadata;
  dataset: TradingBacktestDataset;
};

export type TradingHistoricalBacktestResult = {
  historicalDataset: TradingHistoricalDataset;
  result: TradingBacktestResult;
};

export const TRADING_BACKTEST_BASE_INSTRUMENTS: TradingHistoricalInstrumentConfig[] = [
  {
    instrument: "EURUSD",
    dataSymbols: [{ symbol: "EUR/USD", relation: "direct" }],
    localDataset: {
      format: "forex_ascii_yearly_m1",
      symbol: "EURUSD",
      relation: "direct",
      pathSegments: ["forex", "eurusd"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "GBPUSD",
    dataSymbols: [{ symbol: "GBP/USD", relation: "direct" }],
    localDataset: {
      format: "forex_ascii_yearly_m1",
      symbol: "GBPUSD",
      relation: "direct",
      pathSegments: ["forex", "gbpusd"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "USDJPY",
    dataSymbols: [{ symbol: "USD/JPY", relation: "direct" }],
    localDataset: {
      format: "forex_ascii_yearly_m1",
      symbol: "USDJPY",
      relation: "direct",
      pathSegments: ["forex", "usdjpy"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "XAUUSD",
    dataSymbols: [{ symbol: "XAU/USD", relation: "direct" }],
    localDataset: {
      format: "forex_ascii_yearly_m1",
      symbol: "XAUUSD",
      relation: "direct",
      pathSegments: ["forex", "xauusd"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "NAS100",
    dataSymbols: [
      { symbol: "NDX", relation: "direct", label: "Nasdaq 100 index" },
      { symbol: "QQQ", relation: "proxy", label: "Nasdaq 100 proxy ETF" },
    ],
    localDataset: {
      format: "indices_csv_yearly_m1",
      symbol: "nasdaq",
      relation: "direct",
      label: "Nasdaq local archive",
      pathSegments: ["indices", "nasdaq"],
    },
    marketType: "equities",
    sessionProfile: "ny_equities",
    source: "twelvedata",
  },
  {
    instrument: "US500",
    dataSymbols: [
      { symbol: "SPX", relation: "direct", label: "S&P 500 index" },
      { symbol: "GSPC", relation: "proxy", label: "S&P 500 index proxy" },
      { symbol: "SPY", relation: "proxy", label: "S&P 500 proxy ETF" },
    ],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "SPXUSD",
      relation: "proxy",
      label: "SPXUSD Histdata local archive",
      pathSegments: ["indices", "us500"],
    },
    marketType: "equities",
    sessionProfile: "ny_equities",
    source: "twelvedata",
  },
  {
    instrument: "BTCUSD",
    dataSymbols: [{ symbol: "BTC/USD", relation: "direct" }],
    localDataset: {
      format: "crypto_binance_monthly_m1",
      symbol: "BTCUSDT",
      relation: "direct",
      label: "BTCUSDT local archive",
      pathSegments: ["cripto", "btcusdt"],
    },
    marketType: "crypto",
    sessionProfile: "crypto",
    source: "twelvedata",
  },
  {
    instrument: "ETHUSD",
    dataSymbols: [{ symbol: "ETH/USD", relation: "direct" }],
    localDataset: {
      format: "crypto_binance_monthly_m1",
      symbol: "ETHUSDT",
      relation: "direct",
      label: "ETHUSDT local archive",
      pathSegments: ["cripto", "ethusdt"],
    },
    marketType: "crypto",
    sessionProfile: "crypto",
    source: "twelvedata",
  },
];

export const TRADING_BACKTEST_RESEARCH_EXPANSION_INSTRUMENTS: TradingHistoricalInstrumentConfig[] = [
  {
    instrument: "AUDUSD",
    dataSymbols: [{ symbol: "AUD/USD", relation: "direct" }],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "AUDUSD",
      relation: "direct",
      pathSegments: ["forex", "audusd"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "USDCHF",
    dataSymbols: [{ symbol: "USD/CHF", relation: "direct" }],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "USDCHF",
      relation: "direct",
      pathSegments: ["forex", "usdchf"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "NZDUSD",
    dataSymbols: [{ symbol: "NZD/USD", relation: "direct" }],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "NZDUSD",
      relation: "direct",
      pathSegments: ["forex", "nzdusd"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "AUDJPY",
    dataSymbols: [{ symbol: "AUD/JPY", relation: "direct" }],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "AUDJPY",
      relation: "direct",
      pathSegments: ["forex", "audjpy"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "XAGUSD",
    dataSymbols: [{ symbol: "XAG/USD", relation: "direct" }],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "XAGUSD",
      relation: "direct",
      pathSegments: ["metals", "xagusd"],
    },
    marketType: "forex",
    sessionProfile: "forex",
    source: "twelvedata",
  },
  {
    instrument: "GER40",
    dataSymbols: [
      { symbol: "GDAXI", relation: "direct", label: "DAX performance index" },
      { symbol: "GRXEUR", relation: "proxy", label: "Germany 40 HistData-compatible symbol" },
    ],
    localDataset: {
      format: "histdata_ascii_yearly_m1",
      symbol: "GRXEUR",
      relation: "proxy",
      pathSegments: ["indices", "ger40"],
    },
    marketType: "equities",
    sessionProfile: "ny_equities",
    source: "twelvedata",
  },
  {
    instrument: "SOLUSD",
    dataSymbols: [{ symbol: "SOL/USD", relation: "direct" }],
    localDataset: {
      format: "crypto_binance_monthly_m1",
      symbol: "SOLUSDT",
      relation: "direct",
      label: "SOLUSDT staging archive",
      pathSegments: ["crypto", "solusd"],
    },
    marketType: "crypto",
    sessionProfile: "crypto",
    source: "twelvedata",
  },
  {
    instrument: "BNBUSD",
    dataSymbols: [{ symbol: "BNB/USD", relation: "direct" }],
    localDataset: {
      format: "crypto_binance_monthly_m1",
      symbol: "BNBUSDT",
      relation: "direct",
      label: "BNBUSDT staging archive",
      pathSegments: ["crypto", "bnbusd"],
    },
    marketType: "crypto",
    sessionProfile: "crypto",
    source: "twelvedata",
  },
  {
    instrument: "XRPUSD",
    dataSymbols: [{ symbol: "XRP/USD", relation: "direct" }],
    localDataset: {
      format: "crypto_binance_monthly_m1",
      symbol: "XRPUSDT",
      relation: "direct",
      label: "XRPUSDT staging archive",
      pathSegments: ["crypto", "xrpusd"],
    },
    marketType: "crypto",
    sessionProfile: "crypto",
    source: "twelvedata",
  },
];

export const TRADING_BACKTEST_DEFAULT_TIMEFRAMES: TradingTimeframe[] = [
  "4h",
  "1h",
  "15m",
  "5m",
];

export function resolveTradingHistoricalInstrument(
  instrument: string,
): TradingHistoricalInstrumentConfig {
  const normalized = instrument.trim().toUpperCase();
  const config = [
    ...TRADING_BACKTEST_BASE_INSTRUMENTS,
    ...TRADING_BACKTEST_RESEARCH_EXPANSION_INSTRUMENTS,
  ].find(
    (candidate) => candidate.instrument === normalized,
  );

  if (!config) {
    throw new Error(`Unsupported trading backtest instrument: ${instrument}`);
  }

  return config;
}

export function defaultTradingHistoricalPeriodLabel(args: {
  from: string;
  to: string;
}): string {
  return `${args.from.slice(0, 10)}_${args.to.slice(0, 10)}`.replace(/:/g, "-");
}
