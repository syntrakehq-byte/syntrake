import { createHash } from "node:crypto";

export type DemandRequest = Readonly<{ listingId: string; providerId: string; rightsPolicyId: string; interval: "1day"; adjustment: "none" | "splits" | "dividends" | "all"; from: string; to: string; freshness: "AVAILABLE" | "STALE"; costClass: "KNOWN" | "UNKNOWN" }>;
export type PlannedDemand = Readonly<{ demandKey: string; request: DemandRequest; state: "READY" | "BLOCKED"; reason: "" | "INVALID_IDENTITY" | "RIGHTS_REQUIRED" | "COST_UNKNOWN" | "INVALID_WINDOW" }>;
const id = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
export function planDemand(request: DemandRequest): PlannedDemand {
  const keyParts = [request.listingId, request.providerId, request.rightsPolicyId, request.interval, request.adjustment, request.from, request.to, request.freshness].join("|");
  const demandKey = createHash("sha256").update(keyParts).digest("hex");
  if (![request.listingId, request.providerId].every(x => id.test(x))) return { demandKey, request, state: "BLOCKED", reason: "INVALID_IDENTITY" };
  if (!id.test(request.rightsPolicyId)) return { demandKey, request, state: "BLOCKED", reason: "RIGHTS_REQUIRED" };
  if (request.costClass !== "KNOWN") return { demandKey, request, state: "BLOCKED", reason: "COST_UNKNOWN" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.from) || !/^\d{4}-\d{2}-\d{2}$/.test(request.to) || request.from > request.to) return { demandKey, request, state: "BLOCKED", reason: "INVALID_WINDOW" };
  return { demandKey, request, state: "READY", reason: "" };
}
export function deterministicBackoffMs(attempt: number, retryAfterSeconds: number | null): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 20 || retryAfterSeconds !== null && (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0)) throw new Error("INVALID_RETRY");
  if (retryAfterSeconds !== null) return retryAfterSeconds * 1000;
  return Math.min(3_600_000, 1000 * 2 ** attempt);
}
export type WorkerState = "PENDING" | "LEASED" | "FETCHING" | "COMMITTED" | "RETRY_WAIT" | "DEAD_LETTER";
const transitions: Record<WorkerState, readonly WorkerState[]> = { PENDING: ["LEASED"], LEASED: ["FETCHING", "RETRY_WAIT", "DEAD_LETTER"], FETCHING: ["COMMITTED", "RETRY_WAIT", "DEAD_LETTER"], COMMITTED: [], RETRY_WAIT: ["LEASED", "DEAD_LETTER"], DEAD_LETTER: [] };
export function transition(from: WorkerState, to: WorkerState): WorkerState { if (!transitions[from].includes(to)) throw new Error("INVALID_TRANSITION"); return to; }
