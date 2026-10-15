import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchTwelveDataEarliestAvailableTimestamp,
  fetchTwelveDataHistoricalRange,
  resetTwelveDataHistoricalState,
} from "@/lib/trading/backtest";

describe("trading Twelve Data historical client", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.TWELVEDATA_API_KEY;

  afterEach(() => {
    resetTwelveDataHistoricalState();
    globalThis.fetch = originalFetch;
    process.env.TWELVEDATA_API_KEY = originalApiKey;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries earliest timestamp requests on HTTP 429", async () => {
    process.env.TWELVEDATA_API_KEY = "test-key";
    vi.useFakeTimers();

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          status: "error",
          message: "You have run out of API credits for the current minute.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          datetime: "2020-04-07 16:54:00",
        }),
      }) as any;

    const promise = fetchTwelveDataEarliestAvailableTimestamp({
      symbol: "EUR/USD",
      timeframe: "1m",
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("2020-04-07T16:54:00.000Z");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries time series requests on HTTP 429 and still returns candles", async () => {
    process.env.TWELVEDATA_API_KEY = "test-key";
    vi.useFakeTimers();

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          datetime: "2020-04-07 16:54:00",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          status: "error",
          message: "You have run out of API credits for the current minute.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          values: [
            {
              datetime: "2020-04-07T16:54:00Z",
              open: "1.1000",
              high: "1.1010",
              low: "1.0990",
              close: "1.1005",
              volume: "12",
            },
            {
              datetime: "2020-04-07T16:55:00Z",
              open: "1.1005",
              high: "1.1020",
              low: "1.1000",
              close: "1.1015",
              volume: "15",
            },
          ],
        }),
      }) as any;

    const promise = fetchTwelveDataHistoricalRange({
      symbol: "EUR/USD",
      timeframe: "1m",
      from: "2020-04-07T16:54:00.000Z",
      to: "2020-04-07T16:55:59.000Z",
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        timestamp: "2020-04-07T16:54:00.000Z",
        open: 1.1,
        close: 1.1005,
      }),
      expect.objectContaining({
        timestamp: "2020-04-07T16:55:00.000Z",
        open: 1.1005,
        close: 1.1015,
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("treats HTTP 400 no-data responses as an empty chunk instead of failing", async () => {
    process.env.TWELVEDATA_API_KEY = "test-key";

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          datetime: "2020-04-07 16:54:00",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: "error",
          message: "No data is available on the specified dates. Try setting different start/end dates.",
        }),
      }) as any;

    await expect(
      fetchTwelveDataHistoricalRange({
        symbol: "EUR/USD",
        timeframe: "1m",
        from: "2026-07-16T21:00:00.000Z",
        to: "2026-07-20T00:00:00.000Z",
      }),
    ).resolves.toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries an HTTP 200 response with an empty body", async () => {
    process.env.TWELVEDATA_API_KEY = "test-key";
    vi.useFakeTimers();

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          datetime: "2020-04-07 16:54:00",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          values: [
            {
              datetime: "2020-04-07T16:54:00Z",
              open: "1.1000",
              high: "1.1010",
              low: "1.0990",
              close: "1.1005",
              volume: "12",
            },
          ],
        }),
      }) as any;

    const promise = fetchTwelveDataHistoricalRange({
      symbol: "EUR/USD",
      timeframe: "1m",
      from: "2020-04-07T16:54:00.000Z",
      to: "2020-04-07T16:54:59.000Z",
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        timestamp: "2020-04-07T16:54:00.000Z",
        close: 1.1005,
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
