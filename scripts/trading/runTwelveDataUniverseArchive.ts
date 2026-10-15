import {
  loadResearchConfig,
  runTwelveDataUniverseArchive,
  TWELVEDATA_ARCHIVE_TIMEFRAMES,
  TWELVEDATA_UNIVERSE_ENDPOINTS,
  type TwelveDataUniverseEndpoint,
} from "../../lib/trading/research/index";
import type { TradingTimeframe } from "../../lib/trading/data";

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

function parseTimeframes(argv: string[]): TradingTimeframe[] | undefined {
  const values = parseCsvFlag(argv, ["--timeframes", "--timeframe"]);
  if (!values) return undefined;
  const allowed = new Set<TradingTimeframe>(TWELVEDATA_ARCHIVE_TIMEFRAMES);
  return values.filter((value): value is TradingTimeframe => allowed.has(value as TradingTimeframe));
}

function parseEndpoints(argv: string[]): TwelveDataUniverseEndpoint[] | undefined {
  const values = parseCsvFlag(argv, ["--endpoints", "--endpoint"]);
  if (!values) return undefined;
  const allowed = new Set<TwelveDataUniverseEndpoint>(TWELVEDATA_UNIVERSE_ENDPOINTS);
  return values.filter((value): value is TwelveDataUniverseEndpoint => allowed.has(value as TwelveDataUniverseEndpoint));
}

async function main() {
  await loadResearchConfig();
  const argv = process.argv.slice(2);
  const report = await runTwelveDataUniverseArchive({
    endpoints: parseEndpoints(argv),
    symbols: parseCsvFlag(argv, ["--symbols"]),
    timeframes: parseTimeframes(argv),
    fromYear: parseNumberFlag(argv, "--fromYear"),
    toYear: parseNumberFlag(argv, "--toYear"),
    limitSymbols: parseNumberFlag(argv, "--limitSymbols"),
    offsetSymbols: parseNumberFlag(argv, "--offsetSymbols"),
    download: !argv.includes("--audit-only"),
    force: argv.includes("--force"),
  });

  console.log(JSON.stringify({
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    scope: report.scope,
    summary: report.summary,
    jsonPath: report.outputs.jsonPath,
    markdownPath: report.outputs.markdownPath,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
