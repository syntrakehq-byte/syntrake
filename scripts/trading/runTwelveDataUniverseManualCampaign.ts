import path from "node:path";

import {
  loadResearchConfig,
  readJsonIfExists,
  runTwelveDataUniverseArchive,
  TWELVEDATA_ARCHIVE_TIMEFRAMES,
  TWELVEDATA_UNIVERSE_ENDPOINTS,
  type TwelveDataUniverseArchiveReport,
  type TwelveDataUniverseEndpoint,
  writeJsonAtomic,
} from "../../lib/trading/research/index";
import type { TradingTimeframe } from "../../lib/trading/data";

type ManualCampaignState = {
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  endpointIndex: number;
  timeframeIndex: number;
  offsetSymbols: number;
  completedBatches: number;
  lastReportId: string | null;
  currentEndpoint: TwelveDataUniverseEndpoint | null;
  currentTimeframe: TradingTimeframe | null;
};

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
  const allowed = new Set<TradingTimeframe>(TWELVEDATA_ARCHIVE_TIMEFRAMES);
  return values.filter((value): value is TradingTimeframe => allowed.has(value as TradingTimeframe));
}

function resolveReportsDir(): string {
  return path.join(process.cwd(), "artifacts", "trading-research", "reports", "datasets");
}

function resolveStatePath(): string {
  return path.join(resolveReportsDir(), "twelvedata-universe-manual-campaign-state.json");
}

function readStringFlag(argv: string[], name: string): string | undefined {
  const raw = argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return undefined;
  const value = raw.slice(name.length + 1).trim();
  return value.length > 0 ? value : undefined;
}

async function loadState(statePath: string): Promise<ManualCampaignState> {
  return await readJsonIfExists<ManualCampaignState>(statePath) ?? {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    endpointIndex: 0,
    timeframeIndex: 0,
    offsetSymbols: 0,
    completedBatches: 0,
    lastReportId: null,
    currentEndpoint: null,
    currentTimeframe: null,
  };
}

async function persistState(statePath: string, state: ManualCampaignState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(statePath, state);
}

function isEndpointFinished(report: TwelveDataUniverseArchiveReport, batchSize: number): boolean {
  return report.summary.symbols < batchSize;
}

async function main() {
  await loadResearchConfig();

  const argv = process.argv.slice(2);
  const endpoints = parseEndpoints(argv) ?? [
    "forex_pairs",
    "cryptocurrencies",
    "indices",
    "etf",
    "stocks",
  ];
  const timeframes = parseTimeframes(argv) ?? ["1d", "4h", "1h", "15m", "5m", "1m"];
  const batchSize = Math.max(1, parseNumberFlag(argv, "--batchSize") ?? 25);
  const fromYear = parseNumberFlag(argv, "--fromYear") ?? 1980;
  const toYear = parseNumberFlag(argv, "--toYear") ?? new Date().getUTCFullYear();
  const reportsDir = resolveReportsDir();
  const statePath = path.resolve(readStringFlag(argv, "--statePath") ?? resolveStatePath());
  const reset = argv.includes("--reset");
  const state = await loadState(statePath);

  if (reset) {
    state.startedAt = new Date().toISOString();
    state.updatedAt = state.startedAt;
    state.completedAt = null;
    state.endpointIndex = 0;
    state.timeframeIndex = 0;
    state.offsetSymbols = 0;
    state.completedBatches = 0;
    state.lastReportId = null;
    state.currentEndpoint = null;
    state.currentTimeframe = null;
    await persistState(statePath, state);
  }

  for (let timeframeIndex = state.timeframeIndex; timeframeIndex < timeframes.length; timeframeIndex += 1) {
    const timeframe = timeframes[timeframeIndex];
    const endpointStartIndex = timeframeIndex === state.timeframeIndex ? state.endpointIndex : 0;

    for (let endpointIndex = endpointStartIndex; endpointIndex < endpoints.length; endpointIndex += 1) {
      const endpoint = endpoints[endpointIndex];
      let offsetSymbols = timeframeIndex === state.timeframeIndex && endpointIndex === state.endpointIndex
        ? state.offsetSymbols
        : 0;

      while (true) {
        state.timeframeIndex = timeframeIndex;
        state.endpointIndex = endpointIndex;
        state.offsetSymbols = offsetSymbols;
        state.currentTimeframe = timeframe;
        state.currentEndpoint = endpoint;
        await persistState(statePath, state);

        console.log(
          `[twelvedata-manual-campaign] batch endpoint=${endpoint} timeframe=${timeframe} offset=${offsetSymbols} size=${batchSize}`,
        );

        const report = await runTwelveDataUniverseArchive({
          endpoints: [endpoint],
          timeframes: [timeframe],
          fromYear,
          toYear,
          limitSymbols: batchSize,
          offsetSymbols,
          download: true,
          force: false,
          reportsDir,
        });

        state.completedBatches += 1;
        state.lastReportId = report.reportId;
        await persistState(statePath, state);

        console.log(
          `[twelvedata-manual-campaign] finished endpoint=${endpoint} timeframe=${timeframe} offset=${offsetSymbols} symbols=${report.summary.symbols} downloaded=${report.summary.downloaded} existing=${report.summary.existing} missingRemote=${report.summary.missingRemote} restricted=${report.summary.restricted}`,
        );

        if (report.summary.symbols === 0 || isEndpointFinished(report, batchSize)) {
          break;
        }

        offsetSymbols += report.summary.symbols;
      }
    }
  }

  state.completedAt = new Date().toISOString();
  state.currentEndpoint = null;
  state.currentTimeframe = null;
  await persistState(statePath, state);

  console.log(JSON.stringify({
    ok: true,
    statePath,
    completedAt: state.completedAt,
    completedBatches: state.completedBatches,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
