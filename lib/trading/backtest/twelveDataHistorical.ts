import type { TradingCandleInput, TradingTimeframe } from "@/lib/trading/data";

type TwelveDataHistoricalPoint = {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};

type TwelveDataHistoricalResponse = {
  values?: TwelveDataHistoricalPoint[];
  status?: string;
  message?: string;
};

type TwelveDataEarliestTimestampResponse = {
  datetime?: string;
  earliest_timestamp?: string;
  timestamp?: string | number;
  status?: string;
  message?: string;
};

type ParsedTwelveDataBody<T> = {
  rawText: string | null;
  json: T | null;
};

export class TwelveDataAccessRestrictedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwelveDataAccessRestrictedError";
  }
}

export const TWELVEDATA_INTERVAL_MAP: Record<TradingTimeframe, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

const TRADING_TIMEFRAME_MS: Record<TradingTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const HISTORICAL_CHUNK_BAR_LIMIT = 4_500;
const HISTORICAL_PROBE_WINDOW_MS: Record<TradingTimeframe, number> = {
  "1m": 3 * 24 * 60 * 60_000,
  "5m": 14 * 24 * 60 * 60_000,
  "15m": 31 * 24 * 60 * 60_000,
  "1h": 31 * 24 * 60 * 60_000,
  "4h": 90 * 24 * 60 * 60_000,
  "1d": 365 * 24 * 60 * 60_000,
};
const TWELVEDATA_RETRY_LIMIT = 3;
const TWELVEDATA_RATE_LIMIT_WAIT_MS = 65_000;
const TWELVEDATA_TRANSIENT_RETRY_WAIT_MS = 2_000;

let nextAllowedTwelveDataRequestAt = 0;
const earliestTimestampCache = new Map<string, string | null>();

export function resetTwelveDataHistoricalState(): void {
  nextAllowedTwelveDataRequestAt = 0;
  earliestTimestampCache.clear();
}

function apiKey(): string {
  const key = process.env.TWELVEDATA_API_KEY;

  if (!key) {
    throw new Error("Missing TWELVEDATA_API_KEY for trading historical backtests.");
  }

  return key;
}

export function toIso(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid historical dataset timestamp: ${value}`);
  }

  return date.toISOString();
}

function toProviderDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid provider datetime: ${value}`);
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function estimateOutputSize(from: string, to: string, timeframe: TradingTimeframe): number {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const durationMs = Math.max(0, toMs - fromMs);
  const bars = Math.ceil(durationMs / TRADING_TIMEFRAME_MS[timeframe]) + 8;

  return Math.max(50, Math.min(5000, bars));
}

function resolveChunkDurationMs(timeframe: TradingTimeframe): number {
  return TRADING_TIMEFRAME_MS[timeframe] * HISTORICAL_CHUNK_BAR_LIMIT;
}

function resolveProbeWindowMs(timeframe: TradingTimeframe): number {
  return HISTORICAL_PROBE_WINDOW_MS[timeframe];
}

function resolveRequestIntervalMs(): number {
  const configured = Number(process.env.TRADING_BACKTEST_TD_REQUEST_INTERVAL_MS ?? 0);
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

function isNoDataMessage(message: string | undefined): boolean {
  return (message ?? "").includes("No data is available on the specified dates");
}

function isRateLimitMessage(message: string | undefined): boolean {
  return (message ?? "").includes("run out of API credits for the current minute");
}

function isHttpRateLimited(args: {
  status: number;
  message?: string;
}): boolean {
  return args.status === 429 || isRateLimitMessage(args.message);
}

function redactApiKey(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.searchParams.has("apikey")) {
    url.searchParams.set("apikey", "[redacted]");
  }
  return url.toString();
}

export function isTwelveDataAccessRestrictedMessage(message: string | undefined): boolean {
  const normalized = (message ?? "").toLowerCase();

  return (
    normalized.includes("available starting with the")
    || normalized.includes("grow or venture plan")
    || normalized.includes("direct license")
    || normalized.includes("direct exchange license")
    || normalized.includes("not accessible via api")
    || normalized.includes("not available under your current plan")
    || normalized.includes("upgrade your plan")
  );
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTwelveDataRequestWindow(): Promise<void> {
  const requestIntervalMs = resolveRequestIntervalMs();
  const now = Date.now();

  if (requestIntervalMs > 0 && nextAllowedTwelveDataRequestAt > now) {
    await wait(nextAllowedTwelveDataRequestAt - now);
  }
}

function markTwelveDataRequestComplete(): void {
  nextAllowedTwelveDataRequestAt = Date.now() + resolveRequestIntervalMs();
}

async function waitForTwelveDataRateLimitReset(): Promise<void> {
  nextAllowedTwelveDataRequestAt = Math.max(
    nextAllowedTwelveDataRequestAt,
    Date.now() + TWELVEDATA_RATE_LIMIT_WAIT_MS,
  );
  await wait(TWELVEDATA_RATE_LIMIT_WAIT_MS);
}

async function parseTwelveDataBody<T>(response: Response): Promise<ParsedTwelveDataBody<T>> {
  const responseWithText = response as Response & { text?: () => Promise<string> };
  const responseWithJson = response as Response & { json?: () => Promise<unknown> };

  if (typeof responseWithText.text !== "function") {
    const json = typeof responseWithJson.json === "function"
      ? (await responseWithJson.json().catch(() => null)) as T | null
      : null;

    return {
      rawText: json ? JSON.stringify(json) : null,
      json,
    };
  }

  const rawText = await responseWithText.text().catch(() => null);

  if (!rawText) {
    return {
      rawText,
      json: null,
    };
  }

  try {
    return {
      rawText,
      json: JSON.parse(rawText) as T,
    };
  } catch {
    return {
      rawText,
      json: null,
    };
  }
}

function parseNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHistoricalCandles(
  points: TwelveDataHistoricalPoint[],
  from: string,
  to: string,
): TradingCandleInput[] {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();

  const candles = points
    .map((point) => {
      const timestamp = new Date(point.datetime).toISOString();
      const open = parseNumber(point.open);
      const high = parseNumber(point.high);
      const low = parseNumber(point.low);
      const close = parseNumber(point.close);
      const volume = parseNumber(point.volume);

      if (
        open === null ||
        high === null ||
        low === null ||
        close === null
      ) {
        return null;
      }

      const at = new Date(timestamp).getTime();

      if (at < start || at > end) {
        return null;
      }

      return {
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter(Boolean) as TradingCandleInput[];

  return candles.sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

async function fetchHistoricalTimeframe(args: {
  symbol: string;
  micCode?: string | null;
  timeframe: TradingTimeframe;
  from: string;
  to: string;
}): Promise<TradingCandleInput[]> {
  for (let attempt = 0; attempt < TWELVEDATA_RETRY_LIMIT; attempt += 1) {
    await waitForTwelveDataRequestWindow();

    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", args.symbol);
    if (args.micCode) {
      url.searchParams.set("mic_code", args.micCode);
    }
    url.searchParams.set("interval", TWELVEDATA_INTERVAL_MAP[args.timeframe]);
    url.searchParams.set("start_date", toProviderDateTime(args.from));
    url.searchParams.set("end_date", toProviderDateTime(args.to));
    url.searchParams.set("order", "ASC");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set(
      "outputsize",
      String(estimateOutputSize(args.from, args.to, args.timeframe)),
    );
    url.searchParams.set("apikey", apiKey());

    const requestUrl = url.toString();
    const response = await fetch(requestUrl, {
      cache: "no-store",
    });
    markTwelveDataRequestComplete();
    const body = await parseTwelveDataBody<TwelveDataHistoricalResponse>(response);
    const json = body.json;

    if (
      isHttpRateLimited({
        status: response.status,
        message: json?.message,
      })
      && attempt < TWELVEDATA_RETRY_LIMIT - 1
    ) {
      await waitForTwelveDataRateLimitReset();
      continue;
    }

    if (response.ok && !json && attempt < TWELVEDATA_RETRY_LIMIT - 1) {
      await wait(TWELVEDATA_TRANSIENT_RETRY_WAIT_MS * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      if (isNoDataMessage(json?.message) || isNoDataMessage(body.rawText ?? undefined)) {
        return [];
      }

      throw new Error(
        json?.message || body.rawText
          ? `Historical time series request failed (${response.status}) for ${redactApiKey(requestUrl)}: ${json?.message ?? body.rawText}`
          : `Historical time series request failed (${response.status}) for ${redactApiKey(requestUrl)}.`,
      );
    }

    if (!json) {
      throw new Error(`Historical time series request failed (${response.status}).`);
    }

    if (json.status === "error") {
      if (isNoDataMessage(json.message)) {
        return [];
      }

      if (isTwelveDataAccessRestrictedMessage(json.message)) {
        throw new TwelveDataAccessRestrictedError(json.message ?? "Historical market access is restricted.");
      }

      if (isRateLimitMessage(json.message) && attempt < TWELVEDATA_RETRY_LIMIT - 1) {
        await waitForTwelveDataRateLimitReset();
        continue;
      }

      throw new Error(json.message ?? "Historical time series request failed.");
    }

    return normalizeHistoricalCandles(json.values ?? [], args.from, args.to);
  }

  throw new Error("Historical time series request exceeded retry budget.");
}

function normalizeEarliestTimestamp(value: string | number | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchEarliestTimestamp(args: {
  symbol: string;
  micCode?: string | null;
  timeframe: TradingTimeframe;
}): Promise<string | null> {
  const cacheKey = `${args.symbol}::${args.micCode ?? ""}::${args.timeframe}`;

  if (earliestTimestampCache.has(cacheKey)) {
    return earliestTimestampCache.get(cacheKey) ?? null;
  }

  for (let attempt = 0; attempt < TWELVEDATA_RETRY_LIMIT; attempt += 1) {
    await waitForTwelveDataRequestWindow();

    const url = new URL("https://api.twelvedata.com/earliest_timestamp");
    url.searchParams.set("symbol", args.symbol);
    if (args.micCode) {
      url.searchParams.set("mic_code", args.micCode);
    }
    url.searchParams.set("interval", TWELVEDATA_INTERVAL_MAP[args.timeframe]);
    url.searchParams.set("apikey", apiKey());

    const response = await fetch(url.toString(), {
      cache: "no-store",
    });
    markTwelveDataRequestComplete();
    const body = await parseTwelveDataBody<TwelveDataEarliestTimestampResponse>(response);
    const json = body.json;

    if (
      isHttpRateLimited({
        status: response.status,
        message: json?.message,
      })
      && attempt < TWELVEDATA_RETRY_LIMIT - 1
    ) {
      await waitForTwelveDataRateLimitReset();
      continue;
    }

    if (!response.ok || !json) {
      break;
    }

    if (json.status === "error") {
      if (isNoDataMessage(json.message)) {
        earliestTimestampCache.set(cacheKey, null);
        return null;
      }

      if (isTwelveDataAccessRestrictedMessage(json.message)) {
        throw new TwelveDataAccessRestrictedError(json.message ?? "Historical market access is restricted.");
      }

      if (isRateLimitMessage(json.message) && attempt < TWELVEDATA_RETRY_LIMIT - 1) {
        await waitForTwelveDataRateLimitReset();
        continue;
      }

      break;
    }

    const earliest =
      normalizeEarliestTimestamp(json.datetime)
      ?? normalizeEarliestTimestamp(json.earliest_timestamp)
      ?? normalizeEarliestTimestamp(json.timestamp);
    earliestTimestampCache.set(cacheKey, earliest);
    return earliest;
  }

  return null;
}

export async function fetchTwelveDataEarliestAvailableTimestamp(args: {
  symbol: string;
  micCode?: string | null;
  timeframe: TradingTimeframe;
}): Promise<string | null> {
  return fetchEarliestTimestamp(args);
}

async function probeFirstAvailableSegment(args: {
  symbol: string;
  micCode?: string | null;
  timeframe: TradingTimeframe;
  from: string;
  to: string;
}): Promise<{
  candles: TradingCandleInput[];
  nextCursorMs: number;
} | null> {
  const startMs = new Date(args.from).getTime();
  const endMs = new Date(args.to).getTime();
  const probeWindowMs = resolveProbeWindowMs(args.timeframe);
  const totalWindows = Math.max(1, Math.ceil((endMs - startMs) / probeWindowMs));
  const cache = new Map<number, TradingCandleInput[]>();

  async function readProbeWindow(index: number): Promise<TradingCandleInput[]> {
    const cached = cache.get(index);

    if (cached) {
      return cached;
    }

    const probeStart = startMs + index * probeWindowMs;
    const probeEnd = Math.min(endMs, probeStart + probeWindowMs);
    const candles = await fetchHistoricalTimeframe({
      symbol: args.symbol,
      micCode: args.micCode,
      timeframe: args.timeframe,
      from: new Date(probeStart).toISOString(),
      to: new Date(probeEnd).toISOString(),
    });

    cache.set(index, candles);
    return candles;
  }

  let low = 0;
  let high = totalWindows - 1;
  let firstAvailableIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candles = await readProbeWindow(mid);

    if (candles.length > 0) {
      firstAvailableIndex = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (firstAvailableIndex < 0) {
    return null;
  }

  const firstCandles = await readProbeWindow(firstAvailableIndex);
  const firstProbeStart = startMs + firstAvailableIndex * probeWindowMs;
  const firstProbeEnd = Math.min(endMs, firstProbeStart + probeWindowMs);

  return {
    candles: firstCandles,
    nextCursorMs: firstProbeEnd + 1,
  };
}

function mergeChunkedCandles(chunks: TradingCandleInput[][]): TradingCandleInput[] {
  const deduped = new Map<string, TradingCandleInput>();

  for (const candles of chunks) {
    for (const candle of candles) {
      deduped.set(
        candle.timestamp instanceof Date ? candle.timestamp.toISOString() : String(candle.timestamp),
        candle,
      );
    }
  }

  return Array.from(deduped.values()).sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

export async function fetchTwelveDataHistoricalRange(args: {
  symbol: string;
  micCode?: string | null;
  timeframe: TradingTimeframe;
  from: string;
  to: string;
}): Promise<TradingCandleInput[]> {
  const earliestTimestamp = await fetchEarliestTimestamp({
    symbol: args.symbol,
    micCode: args.micCode,
    timeframe: args.timeframe,
  });
  const requestedStartMs = new Date(args.from).getTime();
  const requestedEndMs = new Date(args.to).getTime();

  if (earliestTimestamp) {
    const earliestMs = new Date(earliestTimestamp).getTime();
    if (earliestMs > requestedEndMs) {
      return [];
    }

    const adjustedArgs = earliestMs > requestedStartMs
      ? {
        ...args,
        from: new Date(earliestMs).toISOString(),
      }
      : args;
    const chunkDurationMs = resolveChunkDurationMs(args.timeframe);
    const chunks: TradingCandleInput[][] = [];
    let cursor = new Date(adjustedArgs.from).getTime();

    while (cursor <= requestedEndMs) {
      const chunkEnd = Math.min(requestedEndMs, cursor + chunkDurationMs);
      const candles = await fetchHistoricalTimeframe({
        symbol: adjustedArgs.symbol,
        micCode: adjustedArgs.micCode,
        timeframe: adjustedArgs.timeframe,
        from: new Date(cursor).toISOString(),
        to: new Date(chunkEnd).toISOString(),
      });

      chunks.push(candles);

      if (chunkEnd >= requestedEndMs) {
        break;
      }

      cursor = chunkEnd + 1;
    }

    return mergeChunkedCandles(chunks);
  }

  const firstAvailable = await probeFirstAvailableSegment(args);

  if (!firstAvailable) {
    return [];
  }

  const endMs = requestedEndMs;
  const chunkDurationMs = resolveChunkDurationMs(args.timeframe);
  const chunks: TradingCandleInput[][] = [firstAvailable.candles];

  let cursor = firstAvailable.nextCursorMs;

  while (cursor < endMs) {
    const chunkEnd = Math.min(endMs, cursor + chunkDurationMs);
    const candles = await fetchHistoricalTimeframe({
      symbol: args.symbol,
      micCode: args.micCode,
      timeframe: args.timeframe,
      from: new Date(cursor).toISOString(),
      to: new Date(chunkEnd).toISOString(),
    });

    chunks.push(candles);

    if (chunkEnd >= endMs) {
      break;
    }

    cursor = chunkEnd + 1;
  }

  return mergeChunkedCandles(chunks);
}
