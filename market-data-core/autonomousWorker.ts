import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { runOfflineIngestOnce, type OfflineProvider, type OfflineResult } from "./offlinePipeline";

export type WorkerEvent = Readonly<{ kind: "STARTED" | "COMMITTED" | "NO_WORK" | "FAILED" | "STOPPED"; workerId: string; jobId?: string; error?: string }>;
export type WorkerStats = Readonly<{ claimed: number; committed: number; noWork: number; failed: number; stopped: boolean }>;
export type WorkerClientFactory = () => Promise<Client>;

const safeError = (error: unknown): string => error instanceof Error ? error.message.slice(0, 160) : "WORKER_FAILURE";

/** Offline-only runner. It has no timer by default and never owns a permanent process. */
export class AutonomousWorker {
  private stopping = false;
  private statsValue: WorkerStats = { claimed: 0, committed: 0, noWork: 0, failed: 0, stopped: false };
  constructor(private readonly input: Readonly<{
    workerId: string;
    clientFactory: WorkerClientFactory;
    provider: OfflineProvider;
    exchangeTimezone: string;
    pollIntervalMs?: number;
    maxTasks?: number;
    onEvent?: (event: WorkerEvent) => void;
  }>) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.workerId)) throw new Error("INVALID_WORKER_IDENTITY");
    if (!Number.isSafeInteger(input.pollIntervalMs ?? 0) || (input.pollIntervalMs ?? 0) < 0) throw new Error("INVALID_POLL_INTERVAL");
    if (!Number.isSafeInteger(input.maxTasks ?? 1) || (input.maxTasks ?? 1) < 1) throw new Error("INVALID_MAX_TASKS");
  }
  stop(): void { this.stopping = true; }
  get stats(): WorkerStats { return this.statsValue; }
  private emit(event: WorkerEvent): void { this.input.onEvent?.(event); }
  async run(): Promise<WorkerStats> {
    this.emit({ kind: "STARTED", workerId: this.input.workerId });
    const maxTasks = this.input.maxTasks ?? 1;
    while (!this.stopping && this.statsValue.committed < maxTasks && this.statsValue.failed < maxTasks) {
      const db = await this.input.clientFactory();
      try {
        await db.connect();
        const result: OfflineResult = await runOfflineIngestOnce({
          db, provider: this.input.provider, workerId: this.input.workerId,
          leaseToken: randomUUID(), runId: randomUUID(),
          providerRunKey: `${this.input.workerId}-${this.statsValue.claimed + 1}`,
          consumedCredits: "1", exchangeTimezone: this.input.exchangeTimezone,
        });
        if (result.state === "NO_WORK") {
          this.statsValue = { ...this.statsValue, noWork: this.statsValue.noWork + 1 };
          this.emit({ kind: "NO_WORK", workerId: this.input.workerId });
          break;
        }
        this.statsValue = { ...this.statsValue, claimed: this.statsValue.claimed + 1, committed: this.statsValue.committed + 1 };
        this.emit({ kind: "COMMITTED", workerId: this.input.workerId, jobId: result.jobId });
      } catch (error) {
        this.statsValue = { ...this.statsValue, failed: this.statsValue.failed + 1 };
        this.emit({ kind: "FAILED", workerId: this.input.workerId, error: safeError(error) });
      } finally { await db.end(); }
      if (!this.stopping && (this.input.pollIntervalMs ?? 0) > 0) await new Promise(resolve => setTimeout(resolve, this.input.pollIntervalMs));
    }
    this.statsValue = { ...this.statsValue, stopped: this.stopping };
    if (this.stopping) this.emit({ kind: "STOPPED", workerId: this.input.workerId });
    return this.statsValue;
  }
}
