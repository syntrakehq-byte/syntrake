import { loadResearchConfig, runTwelveDataUniverseArchiveLoop, TWELVEDATA_UNIVERSE_ENDPOINTS, type TwelveDataUniverseEndpoint } from "../../lib/trading/research/index";
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

function parseEndpoints(argv: string[]): TwelveDataUniverseEndpoint[] | undefined {
  const values = parseCsvFlag(argv, ["--endpoints", "--endpoint"]);
  if (!values) return undefined;
  const allowed = new Set<TwelveDataUniverseEndpoint>(TWELVEDATA_UNIVERSE_ENDPOINTS);
  return values.filter((value): value is TwelveDataUniverseEndpoint => allowed.has(value as TwelveDataUniverseEndpoint));
}

function parseTimeframes(argv: string[]): TradingTimeframe[] | undefined {
  const values = parseCsvFlag(argv, ["--timeframes", "--timeframe"]);
  if (!values) return undefined;
  const allowed = new Set<TradingTimeframe>(["1m", "5m", "15m", "1h", "4h", "1d"]);
  return values.filter((value): value is TradingTimeframe => allowed.has(value as TradingTimeframe));
}

async function main() {
  await loadResearchConfig();
  const argv = process.argv.slice(2);
  const cursor = await runTwelveDataUniverseArchiveLoop({
    endpoints: parseEndpoints(argv),
    timeframes: parseTimeframes(argv),
    fromYear: parseNumberFlag(argv, "--fromYear"),
    toYear: parseNumberFlag(argv, "--toYear"),
    batchSize: parseNumberFlag(argv, "--batchSize"),
    force: argv.includes("--force"),
    once: argv.includes("--once"),
  });

  console.log(JSON.stringify(cursor, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
