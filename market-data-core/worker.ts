import { deterministicBackoffMs, type WorkerState } from "./coordinator";
export type FakeFetchResult = Readonly<{ kind: "SUCCESS" | "RETRY" | "FATAL"; retryAfterSeconds?: number | null }>;
export type WorkerOutcome = Readonly<{ state: WorkerState; nextRunAtMs: number | null; attempts: number }>;
export function processOffline(input: Readonly<{ state: WorkerState; attempts: number; maxAttempts: number; nowMs: number; result: FakeFetchResult }>): WorkerOutcome {
  if (input.state !== "FETCHING" || input.attempts < 0 || input.attempts > input.maxAttempts || !Number.isSafeInteger(input.nowMs)) throw new Error("INVALID_WORK");
  if (input.result.kind === "SUCCESS") return { state: "COMMITTED", nextRunAtMs: null, attempts: input.attempts };
  if (input.result.kind === "FATAL" || input.attempts >= input.maxAttempts) return { state: "DEAD_LETTER", nextRunAtMs: null, attempts: input.attempts };
  return { state: "RETRY_WAIT", nextRunAtMs: input.nowMs + deterministicBackoffMs(input.attempts, input.result.retryAfterSeconds ?? null), attempts: input.attempts + 1 };
}
