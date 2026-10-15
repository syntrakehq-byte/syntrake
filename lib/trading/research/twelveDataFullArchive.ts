import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TradingCandleInput, TradingTimeframe } from "@/lib/trading/data";
import {
  TRADING_BACKTEST_BASE_INSTRUMENTS,
  TRADING_BACKTEST_RESEARCH_EXPANSION_INSTRUMENTS,
  type TradingHistoricalInstrumentConfig,
} from "@/lib/trading/backtest/datasets";
import {
  fetchTwelveDataEarliestAvailableTimestamp,
  fetchTwelveDataHistoricalRange,
  TwelveDataAccessRestrictedError,
} from "@/lib/trading/backtest/twelveDataHistorical";

import { ensureDirectory, writeJsonAtomic } from "./fs";

export const TWELVEDATA_ARCHIVE_TIMEFRAMES: TradingTimeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
export const TWELVEDATA_FULL_HISTORY_FROM_YEAR = 1980;

export type TwelveDataArchiveSyncStatus =
  | "downloaded"
  | "existing"
  | "missing_remote"
  | "restricted_remote_access";

export type TwelveDataArchiveTimeframeAudit = {
  timeframe: TradingTimeframe;
  earliestAvailableAt: string | null;
  earliestAvailableYear: number | null;
  localArchiveFiles: number;
  localArchiveYears: number[];
  targetFromYear: number | null;
  targetToYear: number | null;
  pendingYears: number[];
  restrictionReason: string | null;
  note: string | null;
};

export type TwelveDataArchiveInstrumentAudit = {
  instrument: string;
  market: TradingHistoricalInstrumentConfig["marketType"];
  providerSymbol: string | null;
  providerRelation: "direct" | "proxy" | null;
  localArchiveFiles: number;
  pendingYears: number;
  availableTimeframes: number;
  restrictedTimeframes: number;
  missingRemoteTimeframes: number;
  timeframes: TwelveDataArchiveTimeframeAudit[];
};

export type TwelveDataArchiveSyncEntry = {
  instrument: string;
  market: TradingHistoricalInstrumentConfig["marketType"];
  timeframe: TradingTimeframe;
  providerSymbol: string | null;
  providerRelation: "direct" | "proxy" | null;
  targetPath: string;
  periodLabel: string;
  status: TwelveDataArchiveSyncStatus;
  candleCount: number;
  error: string | null;
};

export type TwelveDataArchiveReport = {
  reportId: string;
  generatedAt: string;
  progress: {
    startedAt: string;
    completedAt: string | null;
    totalSyncEntries: number;
    completedSyncEntries: number;
    activeEntry: string | null;
  };
  scope: {
    instruments: string[];
    markets: string[];
    timeframes: TradingTimeframe[];
    fullHistory: boolean;
    targetFromYear: number | null;
    targetToYear: number;
    download: boolean;
    force: boolean;
  };
  storage: {
    archiveRoot: string;
    reportsDir: string;
  };
  summary: {
    instruments: number;
    timeframes: number;
    scopeEntries: number;
    available: number;
    restricted: number;
    missingRemote: number;
    localArchiveFiles: number;
    pendingYears: number;
    downloaded: number;
    existing: number;
    failed: number;
  };
  instruments: TwelveDataArchiveInstrumentAudit[];
  sync: TwelveDataArchiveSyncEntry[];
  outputs: {
    jsonPath: string;
    markdownPath: string;
  };
};

type TwelveDataArchiveRequest = {
  instruments?: string[];
  markets?: string[];
  timeframes?: TradingTimeframe[];
  fromYear?: number | null;
  toYear?: number | null;
  download?: boolean;
  force?: boolean;
  fullHistory?: boolean;
  reportsDir?: string | null;
  archiveRoot?: string | null;
};

type TwelveDataArchiveSyncPlanEntry = {
  instrument: string;
  timeframe: TradingTimeframe;
  year: number;
};

function resolveArchiveRoot(customRoot?: string | null): string {
  const configured = customRoot?.trim() || process.env.TRADING_TWELVEDATA_ARCHIVE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "data", "historical-twelvedata");
}

function resolveReportsDir(customDir?: string | null): string {
  const configured = customDir?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "artifacts", "trading-research", "reports", "datasets");
}

function allTwelveDataInstruments(): TradingHistoricalInstrumentConfig[] {
  return [
    ...TRADING_BACKTEST_BASE_INSTRUMENTS,
    ...TRADING_BACKTEST_RESEARCH_EXPANSION_INSTRUMENTS,
  ].filter((entry) => entry.source === "twelvedata");
}

function normalizeMarkets(markets?: string[]): string[] {
  return (markets ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function selectInstruments(request: TwelveDataArchiveRequest): TradingHistoricalInstrumentConfig[] {
  const wantedInstruments = new Set((request.instruments ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean));
  const wantedMarkets = new Set(normalizeMarkets(request.markets));

  return allTwelveDataInstruments().filter((entry) => {
    if (wantedInstruments.size > 0 && !wantedInstruments.has(entry.instrument)) {
      return false;
    }
    if (wantedMarkets.size > 0 && !wantedMarkets.has(entry.marketType)) {
      return false;
    }
    return true;
  });
}

function normalizeTimeframes(timeframes?: TradingTimeframe[]): TradingTimeframe[] {
  const values = (timeframes ?? TWELVEDATA_ARCHIVE_TIMEFRAMES).filter((value) =>
    TWELVEDATA_ARCHIVE_TIMEFRAMES.includes(value),
  );
  return Array.from(new Set(values));
}

function resolveFromYearOverride(request: TwelveDataArchiveRequest): number | null {
  if (Number.isInteger(request.fromYear)) {
    return request.fromYear ?? null;
  }

  if (request.fullHistory) {
    return TWELVEDATA_FULL_HISTORY_FROM_YEAR;
  }

  return null;
}

function buildInstrumentArchiveDir(
  root: string,
  config: TradingHistoricalInstrumentConfig,
  timeframe: TradingTimeframe,
): string {
  return path.join(root, config.marketType, config.instrument.toLowerCase(), timeframe);
}

function buildInstrumentArchivePath(
  root: string,
  config: TradingHistoricalInstrumentConfig,
  timeframe: TradingTimeframe,
  year: number,
): string {
  return path.join(buildInstrumentArchiveDir(root, config, timeframe), `${config.instrument}-${timeframe}-${year}.csv`);
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readInstrumentArchiveYears(
  root: string,
  config: TradingHistoricalInstrumentConfig,
  timeframe: TradingTimeframe,
): Promise<number[]> {
  const dir = buildInstrumentArchiveDir(root, config, timeframe);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  return names
    .map((name) => {
      const match = new RegExp(`^${config.instrument}-${timeframe}-(\\d{4})\\.csv$`, "i").exec(name);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => Number.isInteger(value))
    .sort((left, right) => left - right);
}

function renderGenericArchiveCsv(candles: TradingCandleInput[]): string {
  const lines = ["timestamp,open,high,low,close,volume"];
  for (const candle of candles) {
    lines.push([
      new Date(candle.timestamp).toISOString(),
      String(candle.open),
      String(candle.high),
      String(candle.low),
      String(candle.close),
      candle.volume === null || candle.volume === undefined ? "" : String(candle.volume),
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function loadFirstAvailableSymbol(args: {
  config: TradingHistoricalInstrumentConfig;
  timeframe: TradingTimeframe;
  from: string;
  to: string;
}): Promise<
  | { kind: "loaded"; providerSymbol: string; providerRelation: "direct" | "proxy"; candles: TradingCandleInput[] }
  | { kind: "restricted"; reason: string }
  | { kind: "missing" }
> {
  const restrictions: string[] = [];

  for (const candidate of args.config.dataSymbols) {
    try {
      const candles = await fetchTwelveDataHistoricalRange({
        symbol: candidate.symbol,
        timeframe: args.timeframe,
        from: args.from,
        to: args.to,
      });

      if (candles.length > 0) {
        return {
          kind: "loaded",
          providerSymbol: candidate.symbol,
          providerRelation: candidate.relation,
          candles,
        };
      }
    } catch (error) {
      if (error instanceof TwelveDataAccessRestrictedError) {
        restrictions.push(`${candidate.symbol}: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  if (restrictions.length > 0) {
    return { kind: "restricted", reason: restrictions.join(" | ") };
  }

  return { kind: "missing" };
}

async function detectAvailability(args: {
  config: TradingHistoricalInstrumentConfig;
  timeframe: TradingTimeframe;
}): Promise<{
  providerSymbol: string | null;
  providerRelation: "direct" | "proxy" | null;
  earliestAvailableAt: string | null;
  restrictionReason: string | null;
}> {
  const restrictions: string[] = [];

  for (const candidate of args.config.dataSymbols) {
    try {
      const earliest = await fetchTwelveDataEarliestAvailableTimestamp({
        symbol: candidate.symbol,
        timeframe: args.timeframe,
      });
      if (earliest) {
        return {
          providerSymbol: candidate.symbol,
          providerRelation: candidate.relation,
          earliestAvailableAt: earliest,
          restrictionReason: null,
        };
      }
    } catch (error) {
      if (error instanceof TwelveDataAccessRestrictedError) {
        restrictions.push(`${candidate.symbol}: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  return {
    providerSymbol: args.config.dataSymbols[0]?.symbol ?? null,
    providerRelation: args.config.dataSymbols[0]?.relation ?? null,
    earliestAvailableAt: null,
    restrictionReason: restrictions.length > 0 ? restrictions.join(" | ") : null,
  };
}

async function buildTimeframeAudit(args: {
  config: TradingHistoricalInstrumentConfig;
  archiveRoot: string;
  timeframe: TradingTimeframe;
  fromYearOverride: number | null;
  toYear: number;
}): Promise<TwelveDataArchiveTimeframeAudit> {
  const availability = await detectAvailability({
    config: args.config,
    timeframe: args.timeframe,
  });
  const localArchiveYears = await readInstrumentArchiveYears(args.archiveRoot, args.config, args.timeframe);
  const earliestYear = availability.earliestAvailableAt ? new Date(availability.earliestAvailableAt).getUTCFullYear() : null;
  const targetFromYear = earliestYear === null
    ? null
    : Math.max(earliestYear, args.fromYearOverride ?? earliestYear);
  const targetToYear = targetFromYear === null ? null : args.toYear;
  const pendingYears = targetFromYear === null || targetToYear === null
    ? []
    : Array.from({ length: Math.max(0, targetToYear - targetFromYear + 1) }, (_, index) => targetFromYear + index)
        .filter((year) => !localArchiveYears.includes(year));

  return {
    timeframe: args.timeframe,
    earliestAvailableAt: availability.earliestAvailableAt,
    earliestAvailableYear: earliestYear,
    localArchiveFiles: localArchiveYears.length,
    localArchiveYears,
    targetFromYear,
    targetToYear,
    pendingYears,
    restrictionReason: availability.restrictionReason,
    note: availability.restrictionReason
      ? "Provider access is restricted or ambiguous for the configured symbol set."
      : pendingYears.length === 0
        ? "Local Twelve Data archive is already complete for the requested yearly range."
        : args.fromYearOverride === TWELVEDATA_FULL_HISTORY_FROM_YEAR
          ? "Pending years represent the maximum provider history available from the 1980 full-history baseline down to the real earliest timestamp for this timeframe."
          : "Pending years can be downloaded into the dedicated Twelve Data archive root without touching the canonical archive.",
  };
}

async function buildInstrumentAudit(args: {
  config: TradingHistoricalInstrumentConfig;
  archiveRoot: string;
  timeframes: TradingTimeframe[];
  fromYearOverride: number | null;
  toYear: number;
}): Promise<TwelveDataArchiveInstrumentAudit> {
  const timeframes = await Promise.all(
    args.timeframes.map((timeframe) =>
      buildTimeframeAudit({
        config: args.config,
        archiveRoot: args.archiveRoot,
        timeframe,
        fromYearOverride: args.fromYearOverride,
        toYear: args.toYear,
      }),
    ),
  );

  const firstProvider = args.config.dataSymbols[0] ?? null;

  return {
    instrument: args.config.instrument,
    market: args.config.marketType,
    providerSymbol: firstProvider?.symbol ?? null,
    providerRelation: firstProvider?.relation ?? null,
    localArchiveFiles: timeframes.reduce((sum, entry) => sum + entry.localArchiveFiles, 0),
    pendingYears: timeframes.reduce((sum, entry) => sum + entry.pendingYears.length, 0),
    availableTimeframes: timeframes.filter((entry) => entry.earliestAvailableAt).length,
    restrictedTimeframes: timeframes.filter((entry) => entry.restrictionReason).length,
    missingRemoteTimeframes: timeframes.filter((entry) => !entry.earliestAvailableAt && !entry.restrictionReason).length,
    timeframes,
  };
}

async function syncArchiveYear(args: {
  config: TradingHistoricalInstrumentConfig;
  archiveRoot: string;
  timeframe: TradingTimeframe;
  year: number;
  force: boolean;
}): Promise<TwelveDataArchiveSyncEntry> {
  const targetPath = buildInstrumentArchivePath(args.archiveRoot, args.config, args.timeframe, args.year);
  if (!args.force && await fileExists(targetPath)) {
    return {
      instrument: args.config.instrument,
      market: args.config.marketType,
      timeframe: args.timeframe,
      providerSymbol: null,
      providerRelation: null,
      targetPath,
      periodLabel: String(args.year),
      status: "existing",
      candleCount: 0,
      error: null,
    };
  }

  const loaded = await loadFirstAvailableSymbol({
    config: args.config,
    timeframe: args.timeframe,
    from: `${args.year}-01-01T00:00:00.000Z`,
    to: `${args.year}-12-31T23:59:59.000Z`,
  });

  if (loaded.kind === "restricted") {
    return {
      instrument: args.config.instrument,
      market: args.config.marketType,
      timeframe: args.timeframe,
      providerSymbol: args.config.dataSymbols[0]?.symbol ?? null,
      providerRelation: args.config.dataSymbols[0]?.relation ?? null,
      targetPath,
      periodLabel: String(args.year),
      status: "restricted_remote_access",
      candleCount: 0,
      error: loaded.reason,
    };
  }

  if (loaded.kind === "missing") {
    return {
      instrument: args.config.instrument,
      market: args.config.marketType,
      timeframe: args.timeframe,
      providerSymbol: null,
      providerRelation: null,
      targetPath,
      periodLabel: String(args.year),
      status: "missing_remote",
      candleCount: 0,
      error: null,
    };
  }

  await ensureDirectory(path.dirname(targetPath));
  await writeFile(targetPath, renderGenericArchiveCsv(loaded.candles), "utf8");

  return {
    instrument: args.config.instrument,
    market: args.config.marketType,
    timeframe: args.timeframe,
    providerSymbol: loaded.providerSymbol,
    providerRelation: loaded.providerRelation,
    targetPath,
    periodLabel: String(args.year),
    status: "downloaded",
    candleCount: loaded.candles.length,
    error: null,
  };
}

function renderMarkdown(report: TwelveDataArchiveReport): string {
  const lines = [
    "# Twelve Data Full Archive",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Started at: ${report.progress.startedAt}`,
    `- Completed at: ${report.progress.completedAt ?? "running"}`,
    `- Sync progress: ${report.progress.completedSyncEntries}/${report.progress.totalSyncEntries}`,
    `- Active entry: ${report.progress.activeEntry ?? "idle"}`,
    `- Archive root: ${report.storage.archiveRoot}`,
    `- Markets: ${report.scope.markets.join(", ") || "all"}`,
    `- Instruments: ${report.scope.instruments.join(", ") || "all"}`,
    `- Timeframes: ${report.scope.timeframes.join(", ")}`,
    `- Full-history mode: ${report.scope.fullHistory ? `enabled (baseline ${TWELVEDATA_FULL_HISTORY_FROM_YEAR})` : "disabled"}`,
    `- Download mode: ${report.scope.download ? "enabled" : "audit_only"}`,
    `- Force overwrite: ${report.scope.force ? "yes" : "no"}`,
    "",
    "## Summary",
    `- Instruments: ${report.summary.instruments}`,
    `- Timeframes: ${report.summary.timeframes}`,
    `- Scope entries: ${report.summary.scopeEntries}`,
    `- Provider available: ${report.summary.available}`,
    `- Restricted: ${report.summary.restricted}`,
    `- Missing remote: ${report.summary.missingRemote}`,
    `- Local archive files: ${report.summary.localArchiveFiles}`,
    `- Pending years: ${report.summary.pendingYears}`,
    `- Downloaded this run: ${report.summary.downloaded}`,
    `- Already existing this run: ${report.summary.existing}`,
    `- Failed this run: ${report.summary.failed}`,
    "",
    "## Instruments",
  ];

  for (const instrument of report.instruments) {
    lines.push(
      `- ${instrument.instrument} (${instrument.market}): files=${instrument.localArchiveFiles} pendingYears=${instrument.pendingYears} availableTf=${instrument.availableTimeframes}/${instrument.timeframes.length}`,
    );
    for (const timeframe of instrument.timeframes) {
      lines.push(
        `  - ${timeframe.timeframe}: earliest=${timeframe.earliestAvailableAt ?? "n/a"} localFiles=${timeframe.localArchiveFiles} pendingYears=${timeframe.pendingYears.length}`,
      );
      if (timeframe.note) {
        lines.push(`    note=${timeframe.note}`);
      }
      if (timeframe.restrictionReason) {
        lines.push(`    restriction=${timeframe.restrictionReason}`);
      }
    }
  }

  if (report.sync.length > 0) {
    lines.push("", "## Sync entries");
    for (const entry of report.sync.slice(0, 400)) {
      lines.push(
        `- ${entry.instrument} ${entry.timeframe} ${entry.periodLabel}: ${entry.status} provider=${entry.providerSymbol ?? "n/a"} candles=${entry.candleCount}${entry.error ? ` error=${entry.error}` : ""}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildSyncPlan(instruments: TwelveDataArchiveInstrumentAudit[]): TwelveDataArchiveSyncPlanEntry[] {
  const plan: TwelveDataArchiveSyncPlanEntry[] = [];

  for (const instrument of instruments) {
    for (const timeframe of instrument.timeframes) {
      for (const year of timeframe.pendingYears) {
        plan.push({
          instrument: instrument.instrument,
          timeframe: timeframe.timeframe,
          year,
        });
      }
    }
  }

  return plan;
}

function buildReport(args: {
  generatedAt: string;
  startedAt: string;
  completedAt: string | null;
  activeEntry: string | null;
  totalSyncEntries: number;
  sync: TwelveDataArchiveSyncEntry[];
  scope: TwelveDataArchiveReport["scope"];
  storage: TwelveDataArchiveReport["storage"];
  instruments: TwelveDataArchiveInstrumentAudit[];
  outputs: TwelveDataArchiveReport["outputs"];
}): TwelveDataArchiveReport {
  const scopeEntries = args.instruments.reduce((sum, entry) => sum + entry.timeframes.length, 0);

  return {
    reportId: `twelvedata-full-archive-${args.generatedAt}`,
    generatedAt: args.generatedAt,
    progress: {
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      totalSyncEntries: args.totalSyncEntries,
      completedSyncEntries: args.sync.length,
      activeEntry: args.activeEntry,
    },
    scope: args.scope,
    storage: args.storage,
    summary: {
      instruments: args.instruments.length,
      timeframes: args.scope.timeframes.length,
      scopeEntries,
      available: args.instruments.reduce((sum, entry) => sum + entry.availableTimeframes, 0),
      restricted: args.instruments.reduce((sum, entry) => sum + entry.restrictedTimeframes, 0),
      missingRemote: args.instruments.reduce((sum, entry) => sum + entry.missingRemoteTimeframes, 0),
      localArchiveFiles: args.instruments.reduce((sum, entry) => sum + entry.localArchiveFiles, 0),
      pendingYears: args.instruments.reduce((sum, entry) => sum + entry.pendingYears, 0),
      downloaded: args.sync.filter((entry) => entry.status === "downloaded").length,
      existing: args.sync.filter((entry) => entry.status === "existing").length,
      failed: args.sync.filter((entry) => entry.status === "restricted_remote_access" || entry.status === "missing_remote").length,
    },
    instruments: args.instruments,
    sync: args.sync,
    outputs: args.outputs,
  };
}

async function persistReport(args: {
  report: TwelveDataArchiveReport;
  jsonPath: string;
  markdownPath: string;
  timestampedJsonPath?: string | null;
}): Promise<void> {
  await writeJsonAtomic(args.jsonPath, args.report);
  if (args.timestampedJsonPath) {
    await writeJsonAtomic(args.timestampedJsonPath, args.report);
  }
  await writeFile(args.markdownPath, renderMarkdown(args.report), "utf8");
}

export async function runTwelveDataFullArchive(request: TwelveDataArchiveRequest = {}): Promise<TwelveDataArchiveReport> {
  const configs = selectInstruments(request);
  const timeframes = normalizeTimeframes(request.timeframes);
  const toYear = request.toYear ?? new Date().getUTCFullYear();
  const fromYearOverride = resolveFromYearOverride(request);
  const archiveRoot = resolveArchiveRoot(request.archiveRoot);
  const reportsDir = resolveReportsDir(request.reportsDir);
  const download = request.download ?? false;
  const force = Boolean(request.force);
  const fullHistory = Boolean(request.fullHistory);
  const startedAt = new Date().toISOString();

  const instruments = await Promise.all(configs.map((config) => buildInstrumentAudit({
    config,
    archiveRoot,
    timeframes,
    fromYearOverride,
    toYear,
  })));

  const syncPlan = buildSyncPlan(instruments);

  const sync: TwelveDataArchiveSyncEntry[] = [];
  const storage = {
    archiveRoot,
    reportsDir,
  };
  const scope: TwelveDataArchiveReport["scope"] = {
    instruments: (request.instruments ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean),
    markets: normalizeMarkets(request.markets),
    timeframes,
    fullHistory,
    targetFromYear: fromYearOverride,
    targetToYear: toYear,
    download,
    force,
  };
  const jsonPath = path.join(reportsDir, "twelvedata-full-archive-latest.json");
  const markdownPath = path.join(reportsDir, "twelvedata-full-archive-latest.md");
  const stamp = startedAt.replace(/[:.]/g, "-");
  const timestampedJsonPath = path.join(reportsDir, `twelvedata-full-archive-${stamp}.json`);

  await mkdir(reportsDir, { recursive: true });
  await persistReport({
    report: buildReport({
      generatedAt: startedAt,
      startedAt,
      completedAt: null,
      activeEntry: null,
      totalSyncEntries: syncPlan.length,
      sync,
      scope,
      storage,
      instruments,
      outputs: {
        jsonPath,
        markdownPath,
      },
    }),
    jsonPath,
    markdownPath,
    timestampedJsonPath,
  });

  if (download) {
    let syncIndex = 0;
    for (const config of configs) {
      const audit = instruments.find((entry) => entry.instrument === config.instrument);
      if (!audit) continue;
      for (const timeframe of audit.timeframes) {
        for (const year of timeframe.pendingYears) {
          syncIndex += 1;
          const activeEntry = `${config.instrument} ${timeframe.timeframe} ${year} (${syncIndex}/${syncPlan.length})`;
          console.log(`[twelvedata-full-archive] starting ${activeEntry}`);
          const result = await syncArchiveYear({
            config,
            archiveRoot,
            timeframe: timeframe.timeframe,
            year,
            force,
          });
          sync.push(result);
          console.log(
            `[twelvedata-full-archive] finished ${config.instrument} ${timeframe.timeframe} ${year}: ${result.status} candles=${result.candleCount}${result.error ? ` error=${result.error}` : ""}`,
          );
          await persistReport({
            report: buildReport({
              generatedAt: new Date().toISOString(),
              startedAt,
              completedAt: null,
              activeEntry,
              totalSyncEntries: syncPlan.length,
              sync,
              scope,
              storage,
              instruments,
              outputs: {
                jsonPath,
                markdownPath,
              },
            }),
            jsonPath,
            markdownPath,
            timestampedJsonPath: null,
          });
        }
      }
    }
  }

  const report = buildReport({
    generatedAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    activeEntry: null,
    totalSyncEntries: syncPlan.length,
    sync,
    scope,
    storage,
    instruments,
    outputs: {
      jsonPath,
      markdownPath,
    },
  });

  await persistReport({
    report,
    jsonPath,
    markdownPath,
    timestampedJsonPath,
  });

  return report;
}
