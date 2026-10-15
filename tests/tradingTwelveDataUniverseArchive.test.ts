import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trading/backtest/twelveDataHistorical", () => ({
  TwelveDataAccessRestrictedError: class TwelveDataAccessRestrictedError extends Error {},
  fetchTwelveDataEarliestAvailableTimestamp: vi.fn(),
  fetchTwelveDataHistoricalRange: vi.fn(),
}));

describe("trading Twelve Data universe archive", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("keeps duplicate stock symbols separate by mic code and exchange", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "td-universe-archive-"));
    const reportsDir = path.join(tmpRoot, "reports");
    const archiveRoot = path.join(tmpRoot, "archive");
    const catalogPath = path.join(reportsDir, "twelvedata-universe-latest.json");

    const { writeJsonAtomic } = await import("@/lib/trading/research/fs");
    await writeJsonAtomic(catalogPath, {
      entries: [
        {
          endpoint: "stocks",
          symbol: "TEST123",
          name: "Test Bond",
          exchange: "Munich",
          micCode: "XMUN",
          country: "Germany",
          currency: "USD",
          marketType: "equities",
          raw: {
            symbol: "TEST123",
            exchange: "Munich",
            mic_code: "XMUN",
          },
        },
        {
          endpoint: "stocks",
          symbol: "TEST123",
          name: "Test Bond",
          exchange: "XDUS",
          micCode: "XDUS",
          country: "Germany",
          currency: "USD",
          marketType: "equities",
          raw: {
            symbol: "TEST123",
            exchange: "XDUS",
            mic_code: "XDUS",
          },
        },
      ],
      summary: {
        endpoints: {
          forex_pairs: 0,
          cryptocurrencies: 0,
          stocks: 2,
          indices: 0,
          etf: 0,
        },
      },
    });

    const historical = await import("@/lib/trading/backtest/twelveDataHistorical");
    vi.mocked(historical.fetchTwelveDataEarliestAvailableTimestamp).mockResolvedValue("2026-01-01T00:00:00.000Z");
    vi.mocked(historical.fetchTwelveDataHistoricalRange).mockImplementation(async (args) => [
      {
        timestamp: args.from,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: null,
      },
    ]);

    const { runTwelveDataUniverseArchive } = await import("@/lib/trading/research/twelveDataUniverseArchive");
    const report = await runTwelveDataUniverseArchive({
      endpoints: ["stocks"],
      timeframes: ["4h"],
      fromYear: 2026,
      toYear: 2026,
      archiveRoot,
      reportsDir,
      catalogPath,
      force: true,
    });

    expect(report.summary.entriesPlanned).toBe(2);
    expect(vi.mocked(historical.fetchTwelveDataEarliestAvailableTimestamp)).toHaveBeenNthCalledWith(1, {
      symbol: "TEST123",
      micCode: "XMUN",
      timeframe: "4h",
    });
    expect(vi.mocked(historical.fetchTwelveDataEarliestAvailableTimestamp)).toHaveBeenNthCalledWith(2, {
      symbol: "TEST123",
      micCode: "XDUS",
      timeframe: "4h",
    });

    const targetPaths = report.sync.map((entry) => entry.targetPath).sort();
    expect(targetPaths).toHaveLength(2);
    expect(targetPaths[0]).not.toBe(targetPaths[1]);
    expect(targetPaths[0]).toMatch(/stocks/);
    expect(targetPaths[1]).toMatch(/stocks/);
    expect(targetPaths.join("\n")).toMatch(/xmun/i);
    expect(targetPaths.join("\n")).toMatch(/xdus/i);

    for (const targetPath of targetPaths) {
      const csv = await readFile(targetPath, "utf8");
      expect(csv).toContain("timestamp,open,high,low,close,volume");
    }
  });
});
