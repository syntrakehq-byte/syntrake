import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TradingCandleInput } from "@/lib/trading/data";

import { resolveTradingHistoricalInstrument } from "./datasets";
import {
  TwelveDataAccessRestrictedError,
  fetchTwelveDataHistoricalRange,
} from "./twelveDataHistorical";

export type TradingTwelveDataSyncStatus =
  | "downloaded"
  | "existing"
  | "missing_remote"
  | "restricted_remote_access";

export type TradingTwelveDataSyncEntry = {
  instrument: string;
  status: TradingTwelveDataSyncStatus;
  targetPath: string;
  providerSymbol: string | null;
  periodLabel: string;
  candleCount: number;
  restrictionReason?: string | null;
};

function resolveLocalHistoricalBaseDir(): string {
  const configuredDir = process.env.TRADING_BACKTEST_LOCAL_DATA_DIR?.trim();
  if (configuredDir) {
    return path.resolve(configuredDir);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), "Data", "historical");
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildYearlyLocalPath(instrument: string, year: number): string {
  const config = resolveTradingHistoricalInstrument(instrument);
  const localDataset = config.localDataset;

  if (!localDataset) {
    throw new Error(`No local dataset configured for ${instrument}.`);
  }

  const root = path.join(/* turbopackIgnore: true */ resolveLocalHistoricalBaseDir(), ...localDataset.pathSegments);

  if (localDataset.format === "forex_ascii_yearly_m1" || localDataset.format === "histdata_ascii_yearly_m1") {
    return path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${localDataset.symbol}_M1_${year}.csv`);
  }

  if (localDataset.format === "indices_csv_yearly_m1") {
    return path.join(/* turbopackIgnore: true */ root, `${localDataset.symbol}_${year}.csv`);
  }

  throw new Error(`Unsupported Twelve Data yearly sync format '${localDataset.format}' for ${instrument}.`);
}

function formatForexTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day} ${hours}${minutes}${seconds}`;
}

function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }

  return String(value);
}

function renderYearlyArchive(args: {
  instrument: string;
  candles: TradingCandleInput[];
}): string {
  const config = resolveTradingHistoricalInstrument(args.instrument);
  const localDataset = config.localDataset;

  if (!localDataset) {
    throw new Error(`No local dataset configured for ${args.instrument}.`);
  }

  if (localDataset.format === "forex_ascii_yearly_m1" || localDataset.format === "histdata_ascii_yearly_m1") {
    return `${args.candles
      .map((candle) =>
        [
          formatForexTimestamp(new Date(candle.timestamp).toISOString()),
          formatDecimal(candle.open),
          formatDecimal(candle.high),
          formatDecimal(candle.low),
          formatDecimal(candle.close),
          formatDecimal(candle.volume),
        ].join(";"),
      )
      .join("\n")}\n`;
  }

  if (localDataset.format === "indices_csv_yearly_m1") {
    const header = "DateTime,Open,High,Low,Close,Volume,TickVolume";
    const rows = args.candles.map((candle) => {
      const dateTime = new Date(candle.timestamp).toISOString().replace(".000Z", "");
      const volume = formatDecimal(candle.volume);
      return [
        dateTime,
        formatDecimal(candle.open),
        formatDecimal(candle.high),
        formatDecimal(candle.low),
        formatDecimal(candle.close),
        volume,
        volume,
      ].join(",");
    });

    return `${[header, ...rows].join("\n")}\n`;
  }

  throw new Error(`Unsupported Twelve Data yearly sync format '${localDataset.format}' for ${args.instrument}.`);
}

async function loadFirstAvailableProviderYear(args: {
  instrument: string;
  from: string;
  to: string;
}): Promise<
  | { kind: "loaded"; providerSymbol: string; candles: TradingCandleInput[] }
  | { kind: "restricted"; providerSymbol: string | null; reason: string }
  | null
> {
  const config = resolveTradingHistoricalInstrument(args.instrument);
  const restrictions: string[] = [];

  for (const dataSymbol of config.dataSymbols) {
    try {
      const candles = await fetchTwelveDataHistoricalRange({
        symbol: dataSymbol.symbol,
        timeframe: "1m",
        from: args.from,
        to: args.to,
      });

      if (candles.length > 0) {
        return {
          kind: "loaded",
          providerSymbol: dataSymbol.symbol,
          candles,
        };
      }
    } catch (error) {
      if (error instanceof TwelveDataAccessRestrictedError) {
        restrictions.push(`${dataSymbol.symbol}: ${error.message}`);
        continue;
      }

      throw error;
    }
  }

  if (restrictions.length > 0) {
    return {
      kind: "restricted",
      providerSymbol: config.dataSymbols[0]?.symbol ?? null,
      reason: restrictions.join(" | "),
    };
  }

  return null;
}

export async function syncTwelveDataYearlyFile(args: {
  instrument: string;
  year: number;
  force?: boolean;
}): Promise<TradingTwelveDataSyncEntry> {
  const targetPath = buildYearlyLocalPath(args.instrument, args.year);
  const periodLabel = String(args.year);

  if (!args.force && await fileExists(targetPath)) {
    return {
      instrument: args.instrument,
      status: "existing",
      targetPath,
      providerSymbol: null,
      periodLabel,
      candleCount: 0,
    };
  }

  const from = `${args.year}-01-01T00:00:00.000Z`;
  const to = `${args.year}-12-31T23:59:59.000Z`;
  const loaded = await loadFirstAvailableProviderYear({
    instrument: args.instrument,
    from,
    to,
  });

  if (!loaded) {
    return {
      instrument: args.instrument,
      status: "missing_remote",
      targetPath,
      providerSymbol: null,
      periodLabel,
      candleCount: 0,
      restrictionReason: null,
    };
  }

  if (loaded.kind === "restricted") {
    return {
      instrument: args.instrument,
      status: "restricted_remote_access",
      targetPath,
      providerSymbol: loaded.providerSymbol,
      periodLabel,
      candleCount: 0,
      restrictionReason: loaded.reason,
    };
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    renderYearlyArchive({
      instrument: args.instrument,
      candles: loaded.candles,
    }),
    "utf8",
  );

  return {
    instrument: args.instrument,
    status: "downloaded",
    targetPath,
    providerSymbol: loaded.providerSymbol,
    periodLabel,
    candleCount: loaded.candles.length,
    restrictionReason: null,
  };
}
