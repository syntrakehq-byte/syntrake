import type { HistoricalMarketDataRequest, HistoricalMarketDataResult, MarketDataResult } from "./contracts";
import type { InvestingDiscoveryQuote } from "./discoveryMarketDataInvesting";

/** Stable, consumer-facing result for the future authenticated Investing route. */
export type InvestingMarketDataResponse = Readonly<{
  status: "AVAILABLE" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS" | "REFRESH_REQUIRED";
  discovery: InvestingDiscoveryQuote;
  current: MarketDataResult | null;
  history: HistoricalMarketDataResult | null;
  refreshed: boolean;
  source: "CACHE" | "WORKER" | "NONE";
  reason: string;
}>;

export type InvestingMarketDataRequest = Readonly<{
  discovery: InvestingDiscoveryQuote;
  historical: HistoricalMarketDataRequest | null;
  requiresDisplay: boolean;
  rightsPolicyId: string;
  /** A server-side reader, never a browser or user-supplied data source. */
  readCurrent: () => Promise<MarketDataResult | null>;
  readHistory: (() => Promise<HistoricalMarketDataResult>) | null;
  /** Existing R3-C Coordinator/worker seam. It may be called at most once. */
  refresh: (() => Promise<void>) | null;
}>;

function statusFor(history: HistoricalMarketDataResult | null, current: MarketDataResult | null): InvestingMarketDataResponse["status"] {
  if (history?.status === "LICENSE_BLOCKED" || current === null && history?.status === "LICENSE_BLOCKED") return "LICENSE_BLOCKED";
  if (history?.status === "PARTIAL") return "PARTIAL";
  if (history?.status === "UNAVAILABLE" && current === null) return "UNAVAILABLE";
  if (current !== null || history?.status === "AVAILABLE") return "AVAILABLE";
  return "UNAVAILABLE";
}

function matchesDiscovery(current: MarketDataResult, discovery: InvestingDiscoveryQuote): boolean {
  const expected = discovery.marketData;
  return expected !== null && current.listingRef === discovery.listingRef &&
    current.instrument.kind === expected.instrument.kind && current.instrument.symbol === expected.instrument.symbol &&
    current.instrument.mic === expected.instrument.mic && current.instrument.currency === expected.instrument.currency &&
    current.currency === expected.currency && current.interval === expected.interval && current.adjustment === expected.adjustment;
}

/**
 * Composes existing discovery, PIT readers and R3-C refresh without creating a
 * second ingestion engine. Cache is authoritative when it is valid; refresh is
 * requested only after a server-side read proves it is needed.
 */
export async function serveInvestingMarketData(input: InvestingMarketDataRequest): Promise<InvestingMarketDataResponse> {
  if (input.discovery.status === "AMBIGUOUS" || input.discovery.status === "REVIEW_REQUIRED" || input.discovery.status === "UNRESOLVED") {
    return Object.freeze({ status: "AMBIGUOUS", discovery: input.discovery, current: null, history: null, refreshed: false, source: "NONE", reason: "Instrument selection is not canonical and requires explicit confirmation." });
  }
  if (input.discovery.status !== "READY" || !input.discovery.identityVerified || input.discovery.marketData === null) {
    return Object.freeze({ status: "UNAVAILABLE", discovery: input.discovery, current: null, history: null, refreshed: false, source: "NONE", reason: "Market-data discovery is not eligible for Investing." });
  }
  const current = await input.readCurrent();
  const history = input.readHistory === null ? null : await input.readHistory();
  if (history?.status === "LICENSE_BLOCKED" || current?.rights.policyId !== input.rightsPolicyId && current !== null) {
    return Object.freeze({ status: "LICENSE_BLOCKED", discovery: input.discovery, current: null, history, refreshed: false, source: "CACHE", reason: "The requested consumer rights do not authorize presentation." });
  }
  if (current !== null && !matchesDiscovery(current, input.discovery)) {
    return Object.freeze({ status: "UNAVAILABLE", discovery: input.discovery, current: null, history, refreshed: false, source: "CACHE", reason: "Persisted result does not match the canonical instrument, listing or provider request." });
  }
  if (history !== null && history.request.listingId !== input.discovery.listingRef) {
    return Object.freeze({ status: "UNAVAILABLE", discovery: input.discovery, current: null, history, refreshed: false, source: "CACHE", reason: "Historical result belongs to another listing." });
  }
  if (current !== null && current.quality.coverage !== "FULL") {
    return Object.freeze({ status: "PARTIAL", discovery: input.discovery, current: null, history, refreshed: false, source: "CACHE", reason: "Persisted result does not have full quality coverage." });
  }
  if (current !== null && current.quality.freshness !== "KNOWN") {
    return Object.freeze({ status: "STALE", discovery: input.discovery, current: null, history, refreshed: false, source: "CACHE", reason: "Persisted result freshness is not established." });
  }
  if (current !== null && (!input.requiresDisplay || current.rights.display)) {
    return Object.freeze({ status: statusFor(history, current), discovery: input.discovery, current, history, refreshed: false, source: "CACHE", reason: "A valid persisted result was reused; no refresh was requested." });
  }
  if (input.refresh === null) {
    return Object.freeze({ status: "REFRESH_REQUIRED", discovery: input.discovery, current: null, history, refreshed: false, source: "NONE", reason: "No valid persisted result is available and no server-side worker is configured." });
  }
  await input.refresh();
  const refreshed = await input.readCurrent();
  if (refreshed === null || !matchesDiscovery(refreshed, input.discovery) || (input.requiresDisplay && !refreshed.rights.display) || refreshed.rights.policyId !== input.rightsPolicyId) {
    return Object.freeze({ status: refreshed?.rights.display === false ? "LICENSE_BLOCKED" : "UNAVAILABLE", discovery: input.discovery, current: null, history, refreshed: true, source: "WORKER", reason: "Worker completed without a permitted result." });
  }
  return Object.freeze({ status: statusFor(history, refreshed), discovery: input.discovery, current: refreshed, history, refreshed: true, source: "WORKER", reason: "Existing R3-C worker refreshed the persisted result." });
}
