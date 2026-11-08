import { instrumentIdentity, MarketDataError, type InstrumentIdentity } from "./identity";
import { readMarketDataForConsumer, type MarketDataResult } from "./contracts";

export type MarketDataDemand = Readonly<{
  /** Resolved server-side from the canonical registry, never a browser-supplied ticker alone. */
  instrument: InstrumentIdentity;
  rightsPolicyId: string;
  requiresDisplay: boolean;
  interval: "1day";
  adjustment: "none";
  /** Freshness of observation, not proof of exchange realtime status. */
  maxAgeMs: number;
}>;

export type OnDemandMarketDataResponse = Readonly<{
  status: "AVAILABLE" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "STALE";
  source: "CACHE" | "PROVIDER" | "NONE";
  data: MarketDataResult | null;
}>;

export type MarketDataProviderResult = Readonly<{
  data: MarketDataResult;
  /** Explicit, externally evidenced authorization to persist this payload. */
  storageAllowed: boolean;
}>;

export type MarketDataGatewayDependencies = Readonly<{
  /** Cache implementation may be PostgreSQL, not a per-process Map in production. */
  readCached: (demand: MarketDataDemand) => Promise<MarketDataResult | null>;
  fetchAuthorized: (demand: MarketDataDemand) => Promise<MarketDataProviderResult | null>;
  storeAuthorized: (demand: MarketDataDemand, data: MarketDataResult) => Promise<void>;
  clock?: () => Date;
}>;

const id = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const price = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const maxAge = 7 * 24 * 60 * 60 * 1000;

function checkDemand(demand: MarketDataDemand): void {
  if (!demand || !demand.instrument ||
      !id.test(demand.instrument.instrumentId ?? "") ||
      !id.test(demand.instrument.listingId ?? "") ||
      demand.instrument.key !==
        "instrument:" + demand.instrument.instrumentId + ":listing:" + demand.instrument.listingId ||
      typeof demand.rightsPolicyId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(demand.rightsPolicyId) ||
      typeof demand.requiresDisplay !== "boolean" ||
      demand.interval !== "1day" || demand.adjustment !== "none" ||
      !Number.isSafeInteger(demand.maxAgeMs) || demand.maxAgeMs < 1 || demand.maxAgeMs > maxAge) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  const descriptive = instrumentIdentity({
    kind: demand.instrument.kind, symbol: demand.instrument.symbol,
    mic: demand.instrument.mic, currency: demand.instrument.currency,
  });
  if (!descriptive.key) throw new MarketDataError("INVALID_REQUEST");
}

function checkedData(data: MarketDataResult | null, demand: MarketDataDemand, now: Date): "ALLOWED" | "BLOCKED" | "INVALID" | "ABSENT" {
  if (data === null) return "ABSENT";
  if (!data || data.listingRef !== demand.instrument.listingId ||
      data.instrument.instrumentId !== demand.instrument.instrumentId ||
      data.instrument.listingId !== demand.instrument.listingId ||
      data.instrument.key !== demand.instrument.key ||
      data.instrument.kind !== demand.instrument.kind ||
      data.instrument.symbol !== demand.instrument.symbol ||
      data.instrument.mic !== demand.instrument.mic ||
      data.instrument.currency !== demand.instrument.currency ||
      data.currency !== demand.instrument.currency ||
      data.interval !== demand.interval || data.adjustment !== demand.adjustment ||
      !price.test(data.price) || !/[1-9]/.test(data.price) ||
      !utc.test(data.asOf) || !Number.isFinite(Date.parse(data.asOf)) ||
      Date.parse(data.asOf) > now.valueOf() ||
      data.quality?.coverage !== "FULL" ||
      !["KNOWN", "UNKNOWN"].includes(data.quality?.freshness ?? "") ||
      !Array.isArray(data.sourceRefs) || data.sourceRefs.length < 1 ||
      data.sourceRefs.some(source => !source || !source.provider || !source.originalSourceId)) {
    return "INVALID";
  }
  return readMarketDataForConsumer(data, {
    rightsPolicyId: demand.rightsPolicyId,
    requiresDisplay: demand.requiresDisplay,
    interval: demand.interval,
  }, now) === null ? "BLOCKED" : "ALLOWED";
}

/**
 * Consumer-neutral, demand-driven Market Data Core.
 *
 * No timers, agent loop, scheduler, hidden HTTP or fake fallback.
 * A cache hit never calls the supplier; a miss fetches at most once per
 * server process while the cache read/persist seams can be durable PG17.
 */
export function createOnDemandMarketDataGateway(deps: MarketDataGatewayDependencies): {
  request: (demand: MarketDataDemand) => Promise<OnDemandMarketDataResponse>;
} {
  const inflight = new Map<string, Promise<MarketDataProviderResult | null>>();
  const getNow = () => {
    const now = (deps.clock ?? (() => new Date()))();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new MarketDataError("INVALID_REQUEST");
    }
    return now;
  };

  async function request(demand: MarketDataDemand): Promise<OnDemandMarketDataResponse> {
    checkDemand(demand);
    const now = getNow();
    const cached = await deps.readCached(demand);
    const cacheCheck = checkedData(cached, demand, now);
    if (cacheCheck === "BLOCKED") return { status: "LICENSE_BLOCKED", source: "NONE", data: null };
    if (cacheCheck === "INVALID") return { status: "UNAVAILABLE", source: "NONE", data: null };
    if (cacheCheck === "ALLOWED" && cached !== null &&
        now.getTime() - Date.parse(cached.asOf) <= demand.maxAgeMs) {
      return { status: cached.quality.freshness === "KNOWN" ? "AVAILABLE" : "STALE", source: "CACHE", data: cached };
    }
    const key = [demand.instrument.key, demand.rightsPolicyId, demand.interval,
      demand.adjustment, String(demand.requiresDisplay)].join("|");
    let pending = inflight.get(key);
    if (!pending) {
      // One fetch and at most one authorized persistence for concurrent callers
      // on this process; the durable adapter retains cross-process idempotency.
      const operation = async (): Promise<MarketDataProviderResult | null> => {
        const result = await deps.fetchAuthorized(demand);
        if (result === null) return null;
        const verdict = checkedData(result.data, demand, getNow());
        if (verdict === "ALLOWED" && result.storageAllowed) {
          await deps.storeAuthorized(demand, result.data);
        }
        return result;
      };
      pending = operation();
      inflight.set(key, pending);
      const current = pending;
      void current.finally(() => {
        if (inflight.get(key) === current) inflight.delete(key);
      }).catch(() => {});
    }
    let fetched: MarketDataProviderResult | null;
    try { fetched = await pending; }
    catch (error) {
      if (error instanceof MarketDataError && error.code === "DISABLED") {
        return { status: "UNAVAILABLE", source: "NONE", data: null };
      }
      throw error;
    }
    if (fetched === null) return { status: "UNAVAILABLE", source: "NONE", data: null };
    const providerCheck = checkedData(fetched.data, demand, getNow());
    if (providerCheck === "BLOCKED") return { status: "LICENSE_BLOCKED", source: "NONE", data: null };
    if (providerCheck !== "ALLOWED") return { status: "UNAVAILABLE", source: "NONE", data: null };
    return {
      status: fetched.data.quality.freshness === "KNOWN" ? "AVAILABLE" : "STALE",
      source: "PROVIDER", data: fetched.data,
    };
  }

  return { request };
}
