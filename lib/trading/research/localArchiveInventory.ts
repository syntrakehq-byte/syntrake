import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import readline from "node:readline";

import {
  TRADING_BACKTEST_BASE_INSTRUMENTS,
  TRADING_BACKTEST_RESEARCH_EXPANSION_INSTRUMENTS,
  type TradingHistoricalInstrumentConfig,
  type TradingHistoricalLocalDatasetConfig,
} from "@/lib/trading/backtest/datasets";
import type { TradingMarketType } from "@/lib/trading/data";

import { DEFAULT_RESEARCH_CONFIG_PATH } from "./config";
import { ensureDirectory, fileExists, readJsonIfExists, sha256File, sha256Json, writeJsonAtomic } from "./fs";
import { resolveResearchReportSchemaVersion } from "./schema";
import type { ResearchBaselineManifest, ResearchConfig, ResearchReportProvenance } from "./types";

export type ResearchLocalArchiveInventoryState =
  | "complete"
  | "partial"
  | "stale"
  | "unsupported"
  | "unknown";

export type ResearchLocalArchiveStorageTier =
  | "canonical"
  | "staging"
  | "temporary"
  | "quarantine"
  | "legacy"
  | "unreferenced";

export type ResearchLocalArchiveInventoryDataset = {
  dataset_id: string;
  market: string;
  instrument: string;
  timeframe: "1m";
  provider: string;
  source_origin: string;
  original_symbol: string | null;
  normalized_symbol: string;
  instrument_type: string;
  timezone: string;
  adjusted: "unknown" | "not_applicable";
  storage_tier: Exclude<ResearchLocalArchiveStorageTier, "temporary" | "quarantine" | "legacy" | "unreferenced">;
  file_format: string;
  manifest_exists: boolean;
  manifest_path: string | null;
  schema_version: string;
  local_root: string;
  dataset_root: string;
  first_timestamp_local: string | null;
  last_timestamp_local: string | null;
  candle_count: number;
  file_count: number;
  total_size_bytes: number;
  last_modified_at: string | null;
  checksum: string | null;
  expected_parts: number;
  present_parts: number;
  missing_parts: number;
  coverage_by_year: Record<string, number>;
  known_gaps: {
    count: number;
    largest_gap_minutes: number | null;
    sample: Array<{
      from: string;
      to: string;
      missing_minutes: number;
    }>;
  };
  duplicates: {
    identical: number;
    conflicting: number;
  };
  invalid_lines: number;
  validation: {
    valid_rows: number;
    invalid_ohlc_rows: number;
    duplicate_ratio: number;
  };
  file_refs: Array<{
    path: string;
    size_bytes: number;
    modified_at: string;
    checksum: string;
  }>;
  state: ResearchLocalArchiveInventoryState;
  issues: string[];
};

export type ResearchLocalArchiveInventoryRootSummary = {
  root: string;
  file_count: number;
  size_bytes: number;
  categories: Record<ResearchLocalArchiveStorageTier, number>;
  sample_paths: string[];
};

export type ResearchLocalArchiveInventoryReport = {
  schema_version: "research.local-archive-inventory-report.v1";
  report_id: string;
  generated_at: string;
  provenance: ResearchReportProvenance;
  scope: "all" | "canonical" | "staging";
  requested_markets: TradingMarketType[] | null;
  requested_instruments: string[] | null;
  roots: {
    canonical: string;
    staging: string;
  };
  summary: {
    datasets: number;
    states: Record<ResearchLocalArchiveInventoryState, number>;
    storage_tiers: Record<Exclude<ResearchLocalArchiveStorageTier, "temporary" | "quarantine" | "legacy" | "unreferenced">, number>;
    total_files: number;
    total_size_bytes: number;
    duplicate_rows: number;
    conflicting_duplicates: number;
    invalid_lines: number;
    gap_count: number;
  };
  roots_summary: ResearchLocalArchiveInventoryRootSummary[];
  datasets: ResearchLocalArchiveInventoryDataset[];
};

export type ResearchLocalArchiveInventoryScope = "all" | "canonical" | "staging";
export type ResearchLocalArchiveInventoryRequest = {
  scope?: ResearchLocalArchiveInventoryScope;
  markets?: TradingMarketType[] | null;
  instruments?: string[] | null;
};

type ParsedCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type DatasetStats = {
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  candleCount: number;
  duplicateIdentical: number;
  duplicateConflicting: number;
  invalidLines: number;
  invalidOhlcRows: number;
  coverageByYear: Record<string, number>;
  gapCount: number;
  largestGapMinutes: number | null;
  gapSample: Array<{
    from: string;
    to: string;
    missing_minutes: number;
  }>;
};

const LOCAL_ARCHIVE_SCHEMA_VERSION = "local_archive.dataset_manifest.v1";
const BASE_TIMEFRAME_MINUTES = 1;
const GAP_SAMPLE_LIMIT = 5;
const STALE_DATASET_DAYS = 180;

async function buildLightweightInventoryProvenance(config: ResearchConfig): Promise<ResearchReportProvenance> {
  const manifestPath = path.join(
    config.paths.baselinesDir,
    config.liveBaselineSource.baselineId,
    "baseline-manifest.json",
  );
  const baselineManifest = await readJsonIfExists<ResearchBaselineManifest>(manifestPath);

  return {
    owner: "research_lab",
    config_path: DEFAULT_RESEARCH_CONFIG_PATH,
    live_baseline_id: config.liveBaselineSource.baselineId ?? null,
    dataset_manifest_hash: baselineManifest?.dataset_manifest_hash ?? null,
    engine_manifest_hash: baselineManifest?.engine_manifest_hash ?? null,
    dataset_refs: [],
    upstream_report_ids: [],
  };
}

function resolveCanonicalRoot(config: ResearchConfig): string {
  return path.resolve(config.study.datasetLocalDataRoot ?? process.env.TRADING_BACKTEST_LOCAL_DATA_DIR ?? path.join(process.cwd(), "Data", "historical"));
}

function resolveStagingRoot(): string {
  return path.resolve(process.env.TRADING_BACKTEST_STAGING_DATA_DIR ?? path.join(process.cwd(), "data", "historical-staging"));
}

function normalizePathSegments(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function datasetRange(config: ResearchConfig): { from: string; to: string } {
  const candidates = [
    ...config.study.crisisPeriods,
    {
      label: "walk_forward",
      from: config.study.walkForward.from,
      to: config.study.walkForward.to,
    },
    ...(config.study.yearlyPeriods ?? []),
  ];
  const sortedFrom = candidates.map((item) => item.from).sort();
  const sortedTo = candidates.map((item) => item.to).sort();
  return {
    from: sortedFrom[0] ?? config.study.walkForward.from,
    to: sortedTo.at(-1) ?? config.study.walkForward.to,
  };
}

function buildYearRange(from: string, to: string): number[] {
  const years: number[] = [];
  const startYear = new Date(from).getUTCFullYear();
  const endYear = new Date(to).getUTCFullYear();
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

function expectedRelativePaths(args: {
  localDataset: TradingHistoricalLocalDatasetConfig;
  from: string;
  to: string;
}): string[] {
  const rootSegments = args.localDataset.pathSegments;
  if (args.localDataset.format === "forex_ascii_yearly_m1") {
    return buildYearRange(args.from, args.to).flatMap((year) => [
      path.join(...rootSegments, `DAT_ASCII_${args.localDataset.symbol}_M1_${year}.csv`),
      path.join(...rootSegments, `DAT_ASCII_${args.localDataset.symbol}_M1_${year}.csv.csv`),
    ]);
  }
  if (args.localDataset.format === "histdata_ascii_yearly_m1") {
    return buildYearRange(args.from, args.to).map((year) =>
      path.join(...rootSegments, `DAT_ASCII_${args.localDataset.symbol}_M1_${year}.csv`),
    );
  }
  if (args.localDataset.format === "indices_csv_yearly_m1") {
    return buildYearRange(args.from, args.to).map((year) =>
      path.join(...rootSegments, `${args.localDataset.symbol}_${year}.csv`),
    );
  }
  return buildMonthRange(args.from, args.to).map((part) =>
    path.join(...rootSegments, `${args.localDataset.symbol}-1m-${part.year}-${String(part.month).padStart(2, "0")}.csv`),
  );
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(current: string) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(resolved);
      } else if (entry.isFile()) {
        output.push(resolved);
      }
    }
  }
  await walk(root);
  return output;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseForexTimestamp(value: string): string | null {
  const [datePart, timePart] = value.trim().split(" ");
  if (!datePart || !timePart || datePart.length !== 8 || timePart.length !== 6) return null;
  const iso = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}.000Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLooseIsoTimestamp(value: string): string | null {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseForexLine(line: string): ParsedCandle | null {
  const [dateTime, open, high, low, close] = line.split(";");
  const timestamp = parseForexTimestamp(dateTime ?? "");
  const parsedOpen = parseNumber(open);
  const parsedHigh = parseNumber(high);
  const parsedLow = parseNumber(low);
  const parsedClose = parseNumber(close);
  if (!timestamp || parsedOpen === null || parsedHigh === null || parsedLow === null || parsedClose === null) return null;
  return { timestamp, open: parsedOpen, high: parsedHigh, low: parsedLow, close: parsedClose };
}

function parseIndicesLine(line: string): ParsedCandle | null {
  if (line.startsWith("DateTime,")) return null;
  const [dateTime, open, high, low, close] = line.split(",");
  const timestamp = parseLooseIsoTimestamp(dateTime ?? "");
  const parsedOpen = parseNumber(open);
  const parsedHigh = parseNumber(high);
  const parsedLow = parseNumber(low);
  const parsedClose = parseNumber(close);
  if (!timestamp || parsedOpen === null || parsedHigh === null || parsedLow === null || parsedClose === null) return null;
  return { timestamp, open: parsedOpen, high: parsedHigh, low: parsedLow, close: parsedClose };
}

function parseCryptoLine(line: string): ParsedCandle | null {
  const columns = line.split(",");
  const openTime = parseNumber(columns[0]);
  const open = parseNumber(columns[1]);
  const high = parseNumber(columns[2]);
  const low = parseNumber(columns[3]);
  const close = parseNumber(columns[4]);
  if (openTime === null || open === null || high === null || low === null || close === null) return null;
  let normalizedOpenTime = Math.trunc(openTime);
  while (normalizedOpenTime > 9_999_999_999_999) normalizedOpenTime = Math.trunc(normalizedOpenTime / 1000);
  const timestamp = new Date(normalizedOpenTime).toISOString();
  if (Number.isNaN(new Date(timestamp).getTime())) return null;
  return { timestamp, open, high, low, close };
}

function parseLine(line: string, config: TradingHistoricalLocalDatasetConfig): ParsedCandle | null {
  if (!line.trim()) return null;
  if (config.format === "forex_ascii_yearly_m1" || config.format === "histdata_ascii_yearly_m1") {
    return parseForexLine(line);
  }
  if (config.format === "indices_csv_yearly_m1") {
    return parseIndicesLine(line);
  }
  return parseCryptoLine(line);
}

function isValidOhlc(candle: ParsedCandle): boolean {
  if (candle.open < 0 || candle.high < 0 || candle.low < 0 || candle.close < 0) return false;
  if (candle.high < Math.max(candle.open, candle.close, candle.low)) return false;
  if (candle.low > Math.min(candle.open, candle.close, candle.high)) return false;
  return true;
}

async function analyzeDatasetFiles(args: {
  files: string[];
  localDataset: TradingHistoricalLocalDatasetConfig;
  instrument: TradingHistoricalInstrumentConfig;
}): Promise<DatasetStats> {
  const uniqueCandles = new Map<string, ParsedCandle>();
  let duplicateIdentical = 0;
  let duplicateConflicting = 0;
  let invalidLines = 0;
  let invalidOhlcRows = 0;
  const coverageByYear: Record<string, number> = {};

  for (const filePath of args.files) {
    const lineReader = readline.createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lineReader) {
      const parsed = parseLine(line, args.localDataset);
      if (!parsed) {
        if (line.trim() && !line.startsWith("DateTime,")) invalidLines += 1;
        continue;
      }
      if (!isValidOhlc(parsed)) {
        invalidOhlcRows += 1;
        continue;
      }
      const existing = uniqueCandles.get(parsed.timestamp);
      if (existing) {
        const same =
          existing.open === parsed.open
          && existing.high === parsed.high
          && existing.low === parsed.low
          && existing.close === parsed.close;
        if (same) duplicateIdentical += 1;
        else duplicateConflicting += 1;
        continue;
      }
      uniqueCandles.set(parsed.timestamp, parsed);
      const year = String(new Date(parsed.timestamp).getUTCFullYear());
      coverageByYear[year] = (coverageByYear[year] ?? 0) + 1;
    }
  }

  const timestamps = Array.from(uniqueCandles.keys()).sort();
  let gapCount = 0;
  let largestGapMinutes: number | null = null;
  const gapSample: Array<{ from: string; to: string; missing_minutes: number }> = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = new Date(timestamps[index - 1]!).getTime();
    const current = new Date(timestamps[index]!).getTime();
    const diffMinutes = Math.round((current - previous) / 60_000);
    const previousDate = new Date(timestamps[index - 1]!);
    const currentDate = new Date(timestamps[index]!);
    const sameUtcDay =
      previousDate.getUTCFullYear() === currentDate.getUTCFullYear()
      && previousDate.getUTCMonth() === currentDate.getUTCMonth()
      && previousDate.getUTCDate() === currentDate.getUTCDate();
    const shouldTrackGap = args.instrument.marketType === "crypto" || sameUtcDay;
    if (shouldTrackGap && diffMinutes > BASE_TIMEFRAME_MINUTES) {
      gapCount += 1;
      const missingMinutes = diffMinutes - BASE_TIMEFRAME_MINUTES;
      largestGapMinutes = largestGapMinutes === null ? missingMinutes : Math.max(largestGapMinutes, missingMinutes);
      if (gapSample.length < GAP_SAMPLE_LIMIT) {
        gapSample.push({
          from: timestamps[index - 1]!,
          to: timestamps[index]!,
          missing_minutes: missingMinutes,
        });
      }
    }
  }

  return {
    firstTimestamp: timestamps[0] ?? null,
    lastTimestamp: timestamps.at(-1) ?? null,
    candleCount: timestamps.length,
    duplicateIdentical,
    duplicateConflicting,
    invalidLines,
    invalidOhlcRows,
    coverageByYear,
    gapCount,
    largestGapMinutes,
    gapSample,
  };
}

function resolveProvider(config: TradingHistoricalInstrumentConfig): string {
  if (config.localDataset?.format === "crypto_binance_monthly_m1") return "binance";
  return "local_archive";
}

function resolveSourceOrigin(config: TradingHistoricalInstrumentConfig): string {
  if (config.localDataset?.format === "crypto_binance_monthly_m1") return "binance_official_public_archive";
  return "twelvedata_seeded_local_archive";
}

function resolveAdjusted(config: TradingHistoricalInstrumentConfig): "unknown" | "not_applicable" {
  return config.marketType === "forex" || config.marketType === "crypto" ? "not_applicable" : "unknown";
}

function resolveStorageTierFromRelativePath(relativePath: string): ResearchLocalArchiveStorageTier {
  const normalized = normalizePathSegments(relativePath);
  if (normalized.includes("/tmp/") || normalized.includes(".tmp")) return "temporary";
  if (normalized.includes("/quarantine/")) return "quarantine";
  if (normalized.includes("/legacy/") || normalized.includes("/archive/legacy/")) return "legacy";
  return "unreferenced";
}

function classifyState(args: {
  fileCount: number;
  missingParts: number;
  duplicateConflicting: number;
  invalidLines: number;
  invalidOhlcRows: number;
  gapCount: number;
  lastModifiedAt: string | null;
}): ResearchLocalArchiveInventoryState {
  if (args.fileCount === 0) return "unknown";
  const hasIssues =
    args.missingParts > 0
    || args.duplicateConflicting > 0
    || args.invalidLines > 0
    || args.invalidOhlcRows > 0
    || args.gapCount > 0;
  if (hasIssues) return "partial";
  if (args.lastModifiedAt) {
    const ageDays = (Date.now() - new Date(args.lastModifiedAt).getTime()) / 86_400_000;
    if (ageDays > STALE_DATASET_DAYS) {
      return "stale";
    }
  }
  return "complete";
}

function knownInstrumentConfigs(): TradingHistoricalInstrumentConfig[] {
  return [...TRADING_BACKTEST_BASE_INSTRUMENTS, ...TRADING_BACKTEST_RESEARCH_EXPANSION_INSTRUMENTS];
}

function filterInstrumentConfigs(args: {
  instruments: TradingHistoricalInstrumentConfig[];
  requestedMarkets: TradingMarketType[] | null;
  requestedInstruments: string[] | null;
}): TradingHistoricalInstrumentConfig[] {
  let filtered = args.instruments;

  if (args.requestedMarkets && args.requestedMarkets.length > 0) {
    const allowedMarkets = new Set(args.requestedMarkets);
    filtered = filtered.filter((instrument) => allowedMarkets.has(instrument.marketType));
  }

  if (!args.requestedInstruments || args.requestedInstruments.length === 0) {
    return filtered;
  }

  const allowed = new Set(args.requestedInstruments.map((value) => value.trim().toUpperCase()).filter(Boolean));
  return filtered.filter((instrument) => allowed.has(instrument.instrument));
}

async function matchPresentFiles(args: {
  root: string;
  expectedRelativePaths: string[];
}): Promise<string[]> {
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const relativePath of args.expectedRelativePaths) {
    const absolute = path.join(args.root, relativePath);
    if (await fileExists(absolute) && !seen.has(absolute)) {
      seen.add(absolute);
      matched.push(absolute);
    }
  }
  return matched.sort();
}

async function buildDatasetInventory(args: {
  config: ResearchConfig;
  instrument: TradingHistoricalInstrumentConfig;
  root: string;
  storageTier: "canonical" | "staging";
}): Promise<ResearchLocalArchiveInventoryDataset> {
  const localDataset = args.instrument.localDataset;
  if (!localDataset) {
    return {
      dataset_id: `${args.storageTier}:${args.instrument.instrument}:1m`,
      market: args.instrument.sessionProfile,
      instrument: args.instrument.instrument,
      timeframe: "1m",
      provider: args.instrument.source,
      source_origin: args.instrument.source,
      original_symbol: args.instrument.dataSymbols[0]?.symbol ?? null,
      normalized_symbol: args.instrument.instrument,
      instrument_type: args.instrument.marketType,
      timezone: args.config.study.datasetTimezone ?? "UTC",
      adjusted: resolveAdjusted(args.instrument),
      storage_tier: args.storageTier,
      file_format: "unsupported",
      manifest_exists: false,
      manifest_path: null,
      schema_version: LOCAL_ARCHIVE_SCHEMA_VERSION,
      local_root: args.root,
      dataset_root: path.join(args.root, args.instrument.instrument.toLowerCase()),
      first_timestamp_local: null,
      last_timestamp_local: null,
      candle_count: 0,
      file_count: 0,
      total_size_bytes: 0,
      last_modified_at: null,
      checksum: null,
      expected_parts: 0,
      present_parts: 0,
      missing_parts: 0,
      coverage_by_year: {},
      known_gaps: { count: 0, largest_gap_minutes: null, sample: [] },
      duplicates: { identical: 0, conflicting: 0 },
      invalid_lines: 0,
      validation: { valid_rows: 0, invalid_ohlc_rows: 0, duplicate_ratio: 0 },
      file_refs: [],
      state: "unsupported",
      issues: ["No local dataset configured for this instrument."],
    };
  }

  const range = datasetRange(args.config);
  const expected = expectedRelativePaths({
    localDataset,
    from: range.from,
    to: range.to,
  });
  const files = await matchPresentFiles({
    root: args.root,
    expectedRelativePaths: expected,
  });
  const fileRefs = await Promise.all(
    files.map(async (filePath) => {
      const details = await stat(filePath);
      return {
        path: filePath,
        size_bytes: details.size,
        modified_at: details.mtime.toISOString(),
        checksum: await sha256File(filePath),
      };
    }),
  );
  const stats = await analyzeDatasetFiles({
    files,
    localDataset,
    instrument: args.instrument,
  });
  const manifestPath = path.join(args.root, ...localDataset.pathSegments, "manifest.json");
  const manifestExists = await fileExists(manifestPath);
  const checksum = fileRefs.length
    ? sha256Json(fileRefs.map((entry) => ({ path: entry.path, checksum: entry.checksum })))
    : null;
  const lastModifiedAt = fileRefs.map((entry) => entry.modified_at).sort().at(-1) ?? null;
  const presentParts = files.length;
  const expectedParts = localDataset.format === "forex_ascii_yearly_m1"
    ? buildYearRange(range.from, range.to).length
    : localDataset.format === "histdata_ascii_yearly_m1"
      ? buildYearRange(range.from, range.to).length
      : localDataset.format === "indices_csv_yearly_m1"
        ? buildYearRange(range.from, range.to).length
        : buildMonthRange(range.from, range.to).length;
  const missingParts = Math.max(0, expectedParts - presentParts);
  const state = classifyState({
    fileCount: files.length,
    missingParts,
    duplicateConflicting: stats.duplicateConflicting,
    invalidLines: stats.invalidLines,
    invalidOhlcRows: stats.invalidOhlcRows,
    gapCount: stats.gapCount,
    lastModifiedAt,
  });
  const issues: string[] = [];
  if (missingParts > 0) issues.push(`${missingParts} expected period parts are missing for the configured study range.`);
  if (stats.invalidLines > 0) issues.push(`${stats.invalidLines} invalid lines were detected.`);
  if (stats.invalidOhlcRows > 0) issues.push(`${stats.invalidOhlcRows} rows failed OHLC validation.`);
  if (stats.duplicateConflicting > 0) issues.push(`${stats.duplicateConflicting} conflicting duplicate timestamps were detected.`);
  if (stats.gapCount > 0) issues.push(`${stats.gapCount} chronological gaps were detected in the persisted candles.`);
  if (!manifestExists) issues.push("No dataset manifest exists under the dataset root.");

  return {
    dataset_id: `${args.storageTier}:${args.instrument.instrument}:1m`,
    market: args.instrument.sessionProfile,
    instrument: args.instrument.instrument,
    timeframe: "1m",
    provider: resolveProvider(args.instrument),
    source_origin: resolveSourceOrigin(args.instrument),
    original_symbol: args.instrument.dataSymbols[0]?.symbol ?? null,
    normalized_symbol: localDataset.symbol,
    instrument_type: args.instrument.marketType,
    timezone: args.config.study.datasetTimezone ?? "UTC",
    adjusted: resolveAdjusted(args.instrument),
    storage_tier: args.storageTier,
    file_format: localDataset.format,
    manifest_exists: manifestExists,
    manifest_path: manifestExists ? manifestPath : null,
    schema_version: LOCAL_ARCHIVE_SCHEMA_VERSION,
    local_root: args.root,
    dataset_root: path.join(args.root, ...localDataset.pathSegments),
    first_timestamp_local: stats.firstTimestamp,
    last_timestamp_local: stats.lastTimestamp,
    candle_count: stats.candleCount,
    file_count: files.length,
    total_size_bytes: fileRefs.reduce((sum, entry) => sum + entry.size_bytes, 0),
    last_modified_at: lastModifiedAt,
    checksum,
    expected_parts: expectedParts,
    present_parts: presentParts,
    missing_parts: missingParts,
    coverage_by_year: stats.coverageByYear,
    known_gaps: {
      count: stats.gapCount,
      largest_gap_minutes: stats.largestGapMinutes,
      sample: stats.gapSample,
    },
    duplicates: {
      identical: stats.duplicateIdentical,
      conflicting: stats.duplicateConflicting,
    },
    invalid_lines: stats.invalidLines,
    validation: {
      valid_rows: stats.candleCount,
      invalid_ohlc_rows: stats.invalidOhlcRows,
      duplicate_ratio: stats.candleCount > 0 ? Number(((stats.duplicateIdentical + stats.duplicateConflicting) / stats.candleCount).toFixed(6)) : 0,
    },
    file_refs: fileRefs,
    state,
    issues,
  };
}

function buildRootSummary(args: {
  root: string;
  files: string[];
  referencedPrefixes: string[];
}): ResearchLocalArchiveInventoryRootSummary {
  const categories: Record<ResearchLocalArchiveStorageTier, number> = {
    canonical: 0,
    staging: 0,
    temporary: 0,
    quarantine: 0,
    legacy: 0,
    unreferenced: 0,
  };
  const sizeBytes = 0;
  const samplePaths: string[] = [];
  for (const filePath of args.files) {
    const relativePath = normalizePathSegments(path.relative(args.root, filePath));
    const referenced = args.referencedPrefixes.some((prefix) => relativePath.startsWith(prefix));
    const category = referenced ? (args.root.includes("historical-staging") ? "staging" : "canonical") : resolveStorageTierFromRelativePath(relativePath);
    categories[category] += 1;
    if (samplePaths.length < 10) samplePaths.push(filePath);
  }
  return {
    root: args.root,
    file_count: args.files.length,
    size_bytes: sizeBytes,
    categories,
    sample_paths: samplePaths,
  };
}

export async function buildResearchLocalArchiveInventoryReport(
  config: ResearchConfig,
  request: ResearchLocalArchiveInventoryScope | ResearchLocalArchiveInventoryRequest = "all",
): Promise<ResearchLocalArchiveInventoryReport> {
  const normalizedRequest: ResearchLocalArchiveInventoryRequest =
    typeof request === "string"
      ? { scope: request }
      : request;
  const scope = normalizedRequest.scope ?? "all";
  const canonicalRoot = resolveCanonicalRoot(config);
  const stagingRoot = resolveStagingRoot();
  const requestedMarkets = normalizedRequest.markets?.filter(Boolean) ?? null;
  const requestedInstruments = normalizedRequest.instruments?.map((value) => value.trim().toUpperCase()).filter(Boolean) ?? null;
  const instruments = filterInstrumentConfigs({
    instruments: knownInstrumentConfigs(),
    requestedMarkets,
    requestedInstruments,
  });
  const canonicalDatasets = scope === "staging"
    ? []
    : await Promise.all(
        instruments.map((instrument) =>
          buildDatasetInventory({
            config,
            instrument,
            root: canonicalRoot,
            storageTier: "canonical",
          }),
        ),
      );
  const stagingDatasets = scope === "canonical"
    ? []
    : await Promise.all(
        instruments.map((instrument) =>
          buildDatasetInventory({
            config,
            instrument,
            root: stagingRoot,
            storageTier: "staging",
          }),
        ),
      );
  const datasets = [...canonicalDatasets, ...stagingDatasets].sort(
    (left, right) => left.instrument.localeCompare(right.instrument) || left.storage_tier.localeCompare(right.storage_tier),
  );

  const canonicalFiles = scope === "staging" ? [] : await listFilesRecursive(canonicalRoot);
  const stagingFiles = scope === "canonical" ? [] : await listFilesRecursive(stagingRoot);
  const fileSizeMap = new Map<string, number>();
  for (const filePath of [...canonicalFiles, ...stagingFiles]) {
    try {
      fileSizeMap.set(filePath, (await stat(filePath)).size);
    } catch {
      // Ignore races during audit reads.
    }
  }

  const referencedPrefixes = instruments
    .filter((instrument) => instrument.localDataset)
    .map((instrument) => normalizePathSegments(instrument.localDataset!.pathSegments.join("/")));
  const rootsSummary = [
    buildRootSummary({
      root: canonicalRoot,
      files: canonicalFiles,
      referencedPrefixes,
    }),
    buildRootSummary({
      root: stagingRoot,
      files: stagingFiles,
      referencedPrefixes,
    }),
  ].map((summary) => ({
    ...summary,
    size_bytes: [...(summary.root === canonicalRoot ? canonicalFiles : stagingFiles)]
      .reduce((sum, filePath) => sum + (fileSizeMap.get(filePath) ?? 0), 0),
  }));

  const states: Record<ResearchLocalArchiveInventoryState, number> = {
    complete: 0,
    partial: 0,
    stale: 0,
    unsupported: 0,
    unknown: 0,
  };
  const storageTiers: Record<Exclude<ResearchLocalArchiveStorageTier, "temporary" | "quarantine" | "legacy" | "unreferenced">, number> = {
    canonical: 0,
    staging: 0,
  };
  for (const dataset of datasets) {
    states[dataset.state] += 1;
    storageTiers[dataset.storage_tier] += 1;
  }

  return {
    schema_version: resolveResearchReportSchemaVersion("localArchiveInventory"),
    report_id: `local-archive-inventory-${scope}-${new Date().toISOString()}`,
    generated_at: new Date().toISOString(),
    provenance: await buildLightweightInventoryProvenance(config),
    scope,
    requested_markets: requestedMarkets,
    requested_instruments: requestedInstruments,
    roots: {
      canonical: canonicalRoot,
      staging: stagingRoot,
    },
    summary: {
      datasets: datasets.length,
      states,
      storage_tiers: storageTiers,
      total_files: datasets.reduce((sum, dataset) => sum + dataset.file_count, 0),
      total_size_bytes: datasets.reduce((sum, dataset) => sum + dataset.total_size_bytes, 0),
      duplicate_rows: datasets.reduce((sum, dataset) => sum + dataset.duplicates.identical, 0),
      conflicting_duplicates: datasets.reduce((sum, dataset) => sum + dataset.duplicates.conflicting, 0),
      invalid_lines: datasets.reduce((sum, dataset) => sum + dataset.invalid_lines + dataset.validation.invalid_ohlc_rows, 0),
      gap_count: datasets.reduce((sum, dataset) => sum + dataset.known_gaps.count, 0),
    },
    roots_summary: rootsSummary,
    datasets,
  };
}

export async function writeResearchLocalArchiveInventoryReport(args: {
  config: ResearchConfig;
  report: ResearchLocalArchiveInventoryReport;
}): Promise<{
  jsonPath: string;
  markdownPath: string;
  latestJsonPath: string;
  latestMarkdownPath: string;
}> {
  const datasetDir = path.join(args.config.paths.reportsDir, "datasets");
  await ensureDirectory(datasetDir);

  const jsonPath = path.join(datasetDir, `${args.report.report_id.replace(/[:.]/g, "-")}.json`);
  const markdownPath = path.join(datasetDir, `${args.report.report_id.replace(/[:.]/g, "-")}.md`);
  const scopeSuffix = args.report.scope === "all" ? "latest" : `${args.report.scope}-latest`;
  const latestJsonPath = path.join(datasetDir, `local-archive-inventory-${scopeSuffix}.json`);
  const latestMarkdownPath = path.join(datasetDir, `local-archive-inventory-${scopeSuffix}.md`);

  await writeJsonAtomic(jsonPath, args.report);
  await writeJsonAtomic(latestJsonPath, args.report);

  const markdown = [
    "# Research Local Archive Inventory",
    "",
    `- Generated at: ${args.report.generated_at}`,
    `- Scope: ${args.report.scope}`,
    `- Requested markets: ${args.report.requested_markets?.join(", ") ?? "all"}`,
    `- Requested instruments: ${args.report.requested_instruments?.join(", ") ?? "all"}`,
    `- Dataset refs: ${args.report.provenance.dataset_refs.length}`,
    `- Canonical root: ${args.report.roots.canonical}`,
    `- Staging root: ${args.report.roots.staging}`,
    `- Datasets: ${args.report.summary.datasets}`,
    `- Total files: ${args.report.summary.total_files}`,
    `- Total size bytes: ${args.report.summary.total_size_bytes}`,
    `- Duplicate rows: ${args.report.summary.duplicate_rows}`,
    `- Conflicting duplicates: ${args.report.summary.conflicting_duplicates}`,
    `- Invalid lines: ${args.report.summary.invalid_lines}`,
    `- Gap count: ${args.report.summary.gap_count}`,
    "",
    "## Dataset States",
    ...Object.entries(args.report.summary.states).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Roots",
    ...args.report.roots_summary.flatMap((root) => [
      `- ${root.root}`,
      `  file_count=${root.file_count} size_bytes=${root.size_bytes}`,
      `  categories=${JSON.stringify(root.categories)}`,
    ]),
    "",
    "## Datasets",
    ...args.report.datasets.map((dataset) =>
      `- ${dataset.storage_tier}/${dataset.instrument}: state=${dataset.state} files=${dataset.file_count} candles=${dataset.candle_count} missing_parts=${dataset.missing_parts} duplicates=${dataset.duplicates.identical}/${dataset.duplicates.conflicting} invalid=${dataset.invalid_lines + dataset.validation.invalid_ohlc_rows} gaps=${dataset.known_gaps.count}`,
    ),
  ].join("\n");

  await writeFile(markdownPath, `${markdown}\n`, "utf8");
  await writeFile(latestMarkdownPath, `${markdown}\n`, "utf8");

  return {
    jsonPath,
    markdownPath,
    latestJsonPath,
    latestMarkdownPath,
  };
}
