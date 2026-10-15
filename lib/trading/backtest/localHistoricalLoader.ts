import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { TradingCandleInput, TradingTimeframe } from "@/lib/trading/data";

import {
  resolveTradingHistoricalInstrument,
  type TradingHistoricalDataset,
  type TradingHistoricalDatasetRequest,
  type TradingHistoricalLocalDatasetConfig,
} from "./datasets";

const LOCAL_BASE_TIMEFRAME = "1m" as const;
const TIMEFRAME_MS: Record<TradingTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function resolveLocalHistoricalBaseDir(): string {
  const configuredDir = process.env.TRADING_BACKTEST_LOCAL_DATA_DIR?.trim();
  if (configuredDir) {
    return path.resolve(/* turbopackIgnore: true */ configuredDir);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), "Data", "historical");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildYearRange(from: string, to: string): number[] {
  const startYear = new Date(from).getUTCFullYear();
  const endYear = new Date(to).getUTCFullYear();
  const years: number[] = [];

  for (let year = startYear; year <= endYear; year += 1) {
    years.push(year);
  }

  return years;
}

function buildMonthRange(from: string, to: string): Array<{ year: number; month: number }> {
  const cursor = new Date(from);
  const end = new Date(to);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  const output: Array<{ year: number; month: number }> = [];

  while (cursor <= end) {
    output.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return output;
}

export async function resolveLocalHistoricalFiles(args: {
  config: TradingHistoricalLocalDatasetConfig;
  from: string;
  to: string;
  baseDir?: string | null;
}): Promise<string[]> {
  const baseDir = args.baseDir ? path.resolve(args.baseDir) : resolveLocalHistoricalBaseDir();
  const root = path.join(/* turbopackIgnore: true */ baseDir, ...args.config.pathSegments);
  const files: string[] = [];

  if (args.config.format === "forex_ascii_yearly_m1") {
    for (const year of buildYearRange(args.from, args.to)) {
      const candidateFiles = [
        path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${args.config.symbol}_M1_${year}.csv.csv`),
        path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${args.config.symbol}_M1_${year}.csv`),
      ];

      for (const filePath of candidateFiles) {
        if (await fileExists(filePath)) {
          files.push(filePath);
          break;
        }
      }
    }
  } else if (args.config.format === "histdata_ascii_yearly_m1") {
    for (const year of buildYearRange(args.from, args.to)) {
      const filePath = path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${args.config.symbol}_M1_${year}.csv`);

      if (await fileExists(filePath)) {
        files.push(filePath);
      }
    }
  } else if (args.config.format === "indices_csv_yearly_m1") {
    for (const year of buildYearRange(args.from, args.to)) {
      const filePath = path.join(/* turbopackIgnore: true */ root, `${args.config.symbol}_${year}.csv`);

      if (await fileExists(filePath)) {
        files.push(filePath);
      }
    }
  } else {
    for (const part of buildMonthRange(args.from, args.to)) {
      const filePath = path.join(
        /* turbopackIgnore: true */ root,
        `${args.config.symbol}-1m-${part.year}-${String(part.month).padStart(2, "0")}.csv`,
      );

      if (await fileExists(filePath)) {
        files.push(filePath);
      }
    }
  }

  return files;
}

export async function inspectLocalHistoricalFiles(args: {
  files: string[];
}): Promise<Array<{ path: string; sizeBytes: number; modifiedAt: string }>> {
  return Promise.all(
    args.files.map(async (filePath) => {
      const details = await stat(filePath);
      return {
        path: filePath,
        sizeBytes: details.size,
        modifiedAt: details.mtime.toISOString(),
      };
    }),
  );
}

function parseForexTimestamp(value: string): string | null {
  const [datePart, timePart] = value.trim().split(" ");

  if (!datePart || !timePart || datePart.length !== 8 || timePart.length !== 6) {
    return null;
  }

  const iso = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}.000Z`;
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLooseIsoTimestamp(value: string): string | null {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseForexAsciiLine(line: string): TradingCandleInput | null {
  const [dateTime, open, high, low, close, volume] = line.split(";");
  const timestamp = parseForexTimestamp(dateTime ?? "");
  const parsedOpen = parseNumber(open);
  const parsedHigh = parseNumber(high);
  const parsedLow = parseNumber(low);
  const parsedClose = parseNumber(close);

  if (!timestamp || parsedOpen === null || parsedHigh === null || parsedLow === null || parsedClose === null) {
    return null;
  }

  return {
    timestamp,
    open: parsedOpen,
    high: parsedHigh,
    low: parsedLow,
    close: parsedClose,
    volume: parseNumber(volume),
  };
}

function parseCryptoBinanceLine(line: string): TradingCandleInput | null {
  const columns = line.split(",");
  const openTime = parseNumber(columns[0]);
  const open = parseNumber(columns[1]);
  const high = parseNumber(columns[2]);
  const low = parseNumber(columns[3]);
  const close = parseNumber(columns[4]);
  const volume = parseNumber(columns[5]);

  if (
    openTime === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  let normalizedOpenTime = Math.trunc(openTime);

  // Some Binance exports switched from milliseconds to microseconds in newer files.
  while (normalizedOpenTime > 9_999_999_999_999) {
    normalizedOpenTime = Math.trunc(normalizedOpenTime / 1000);
  }

  const timestamp = new Date(normalizedOpenTime).toISOString();

  if (Number.isNaN(new Date(timestamp).getTime())) {
    return null;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  };
}

function parseIndicesCsvLine(line: string): TradingCandleInput | null {
  if (line.startsWith("DateTime,")) {
    return null;
  }

  const [dateTime, open, high, low, close, volume, tickVolume] = line.split(",");
  const timestamp = parseLooseIsoTimestamp(dateTime ?? "");
  const parsedOpen = parseNumber(open);
  const parsedHigh = parseNumber(high);
  const parsedLow = parseNumber(low);
  const parsedClose = parseNumber(close);
  const parsedVolume = parseNumber(volume);
  const parsedTickVolume = parseNumber(tickVolume);

  if (!timestamp || parsedOpen === null || parsedHigh === null || parsedLow === null || parsedClose === null) {
    return null;
  }

  return {
    timestamp,
    open: parsedOpen,
    high: parsedHigh,
    low: parsedLow,
    close: parsedClose,
    volume:
      parsedVolume !== null && parsedVolume > 0
        ? parsedVolume
        : parsedTickVolume,
  };
}

function parseLocalHistoricalLine(args: {
  line: string;
  config: TradingHistoricalLocalDatasetConfig;
}): TradingCandleInput | null {
  if (!args.line.trim()) {
    return null;
  }

  if (
    args.config.format === "forex_ascii_yearly_m1" ||
    args.config.format === "histdata_ascii_yearly_m1"
  ) {
    return parseForexAsciiLine(args.line);
  }

  if (args.config.format === "indices_csv_yearly_m1") {
    return parseIndicesCsvLine(args.line);
  }

  return parseCryptoBinanceLine(args.line);
}

async function readLocalBaseCandles(args: {
  files: string[];
  config: TradingHistoricalLocalDatasetConfig;
  from: string;
  to: string;
}): Promise<TradingCandleInput[]> {
  const start = new Date(args.from).getTime();
  const end = new Date(args.to).getTime();
  const deduped = new Map<string, TradingCandleInput>();

  for (const filePath of args.files) {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const lineReader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      const candle = parseLocalHistoricalLine({
        line,
        config: args.config,
      });

      if (!candle) {
        continue;
      }

      const timestamp = new Date(candle.timestamp).getTime();

      if (timestamp < start || timestamp > end) {
        continue;
      }

      deduped.set(new Date(candle.timestamp).toISOString(), {
        ...candle,
        timestamp: new Date(candle.timestamp).toISOString(),
      });
    }
  }

  return Array.from(deduped.values()).sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

function resolveBucketStart(timestampMs: number, timeframe: TradingTimeframe): number {
  if (timeframe === "1d") {
    const date = new Date(timestampMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  const durationMs = TIMEFRAME_MS[timeframe];
  return Math.floor(timestampMs / durationMs) * durationMs;
}

function aggregateCandlesToTimeframe(
  candles: TradingCandleInput[],
  timeframe: TradingTimeframe,
): TradingCandleInput[] {
  if (timeframe === LOCAL_BASE_TIMEFRAME) {
    return [...candles];
  }

  const output: TradingCandleInput[] = [];
  let currentBucket: {
    bucketStart: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  } | null = null;

  for (const candle of candles) {
    const timestampMs = new Date(candle.timestamp).getTime();
    const bucketStart = resolveBucketStart(timestampMs, timeframe);
    const volume = candle.volume ?? null;

    if (!currentBucket || currentBucket.bucketStart !== bucketStart) {
      if (currentBucket) {
        output.push({
          timestamp: new Date(currentBucket.bucketStart).toISOString(),
          open: currentBucket.open,
          high: currentBucket.high,
          low: currentBucket.low,
          close: currentBucket.close,
          volume: currentBucket.volume,
        });
      }

      currentBucket = {
        bucketStart,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume,
      };
      continue;
    }

    currentBucket.high = Math.max(currentBucket.high, candle.high);
    currentBucket.low = Math.min(currentBucket.low, candle.low);
    currentBucket.close = candle.close;
    currentBucket.volume =
      currentBucket.volume === null && volume === null
        ? null
        : (currentBucket.volume ?? 0) + (volume ?? 0);
  }

  if (currentBucket) {
    output.push({
      timestamp: new Date(currentBucket.bucketStart).toISOString(),
      open: currentBucket.open,
      high: currentBucket.high,
      low: currentBucket.low,
      close: currentBucket.close,
      volume: currentBucket.volume,
    });
  }

  return output;
}

export async function loadLocalHistoricalTradingDataset(
  request: TradingHistoricalDatasetRequest,
): Promise<TradingHistoricalDataset> {
  const instrument = resolveTradingHistoricalInstrument(request.instrument);
  const localDataset = instrument.localDataset;
  const from = new Date(request.from).toISOString();
  const to = new Date(request.to).toISOString();

  if (!localDataset) {
    throw new Error(`No local historical dataset configured for ${instrument.instrument}.`);
  }

  const requestedTimeframes: TradingTimeframe[] =
    request.timeframes?.length
      ? request.timeframes
      : ["4h", "1h", "15m", "5m"];
  const files = await resolveLocalHistoricalFiles({
    config: localDataset,
    from,
    to,
    baseDir: request.localDataRoot ?? null,
  });

  if (files.length === 0) {
    throw new Error(`No local historical files found for ${instrument.instrument} in the requested range.`);
  }

  const baseCandles = await readLocalBaseCandles({
    files,
    config: localDataset,
    from,
    to,
  });

  if (baseCandles.length === 0) {
    throw new Error(`Local historical dataset is empty for ${instrument.instrument} in the requested range.`);
  }

  const datasetTimeframes: Partial<Record<TradingTimeframe, TradingCandleInput[]>> = {};
  const candleCounts: Partial<Record<TradingTimeframe, number>> = {};

  for (const timeframe of requestedTimeframes) {
    const candles = aggregateCandlesToTimeframe(baseCandles, timeframe);

    if (candles.length === 0) {
      continue;
    }

    datasetTimeframes[timeframe] = candles;
    candleCounts[timeframe] = candles.length;
  }

  return {
    metadata: {
      instrument: instrument.instrument,
      dataSymbol: localDataset.symbol,
      dataSymbolRelation: localDataset.relation ?? "direct",
      dataSymbolLabel: localDataset.label ?? null,
      marketType: instrument.marketType,
      sessionProfile: instrument.sessionProfile,
      source: "local_archive",
      from,
      to,
      loadedAt: new Date().toISOString(),
      timeframes: requestedTimeframes,
      candleCounts,
    },
    dataset: {
      instrument: instrument.instrument,
      marketType: instrument.marketType,
      sessionProfile: instrument.sessionProfile,
      timeframes: datasetTimeframes,
    },
  };
}
