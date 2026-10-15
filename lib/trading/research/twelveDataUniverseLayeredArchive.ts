import path from "node:path";

import { readJsonIfExists, writeJsonAtomic } from "./fs";
import { type TwelveDataUniverseEndpoint } from "./twelveDataUniverseCatalog";
import {
  runTwelveDataUniverseArchiveLoop,
  type TwelveDataUniverseArchiveLoopCursor,
} from "./twelveDataUniverseArchiveLoop";

export type TwelveDataUniverseLayeredArchiveState = {
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeframes: ("1m" | "5m" | "15m" | "1h" | "4h" | "1d")[];
  currentTimeframeIndex: number;
  currentTimeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | null;
  currentCursorPath: string | null;
  completedLayers: string[];
};

type TwelveDataUniverseLayeredArchiveRequest = {
  endpoints?: TwelveDataUniverseEndpoint[];
  timeframes?: ("1m" | "5m" | "15m" | "1h" | "4h" | "1d")[];
  fromYear?: number | null;
  toYear?: number | null;
  batchSize?: number | null;
  force?: boolean;
  reportsDir?: string | null;
  catalogPath?: string | null;
  statePath?: string | null;
};

const DEFAULT_TIMEFRAMES: TwelveDataUniverseLayeredArchiveState["timeframes"] = ["1d", "4h", "1h", "15m", "5m", "1m"];

function resolveReportsDir(customDir?: string | null): string {
  const configured = customDir?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "artifacts", "trading-research", "reports", "datasets");
}

function resolveStatePath(customPath: string | null | undefined, reportsDir: string): string {
  const configured = customPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(reportsDir, "twelvedata-universe-layered-state.json");
}

function resolveLoopCursorPath(reportsDir: string, timeframe: string): string {
  return path.join(reportsDir, `twelvedata-universe-archive-loop-${timeframe}.json`);
}

function normalizeTimeframes(
  timeframes?: TwelveDataUniverseLayeredArchiveState["timeframes"],
): TwelveDataUniverseLayeredArchiveState["timeframes"] {
  const allowed = new Set(DEFAULT_TIMEFRAMES);
  const values = (timeframes ?? DEFAULT_TIMEFRAMES).filter((value) => allowed.has(value));
  return Array.from(new Set(values)) as TwelveDataUniverseLayeredArchiveState["timeframes"];
}

async function loadState(
  statePath: string,
  timeframes: TwelveDataUniverseLayeredArchiveState["timeframes"],
): Promise<TwelveDataUniverseLayeredArchiveState> {
  const existing = await readJsonIfExists<TwelveDataUniverseLayeredArchiveState>(statePath);
  if (existing) {
    return {
      ...existing,
      timeframes,
    };
  }

  return {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    timeframes,
    currentTimeframeIndex: 0,
    currentTimeframe: timeframes[0] ?? null,
    currentCursorPath: timeframes[0] ? resolveLoopCursorPath(path.dirname(statePath), timeframes[0]) : null,
    completedLayers: [],
  };
}

export async function runTwelveDataUniverseLayeredArchive(
  request: TwelveDataUniverseLayeredArchiveRequest = {},
): Promise<TwelveDataUniverseLayeredArchiveState> {
  const reportsDir = resolveReportsDir(request.reportsDir);
  const timeframes = normalizeTimeframes(request.timeframes);
  const statePath = resolveStatePath(request.statePath, reportsDir);
  const state = await loadState(statePath, timeframes);

  for (let timeframeIndex = state.currentTimeframeIndex; timeframeIndex < timeframes.length; timeframeIndex += 1) {
    const timeframe = timeframes[timeframeIndex];
    const cursorPath = resolveLoopCursorPath(reportsDir, timeframe);

    state.currentTimeframeIndex = timeframeIndex;
    state.currentTimeframe = timeframe;
    state.currentCursorPath = cursorPath;
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(statePath, state);

    console.log(`[twelvedata-universe-layered] starting timeframe=${timeframe}`);

    const cursor: TwelveDataUniverseArchiveLoopCursor = await runTwelveDataUniverseArchiveLoop({
      endpoints: request.endpoints,
      timeframes: [timeframe],
      fromYear: request.fromYear,
      toYear: request.toYear,
      batchSize: request.batchSize,
      force: request.force,
      reportsDir,
      catalogPath: request.catalogPath,
      cursorPath,
    });

    console.log(
      `[twelvedata-universe-layered] completed timeframe=${timeframe} endpointIndex=${cursor.endpointIndex} completedBatches=${cursor.completedBatches}`,
    );

    if (!state.completedLayers.includes(timeframe)) {
      state.completedLayers.push(timeframe);
    }
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(statePath, state);
  }

  state.currentTimeframeIndex = timeframes.length;
  state.currentTimeframe = null;
  state.currentCursorPath = null;
  state.completedAt = new Date().toISOString();
  state.updatedAt = state.completedAt;
  await writeJsonAtomic(statePath, state);

  return state;
}
