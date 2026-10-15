import { createHash } from "node:crypto";
import path from "node:path";

import {
  getCandles,
  hasAnyMarketDataProviderConfigured,
  type ProviderPref,
} from "@/lib/market/marketClient";
import type { Candle, Timeframe } from "@/lib/market/types";
import defaultTradingScannerFallbackCatalog from "@/config/trading/trading-scanner-fallback-catalog.json";
import {
  coveragePriority,
  type TradingProductMarketCoverage,
} from "@/lib/trading/marketCoverageTypes";
import {
  readTradingProductCoverageMap,
  resolveTradingProductCoverage,
} from "@/lib/trading/marketCoverage";
import {
  createTradingMarketDataSnapshot,
  TRADING_TIMEFRAMES,
  type TradingCandleInput,
  type TradingMarketType,
  type TradingSessionProfile,
  type TradingTimeframe,
} from "@/lib/trading/data";
import { createDecisionCore } from "@/lib/trading/decision";
import { createExecutionPlan } from "@/lib/trading/execution";
import { createMarketReading, readSession, type SessionState } from "@/lib/trading/market";
import {
  createClearBehaviorSnapshot,
  createDefaultTradingPlaybook,
  runBehaviorGuard,
  runPlaybookCheck,
} from "@/lib/trading/playbook";
import { TRADING_LIGHT_SCANNER_ACTIONABLE_MAX_AGE_MS } from "@/lib/trading/scannerFreshness";
import { createSetupCore } from "@/lib/trading/setups";
import { loadResearchConfig } from "@/lib/trading/research/config";
import { readJsonIfExists } from "@/lib/trading/research/fs";
import { readResearchLabRemoteSnapshot } from "@/lib/trading/research/supabaseSync";
import type { ResearchBaselineManifest, ResearchConfig } from "@/lib/trading/research/types";
import type {
  ComposeTradingLiveDecisionInput,
  TradingSignalBaselineIdentity,
  TradingSignalIdentity,
} from "@/lib/trading/state";

export { TRADING_LIGHT_SCANNER_ACTIONABLE_MAX_AGE_MS } from "@/lib/trading/scannerFreshness";

type TradingScannerInstrumentConfig = {
  instrument: string;
  dataSymbol: string;
  dataSymbols?: Array<{
    symbol: string;
    relation: "direct" | "proxy";
    label?: string;
  }>;
  marketType: TradingMarketType;
  sessionProfile: TradingSessionProfile;
  provider: ProviderPref;
  focusGroup: TradingScannerFocusGroup;
};

type TradingScannerFocusGroup = "forex" | "equities" | "metals" | "crypto";

export type TradingLightScannerFocus = {
  sessionLabel: string;
  preferredFocusGroups: TradingScannerFocusGroup[];
  prioritizeOpenMarkets: boolean;
};

const TRADING_LIGHT_SCANNER_PROVIDER_BASE_TIMEFRAME = "5m" as const;
const TRADING_LIGHT_SCANNER_PROVIDER_REQUEST: Timeframe = {
  interval: "5min",
  points: 1500,
};
const TRADING_LIGHT_SCANNER_PROVIDER_DERIVED_TIMEFRAMES: TradingTimeframe[] = [
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];
const TRADING_LIGHT_SCANNER_TIMEFRAME_MS: Record<TradingTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const TRADING_LIGHT_SCANNER_CACHE_TTL_MS = 90_000;
const TRADING_LIGHT_SCANNER_PROVIDER_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const TRADING_LIGHT_SCANNER_FALLBACK_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TRADING_LIGHT_SCANNER_PROVIDER_FRESH_CACHE_MAX_AGE_MS =
  TRADING_LIGHT_SCANNER_ACTIONABLE_MAX_AGE_MS;
const TRADING_LIGHT_SCANNER_PROVIDER_PERSISTENT_CACHE_TTL_SEC =
  TRADING_LIGHT_SCANNER_PROVIDER_FRESH_CACHE_MAX_AGE_MS / 1000;
const TRADING_LIGHT_SCANNER_OPEN_MARKET_LIVE_FETCH_LIMIT_DEFAULT = 8;

type TradingLightScannerCacheEntry = {
  value: ComposeTradingLiveDecisionInput[];
  exp: number;
};

type TradingLightScannerTimeframePayload = {
  timeframes: Partial<Record<TradingTimeframe, TradingCandleInput[]>>;
  snapshotAt: string;
  source: "provider" | "cache" | "catalog" | "empty";
  providerError: string | null;
  dataSymbol: string | null;
  dataRelation: "direct" | "proxy" | null;
};

type TradingLightScannerProviderCacheFile = {
  instrument: string;
  snapshotAt: string;
  timeframes: Partial<Record<TradingTimeframe, TradingCandleInput[]>>;
  writtenAt: string;
  dataSymbol?: string | null;
  dataRelation?: "direct" | "proxy" | null;
};

type TradingLightScannerFallbackCatalogFile = {
  generatedAt: string;
  instruments: Record<string, TradingLightScannerProviderCacheFile>;
};

type TradingLightScannerFreshness = {
  ageMs: number;
  actionable: boolean;
  staleReason: string | null;
};

const TRADING_LIGHT_SCANNER_CACHE = new Map<string, TradingLightScannerCacheEntry>();
const TRADING_LIGHT_SCANNER_PROVIDER_MEMORY_CACHE = new Map<
  string,
  TradingLightScannerTimeframePayload
>();
let tradingLightScannerEnvLoaded = false;
let tradingLightScannerFallbackCatalogOverride:
  | Map<string, TradingLightScannerProviderCacheFile>
  | null = null;

export const TRADING_LIGHT_SCANNER_INSTRUMENTS: TradingScannerInstrumentConfig[] = [
  {
    instrument: "EURUSD",
    dataSymbol: "EUR/USD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "GBPUSD",
    dataSymbol: "GBP/USD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "USDJPY",
    dataSymbol: "USD/JPY",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "AUDUSD",
    dataSymbol: "AUD/USD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "USDCHF",
    dataSymbol: "USD/CHF",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "NZDUSD",
    dataSymbol: "NZD/USD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "AUDJPY",
    dataSymbol: "AUD/JPY",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "EURJPY",
    dataSymbol: "EUR/JPY",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "EURGBP",
    dataSymbol: "EUR/GBP",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "USDCAD",
    dataSymbol: "USD/CAD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "GBPJPY",
    dataSymbol: "GBP/JPY",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "EURCHF",
    dataSymbol: "EUR/CHF",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "NZDJPY",
    dataSymbol: "NZD/JPY",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "forex",
  },
  {
    instrument: "BTCUSD",
    dataSymbol: "BTC/USD",
    marketType: "crypto",
    sessionProfile: "crypto",
    provider: "auto",
    focusGroup: "crypto",
  },
  {
    instrument: "ETHUSD",
    dataSymbol: "ETH/USD",
    marketType: "crypto",
    sessionProfile: "crypto",
    provider: "auto",
    focusGroup: "crypto",
  },
  {
    instrument: "XAUUSD",
    dataSymbol: "XAU/USD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "metals",
  },
  {
    instrument: "XAGUSD",
    dataSymbol: "XAG/USD",
    marketType: "forex",
    sessionProfile: "forex",
    provider: "twelvedata",
    focusGroup: "metals",
  },
  {
    instrument: "NAS100",
    dataSymbol: "NDX",
    dataSymbols: [
      { symbol: "NDX", relation: "direct", label: "Nasdaq 100 index" },
      { symbol: "QQQ", relation: "proxy", label: "Nasdaq 100 proxy ETF" },
    ],
    marketType: "equities",
    sessionProfile: "ny_equities",
    provider: "twelvedata",
    focusGroup: "equities",
  },
  {
    instrument: "US500",
    dataSymbol: "SPX",
    dataSymbols: [
      { symbol: "SPX", relation: "direct", label: "S&P 500 index" },
      { symbol: "GSPC", relation: "proxy", label: "S&P 500 index proxy" },
      { symbol: "SPY", relation: "proxy", label: "S&P 500 proxy ETF" },
    ],
    marketType: "equities",
    sessionProfile: "ny_equities",
    provider: "twelvedata",
    focusGroup: "equities",
  },
];

const TRADING_LIGHT_SCANNER_MARKET_TYPE_ORDER: Record<TradingMarketType, number> = {
  forex: 0,
  equities: 1,
  crypto: 2,
};

function formatScannerSessionLabel(session: SessionState): string {
  switch (session) {
    case "market_closed":
      return "Market closed";
    case "pre_market":
      return "Pre-market";
    case "london_open":
      return "London open";
    case "london_session":
      return "London session";
    case "london_ny_overlap":
      return "London / NY overlap";
    case "ny_open":
      return "New York open";
    case "midday_lull":
      return "Midday lull";
    case "late_us":
      return "Late US";
    case "asia_flow":
      return "Asia flow";
    case "weekend_drift":
      return "Weekend drift";
  }
}

function formatFreshnessAge(ageMs: number) {
  const totalMinutes = Math.max(1, Math.round(ageMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${totalMinutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function resolveTradingResearchExecutionGateReason(
  coverage: TradingProductMarketCoverage,
): string | null {
  if (coverage.status === "coverage_backed") {
    return null;
  }

  if (coverage.status === "staged_only") {
    return "This market is staged for scanner visibility, but Syntrake research has not audited it for live execution yet.";
  }

  return "This market is visible from the live scanner only. Syntrake research has not audited it for live execution yet.";
}

function resolveTradingScannerDataCandidates(config: TradingScannerInstrumentConfig) {
  if (Array.isArray(config.dataSymbols) && config.dataSymbols.length > 0) {
    return config.dataSymbols;
  }

  return [{ symbol: config.dataSymbol, relation: "direct" as const }];
}

function resolveTradingScannerProxyExecutionGateReason(args: {
  instrument: string;
  dataSymbol: string | null;
  dataRelation: "direct" | "proxy" | null;
}) {
  if (args.dataRelation !== "proxy" || !args.dataSymbol) {
    return null;
  }

  return `${args.instrument} is currently being modeled from proxy market data (${args.dataSymbol}), not a direct live benchmark. Keep it in watch mode and confirm the real market in your broker before executing.`;
}

function getZonedMinuteOfDay(timestamp: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return Number(lookup.get("hour") ?? "0") * 60 + Number(lookup.get("minute") ?? "0");
}

function resolveTradingScannerPremarketCoverageGateReason(args: {
  config: TradingScannerInstrumentConfig;
  session: SessionState;
  asOf: string;
}) {
  if (
    args.config.provider !== "twelvedata" ||
    args.config.sessionProfile !== "ny_equities" ||
    args.session !== "pre_market"
  ) {
    return null;
  }

  const newYorkMinuteOfDay = getZonedMinuteOfDay(args.asOf, "America/New_York");

  if (newYorkMinuteOfDay >= 7 * 60) {
    return null;
  }

  return `${args.config.instrument} is in pre-market before 07:00 ET, but the current live provider does not offer real-time extended-hours coverage for that window. Keep it in observation mode until live extended-hours data is available or the regular session opens.`;
}

function assessTradingLightScannerFreshness(args: {
  asOf: string;
  snapshotAt: string;
  source?: TradingLightScannerTimeframePayload["source"];
}): TradingLightScannerFreshness {
  if (args.source === "empty") {
    return {
      ageMs: Number.POSITIVE_INFINITY,
      actionable: false,
      staleReason: "Live market data is unavailable. Refresh live market data before executing.",
    };
  }

  const asOfMs = new Date(args.asOf).getTime();
  const snapshotAtMs = new Date(args.snapshotAt).getTime();

  if (!Number.isFinite(asOfMs) || !Number.isFinite(snapshotAtMs)) {
    return {
      ageMs: Number.POSITIVE_INFINITY,
      actionable: false,
      staleReason: "Live snapshot timestamp is invalid. Refresh live market data before executing.",
    };
  }

  const ageMs = Math.max(0, asOfMs - snapshotAtMs);

  if (args.source === "catalog") {
    return {
      ageMs,
      actionable: false,
      staleReason: `Snapshot is coming from the fallback catalog (${formatFreshnessAge(
        ageMs,
      )} old), not a live provider. Refresh live market data before executing.`,
    };
  }

  if (ageMs <= TRADING_LIGHT_SCANNER_ACTIONABLE_MAX_AGE_MS) {
    return {
      ageMs,
      actionable: true,
      staleReason: null,
    };
  }

  return {
    ageMs,
    actionable: false,
    staleReason: `Live snapshot is stale (${formatFreshnessAge(
      ageMs,
    )} old). Refresh live market data before executing.`,
  };
}

function resolveLightScannerSession(
  config: TradingScannerInstrumentConfig,
  asOf: string,
) {
  const snapshot = createTradingMarketDataSnapshot({
    instrument: config.instrument,
    marketType: config.marketType,
    sessionProfile: config.sessionProfile,
    snapshotAt: asOf,
    timeframes: {},
  });

  return readSession(snapshot);
}

export function resolveTradingLightScannerFocus(asOf: string): TradingLightScannerFocus {
  const forexSession = resolveLightScannerSession(TRADING_LIGHT_SCANNER_INSTRUMENTS[0], asOf);
  const equitiesSession = resolveLightScannerSession(
    TRADING_LIGHT_SCANNER_INSTRUMENTS.find((config) => config.instrument === "NAS100") ??
      TRADING_LIGHT_SCANNER_INSTRUMENTS[0],
    asOf,
  );

  if (forexSession.marketOpen && forexSession.session === "london_ny_overlap") {
    return {
      sessionLabel: "London / NY overlap",
      preferredFocusGroups: ["forex", "equities", "metals", "crypto"],
      prioritizeOpenMarkets: true,
    };
  }

  if (
    equitiesSession.marketOpen &&
    (equitiesSession.session === "pre_market" ||
      equitiesSession.session === "ny_open" ||
      equitiesSession.session === "midday_lull" ||
      equitiesSession.session === "late_us")
  ) {
    return {
      sessionLabel: formatScannerSessionLabel(equitiesSession.session),
      preferredFocusGroups: ["equities", "metals", "forex", "crypto"],
      prioritizeOpenMarkets: true,
    };
  }

  if (
    forexSession.marketOpen &&
    (forexSession.session === "london_open" || forexSession.session === "london_session")
  ) {
    return {
      sessionLabel: formatScannerSessionLabel(forexSession.session),
      preferredFocusGroups: ["forex", "metals", "equities", "crypto"],
      prioritizeOpenMarkets: true,
    };
  }

  return {
    sessionLabel: formatScannerSessionLabel(forexSession.session),
    preferredFocusGroups: ["crypto", "forex", "equities", "metals"],
    prioritizeOpenMarkets: true,
  };
}

function prioritizeTradingScannerInstruments(
  instruments: TradingScannerInstrumentConfig[],
  asOf: string,
  coverageMap: Map<string, TradingProductMarketCoverage>,
) {
  const focus = resolveTradingLightScannerFocus(asOf);
  const preferredFocusGroupOrder = new Map(
    focus.preferredFocusGroups.map((focusGroup, index) => [focusGroup, index]),
  );

  return [...instruments]
    .map((config, index) => ({
      config,
      index,
      session: resolveLightScannerSession(config, asOf),
    }))
    .sort((left, right) => {
      const marketOpenDelta =
        Number(right.session.marketOpen) - Number(left.session.marketOpen);

      if (focus.prioritizeOpenMarkets && marketOpenDelta !== 0) {
        return marketOpenDelta;
      }

      const preferredTypeDelta =
        (preferredFocusGroupOrder.get(left.config.focusGroup) ?? 99) -
        (preferredFocusGroupOrder.get(right.config.focusGroup) ?? 99);

      if (preferredTypeDelta !== 0) {
        return preferredTypeDelta;
      }

      const coverageDelta =
        coveragePriority(resolveTradingProductCoverage(left.config.instrument, coverageMap).status) -
        coveragePriority(resolveTradingProductCoverage(right.config.instrument, coverageMap).status);

      if (coverageDelta !== 0) {
        return coverageDelta;
      }

      const fallbackTypeDelta =
        TRADING_LIGHT_SCANNER_MARKET_TYPE_ORDER[left.config.marketType] -
        TRADING_LIGHT_SCANNER_MARKET_TYPE_ORDER[right.config.marketType];

      if (fallbackTypeDelta !== 0) {
        return fallbackTypeDelta;
      }

      return left.index - right.index;
    })
    .map(({ config }) => config);
}

function buildTradingLightScannerCacheKey(
  instruments: TradingScannerInstrumentConfig[],
  asOf: string,
  liveBaseline: TradingSignalBaselineIdentity,
) {
  const asOfMs = new Date(asOf).getTime();
  const minuteBucket = Number.isFinite(asOfMs)
    ? Math.floor(asOfMs / 60_000)
    : Math.floor(Date.now() / 60_000);
  const baselineKey = liveBaseline.valid
    ? `${liveBaseline.baseline_id}:${liveBaseline.engine_hash}`
    : `invalid:${liveBaseline.invalid_reason ?? "unknown"}`;

  return `${minuteBucket}:${baselineKey}:${instruments.map((instrument) => instrument.instrument).join("|")}`;
}

function resolveTradingLightScannerLiveFetchLimit() {
  const configured = Number(process.env.TRADING_LIGHT_SCANNER_LIVE_FETCH_LIMIT);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.round(configured));
  }

  if (process.env.NODE_ENV === "test") {
    return Number.POSITIVE_INFINITY;
  }

  return 5;
}

function resolveTradingLightScannerOpenMarketLiveFetchLimit() {
  const configured = Number(process.env.TRADING_LIGHT_SCANNER_OPEN_MARKET_LIVE_FETCH_LIMIT);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.round(configured));
  }

  if (process.env.NODE_ENV === "test") {
    return Number.POSITIVE_INFINITY;
  }

  return TRADING_LIGHT_SCANNER_OPEN_MARKET_LIVE_FETCH_LIMIT_DEFAULT;
}

function resolveStoredScannerPayload(
  input: ComposeTradingLiveDecisionInput | null | undefined,
  asOf: string,
  options?: {
    allowStale?: boolean;
  },
): TradingLightScannerTimeframePayload | null {
  if (!input?.snapshot || !input.scannerSnapshot) {
    return null;
  }

  const freshness = assessTradingLightScannerFreshness({
    asOf,
    snapshotAt: input.snapshot.snapshotAt,
    source: input.scannerSnapshot.source,
  });

  if (!freshness.actionable && options?.allowStale !== true) {
    return null;
  }

  return {
    timeframes: input.snapshot.timeframes,
    snapshotAt: input.snapshot.snapshotAt,
    source: "cache",
    providerError: input.scannerSnapshot.providerError ?? null,
    dataSymbol: input.scannerSnapshot.dataSymbol ?? null,
    dataRelation: input.scannerSnapshot.dataRelation ?? null,
  };
}

function isMarketDataRateLimitedError(error: unknown) {
  const message = String((error as any)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("run out of api credits") ||
    message.includes("current limit being") ||
    message.includes("rate limit") ||
    message.includes("(429)")
  );
}

async function ensureTradingLightScannerEnvLoaded() {
  if (
    tradingLightScannerEnvLoaded ||
    process.env.NEXT_RUNTIME ||
    process.env.VITEST ||
    process.env.NODE_ENV === "test"
  ) {
    tradingLightScannerEnvLoaded = true;
    return;
  }

  try {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(process.cwd());
  } catch {
    // Ignore env bootstrap failures and let normal provider fallback logic continue.
  } finally {
    tradingLightScannerEnvLoaded = true;
  }
}

function buildTradingLightScannerProviderCacheKey(instrument: string) {
  return instrument.trim().toUpperCase();
}

async function writeTradingLightScannerProviderCache(args: {
  instrument: string;
  payload: TradingLightScannerTimeframePayload;
}) {
  const key = buildTradingLightScannerProviderCacheKey(args.instrument);
  TRADING_LIGHT_SCANNER_PROVIDER_MEMORY_CACHE.set(key, {
    snapshotAt: args.payload.snapshotAt,
    timeframes: args.payload.timeframes,
    source: "cache",
    providerError: null,
    dataSymbol: args.payload.dataSymbol,
    dataRelation: args.payload.dataRelation,
  });
}

async function readTradingLightScannerProviderCache(
  instrument: string,
  asOf: string,
  maxAgeMs = TRADING_LIGHT_SCANNER_PROVIDER_CACHE_MAX_AGE_MS,
): Promise<TradingLightScannerTimeframePayload | null> {
  const key = buildTradingLightScannerProviderCacheKey(instrument);
  const hit = TRADING_LIGHT_SCANNER_PROVIDER_MEMORY_CACHE.get(key);

  if (!hit) {
    return null;
  }

  const asOfMs = new Date(asOf).getTime();
  const snapshotAtMs = new Date(hit.snapshotAt).getTime();

  if (
    !Number.isFinite(asOfMs) ||
    !Number.isFinite(snapshotAtMs) ||
    Math.abs(asOfMs - snapshotAtMs) > maxAgeMs
  ) {
    TRADING_LIGHT_SCANNER_PROVIDER_MEMORY_CACHE.delete(key);
    return null;
  }

  return {
    snapshotAt: hit.snapshotAt,
    timeframes: hit.timeframes,
    source: "cache",
    providerError: null,
    dataSymbol: hit.dataSymbol ?? null,
    dataRelation: hit.dataRelation ?? null,
  };
}

async function readTradingLightScannerFallbackCatalogMap() {
  if (tradingLightScannerFallbackCatalogOverride) {
    return tradingLightScannerFallbackCatalogOverride;
  }

  return new Map(
    Object.entries(
      ((defaultTradingScannerFallbackCatalog as TradingLightScannerFallbackCatalogFile)
        .instruments ?? {}) as Record<string, TradingLightScannerProviderCacheFile>,
    ).map(([instrument, payload]) => [instrument.trim().toUpperCase(), payload]),
  );
}

async function readTradingLightScannerFallbackCatalog(
  instrument: string,
  asOf: string,
): Promise<TradingLightScannerTimeframePayload | null> {
  try {
    const catalog = await readTradingLightScannerFallbackCatalogMap();
    const payload = catalog.get(instrument.trim().toUpperCase());

    if (!payload) {
      return null;
    }

    const snapshotAtMs = new Date(payload.snapshotAt).getTime();
    const asOfMs = new Date(asOf).getTime();

    if (
      !Number.isFinite(snapshotAtMs) ||
      !Number.isFinite(asOfMs) ||
      Math.abs(asOfMs - snapshotAtMs) > TRADING_LIGHT_SCANNER_FALLBACK_CATALOG_MAX_AGE_MS
    ) {
      return null;
    }

    return {
      snapshotAt: payload.snapshotAt,
      timeframes: payload.timeframes,
      source: "catalog",
      providerError: null,
      dataSymbol: payload.dataSymbol ?? null,
      dataRelation: payload.dataRelation ?? null,
    };
  } catch {
    return null;
  }
}

function normalizeCandles(candles: Candle[]): TradingCandleInput[] {
  return candles.map((candle) => ({
    timestamp: candle.t,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v ?? null,
  }));
}

function resolveBucketStart(timestampMs: number, timeframe: TradingTimeframe): number {
  if (timeframe === "1d") {
    const date = new Date(timestampMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  const durationMs = TRADING_LIGHT_SCANNER_TIMEFRAME_MS[timeframe];
  return Math.floor(timestampMs / durationMs) * durationMs;
}

function aggregateScannerCandles(
  candles: TradingCandleInput[],
  timeframe: TradingTimeframe,
): TradingCandleInput[] {
  if (timeframe === TRADING_LIGHT_SCANNER_PROVIDER_BASE_TIMEFRAME) {
    return [...candles];
  }

  const output: TradingCandleInput[] = [];
  let currentBucket: {
    bucketStart: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  } | null = null;

  for (const candle of candles) {
    const timestampMs = new Date(candle.timestamp).getTime();
    const bucketStart = resolveBucketStart(timestampMs, timeframe);
    const volume = candle.volume ?? null;

    if (!currentBucket || currentBucket.bucketStart !== bucketStart) {
      if (currentBucket) {
        output.push({
          timestamp: new Date(currentBucket.bucketStart).toISOString(),
          open: currentBucket.open,
          high: currentBucket.high,
          low: currentBucket.low,
          close: currentBucket.close,
          volume: currentBucket.volume,
        });
      }

      currentBucket = {
        bucketStart,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume,
      };
      continue;
    }

    currentBucket.high = Math.max(currentBucket.high, candle.high);
    currentBucket.low = Math.min(currentBucket.low, candle.low);
    currentBucket.close = candle.close;
    currentBucket.volume =
      currentBucket.volume === null && volume === null
        ? null
        : (currentBucket.volume ?? 0) + (volume ?? 0);
  }

  if (currentBucket) {
    output.push({
      timestamp: new Date(currentBucket.bucketStart).toISOString(),
      open: currentBucket.open,
      high: currentBucket.high,
      low: currentBucket.low,
      close: currentBucket.close,
      volume: currentBucket.volume,
    });
  }

  return output;
}

function buildDerivedProviderTimeframes(
  candles: TradingCandleInput[],
): Partial<Record<TradingTimeframe, TradingCandleInput[]>> {
  const timeframes: Partial<Record<TradingTimeframe, TradingCandleInput[]>> = {};

  for (const timeframe of TRADING_LIGHT_SCANNER_PROVIDER_DERIVED_TIMEFRAMES) {
    const rows = aggregateScannerCandles(candles, timeframe);
    if (rows.length > 0) {
      timeframes[timeframe] = rows;
    }
  }

  return timeframes;
}

function resolveProviderSnapshotAt(
  candles: TradingCandleInput[],
  asOf: string,
): string {
  const asOfMs = new Date(asOf).getTime();
  const latestCandleMs = candles.reduce((latest, candle) => {
    const candleMs = new Date(candle.timestamp).getTime();
    if (!Number.isFinite(candleMs)) {
      return latest;
    }
    return Math.max(latest, candleMs);
  }, Number.NEGATIVE_INFINITY);

  if (!Number.isFinite(latestCandleMs)) {
    return asOf;
  }

  if (!Number.isFinite(asOfMs)) {
    return new Date(latestCandleMs).toISOString();
  }

  return new Date(Math.min(asOfMs, latestCandleMs)).toISOString();
}

async function fetchInstrumentTimeframes(
  config: TradingScannerInstrumentConfig,
  asOf: string,
  options?: {
    allowLiveFetch?: boolean;
    forceProviderRefresh?: boolean;
    marketOpen?: boolean;
    session?: SessionState;
    storedInput?: ComposeTradingLiveDecisionInput | null;
  },
): Promise<TradingLightScannerTimeframePayload> {
  await ensureTradingLightScannerEnvLoaded();
  let providerError: string | null = null;
  const allowLiveFetch = options?.allowLiveFetch ?? true;
  const hasLiveProvider =
    config.marketType === "crypto" || hasAnyMarketDataProviderConfigured();

  const recentCache = options?.forceProviderRefresh
    ? null
    : await readTradingLightScannerProviderCache(
        config.instrument,
        asOf,
        TRADING_LIGHT_SCANNER_PROVIDER_FRESH_CACHE_MAX_AGE_MS,
      );

  if (recentCache) {
    return recentCache;
  }

  if (allowLiveFetch && hasLiveProvider) {
    const providerErrors: string[] = [];
    for (const dataCandidate of resolveTradingScannerDataCandidates(config)) {
      try {
        const candles = await getCandles(
          dataCandidate.symbol,
          TRADING_LIGHT_SCANNER_PROVIDER_REQUEST,
          config.provider,
          {
            persistentCacheTtlSec: options?.forceProviderRefresh
              ? 0
              : TRADING_LIGHT_SCANNER_PROVIDER_PERSISTENT_CACHE_TTL_SEC,
            memoryCacheTtlMs: options?.forceProviderRefresh
              ? 0
              : TRADING_LIGHT_SCANNER_PROVIDER_FRESH_CACHE_MAX_AGE_MS,
            extendedHours:
              config.sessionProfile === "ny_equities" && options?.session === "pre_market",
          },
        );
        const normalized = normalizeCandles(candles);

        if (normalized.length === 0) {
          providerErrors.push(`${dataCandidate.symbol}:provider_returned_no_candles`);
          continue;
        }

        let snapshotAt = resolveProviderSnapshotAt(normalized, asOf);
        let payload = {
          timeframes: buildDerivedProviderTimeframes(normalized),
          snapshotAt,
          source: "provider" as const,
          providerError: null,
          dataSymbol: dataCandidate.symbol,
          dataRelation: dataCandidate.relation,
        };

        const freshness = assessTradingLightScannerFreshness({
          asOf,
          snapshotAt,
          source: payload.source,
        });

        if (options?.marketOpen && !freshness.actionable && !options?.forceProviderRefresh) {
          const forcedCandles = await getCandles(
            dataCandidate.symbol,
            TRADING_LIGHT_SCANNER_PROVIDER_REQUEST,
            config.provider,
            {
              persistentCacheTtlSec: 0,
              memoryCacheTtlMs: 0,
              extendedHours:
                config.sessionProfile === "ny_equities" && options?.session === "pre_market",
            },
          );
          const forcedNormalized = normalizeCandles(forcedCandles);
          if (forcedNormalized.length > 0) {
            snapshotAt = resolveProviderSnapshotAt(forcedNormalized, asOf);
            payload = {
              timeframes: buildDerivedProviderTimeframes(forcedNormalized),
              snapshotAt,
              source: "provider" as const,
              providerError: null,
              dataSymbol: dataCandidate.symbol,
              dataRelation: dataCandidate.relation,
            };
          }
        }

        await writeTradingLightScannerProviderCache({
          instrument: config.instrument,
          payload,
        });
        return payload;
      } catch (error: any) {
        providerErrors.push(
          `${dataCandidate.symbol}:${error?.message ?? "provider_fetch_failed"}`,
        );
        if (isMarketDataRateLimitedError(error)) {
          break;
        }
      }
    }
    providerError =
      providerErrors[0] && providerErrors.length === 1
        ? providerErrors[0]
        : providerErrors.length > 1
          ? providerErrors.join(" | ")
          : "provider_fetch_failed";
  } else if (!allowLiveFetch) {
    providerError = "live_fetch_deferred";
  } else {
    providerError = "missing_market_data_provider";
  }

  const cached = await readTradingLightScannerProviderCache(config.instrument, asOf);
  if (cached) {
    return {
      ...cached,
      providerError,
    };
  }

  const storedPayload = resolveStoredScannerPayload(options?.storedInput, asOf, {
    allowStale: !allowLiveFetch,
  });
  if (storedPayload) {
    return {
      ...storedPayload,
      providerError: providerError ?? storedPayload.providerError,
    };
  }

  const catalogFallback = await readTradingLightScannerFallbackCatalog(config.instrument, asOf);
  if (catalogFallback) {
    return {
      ...catalogFallback,
      providerError,
    };
  }

  return {
    timeframes: {},
    snapshotAt: asOf,
    source: "empty",
    providerError,
    dataSymbol: null,
    dataRelation: null,
  };
}

async function scanInstrument(
  config: TradingScannerInstrumentConfig,
  asOf: string,
  coverage: TradingProductMarketCoverage,
  options?: {
    allowLiveFetch?: boolean;
    forceProviderRefresh?: boolean;
    includeInactiveMarkets?: boolean;
    storedInput?: ComposeTradingLiveDecisionInput | null;
    liveBaseline?: TradingSignalBaselineIdentity | null;
  },
): Promise<ComposeTradingLiveDecisionInput | null> {
  const currentSession = resolveLightScannerSession(config, asOf);
  const { timeframes, snapshotAt, source, providerError, dataSymbol, dataRelation } =
    await fetchInstrumentTimeframes(config, asOf, {
      ...options,
      marketOpen: currentSession.marketOpen,
      session: currentSession.session,
    });
  const hasAnyCandles = TRADING_TIMEFRAMES.some(
    (timeframe) => (timeframes[timeframe]?.length ?? 0) > 0,
  );

  if (!hasAnyCandles && !options?.includeInactiveMarkets) {
    return null;
  }

  const snapshot = createTradingMarketDataSnapshot({
    instrument: config.instrument,
    marketType: config.marketType,
    sessionProfile: config.sessionProfile,
    snapshotAt,
    timeframes,
  });
  const freshness = assessTradingLightScannerFreshness({
    asOf,
    snapshotAt,
    source,
  });
  const freshnessReason =
    !currentSession.marketOpen && source === "empty"
      ? "Market is closed. Syntrake will re-check this market when the next live session opens."
      : freshness.staleReason;
  const snapshotMarket = createMarketReading(snapshot);
  const market = freshness.actionable
    ? snapshotMarket
    : {
        ...snapshotMarket,
        session: currentSession,
      };
  const setupCore = createSetupCore({ snapshot, market });
  let decisionCore = createDecisionCore({ snapshot, market, setupCore });
  const playbook = createDefaultTradingPlaybook({
    id: `scanner-${config.instrument.toLowerCase()}`,
    name: `${config.instrument} Scanner Playbook`,
  });
  const behavior = createClearBehaviorSnapshot();
  const operationalInput = {
    snapshot,
    market,
    setupCore,
    decisionCore,
    playbook,
    behavior,
  };
  let playbookCheck = runPlaybookCheck(operationalInput);
  const researchExecutionGateReason = resolveTradingResearchExecutionGateReason(coverage);
  const proxyExecutionGateReason = resolveTradingScannerProxyExecutionGateReason({
    instrument: config.instrument,
    dataSymbol,
    dataRelation,
  });
  const premarketCoverageGateReason = resolveTradingScannerPremarketCoverageGateReason({
    config,
    session: currentSession.session,
    asOf,
  });
  const liveBaselineGateReason =
    options?.liveBaseline?.valid === true
      ? null
      : options?.liveBaseline?.invalid_reason ??
        "Current Live Baseline is unavailable. Syntrake can explain the setup but cannot execute it.";

  if (researchExecutionGateReason) {
    playbookCheck = {
      ...playbookCheck,
      rulesAligned: false,
      executionAllowed: false,
      hardBlock: true,
      reasons: Array.from(
        new Set([researchExecutionGateReason, ...playbookCheck.reasons]),
      ),
      nextDisciplineStep: researchExecutionGateReason,
    };
  }

  if (proxyExecutionGateReason) {
    playbookCheck = {
      ...playbookCheck,
      rulesAligned: false,
      executionAllowed: false,
      hardBlock: true,
      reasons: Array.from(new Set([proxyExecutionGateReason, ...playbookCheck.reasons])),
      nextDisciplineStep: proxyExecutionGateReason,
    };
  }

  if (premarketCoverageGateReason) {
    playbookCheck = {
      ...playbookCheck,
      rulesAligned: false,
      executionAllowed: false,
      hardBlock: true,
      reasons: Array.from(new Set([premarketCoverageGateReason, ...playbookCheck.reasons])),
      nextDisciplineStep: premarketCoverageGateReason,
    };
  }

  if (liveBaselineGateReason) {
    playbookCheck = {
      ...playbookCheck,
      rulesAligned: false,
      executionAllowed: false,
      hardBlock: true,
      reasons: Array.from(new Set([liveBaselineGateReason, ...playbookCheck.reasons])),
      nextDisciplineStep: liveBaselineGateReason,
    };
  }

  const behaviorGuard = runBehaviorGuard(operationalInput);
  let executionPlan = createExecutionPlan({
    ...operationalInput,
    playbookCheck,
    behaviorGuard,
  });

  if (!freshness.actionable) {
    const staleReason =
      freshnessReason ??
      "Live snapshot is stale. Refresh live market data before executing.";

    decisionCore = {
      ...decisionCore,
      decision: {
        ...decisionCore.decision,
        currentState: market.session.marketOpen ? "WAIT" : "MARKET_CLOSED",
        primaryMessage: market.session.marketOpen ? "Live data stale." : "Market closed.",
        secondaryMessage: staleReason,
        reasons: Array.from(new Set([...decisionCore.decision.reasons, staleReason])),
      },
    };

    executionPlan = {
      ...executionPlan,
      executionStatus: {
        executionStatus: "restricted",
        reasons: Array.from(new Set([staleReason, ...executionPlan.executionStatus.reasons])),
        nextDisciplineStep: "Refresh live market data before executing.",
      },
    };
  }

  const draft = {
    snapshot,
    market,
    setupCore,
    decisionCore,
    playbook,
    playbookCheck,
    behaviorGuard,
    executionPlan,
    memory: null,
    liveBaseline: options?.liveBaseline ?? null,
    scannerSnapshot: {
      source,
      providerError,
      dataSymbol: dataSymbol ?? null,
      dataRelation: dataRelation ?? null,
      snapshotAgeMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
      actionableFreshness: freshness.actionable,
      staleReason: freshnessReason,
    },
    scannerCoverage: coverage,
  };

  return {
    ...draft,
    signal: buildTradingSignalIdentity({
      input: draft,
      liveBaseline: options?.liveBaseline ?? null,
    }),
  };
}

function invalidLiveBaselineIdentity(args: {
  asOf: string;
  reason: string;
}): TradingSignalBaselineIdentity {
  return {
    baseline_id: "",
    engine_hash: "",
    strategy_id: "",
    validation_profile: "",
    dataset_profile: null,
    source: "research_live_baseline",
    valid: false,
    loaded_at: args.asOf,
    invalid_reason: args.reason,
  };
}

function hashSignalPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 32);
}

function buildTradingSignalIdentity(args: {
  input: Pick<
    ComposeTradingLiveDecisionInput,
    "snapshot" | "setupCore" | "decisionCore" | "executionPlan"
  >;
  liveBaseline: TradingSignalBaselineIdentity | null | undefined;
}): TradingSignalIdentity | null {
  const liveBaseline = args.liveBaseline;
  if (!liveBaseline?.valid || !liveBaseline.baseline_id || !liveBaseline.engine_hash) {
    return null;
  }

  const payload = {
    baseline_id: liveBaseline.baseline_id,
    engine_hash: liveBaseline.engine_hash,
    strategy_id: liveBaseline.strategy_id,
    validation_profile: liveBaseline.validation_profile,
    instrument: args.input.snapshot.instrument,
    snapshot_at: args.input.snapshot.snapshotAt,
    current_state: args.input.decisionCore.decision.currentState,
    execution_status: args.input.executionPlan.executionStatus.executionStatus,
    direction: args.input.setupCore.setup.direction,
    trigger: args.input.executionPlan.entryZone.triggerLevel ?? args.input.setupCore.setup.triggerLevel ?? null,
    entry_low: args.input.executionPlan.entryZone.entryZoneLow ?? null,
    entry_high: args.input.executionPlan.entryZone.entryZoneHigh ?? null,
    invalidation:
      args.input.executionPlan.invalidation.invalidationLevel ??
      args.input.setupCore.setup.invalidationLevel ??
      null,
    target: args.input.executionPlan.tradePath.targetZone ?? null,
  };

  return {
    signal_id: `sig_${hashSignalPayload(payload)}`,
    source: "trading_scanner",
    origin: "current_live_baseline",
    timestamp: args.input.snapshot.snapshotAt,
    baseline_id: liveBaseline.baseline_id,
    engine_hash: liveBaseline.engine_hash,
    strategy_id: liveBaseline.strategy_id,
    validation_profile: liveBaseline.validation_profile,
  };
}

function baselineIdentityFromManifest(args: {
  asOf: string;
  config: ResearchConfig;
  manifest: ResearchBaselineManifest;
}): TradingSignalBaselineIdentity {
  const baselineId = String(
    args.manifest.baseline_id || args.config.liveBaselineSource.baselineId || "",
  ).trim();
  const engineHash = String(args.manifest.engine_manifest_hash || "").trim();
  const validationProfile = String(
    args.manifest.validation_profile || args.config.liveBaselineSource.validationProfile || "",
  ).trim();

  if (!baselineId || !engineHash || !validationProfile) {
    return invalidLiveBaselineIdentity({
      asOf: args.asOf,
      reason: "Current Live Baseline manifest is incomplete.",
    });
  }

  return {
    baseline_id: baselineId,
    engine_hash: engineHash,
    strategy_id: baselineId,
    validation_profile: validationProfile,
    dataset_profile: args.manifest.dataset_profile ?? args.config.liveBaselineSource.datasetProfile ?? null,
    source: "research_live_baseline",
    valid: true,
    loaded_at: args.asOf,
    invalid_reason: null,
  };
}

async function readCurrentLiveBaselineManifest(
  config: ResearchConfig,
): Promise<ResearchBaselineManifest | null> {
  const baselineId = String(config.liveBaselineSource.baselineId || "").trim();
  if (!baselineId) return null;

  const manifestPath = path.join(
    config.paths.baselinesDir,
    baselineId,
    "baseline-manifest.json",
  );
  const localManifest = await readJsonIfExists<ResearchBaselineManifest>(manifestPath);
  if (localManifest?.baseline_id === baselineId) {
    return localManifest;
  }

  const remote = await readResearchLabRemoteSnapshot({ runLimit: 0, decisionLimit: 0 });
  const remotePayload = remote.state?.payload as { baseline?: ResearchBaselineManifest | null } | null;
  const remoteManifest = remotePayload?.baseline ?? null;
  if (remoteManifest?.baseline_id === baselineId) {
    return remoteManifest;
  }

  return null;
}

export async function loadCurrentTradingSignalBaseline(
  asOf: string,
): Promise<TradingSignalBaselineIdentity> {
  try {
    const config = await loadResearchConfig();
    const manifest = await readCurrentLiveBaselineManifest(config);
    if (!manifest) {
      return invalidLiveBaselineIdentity({
        asOf,
        reason: "Current Live Baseline manifest is unavailable from local artifacts and Supabase sync.",
      });
    }

    return baselineIdentityFromManifest({ asOf, config, manifest });
  } catch (error: any) {
    return invalidLiveBaselineIdentity({
      asOf,
      reason: error?.message
        ? `Current Live Baseline could not be loaded: ${error.message}`
        : "Current Live Baseline could not be loaded.",
    });
  }
}

export async function buildTradingLightScannerInputs(args: {
  asOf: string;
  instruments?: TradingScannerInstrumentConfig[];
  forceRefresh?: boolean;
  forceProviderRefresh?: boolean;
  includeInactiveMarkets?: boolean;
  allowLiveFetch?: boolean;
  liveFetchInstruments?: string[] | null;
  storedInputs?: ComposeTradingLiveDecisionInput[] | null;
}): Promise<ComposeTradingLiveDecisionInput[]> {
  const coverageMap = await readTradingProductCoverageMap();
  const instruments = prioritizeTradingScannerInstruments(
    args.instruments ?? TRADING_LIGHT_SCANNER_INSTRUMENTS,
    args.asOf,
    coverageMap,
  );
  const storedInputMap = new Map(
    (args.storedInputs ?? []).map((input) => [input.snapshot.instrument.trim().toUpperCase(), input]),
  );
  const liveFetchLimit = resolveTradingLightScannerLiveFetchLimit();
  const openMarketLiveFetchLimit = resolveTradingLightScannerOpenMarketLiveFetchLimit();
  const liveBaseline = await loadCurrentTradingSignalBaseline(args.asOf);
  const cacheKey = buildTradingLightScannerCacheKey(instruments, args.asOf, liveBaseline);
  const cached = TRADING_LIGHT_SCANNER_CACHE.get(cacheKey);

  if (!args.forceRefresh && cached && cached.exp > Date.now()) {
    return cached.value;
  }

  const instrumentStates = instruments.map((instrument, index) => {
    const session = resolveLightScannerSession(instrument, args.asOf);
    const storedInput =
      storedInputMap.get(instrument.instrument.trim().toUpperCase()) ?? null;
    const storedPayload = resolveStoredScannerPayload(storedInput, args.asOf);
    const storedFreshness = storedPayload
      ? assessTradingLightScannerFreshness({
          asOf: args.asOf,
          snapshotAt: storedPayload.snapshotAt,
          source: storedPayload.source,
        })
      : null;

    return {
      instrument,
      index,
      session,
      storedInput,
      storedPayload,
      storedFreshness,
    };
  });

  const liveFetchAllowed = args.allowLiveFetch !== false;
  const explicitLiveFetchInstrumentSet =
    args.liveFetchInstruments && args.liveFetchInstruments.length > 0
      ? new Set(args.liveFetchInstruments.map((instrument) => instrument.trim().toUpperCase()))
      : null;
  const openMarketFetchTargets = new Set(
    liveFetchAllowed
      ? explicitLiveFetchInstrumentSet
        ? instrumentStates
            .filter(
              (entry) =>
                entry.session.marketOpen &&
                explicitLiveFetchInstrumentSet.has(entry.instrument.instrument.trim().toUpperCase()),
            )
            .map((entry) => entry.instrument.instrument)
        : instrumentStates
            .filter((entry) => entry.session.marketOpen)
            .sort((left, right) => {
              const leftMissingFresh = left.storedPayload ? 0 : 1;
              const rightMissingFresh = right.storedPayload ? 0 : 1;
              if (leftMissingFresh !== rightMissingFresh) {
                return rightMissingFresh - leftMissingFresh;
              }

              const leftAgeMs = left.storedFreshness?.ageMs ?? Number.POSITIVE_INFINITY;
              const rightAgeMs = right.storedFreshness?.ageMs ?? Number.POSITIVE_INFINITY;
              if (leftAgeMs !== rightAgeMs) {
                return rightAgeMs - leftAgeMs;
              }

              return left.index - right.index;
            })
            .slice(0, openMarketLiveFetchLimit)
            .map((entry) => entry.instrument.instrument)
      : [],
  );

  const results = await Promise.allSettled(
    instrumentStates.map((entry) =>
      {
        const shouldFetchOpenMarketLive =
          entry.session.marketOpen && openMarketFetchTargets.has(entry.instrument.instrument);

        return scanInstrument(
          entry.instrument,
          args.asOf,
          resolveTradingProductCoverage(entry.instrument.instrument, coverageMap),
          {
            allowLiveFetch:
              liveFetchAllowed &&
              (shouldFetchOpenMarketLive || (!args.forceRefresh && entry.index < liveFetchLimit)),
            forceProviderRefresh:
              args.forceProviderRefresh === true && shouldFetchOpenMarketLive,
            includeInactiveMarkets: args.includeInactiveMarkets === true,
            storedInput: entry.storedInput,
            liveBaseline,
          },
        );
      },
    ),
  );

  const value = results.flatMap((result) => {
    if (result.status !== "fulfilled" || !result.value) {
      return [];
    }

    return [result.value];
  });

  TRADING_LIGHT_SCANNER_CACHE.set(cacheKey, {
    value,
    exp: Date.now() + TRADING_LIGHT_SCANNER_CACHE_TTL_MS,
  });

  return value;
}

export type TradingLightScannerInstrumentDiagnostic = {
  instrument: string;
  dataSymbol: string;
  dataRelation: "direct" | "proxy" | null;
  source: "provider" | "cache" | "catalog" | "empty";
  providerError: string | null;
  hasAnyCandles: boolean;
  snapshotAt: string;
  sessionLabel: string;
  marketOpen: boolean;
  snapshotAgeMs: number;
  actionableFreshness: boolean;
  staleReason: string | null;
  coverage: TradingProductMarketCoverage;
  candleCounts: Partial<Record<TradingTimeframe, number>>;
};

export type TradingLightScannerDiagnosticSummary = {
  instrumentCount: number;
  openMarketCount: number;
  freshOpenMarketCount: number;
  staleOpenMarketCount: number;
  actionableSnapshotCount: number;
  sourceCounts: Record<TradingLightScannerInstrumentDiagnostic["source"], number>;
  coverageCounts: Record<TradingProductMarketCoverage["status"], number>;
  providerErrorCounts: Record<string, number>;
};

export async function inspectTradingLightScanner(args: {
  asOf: string;
  instruments?: TradingScannerInstrumentConfig[];
  forceProviderRefresh?: boolean;
  liveFetch?: boolean;
  openMarketsOnlyLiveFetch?: boolean;
}): Promise<TradingLightScannerInstrumentDiagnostic[]> {
  const coverageMap = await readTradingProductCoverageMap();
  const instruments = prioritizeTradingScannerInstruments(
    args.instruments ?? TRADING_LIGHT_SCANNER_INSTRUMENTS,
    args.asOf,
    coverageMap,
  );
  const liveFetchLimit = resolveTradingLightScannerLiveFetchLimit();

  const results = await Promise.all(
    instruments.map(async (config, index) => {
      const coverage = resolveTradingProductCoverage(config.instrument, coverageMap);
      const session = resolveLightScannerSession(config, args.asOf);
      const allowClosedMarketLiveFetch =
        args.openMarketsOnlyLiveFetch === true ? false : index < liveFetchLimit;
      const payload = await fetchInstrumentTimeframes(config, args.asOf, {
        allowLiveFetch:
          args.liveFetch === false ? false : session.marketOpen || allowClosedMarketLiveFetch,
        forceProviderRefresh: args.forceProviderRefresh === true && session.marketOpen,
        marketOpen: session.marketOpen,
      });
      const candleCounts = TRADING_TIMEFRAMES.reduce<Partial<Record<TradingTimeframe, number>>>(
        (acc, timeframe) => {
          const rows = payload.timeframes[timeframe];
          if (rows?.length) {
            acc[timeframe] = rows.length;
          }
          return acc;
        },
        {},
      );
      const hasAnyCandles = Object.keys(candleCounts).length > 0;
      const freshness = assessTradingLightScannerFreshness({
        asOf: args.asOf,
        snapshotAt: payload.snapshotAt,
        source: payload.source,
      });

      return {
        instrument: config.instrument,
        dataSymbol: payload.dataSymbol ?? config.dataSymbol,
        dataRelation: payload.dataRelation ?? null,
        source: payload.source,
        providerError: payload.providerError,
        hasAnyCandles,
        snapshotAt: payload.snapshotAt,
        sessionLabel: formatScannerSessionLabel(session.session),
        marketOpen: session.marketOpen,
        snapshotAgeMs: freshness.ageMs,
        actionableFreshness: freshness.actionable,
        staleReason: freshness.staleReason,
        coverage,
        candleCounts,
      } satisfies TradingLightScannerInstrumentDiagnostic;
    }),
  );

  return results;
}

export function summarizeTradingLightScannerDiagnostics(
  diagnostics: TradingLightScannerInstrumentDiagnostic[],
): TradingLightScannerDiagnosticSummary {
  return diagnostics.reduce<TradingLightScannerDiagnosticSummary>(
    (summary, diagnostic) => {
      summary.instrumentCount += 1;
      summary.sourceCounts[diagnostic.source] += 1;
      summary.coverageCounts[diagnostic.coverage.status] += 1;

      if (diagnostic.providerError) {
        summary.providerErrorCounts[diagnostic.providerError] =
          (summary.providerErrorCounts[diagnostic.providerError] ?? 0) + 1;
      }

      if (diagnostic.actionableFreshness) {
        summary.actionableSnapshotCount += 1;
      }

      if (diagnostic.marketOpen) {
        summary.openMarketCount += 1;

        if (diagnostic.actionableFreshness) {
          summary.freshOpenMarketCount += 1;
        } else {
          summary.staleOpenMarketCount += 1;
        }
      }

      return summary;
    },
    {
      instrumentCount: 0,
      openMarketCount: 0,
      freshOpenMarketCount: 0,
      staleOpenMarketCount: 0,
      actionableSnapshotCount: 0,
      sourceCounts: {
        provider: 0,
        cache: 0,
        catalog: 0,
        empty: 0,
      },
      coverageCounts: {
        coverage_backed: 0,
        staged_only: 0,
        live_only: 0,
      },
      providerErrorCounts: {},
    },
  );
}

export function resetTradingLightScannerTestState() {
  TRADING_LIGHT_SCANNER_CACHE.clear();
  TRADING_LIGHT_SCANNER_PROVIDER_MEMORY_CACHE.clear();
  tradingLightScannerFallbackCatalogOverride = null;
}

export function setTradingLightScannerFallbackCatalogForTests(
  catalog: TradingLightScannerFallbackCatalogFile | null,
) {
  if (!catalog) {
    tradingLightScannerFallbackCatalogOverride = null;
    return;
  }

  tradingLightScannerFallbackCatalogOverride = new Map(
    Object.entries(catalog.instruments ?? {}).map(([instrument, payload]) => [
      instrument.trim().toUpperCase(),
      payload,
    ]),
  );
}
