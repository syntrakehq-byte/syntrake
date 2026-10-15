import path from "node:path";

import { readJsonIfExists, writeJsonAtomic } from "./fs";
import {
  TWELVEDATA_UNIVERSE_ENDPOINTS,
  type TwelveDataUniverseEndpoint,
  type TwelveDataUniverseCatalogReport,
} from "./twelveDataUniverseCatalog";
import { runTwelveDataUniverseArchive } from "./twelveDataUniverseArchive";

export type TwelveDataUniverseArchiveLoopCursor = {
  endpointIndex: number;
  offsetSymbols: number;
  completedBatches: number;
  updatedAt: string;
};

type TwelveDataUniverseArchiveLoopRequest = {
  endpoints?: TwelveDataUniverseEndpoint[];
  timeframes?: ("1m" | "5m" | "15m" | "1h" | "4h" | "1d")[];
  fromYear?: number | null;
  toYear?: number | null;
  batchSize?: number | null;
  force?: boolean;
  once?: boolean;
  reportsDir?: string | null;
  catalogPath?: string | null;
  cursorPath?: string | null;
};

const DEFAULT_BATCH_RETRY_LIMIT = 5;
const DEFAULT_BATCH_RETRY_WAIT_MS = 30_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  return path.join(reportsDir, "twelvedata-universe-archive-loop-cursor.json");
}

async function loadCatalogSummary(catalogPath: string): Promise<Record<TwelveDataUniverseEndpoint, number>> {
  const payload = await readJsonIfExists<TwelveDataUniverseCatalogReport>(catalogPath);
  if (!payload?.summary?.endpoints) {
    throw new Error(`Universe catalog summary missing: ${catalogPath}`);
  }
  return payload.summary.endpoints;
}

async function loadCursor(cursorPath: string): Promise<TwelveDataUniverseArchiveLoopCursor> {
  return await readJsonIfExists<TwelveDataUniverseArchiveLoopCursor>(cursorPath) ?? {
    endpointIndex: 0,
    offsetSymbols: 0,
    completedBatches: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function runTwelveDataUniverseArchiveLoop(
  request: TwelveDataUniverseArchiveLoopRequest = {},
): Promise<TwelveDataUniverseArchiveLoopCursor> {
  const reportsDir = resolveReportsDir(request.reportsDir);
  const catalogPath = resolveCatalogPath(request.catalogPath);
  const cursorPath = resolveCursorPath(request.cursorPath, reportsDir);
  const endpointCounts = await loadCatalogSummary(catalogPath);
  const endpoints = request.endpoints?.length ? request.endpoints : [...TWELVEDATA_UNIVERSE_ENDPOINTS];
  const batchSize = Math.max(1, request.batchSize ?? 25);
  const force = Boolean(request.force);
  const once = Boolean(request.once);

  const cursor = await loadCursor(cursorPath);
  let completedBatches = cursor.completedBatches;

  for (let endpointIndex = cursor.endpointIndex; endpointIndex < endpoints.length; endpointIndex += 1) {
    const endpoint = endpoints[endpointIndex];
    const totalSymbols = endpointCounts[endpoint] ?? 0;
    let offsetSymbols = endpointIndex === cursor.endpointIndex ? cursor.offsetSymbols : 0;

    while (offsetSymbols < totalSymbols) {
      console.log(
        `[twelvedata-universe-loop] batch endpoint=${endpoint} offset=${offsetSymbols} size=${batchSize} total=${totalSymbols}`,
      );

      const retryLimit = positiveInteger(
        process.env.TRADING_TWELVEDATA_BATCH_RETRY_LIMIT,
        DEFAULT_BATCH_RETRY_LIMIT,
      );
      const retryWaitMs = positiveInteger(
        process.env.TRADING_TWELVEDATA_BATCH_RETRY_WAIT_MS,
        DEFAULT_BATCH_RETRY_WAIT_MS,
      );

      for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
        try {
          await runTwelveDataUniverseArchive({
            endpoints: [endpoint],
            timeframes: request.timeframes,
            fromYear: request.fromYear,
            toYear: request.toYear,
            limitSymbols: batchSize,
            offsetSymbols,
            download: true,
            force,
            reportsDir,
            catalogPath,
          });
          break;
        } catch (error) {
          if (attempt >= retryLimit) {
            throw error;
          }

          console.error(
            `[twelvedata-universe-loop] batch failed endpoint=${endpoint} offset=${offsetSymbols} attempt=${attempt}/${retryLimit}; retrying in ${retryWaitMs}ms`,
            error,
          );
          await wait(retryWaitMs);
        }
      }

      completedBatches += 1;
      const nextCursor: TwelveDataUniverseArchiveLoopCursor = {
        endpointIndex,
        offsetSymbols: offsetSymbols + batchSize,
        completedBatches,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(cursorPath, nextCursor);

      if (once) {
        return nextCursor;
      }

      offsetSymbols += batchSize;
    }

    await writeJsonAtomic(cursorPath, {
      endpointIndex: endpointIndex + 1,
      offsetSymbols: 0,
      completedBatches,
      updatedAt: new Date().toISOString(),
    } satisfies TwelveDataUniverseArchiveLoopCursor);
  }

  const finishedCursor: TwelveDataUniverseArchiveLoopCursor = {
    endpointIndex: endpoints.length,
    offsetSymbols: 0,
    completedBatches,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(cursorPath, finishedCursor);
  return finishedCursor;
}
