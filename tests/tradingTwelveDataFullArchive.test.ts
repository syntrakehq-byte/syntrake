import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runTwelveDataFullArchive } from "@/lib/trading/research";
import * as twelveDataHistorical from "@/lib/trading/backtest/twelveDataHistorical";

describe("twelve data full archive", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    vi.restoreAllMocks();
  });

  it("writes a report for available and restricted instruments without touching the canonical archive", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "syntrake-td-full-archive-"));
    tempDirs.push(rootDir);
    const archiveRoot = path.join(rootDir, "archive");
    const reportsDir = path.join(rootDir, "reports");
    await mkdir(archiveRoot, { recursive: true });
    await mkdir(reportsDir, { recursive: true });

    vi.spyOn(twelveDataHistorical, "fetchTwelveDataEarliestAvailableTimestamp").mockImplementation(async ({ symbol }) => {
      if (symbol === "EUR/USD") return "2020-04-07T16:54:00.000Z";
      throw new twelveDataHistorical.TwelveDataAccessRestrictedError("restricted");
    });

    const report = await runTwelveDataFullArchive({
      archiveRoot,
      reportsDir,
      markets: ["forex"],
      timeframes: ["1m", "1d"],
      fullHistory: true,
    });

    expect(report.summary.instruments).toBeGreaterThan(0);
    expect(report.summary.available).toBeGreaterThan(0);
    expect(report.summary.restricted).toBeGreaterThan(0);
    expect(report.summary.timeframes).toBe(2);
    expect(report.storage.archiveRoot).toBe(archiveRoot);
    expect(report.scope.fullHistory).toBe(true);
    expect(report.scope.targetFromYear).toBe(1980);

    const eurusd = report.instruments.find((entry) => entry.instrument === "EURUSD");
    expect(eurusd?.timeframes[0]?.earliestAvailableYear).toBe(2020);
    expect(eurusd?.pendingYears).toBeGreaterThan(0);
    expect(eurusd?.timeframes).toHaveLength(2);
    expect(eurusd?.timeframes[0]?.targetFromYear).toBe(2020);

    const blocked = report.instruments.find((entry) => entry.instrument !== "EURUSD");
    expect(blocked?.timeframes.some((entry) => Boolean(entry.restrictionReason))).toBe(true);
  });
});
