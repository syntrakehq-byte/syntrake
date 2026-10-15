import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { TradingCandleInput, TradingTimeframe } from "@/lib/trading/data";
import {
  fetchTwelveDataEarliestAvailableTimestamp,
  fetchTwelveDataHistoricalRange,
  TwelveDataAccessRestrictedError,
} from "@/lib/trading/backtest/twelveDataHistorical";

import { ensureDirectory, readJsonIfExists, sanitizeFileSegment, writeJsonAtomic } from "./fs";
import {
  type TwelveDataUniverseEndpoint,
  type TwelveDataUniverseEntry,
} from "./twelveDataUniverseCatalog";
import {
  TWELVEDATA_ARCHIVE_TIMEFRAMES,
  TWELVEDATA_FULL_HISTORY_FROM_YEAR,
} from "./twelveDataFullArchive";

export type TwelveDataUniverseArchiveStatus =
  | "downloaded"
  | "existing"
  | "missing_remote"
  | "restricted_remote_access";

export type TwelveDataUniverseArchiveSyncEntry = {
  endpoint: TwelveDataUniverseEndpoint;
  symbol: string;
  exchange: string | null;
  micCode: string | null;
  timeframe: TradingTimeframe;
  year: number;
  targetPath: string;
  status: TwelveDataUniverseArchiveStatus;
  candleCount: number;
  error: string | null;
};

export type TwelveDataUniverseArchiveReport = {
  reportId: string;
  generatedAt: string;
  progress: {
    startedAt: string;
    completedAt: string | null;
    totalEntries: number;
    completedEntries: number;
    activeEntry: string | null;
  };
  scope: {
    endpoints: TwelveDataUniverseEndpoint[];
    timeframes: TradingTimeframe[];
    fromYear: number;
    toYear: number;
    limitSymbols: number | null;
    offsetSymbols: number;
    download: boolean;
    force: boolean;
  };
  storage: {
    archiveRoot: string;
    reportsDir: string;
    universeCatalogPath: string;
    cursorPath: string;
  };
  summary: {
    symbols: number;
    entriesPlanned: number;
    downloaded: number;
    existing: number;
    missingRemote: number;
    restricted: number;
    failed: number;
  };
  outputs: {
    jsonPath: string;
    markdownPath: string;
  };
  sync: TwelveDataUniverseArchiveSyncEntry[];
};

type TwelveDataUniverseArchiveRequest = {
  endpoints?: TwelveDataUniverseEndpoint[];
  symbols?: string[];
  timeframes?: TradingTimeframe[];
  fromYear?: number | null;
  toYear?: number | null;
  limitSymbols?: number | null;
  offsetSymbols?: number | null;
  download?: boolean;
  force?: boolean;
  archiveRoot?: string | null;
  reportsDir?: string | null;
  catalogPath?: string | null;
  cursorPath?: string | null;
};

type UniverseCatalogPayload = {
  entries?: TwelveDataUniverseEntry[];
};

type UniverseSyncPlanEntry = {
  entry: TwelveDataUniverseEntry;
  timeframe: TradingTimeframe;
  year: number;
};

function resolveArchiveRoot(customRoot?: string | null): string {
  const configured = customRoot?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "data", "historical-twelvedata-universe");
}

function resolveReportsDir(customDir?: string | null): string {
  const configured = customDir?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "artifacts", "trading-research", "reports", "datasets");
}

function resolveCatalogPath(customPath?: string | null): string {
  const configured = customPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "artifacts", "trading-research", "reports", "datasets", "twelvedata-universe-latest.json");
}

function resolveCursorPath(customPath: string | null | undefined, reportsDir: string): string {
  const configured = customPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(reportsDir, "twelvedata-universe-archive-cursor.json");
}

function normalizeSymbolForDir(symbol: string): string {
  return sanitizeFileSegment(symbol.replace(/\//g, "-").toLowerCase());
}

function normalizeSymbolForFile(symbol: string): string {
  return sanitizeFileSegment(symbol.replace(/\//g, "-").toUpperCase());
}

function normalizeExchangeForDir(exchange: string | null, micCode: string | null): string | null {
  const value = micCode?.trim() || exchange?.trim() || null;
  if (!value) {
    return null;
  }
  return sanitizeFileSegment(value.replace(/\//g, "-").toLowerCase());
}

function normalizeExchangeForFile(exchange: string | null, micCode: string | null): string | null {
  const value = micCode?.trim() || exchange?.trim() || null;
  if (!value) {
    return null;
  }
  return sanitizeFileSegment(value.replace(/\//g, "-").toUpperCase());
}

function buildUniverseEntryKey(entry: {
  endpoint: TwelveDataUniverseEndpoint;
  symbol: string;
  exchange: string | null;
  micCode: string | null;
}): string {
  return [
    entry.endpoint,
    entry.symbol.trim().toUpperCase(),
    entry.micCode?.trim().toUpperCase() ?? "",
    entry.exchange?.trim().toUpperCase() ?? "",
  ].join("::");
}

function normalizeTimeframes(timeframes?: TradingTimeframe[]): TradingTimeframe[] {
  const values = (timeframes ?? TWELVEDATA_ARCHIVE_TIMEFRAMES).filter((value) =>
    TWELVEDATA_ARCHIVE_TIMEFRAMES.includes(value),
  );
  return Array.from(new Set(values));
}

async function loadUniverseEntries(catalogPath: string): Promise<TwelveDataUniverseEntry[]> {
  const payload = await readJsonIfExists<UniverseCatalogPayload>(catalogPath);
  if (!payload?.entries || !Array.isArray(payload.entries)) {
    throw new Error(`Universe catalog missing or invalid: ${catalogPath}`);
  }
  return payload.entries;
}

function selectUniverseEntries(args: {
  entries: TwelveDataUniverseEntry[];
  endpoints?: TwelveDataUniverseEndpoint[];
  symbols?: string[];
  offsetSymbols: number;
  limitSymbols: number | null;
}): TwelveDataUniverseEntry[] {
  const endpointSet = new Set(args.endpoints ?? []);
  const symbolSet = new Set((args.symbols ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean));

  let selected = args.entries.filter((entry) => {
    if (endpointSet.size > 0 && !endpointSet.has(entry.endpoint)) {
      return false;
    }
    if (symbolSet.size > 0 && !symbolSet.has(entry.symbol.trim().toUpperCase())) {
      return false;
    }
    return true;
  });

  selected = selected
    .slice(args.offsetSymbols)
    .slice(0, args.limitSymbols ?? selected.length);

  return selected;
}

async function detectAvailability(args: {
  entry: TwelveDataUniverseEntry;
  timeframe: TradingTimeframe;
}): Promise<{
  earliestAvailableAt: string | null;
  restrictionReason: string | null;
}> {
  try {
    return {
      earliestAvailableAt: await fetchTwelveDataEarliestAvailableTimestamp({
        symbol: args.entry.symbol,
        micCode: args.entry.micCode,
        timeframe: args.timeframe,
      }),
      restrictionReason: null,
    };
  } catch (error) {
    if (error instanceof TwelveDataAccessRestrictedError) {
      return {
        earliestAvailableAt: null,
        restrictionReason: error.message,
      };
    }
    throw error;
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, "utf8");
    return true;
  } catch {
    return false;
  }
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

function buildTargetPath(args: {
  archiveRoot: string;
  entry: Pick<TwelveDataUniverseEntry, "endpoint" | "symbol" | "exchange" | "micCode">;
  timeframe: TradingTimeframe;
  year: number;
}): string {
  const exchangeDir = normalizeExchangeForDir(args.entry.exchange, args.entry.micCode);
  const exchangeFile = normalizeExchangeForFile(args.entry.exchange, args.entry.micCode);
  const directoryParts = [
    args.archiveRoot,
    args.entry.endpoint,
    ...(exchangeDir ? [exchangeDir] : []),
    normalizeSymbolForDir(args.entry.symbol),
    args.timeframe,
  ];
  const fileName = exchangeFile
    ? `${normalizeSymbolForFile(args.entry.symbol)}-${exchangeFile}-${args.timeframe}-${args.year}.csv`
    : `${normalizeSymbolForFile(args.entry.symbol)}-${args.timeframe}-${args.year}.csv`;

  return path.join(...directoryParts, fileName);
}

async function syncYear(args: {
  archiveRoot: string;
  entry: TwelveDataUniverseEntry;
  timeframe: TradingTimeframe;
  year: number;
  force: boolean;
}): Promise<TwelveDataUniverseArchiveSyncEntry> {
  const targetPath = buildTargetPath(args);

  if (!args.force && await fileExists(targetPath)) {
    return {
      endpoint: args.entry.endpoint,
      symbol: args.entry.symbol,
      exchange: args.entry.exchange,
      micCode: args.entry.micCode,
      timeframe: args.timeframe,
      year: args.year,
      targetPath,
      status: "existing",
      candleCount: 0,
      error: null,
    };
  }

  try {
    const candles = await fetchTwelveDataHistoricalRange({
      symbol: args.entry.symbol,
      micCode: args.entry.micCode,
      timeframe: args.timeframe,
      from: `${args.year}-01-01T00:00:00.000Z`,
      to: `${args.year}-12-31T23:59:59.000Z`,
    });

    if (candles.length === 0) {
      return {
        endpoint: args.entry.endpoint,
        symbol: args.entry.symbol,
        exchange: args.entry.exchange,
        micCode: args.entry.micCode,
        timeframe: args.timeframe,
        year: args.year,
        targetPath,
        status: "missing_remote",
        candleCount: 0,
        error: null,
      };
    }

    await ensureDirectory(path.dirname(targetPath));
    await writeFile(targetPath, renderGenericArchiveCsv(candles), "utf8");

    return {
      endpoint: args.entry.endpoint,
      symbol: args.entry.symbol,
      exchange: args.entry.exchange,
      micCode: args.entry.micCode,
      timeframe: args.timeframe,
      year: args.year,
      targetPath,
      status: "downloaded",
      candleCount: candles.length,
      error: null,
    };
  } catch (error) {
    if (error instanceof TwelveDataAccessRestrictedError) {
      return {
        endpoint: args.entry.endpoint,
        symbol: args.entry.symbol,
        exchange: args.entry.exchange,
        micCode: args.entry.micCode,
        timeframe: args.timeframe,
        year: args.year,
        targetPath,
        status: "restricted_remote_access",
        candleCount: 0,
        error: error.message,
      };
    }
    throw error;
  }
}

function buildReport(args: {
  generatedAt: string;
  startedAt: string;
  completedAt: string | null;
  activeEntry: string | null;
  totalEntries: number;
  selectedEntries: TwelveDataUniverseEntry[];
  scope: TwelveDataUniverseArchiveReport["scope"];
  storage: TwelveDataUniverseArchiveReport["storage"];
  outputs: TwelveDataUniverseArchiveReport["outputs"];
  sync: TwelveDataUniverseArchiveSyncEntry[];
}): TwelveDataUniverseArchiveReport {
  return {
    reportId: `twelvedata-universe-archive-${args.generatedAt}`,
    generatedAt: args.generatedAt,
    progress: {
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      totalEntries: args.totalEntries,
      completedEntries: args.sync.length,
      activeEntry: args.activeEntry,
    },
    scope: args.scope,
    storage: args.storage,
    summary: {
      symbols: args.selectedEntries.length,
      entriesPlanned: args.totalEntries,
      downloaded: args.sync.filter((entry) => entry.status === "downloaded").length,
      existing: args.sync.filter((entry) => entry.status === "existing").length,
      missingRemote: args.sync.filter((entry) => entry.status === "missing_remote").length,
      restricted: args.sync.filter((entry) => entry.status === "restricted_remote_access").length,
      failed: args.sync.filter((entry) => entry.error !== null).length,
    },
    outputs: args.outputs,
    sync: args.sync,
  };
}

function renderMarkdown(report: TwelveDataUniverseArchiveReport): string {
  const lines = [
    "# Twelve Data Universe Archive",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Started at: ${report.progress.startedAt}`,
    `- Completed at: ${report.progress.completedAt ?? "running"}`,
    `- Sync progress: ${report.progress.completedEntries}/${report.progress.totalEntries}`,
    `- Active entry: ${report.progress.activeEntry ?? "idle"}`,
    `- Archive root: ${report.storage.archiveRoot}`,
    `- Endpoints: ${report.scope.endpoints.join(", ") || "all"}`,
    `- Timeframes: ${report.scope.timeframes.join(", ")}`,
    `- Year range: ${report.scope.fromYear} -> ${report.scope.toYear}`,
    `- Limit symbols: ${report.scope.limitSymbols ?? "all"}`,
    `- Offset symbols: ${report.scope.offsetSymbols}`,
    "",
    "## Summary",
    `- Symbols: ${report.summary.symbols}`,
    `- Planned entries: ${report.summary.entriesPlanned}`,
    `- Downloaded: ${report.summary.downloaded}`,
    `- Existing: ${report.summary.existing}`,
    `- Missing remote: ${report.summary.missingRemote}`,
    `- Restricted: ${report.summary.restricted}`,
    "",
    "## Sync",
  ];

  for (const entry of report.sync.slice(-400)) {
    lines.push(
      `- ${entry.endpoint} ${entry.symbol}${entry.exchange ? ` [${entry.exchange}]` : ""} ${entry.timeframe} ${entry.year}: ${entry.status} candles=${entry.candleCount}${entry.error ? ` error=${entry.error}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function persistReport(args: {
  report: TwelveDataUniverseArchiveReport;
  jsonPath: string;
  markdownPath: string;
  cursorPath: string;
}): Promise<void> {
  await writeJsonAtomic(args.jsonPath, args.report);
  await writeFile(args.markdownPath, renderMarkdown(args.report), "utf8");
  await writeJsonAtomic(args.cursorPath, {
    generatedAt: args.report.generatedAt,
    progress: args.report.progress,
    summary: args.report.summary,
  });
}

function buildPlan(args: {
  entries: TwelveDataUniverseEntry[];
  timeframes: TradingTimeframe[];
  fromYear: number;
  toYear: number;
  availability: Map<string, { earliestAvailableAt: string | null; restrictionReason: string | null }>;
}): UniverseSyncPlanEntry[] {
  const plan: UniverseSyncPlanEntry[] = [];

  for (const entry of args.entries) {
    for (const timeframe of args.timeframes) {
      const key = `${buildUniverseEntryKey(entry)}::${timeframe}`;
      const availability = args.availability.get(key);
      if (!availability?.earliestAvailableAt || availability.restrictionReason) {
        continue;
      }

      const earliestYear = new Date(availability.earliestAvailableAt).getUTCFullYear();
      const startYear = Math.max(args.fromYear, earliestYear);
      for (let year = startYear; year <= args.toYear; year += 1) {
        plan.push({
          entry,
          timeframe,
          year,
        });
      }
    }
  }

  return plan;
}

export async function runTwelveDataUniverseArchive(
  request: TwelveDataUniverseArchiveRequest = {},
): Promise<TwelveDataUniverseArchiveReport> {
  const startedAt = new Date().toISOString();
  const archiveRoot = resolveArchiveRoot(request.archiveRoot);
  const reportsDir = resolveReportsDir(request.reportsDir);
  const catalogPath = resolveCatalogPath(request.catalogPath);
  const cursorPath = resolveCursorPath(request.cursorPath, reportsDir);
  const timeframes = normalizeTimeframes(request.timeframes);
  const fromYear = request.fromYear ?? TWELVEDATA_FULL_HISTORY_FROM_YEAR;
  const toYear = request.toYear ?? new Date().getUTCFullYear();
  const offsetSymbols = Math.max(0, request.offsetSymbols ?? 0);
  const limitSymbols = request.limitSymbols ?? null;
  const download = request.download ?? true;
  const force = Boolean(request.force);
  const jsonPath = path.join(reportsDir, "twelvedata-universe-archive-latest.json");
  const markdownPath = path.join(reportsDir, "twelvedata-universe-archive-latest.md");

  await mkdir(reportsDir, { recursive: true });
  const allEntries = await loadUniverseEntries(catalogPath);
  const selectedEntries = selectUniverseEntries({
    entries: allEntries,
    endpoints: request.endpoints,
    symbols: request.symbols,
    offsetSymbols,
    limitSymbols,
  });

  const availability = new Map<string, { earliestAvailableAt: string | null; restrictionReason: string | null }>();
  for (const entry of selectedEntries) {
    for (const timeframe of timeframes) {
      const key = `${buildUniverseEntryKey(entry)}::${timeframe}`;
      availability.set(
        key,
        await detectAvailability({
          entry,
          timeframe,
        }),
      );
    }
  }

  const plan = buildPlan({
    entries: selectedEntries,
    timeframes,
    fromYear,
    toYear,
    availability,
  });

  const storage = {
    archiveRoot,
    reportsDir,
    universeCatalogPath: catalogPath,
    cursorPath,
  };
  const scope: TwelveDataUniverseArchiveReport["scope"] = {
    endpoints: request.endpoints ?? [],
    timeframes,
    fromYear,
    toYear,
    limitSymbols,
    offsetSymbols,
    download,
    force,
  };
  const outputs = {
    jsonPath,
    markdownPath,
  };
  const sync: TwelveDataUniverseArchiveSyncEntry[] = [];

  await persistReport({
    report: buildReport({
      generatedAt: startedAt,
      startedAt,
      completedAt: null,
      activeEntry: null,
      totalEntries: plan.length,
      selectedEntries,
      scope,
      storage,
      outputs,
      sync,
    }),
    jsonPath,
    markdownPath,
    cursorPath,
  });

  if (download) {
    let index = 0;
    for (const entry of plan) {
      index += 1;
      const activeEntry = `${entry.entry.endpoint} ${entry.entry.symbol}${entry.entry.exchange ? ` [${entry.entry.exchange}]` : ""} ${entry.timeframe} ${entry.year} (${index}/${plan.length})`;
      console.log(`[twelvedata-universe-archive] starting ${activeEntry}`);
      const result = await syncYear({
        archiveRoot,
        entry: entry.entry,
        timeframe: entry.timeframe,
        year: entry.year,
        force,
      });
      sync.push(result);
      console.log(
        `[twelvedata-universe-archive] finished ${entry.entry.endpoint} ${entry.entry.symbol}${entry.entry.exchange ? ` [${entry.entry.exchange}]` : ""} ${entry.timeframe} ${entry.year}: ${result.status} candles=${result.candleCount}${result.error ? ` error=${result.error}` : ""}`,
      );

      await persistReport({
        report: buildReport({
          generatedAt: new Date().toISOString(),
          startedAt,
          completedAt: null,
          activeEntry,
          totalEntries: plan.length,
          selectedEntries,
          scope,
          storage,
          outputs,
          sync,
        }),
        jsonPath,
        markdownPath,
        cursorPath,
      });
    }
  }

  const report = buildReport({
    generatedAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    activeEntry: null,
    totalEntries: plan.length,
    selectedEntries,
    scope,
    storage,
    outputs,
    sync,
  });

  await persistReport({
    report,
    jsonPath,
    markdownPath,
    cursorPath,
  });

  return report;
}
