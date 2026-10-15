import {
  loadResearchConfig,
  runTwelveDataFullArchive,
  TWELVEDATA_ARCHIVE_TIMEFRAMES,
  TWELVEDATA_FULL_HISTORY_FROM_YEAR,
} from "../../lib/trading/research/index";
import type { TradingMarketType, TradingTimeframe } from "../../lib/trading/data";

function parseCsvFlag(argv: string[], names: string[]): string[] | undefined {
  const raw = argv.find((arg) => names.some((name) => arg.startsWith(`${name}=`)));
  if (!raw) return undefined;
  const index = raw.indexOf("=");
  if (index < 0) return undefined;
  return raw
    .slice(index + 1)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseNumberFlag(argv: string[], name: string): number | null | undefined {
  const raw = argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return undefined;
  const value = Number(raw.slice(name.length + 1));
  if (!Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function parseStringFlag(argv: string[], name: string): string | undefined {
  const raw = argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return undefined;
  const value = raw.slice(name.length + 1).trim();
  return value || undefined;
}

function parseTimeframes(argv: string[]): TradingTimeframe[] | undefined {
  const values = parseCsvFlag(argv, ["--timeframes", "--timeframe"]);
  if (!values) return undefined;
  const allowed = new Set<TradingTimeframe>(TWELVEDATA_ARCHIVE_TIMEFRAMES);
  return values.filter((value): value is TradingTimeframe => allowed.has(value as TradingTimeframe));
}

function parseMarkets(argv: string[]): TradingMarketType[] | undefined {
  const values = parseCsvFlag(argv, ["--markets", "--market"]);
  if (!values) return undefined;
  const allowed = new Set<TradingMarketType>(["forex", "crypto", "equities"]);
  return values
    .map((value) => value.toLowerCase())
    .filter((value): value is TradingMarketType => allowed.has(value as TradingMarketType));
}

async function main() {
  const argv = process.argv.slice(2);
  await loadResearchConfig();

  const report = await runTwelveDataFullArchive({
    instruments: parseCsvFlag(argv, ["--instruments"]),
    markets: parseMarkets(argv),
    timeframes: parseTimeframes(argv),
    fromYear: parseNumberFlag(argv, "--fromYear"),
    toYear: parseNumberFlag(argv, "--toYear"),
    fullHistory: argv.includes("--full-history"),
    download: argv.includes("--download"),
    force: argv.includes("--force"),
    reportsDir: parseStringFlag(argv, "--reportsDir"),
    archiveRoot: parseStringFlag(argv, "--archiveRoot"),
  });

  console.log(
    JSON.stringify(
      {
        reportId: report.reportId,
        generatedAt: report.generatedAt,
        scope: report.scope,
        summary: report.summary,
        hints: report.scope.fullHistory
          ? {
            baselineFromYear: TWELVEDATA_FULL_HISTORY_FROM_YEAR,
            note: "Each instrument/timeframe starts at its real Twelve Data earliest timestamp, not necessarily 1980.",
          }
          : null,
        jsonPath: report.outputs.jsonPath,
        markdownPath: report.outputs.markdownPath,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
