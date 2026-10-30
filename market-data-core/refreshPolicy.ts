import { MarketDataError } from "./identity";

export type RefreshDecision =
  | Readonly<{ state: "FETCH"; costCredits: number }>
  | Readonly<{ state: "DISABLED" | "FRESH" | "BACKOFF" | "BUDGET_EXHAUSTED" }>;

/**
 * Pure preflight policy. Does NOT allocate credits: production needs a central
 * durable quota reservation before fetching (R3-B). No process-local counter.
 */
export function decideRefresh(input: Readonly<{
  enabled: boolean;
  nowMs: number;
  lastIngestMs: number | null;
  maxAgeMs: number;
  retryNotBeforeMs: number | null;
  remainingCredits: number;
  costCredits: number;
}>): RefreshDecision {
  const { nowMs, lastIngestMs, maxAgeMs, retryNotBeforeMs, remainingCredits, costCredits } = input;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      lastIngestMs !== null && (!Number.isSafeInteger(lastIngestMs) || lastIngestMs > nowMs || lastIngestMs < 0) ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 ||
      retryNotBeforeMs !== null && (!Number.isSafeInteger(retryNotBeforeMs) || retryNotBeforeMs < 0) ||
      !Number.isSafeInteger(remainingCredits) || remainingCredits < 0 ||
      !Number.isSafeInteger(costCredits) || costCredits <= 0) {
    throw new MarketDataError("INVALID_REQUEST");
  }
  if (!input.enabled) return { state: "DISABLED" };
  if (retryNotBeforeMs !== null && nowMs < retryNotBeforeMs) return { state: "BACKOFF" };
  if (lastIngestMs !== null && nowMs - lastIngestMs < maxAgeMs) return { state: "FRESH" };
  if (remainingCredits < costCredits) return { state: "BUDGET_EXHAUSTED" };
  return { state: "FETCH", costCredits };
}
