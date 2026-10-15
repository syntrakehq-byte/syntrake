import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  resolveTradingHistoricalInstrument,
  type TradingHistoricalLocalDatasetConfig,
} from "@/lib/trading/backtest/datasets";
import {
  runTradingHistoricalCoverageAudit,
  writeTradingHistoricalCoverageAuditReport,
} from "@/lib/trading/backtest/coverageAudit";
import type { TradingHistoricalPeriod } from "@/lib/trading/backtest/periods";
import {
  buildBinanceMonthlyKlineZipUrl,
  buildMonthlyRange,
  downloadBinanceMonthlyCsv,
  summarizeSyncResult,
  syncOfficialHistoricalArchives,
  type TradingOfficialSyncInstrument,
  type TradingOfficialSyncMonth,
  type TradingOfficialSyncResult,
} from "@/lib/trading/backtest/officialArchiveSync";
import { syncTwelveDataYearlyFile } from "@/lib/trading/backtest/twelveDataArchiveSync";

import { loadResearchConfig } from "./config";
import { ensureDirectory, readJsonIfExists, writeJsonAtomic } from "./fs";
import type { ResearchConfig } from "./types";

type StagingCatalog = {
  markets?: Array<{
    instrument: string;
    group: string;
    status: string;
    priority: number;
    rationale: string;
    expected_local_format: string;
    expected_symbol: string;
    first_available_month?: string;
    target_path_segments: string[];
    source: {
      provider: string;
      kind: string;
      listing_url: string;
      reference_url: string;
    };
  }>;
};

export type MarketDataBackfillPeriodStatus =
  | "existing"
  | "missing_downloadable"
  | "missing_manual"
  | "unsupported";

export type MarketDataBackfillPeriod = {
  label: string;
  status: MarketDataBackfillPeriodStatus;
  targetPath: string;
  existingPath: string | null;
  remoteUrl: string | null;
  note: string | null;
};

export type MarketDataBackfillPlanEntry = {
  instrument: string;
  source: "active_lab" | "staged_market";
  group: string | null;
  localFormat: string | null;
  dataSymbol: string | null;
  autoDownload: boolean;
  periods: MarketDataBackfillPeriod[];
};

export type MarketDataBackfillPlan = {
  generatedAt: string;
  localDataDir: string;
  stagingDataDir: string;
  from: TradingOfficialSyncMonth;
  to: TradingOfficialSyncMonth;
  activeInstruments: string[];
  includeStaged: boolean;
  entries: MarketDataBackfillPlanEntry[];
  summary: {
    instruments: number;
    periods: number;
    existing: number;
    missingDownloadable: number;
    missingManual: number;
    unsupported: number;
  };
};

export type StagedMarketDataSyncStatus = "downloaded" | "existing" | "failed";

export type StagedMarketDataSyncEntry = {
  instrument: string;
  status: StagedMarketDataSyncStatus;
  targetPath: string;
  remoteUrl: string | null;
  checksumVerified: boolean | null;
  periodLabel: string;
  error: string | null;
};

export type ActiveMarketDataSyncStatus =
  | "downloaded"
  | "existing"
  | "failed"
  | "missing_remote"
  | "restricted_remote_access";

export type ActiveMarketDataSyncEntry = {
  instrument: string;
  status: ActiveMarketDataSyncStatus;
  targetPath: string;
  remoteUrl: string | null;
  providerSymbol: string | null;
  periodLabel: string;
  candleCount: number;
  error: string | null;
};

export type MarketDataBackfillRunRequest = {
  instruments?: string[];
  from?: TradingOfficialSyncMonth;
  to?: TradingOfficialSyncMonth;
  auditFromYear?: number;
  auditToYear?: number;
  includeStaged?: boolean;
  download?: boolean;
  force?: boolean;
  runAudit?: boolean;
  reportsDir?: string | null;
  coverageAuditPath?: string | null;
};

export type MarketDataBackfillRunReport = {
  ok: boolean;
  generatedAt: string;
  request: {
    instruments: string[];
    from: TradingOfficialSyncMonth;
    to: TradingOfficialSyncMonth;
    includeStaged: boolean;
    download: boolean;
    force: boolean;
    runAudit: boolean;
    auditFromYear: number;
    auditToYear: number;
  };
  before: MarketDataBackfillPlan;
  after: MarketDataBackfillPlan;
  sync: {
    attempted: boolean;
    supportedInstruments: TradingOfficialSyncInstrument[];
    result: TradingOfficialSyncResult | null;
    summary: Awaited<ReturnType<typeof summarizeSyncResult>> | null;
    activeAttempted: boolean;
    activeResult: ActiveMarketDataSyncEntry[];
    activeSummary: {
      downloaded: number;
      existing: number;
      missingRemote: number;
      restrictedAccess: number;
      failed: number;
    };
    stagedAttempted: boolean;
    stagedResult: StagedMarketDataSyncEntry[];
    stagedSummary: {
      downloaded: number;
      existing: number;
      failed: number;
    };
  };
  coverageAudit: {
    attempted: boolean;
    outputPath: string | null;
    failures: number | null;
    summaryByInstrument: Record<string, unknown> | null;
  };
  outputs: {
    jsonPath: string;
    markdownPath: string;
  };
};

function resolveLocalHistoricalBaseDir(): string {
  const configuredDir = process.env.TRADING_BACKTEST_LOCAL_DATA_DIR?.trim();
  if (configuredDir) {
    return path.resolve(/* turbopackIgnore: true */ configuredDir);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), "Data", "historical");
}

function resolveStagingBaseDir(): string {
  const configuredDir = process.env.TRADING_BACKTEST_STAGING_DATA_DIR?.trim();
  if (configuredDir) {
    return path.resolve(/* turbopackIgnore: true */ configuredDir);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), "data", "historical-staging");
}

function resolveReportsDir(customDir?: string | null): string {
  const configuredDir = customDir?.trim();
  if (configuredDir) {
    return path.resolve(/* turbopackIgnore: true */ configuredDir);
  }

  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "artifacts",
    "trading-research",
    "reports",
    "datasets",
  );
}

function monthLabel(value: TradingOfficialSyncMonth): string {
  return `${value.year}-${String(value.month).padStart(2, "0")}`;
}

function parseMonthLabel(label: string): TradingOfficialSyncMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function compareMonth(left: TradingOfficialSyncMonth, right: TradingOfficialSyncMonth): number {
  return (left.year - right.year) || (left.month - right.month);
}

function isBeforeFirstAvailableMonth(
  part: TradingOfficialSyncMonth,
  firstAvailableMonth?: string,
): boolean {
  if (!firstAvailableMonth) return false;
  const first = parseMonthLabel(firstAvailableMonth);
  return first ? compareMonth(part, first) < 0 : false;
}

function defaultPreviousCompleteMonth(): TradingOfficialSyncMonth {
  const now = new Date();
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - 1);

  return {
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
  };
}

function defaultFromMonth(config: ResearchConfig): TradingOfficialSyncMonth {
  const firstPeriod = config.study.yearlyPeriods.at(0);
  if (!firstPeriod) {
    return { year: 2019, month: 1 };
  }

  const date = new Date(firstPeriod.from);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function defaultAuditYearRange(config: ResearchConfig): { fromYear: number; toYear: number } {
  const periods = config.study.yearlyPeriods;
  const years = periods
    .map((period) => new Date(period.from).getUTCFullYear())
    .filter((year) => Number.isInteger(year));

  if (years.length === 0) {
    return { fromYear: 2019, toYear: 2025 };
  }

  return {
    fromYear: Math.min(...years),
    toYear: Math.max(...years),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isOfficialSyncInstrument(value: string): value is TradingOfficialSyncInstrument {
  return value === "BTCUSD"
    || value === "ETHUSD"
    || value === "BNBUSD"
    || value === "SOLUSD"
    || value === "XRPUSD";
}

function isAutoDownloadable(config: TradingHistoricalLocalDatasetConfig, instrument: string): boolean {
  if (config.format === "crypto_binance_monthly_m1") {
    return isOfficialSyncInstrument(instrument);
  }

  return (
    config.format === "forex_ascii_yearly_m1"
    || config.format === "histdata_ascii_yearly_m1"
    || config.format === "indices_csv_yearly_m1"
  );
}

function buildTwelveDataHintUrl(symbol: string): string {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1min");
  url.searchParams.set("order", "ASC");
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

function buildLocalCandidates(args: {
  baseDir: string;
  instrument: ReturnType<typeof resolveTradingHistoricalInstrument>;
  localDataset: TradingHistoricalLocalDatasetConfig;
  part: TradingOfficialSyncMonth;
}): {
  label: string;
  targetPath: string;
  candidates: string[];
  remoteUrl: string | null;
} {
  const root = path.join(args.baseDir, ...args.localDataset.pathSegments);

  if (args.localDataset.format === "crypto_binance_monthly_m1") {
    const label = monthLabel(args.part);
    const filename = `${args.localDataset.symbol}-1m-${label}.csv`;
    return {
      label,
      targetPath: path.join(/* turbopackIgnore: true */ root, filename),
      candidates: [path.join(/* turbopackIgnore: true */ root, filename)],
      remoteUrl: buildBinanceMonthlyKlineZipUrl(args.localDataset.symbol, args.part),
    };
  }

  if (args.localDataset.format === "forex_ascii_yearly_m1") {
    const label = String(args.part.year);
    const canonical = path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${args.localDataset.symbol}_M1_${args.part.year}.csv`);
    return {
      label,
      targetPath: canonical,
      candidates: [
        path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${args.localDataset.symbol}_M1_${args.part.year}.csv.csv`),
        canonical,
      ],
      remoteUrl: buildTwelveDataHintUrl(args.instrument.dataSymbols[0]?.symbol ?? args.localDataset.symbol),
    };
  }

  if (args.localDataset.format === "histdata_ascii_yearly_m1") {
    const label = String(args.part.year);
    const targetPath = path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${args.localDataset.symbol}_M1_${args.part.year}.csv`);
    return {
      label,
      targetPath,
      candidates: [targetPath],
      remoteUrl: buildTwelveDataHintUrl(args.instrument.dataSymbols[0]?.symbol ?? args.localDataset.symbol),
    };
  }

  const label = String(args.part.year);
  const targetPath = path.join(/* turbopackIgnore: true */ root, `${args.localDataset.symbol}_${args.part.year}.csv`);
  return {
    label,
    targetPath,
    candidates: [targetPath],
    remoteUrl: buildTwelveDataHintUrl(args.instrument.dataSymbols[0]?.symbol ?? args.localDataset.symbol),
  };
}

function buildStagedCryptoCandidates(args: {
  root: string;
  symbol: string;
  part: TradingOfficialSyncMonth;
}): {
  label: string;
  targetPath: string;
  candidates: string[];
  remoteUrl: string;
} {
  const label = monthLabel(args.part);
  const filename = `${args.symbol}-1m-${label}.csv`;
  return {
    label,
    targetPath: path.join(/* turbopackIgnore: true */ args.root, filename),
    candidates: [path.join(/* turbopackIgnore: true */ args.root, filename)],
    remoteUrl: buildBinanceMonthlyKlineZipUrl(args.symbol, args.part),
  };
}

function uniqueYearParts(from: TradingOfficialSyncMonth, to: TradingOfficialSyncMonth): TradingOfficialSyncMonth[] {
  const parts: TradingOfficialSyncMonth[] = [];
  for (let year = from.year; year <= to.year; year += 1) {
    parts.push({ year, month: 1 });
  }
  return parts;
}

function resolveExpectedParts(
  config: TradingHistoricalLocalDatasetConfig,
  from: TradingOfficialSyncMonth,
  to: TradingOfficialSyncMonth,
): TradingOfficialSyncMonth[] {
  return config.format === "crypto_binance_monthly_m1"
    ? buildMonthlyRange(from, to)
    : uniqueYearParts(from, to);
}

async function buildActiveEntry(args: {
  instrument: string;
  from: TradingOfficialSyncMonth;
  to: TradingOfficialSyncMonth;
  localDataDir: string;
}): Promise<MarketDataBackfillPlanEntry> {
  const instrument = resolveTradingHistoricalInstrument(args.instrument);
  const localDataset = instrument.localDataset;

  if (!localDataset) {
    return {
      instrument: instrument.instrument,
      source: "active_lab",
      group: instrument.marketType,
      localFormat: null,
      dataSymbol: null,
      autoDownload: false,
      periods: [{
        label: "all",
        status: "unsupported",
        targetPath: "",
        existingPath: null,
        remoteUrl: null,
        note: "No local dataset is configured for this active lab instrument.",
      }],
    };
  }

  const autoDownload = isAutoDownloadable(localDataset, instrument.instrument);
  const periods: MarketDataBackfillPeriod[] = [];
  const parts = resolveExpectedParts(localDataset, args.from, args.to);

  for (const part of parts) {
    const target = buildLocalCandidates({
      baseDir: args.localDataDir,
      instrument,
      localDataset,
      part,
    });
    const existingPath = await firstExistingPath(target.candidates);

    periods.push({
      label: target.label,
      status: existingPath
        ? "existing"
        : autoDownload
          ? "missing_downloadable"
          : "missing_manual",
      targetPath: target.targetPath,
      existingPath,
      remoteUrl: autoDownload ? target.remoteUrl : null,
      note: existingPath
        ? null
        : autoDownload
          ? localDataset.format === "crypto_binance_monthly_m1"
            ? "Can be downloaded from Binance public monthly kline archives."
            : "Can be downloaded from Twelve Data and persisted into the local yearly archive consumed by local-only research."
          : "Local file is required before this market can be trusted by local-only research.",
    });
  }

  return {
    instrument: instrument.instrument,
    source: "active_lab",
    group: instrument.marketType,
    localFormat: localDataset.format,
    dataSymbol: localDataset.symbol,
    autoDownload,
    periods,
  };
}

async function buildStagedEntries(args: {
  from: TradingOfficialSyncMonth;
  to: TradingOfficialSyncMonth;
  stagingDataDir: string;
  stagingCatalogPath?: string;
}): Promise<MarketDataBackfillPlanEntry[]> {
  const catalog = await readJsonIfExists<StagingCatalog>(
    args.stagingCatalogPath ?? "config/trading-research/market-staging-catalog.json",
  );
  const markets = catalog?.markets ?? [];
  const entries: MarketDataBackfillPlanEntry[] = [];

  for (const market of markets) {
    const root = path.join(args.stagingDataDir, ...market.target_path_segments);
    const periods: MarketDataBackfillPeriod[] = [];
    const isBinanceCrypto =
      market.expected_local_format === "crypto_binance_monthly_m1"
      && market.source.provider.toLowerCase() === "binance";

    if (isBinanceCrypto) {
      for (const part of buildMonthlyRange(args.from, args.to)) {
        const target = buildStagedCryptoCandidates({
          root,
          symbol: market.expected_symbol,
          part,
        });
        const existingPath = await firstExistingPath(target.candidates);
        const isPreListing = isBeforeFirstAvailableMonth(part, market.first_available_month);

        periods.push({
          label: target.label,
          status: existingPath
            ? "existing"
            : isPreListing
              ? "unsupported"
              : "missing_downloadable",
          targetPath: target.targetPath,
          existingPath,
          remoteUrl: isPreListing ? null : target.remoteUrl,
          note: existingPath
            ? "Staged Binance file exists, but this market is not active in the lab yet."
            : isPreListing
              ? `Skipped because ${market.expected_symbol} appears unavailable before ${market.first_available_month} in Binance public monthly archives.`
              : "Can be downloaded to staging from Binance public monthly kline archives; promotion stays blocked until full validation.",
        });
      }

      entries.push({
        instrument: market.instrument.toUpperCase(),
        source: "staged_market",
        group: market.group,
        localFormat: market.expected_local_format,
        dataSymbol: market.expected_symbol,
        autoDownload: true,
        periods,
      });
      continue;
    }

    for (const part of uniqueYearParts(args.from, args.to)) {
      const targetPath = path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${market.expected_symbol}_M1_${part.year}.csv`);
      const existingPath = await firstExistingPath([
        path.join(/* turbopackIgnore: true */ root, `DAT_ASCII_${market.expected_symbol}_M1_${part.year}.csv.csv`),
        targetPath,
      ]);

      periods.push({
        label: String(part.year),
        status: existingPath ? "existing" : "missing_manual",
        targetPath,
        existingPath,
        remoteUrl: market.source.listing_url,
        note: existingPath
          ? "Staged file exists, but this market is not active in the lab yet."
          : `Manual source prepared from ${market.source.provider}; keep staged until coverage is audited.`,
      });
    }

    entries.push({
      instrument: market.instrument.toUpperCase(),
      source: "staged_market",
      group: market.group,
      localFormat: market.expected_local_format,
      dataSymbol: market.expected_symbol,
      autoDownload: false,
      periods,
    });
  }

  return entries;
}

function summarizePlan(entries: MarketDataBackfillPlanEntry[]): MarketDataBackfillPlan["summary"] {
  const summary = {
    instruments: entries.length,
    periods: 0,
    existing: 0,
    missingDownloadable: 0,
    missingManual: 0,
    unsupported: 0,
  };

  for (const entry of entries) {
    for (const period of entry.periods) {
      summary.periods += 1;
      if (period.status === "existing") summary.existing += 1;
      if (period.status === "missing_downloadable") summary.missingDownloadable += 1;
      if (period.status === "missing_manual") summary.missingManual += 1;
      if (period.status === "unsupported") summary.unsupported += 1;
    }
  }

  return summary;
}

export async function buildTradingMarketDataBackfillPlan(args: {
  config?: ResearchConfig;
  instruments?: string[];
  from?: TradingOfficialSyncMonth;
  to?: TradingOfficialSyncMonth;
  includeStaged?: boolean;
  stagingCatalogPath?: string;
} = {}): Promise<MarketDataBackfillPlan> {
  const config = args.config ?? await loadResearchConfig();
  const from = args.from ?? defaultFromMonth(config);
  const to = args.to ?? defaultPreviousCompleteMonth();
  const activeInstruments = (args.instruments?.length ? args.instruments : config.study.instruments)
    .map((instrument) => instrument.trim().toUpperCase())
    .filter(Boolean);
  const localDataDir = resolveLocalHistoricalBaseDir();
  const stagingDataDir = resolveStagingBaseDir();
  const entries: MarketDataBackfillPlanEntry[] = [];

  for (const instrument of activeInstruments) {
    entries.push(await buildActiveEntry({
      instrument,
      from,
      to,
      localDataDir,
    }));
  }

  if (args.includeStaged) {
    entries.push(...await buildStagedEntries({
      from,
      to,
      stagingDataDir,
      stagingCatalogPath: args.stagingCatalogPath,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    localDataDir,
    stagingDataDir,
    from,
    to,
    activeInstruments,
    includeStaged: Boolean(args.includeStaged),
    entries,
    summary: summarizePlan(entries),
  };
}

function buildYearlyPeriods(fromYear: number, toYear: number): TradingHistoricalPeriod[] {
  const periods: TradingHistoricalPeriod[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    periods.push({
      label: String(year),
      from: `${year}-01-01T00:00:00.000Z`,
      to: `${year}-12-31T23:59:59.000Z`,
    });
  }
  return periods;
}

function collectSupportedSyncInstruments(entries: MarketDataBackfillPlanEntry[]): TradingOfficialSyncInstrument[] {
  return Array.from(
    new Set(
      entries
        .filter((entry) => entry.source === "active_lab")
        .filter((entry) => entry.periods.some((period) => period.status === "missing_downloadable"))
        .map((entry) => entry.instrument)
        .filter(isOfficialSyncInstrument),
    ),
  );
}

async function syncStagedDownloadableEntries(args: {
  entries: MarketDataBackfillPlanEntry[];
  force?: boolean;
}): Promise<StagedMarketDataSyncEntry[]> {
  const result: StagedMarketDataSyncEntry[] = [];

  for (const entry of args.entries) {
    if (entry.source !== "staged_market" || !entry.autoDownload || !entry.dataSymbol) {
      continue;
    }

    for (const period of entry.periods) {
      const part = parseMonthLabel(period.label);
      if (!part) {
        continue;
      }

      if (!args.force && period.existingPath) {
        result.push({
          instrument: entry.instrument,
          status: "existing",
          targetPath: period.targetPath,
          remoteUrl: period.remoteUrl,
          checksumVerified: null,
          periodLabel: period.label,
          error: null,
        });
        continue;
      }

      try {
        const download = await downloadBinanceMonthlyCsv({
          symbol: entry.dataSymbol,
          part,
          targetPath: period.targetPath,
        });
        result.push({
          instrument: entry.instrument,
          status: "downloaded",
          targetPath: period.targetPath,
          remoteUrl: download.remoteUrl,
          checksumVerified: download.checksumVerified,
          periodLabel: period.label,
          error: null,
        });
      } catch (error) {
        result.push({
          instrument: entry.instrument,
          status: "failed",
          targetPath: period.targetPath,
          remoteUrl: period.remoteUrl,
          checksumVerified: null,
          periodLabel: period.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}

async function syncActiveTwelveDataEntries(args: {
  entries: MarketDataBackfillPlanEntry[];
  force?: boolean;
}): Promise<ActiveMarketDataSyncEntry[]> {
  const result: ActiveMarketDataSyncEntry[] = [];

  for (const entry of args.entries) {
    if (entry.source !== "active_lab" || !entry.autoDownload || entry.localFormat === "crypto_binance_monthly_m1") {
      continue;
    }

    for (const period of entry.periods) {
      const year = Number(period.label);
      if (!Number.isInteger(year)) {
        continue;
      }

      try {
        const synced = await syncTwelveDataYearlyFile({
          instrument: entry.instrument,
          year,
          force: args.force,
        });
        result.push({
          instrument: entry.instrument,
          status: synced.status,
          targetPath: synced.targetPath,
          remoteUrl: period.remoteUrl,
          providerSymbol: synced.providerSymbol,
          periodLabel: synced.periodLabel,
          candleCount: synced.candleCount,
          error: null,
        });
      } catch (error) {
        result.push({
          instrument: entry.instrument,
          status: "failed",
          targetPath: period.targetPath,
          remoteUrl: period.remoteUrl,
          providerSymbol: null,
          periodLabel: period.label,
          candleCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}

function summarizeStagedSync(entries: StagedMarketDataSyncEntry[]): MarketDataBackfillRunReport["sync"]["stagedSummary"] {
  return {
    downloaded: entries.filter((entry) => entry.status === "downloaded").length,
    existing: entries.filter((entry) => entry.status === "existing").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
  };
}

function summarizeActiveSync(entries: ActiveMarketDataSyncEntry[]): MarketDataBackfillRunReport["sync"]["activeSummary"] {
  return {
    downloaded: entries.filter((entry) => entry.status === "downloaded").length,
    existing: entries.filter((entry) => entry.status === "existing").length,
    missingRemote: entries.filter((entry) => entry.status === "missing_remote").length,
    restrictedAccess: entries.filter((entry) => entry.status === "restricted_remote_access").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
  };
}

async function writeBackfillMarkdown(report: MarketDataBackfillRunReport, targetPath: string): Promise<void> {
  const lines = [
    "# Trading Market Data Backfill",
    "",
    `Generated at: ${report.generatedAt}`,
    `Range: ${monthLabel(report.request.from)} -> ${monthLabel(report.request.to)}`,
    "",
    "## Summary",
    "",
    `- Before: ${report.before.summary.existing}/${report.before.summary.periods} existing, ${report.before.summary.missingDownloadable} downloadable missing, ${report.before.summary.missingManual} manual missing`,
    `- After: ${report.after.summary.existing}/${report.after.summary.periods} existing, ${report.after.summary.missingDownloadable} downloadable missing, ${report.after.summary.missingManual} manual missing`,
    `- Download attempted: ${report.sync.attempted ? "yes" : "no"}`,
    `- Downloaded: ${report.sync.summary?.downloaded ?? 0}`,
    `- Twelve Data yearly sync: ${report.sync.activeSummary.downloaded} downloaded, ${report.sync.activeSummary.restrictedAccess} restricted access, ${report.sync.activeSummary.failed} failed, ${report.sync.activeSummary.missingRemote} missing remote`,
    `- Staged downloads: ${report.sync.stagedSummary.downloaded} downloaded, ${report.sync.stagedSummary.failed} failed`,
    `- Coverage audit: ${report.coverageAudit.outputPath ?? "not run"}`,
    "",
    "## Remaining Gaps",
    "",
  ];

  const remaining = report.after.entries.flatMap((entry) =>
    entry.periods
      .filter((period) => period.status !== "existing")
      .slice(0, 24)
      .map((period) => `- ${entry.instrument} ${period.label}: ${period.status} (${period.note ?? "no note"})`),
  );

  lines.push(...(remaining.length ? remaining : ["- None in the requested scope."]));

  await ensureDirectory(path.dirname(targetPath));
  await writeFile(targetPath, `${lines.join("\n")}\n`, "utf8");
}

export async function runTradingMarketDataBackfill(
  request: MarketDataBackfillRunRequest = {},
): Promise<MarketDataBackfillRunReport> {
  const config = await loadResearchConfig();
  const auditYears = defaultAuditYearRange(config);
  const from = request.from ?? defaultFromMonth(config);
  const to = request.to ?? defaultPreviousCompleteMonth();
  const includeStaged = request.includeStaged ?? true;
  const download = request.download ?? true;
  const runAudit = request.runAudit ?? true;
  const hasInstrumentOverride = Boolean(request.instruments?.length);
  const activeInstruments = (request.instruments?.length ? request.instruments : config.study.instruments)
    .map((instrument) => instrument.trim().toUpperCase())
    .filter(Boolean);
  const reportsDir = resolveReportsDir(request.reportsDir);

  const before = await buildTradingMarketDataBackfillPlan({
    config,
    instruments: activeInstruments,
    from,
    to,
    includeStaged,
  });
  const supportedInstruments = collectSupportedSyncInstruments(before.entries);
  let syncResult: TradingOfficialSyncResult | null = null;
  let syncSummary: Awaited<ReturnType<typeof summarizeSyncResult>> | null = null;
  let activeResult: ActiveMarketDataSyncEntry[] = [];
  let stagedResult: StagedMarketDataSyncEntry[] = [];

  if (download && supportedInstruments.length > 0) {
    syncResult = await syncOfficialHistoricalArchives({
      instruments: supportedInstruments,
      from,
      to,
      force: request.force,
    });
    syncSummary = await summarizeSyncResult(syncResult);
  }

  if (download) {
    activeResult = await syncActiveTwelveDataEntries({
      entries: before.entries,
      force: request.force,
    });
  }

  if (download) {
    stagedResult = await syncStagedDownloadableEntries({
      entries: before.entries,
      force: request.force,
    });
  }

  const after = await buildTradingMarketDataBackfillPlan({
    config,
    instruments: activeInstruments,
    from,
    to,
    includeStaged,
  });

  const auditFromYear = request.auditFromYear ?? auditYears.fromYear;
  const auditToYear = request.auditToYear ?? auditYears.toYear;
  let coverageAuditPath: string | null = null;
  let coverageFailures: number | null = null;
  let coverageSummaryByInstrument: Record<string, unknown> | null = null;

  if (runAudit) {
    const auditReport = await runTradingHistoricalCoverageAudit({
      periods: buildYearlyPeriods(auditFromYear, auditToYear),
      instruments: activeInstruments,
      timeframes: config.study.timeframes,
      continueOnError: true,
      sourcePreference: "local_only",
    });
    coverageAuditPath = await writeTradingHistoricalCoverageAuditReport({
      report: auditReport,
      outputPath:
        request.coverageAuditPath
        ?? (
          hasInstrumentOverride
            ? path.join(reportsDir, `coverage-audit-scoped-${activeInstruments.join("-").toLowerCase()}-${auditFromYear}-${auditToYear}.json`)
            : config.paths.coverageAuditPath
        )
        ?? "artifacts/trading-backtests/trading-coverage-audit-local-2019-2025.json",
    });
    coverageFailures = auditReport.summary.failures.length;
    coverageSummaryByInstrument = auditReport.summary.byInstrument;
  }

  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(reportsDir, "market-data-backfill-latest.json");
  const markdownPath = path.join(reportsDir, "market-data-backfill-latest.md");
  const timestampedJsonPath = path.join(reportsDir, `market-data-backfill-${stamp}.json`);

  const report: MarketDataBackfillRunReport = {
    ok: true,
    generatedAt,
    request: {
      instruments: activeInstruments,
      from,
      to,
      includeStaged,
      download,
      force: Boolean(request.force),
      runAudit,
      auditFromYear,
      auditToYear,
    },
    before,
    after,
    sync: {
      attempted: download && supportedInstruments.length > 0,
      supportedInstruments,
      result: syncResult,
      summary: syncSummary,
      activeAttempted: download,
      activeResult,
      activeSummary: summarizeActiveSync(activeResult),
      stagedAttempted: download,
      stagedResult,
      stagedSummary: summarizeStagedSync(stagedResult),
    },
    coverageAudit: {
      attempted: runAudit,
      outputPath: coverageAuditPath,
      failures: coverageFailures,
      summaryByInstrument: coverageSummaryByInstrument,
    },
    outputs: {
      jsonPath,
      markdownPath,
    },
  };

  await mkdir(reportsDir, { recursive: true });
  await writeJsonAtomic(jsonPath, report);
  await writeJsonAtomic(timestampedJsonPath, report);
  await writeBackfillMarkdown(report, markdownPath);

  return report;
}
