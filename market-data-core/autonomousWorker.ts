import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { runOfflineIngestOnce, type OfflineProvider, type OfflineResult } from "./offlinePipeline";
import { heartbeat } from "./supervisor";

export type WorkerEvent = Readonly<{ kind: "STARTED" | "COMMITTED" | "NO_WORK" | "FAILED" | "STOPPED"; workerId: string; jobId?: string; error?: string }>;
export type WorkerStats = Readonly<{ attempts: number; claimAttempts: number; committed: number; noWork: number; failed: number; recovered: number; stopped: boolean }>;
export type WorkerClientFactory = () => Promise<Client>;

const SAFE_ERROR_CODES = new Set(["OFFLINE_PROVIDER_NOT_AVAILABLE", "OFFLINE_SOURCE_IDENTITY_MISMATCH", "OFFLINE_FETCH_FENCE_REJECTED", "OFFLINE_JOB_MISSING", "OFFLINE_DATA_FUTURE_OR_EXPIRED", "OFFLINE_CACHE_RIGHTS_DENIED", "OFFLINE_OBSERVATION_RIGHTS_CONFLICT", "OFFLINE_REVISION_UNAVAILABLE", "OFFLINE_ACK_REJECTED", "INVALID_OFFLINE_WORK", "INVALID_EXCHANGE_TIMEZONE", "INVALID_WORKER_IDENTITY", "INVALID_POLL_INTERVAL", "INVALID_MAX_TASKS", "INVALID_MAX_POLLS", "INVALID_COST_CONTRACT", "DATABASE_FAILURE", "WORKER_FAILURE"]);
export const safeError = (error: unknown): string => {
  const code = error instanceof Error ? error.message.split(/[\s:]/, 1)[0] : "WORKER_FAILURE";
  return SAFE_ERROR_CODES.has(code) ? code : "WORKER_FAILURE";
};

/** Offline-only runner. It has no timer by default and never owns a permanent process. */
export class AutonomousWorker {
  private stopping = false;
  private statsValue: WorkerStats = { attempts: 0, claimAttempts: 0, committed: 0, noWork: 0, failed: 0, recovered: 0, stopped: false };
  private wakePoll: (() => void) | undefined;
  constructor(private readonly input: Readonly<{
    workerId: string;
    clientFactory: WorkerClientFactory;
    provider: OfflineProvider;
    exchangeTimezone: string;
    pollIntervalMs?: number;
    maxTasks?: number;
    maxPolls?: number;
    consumedCredits: string;
    heartbeat?: Readonly<{ instanceId: string; capabilityToken: string }>;
    onEvent?: (event: WorkerEvent) => void;
  }>) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.workerId)) throw new Error("INVALID_WORKER_IDENTITY");
    if (!Number.isSafeInteger(input.pollIntervalMs ?? 0) || (input.pollIntervalMs ?? 0) < 0) throw new Error("INVALID_POLL_INTERVAL");
    if (!Number.isSafeInteger(input.maxTasks ?? 1) || (input.maxTasks ?? 1) < 1) throw new Error("INVALID_MAX_TASKS");
    if (!Number.isSafeInteger(input.maxPolls ?? input.maxTasks ?? 1) || (input.maxPolls ?? input.maxTasks ?? 1) < 1) throw new Error("INVALID_MAX_POLLS");
    if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(input.consumedCredits)) throw new Error("INVALID_COST_CONTRACT");
  }
  stop(): void { this.stopping = true; this.wakePoll?.(); this.wakePoll = undefined; }
  get stats(): WorkerStats { return this.statsValue; }
  private emit(event: WorkerEvent): void { try { this.input.onEvent?.(event); } catch { /* observability cannot abort financial state */ } }
  async run(): Promise<WorkerStats> {
    this.emit({ kind: "STARTED", workerId: this.input.workerId });
    const maxTasks = this.input.maxTasks ?? 1;
    const maxPolls = this.input.maxPolls ?? maxTasks;
    while (!this.stopping && this.statsValue.committed < maxTasks && this.statsValue.attempts < maxPolls) {
      let db: Client | undefined;
      this.statsValue = { ...this.statsValue, attempts: this.statsValue.attempts + 1, claimAttempts: this.statsValue.claimAttempts + 1 };
      try {
        db = await this.input.clientFactory();
        await db.connect();
        if (this.input.heartbeat && !(await heartbeat(db, this.input.workerId, this.input.heartbeat.instanceId, this.input.heartbeat.capabilityToken))) throw new Error("WORKER_IDENTITY_REJECTED");
        const recovered = await db.query<{ recover_expired_ingest_leases_safe: number }>("SELECT market_core.recover_expired_ingest_leases_safe() AS recover_expired_ingest_leases_safe");
        this.statsValue = { ...this.statsValue, recovered: this.statsValue.recovered + Number(recovered.rows[0]?.recover_expired_ingest_leases_safe ?? 0) };
        const result: OfflineResult = await runOfflineIngestOnce({
          db, provider: this.input.provider, workerId: this.input.workerId,
          leaseToken: randomUUID(), runId: randomUUID(),
          providerRunKey: `${this.input.workerId}-${this.statsValue.claimAttempts}`,
          consumedCredits: this.input.consumedCredits, exchangeTimezone: this.input.exchangeTimezone,
        });
        if (result.state === "NO_WORK") {
          this.statsValue = { ...this.statsValue, noWork: this.statsValue.noWork + 1 };
          this.emit({ kind: "NO_WORK", workerId: this.input.workerId });
          if ((this.input.pollIntervalMs ?? 0) === 0) break;
          if (!this.stopping) await new Promise<void>(resolve => { const timer = setTimeout(() => { this.wakePoll = undefined; resolve(); }, this.input.pollIntervalMs); this.wakePoll = () => { clearTimeout(timer); this.wakePoll = undefined; resolve(); }; });
          continue;
        }
        this.statsValue = { ...this.statsValue, committed: this.statsValue.committed + 1 };
        this.emit({ kind: "COMMITTED", workerId: this.input.workerId, jobId: result.jobId });
      } catch (error) {
        this.statsValue = { ...this.statsValue, failed: this.statsValue.failed + 1 };
        this.emit({ kind: "FAILED", workerId: this.input.workerId, error: safeError(error) });
      } finally { if (db) { try { await db.end(); } catch { /* close failure is non-fatal after durable ACK */ } } }
      if (!this.stopping && (this.input.pollIntervalMs ?? 0) > 0) await new Promise<void>(resolve => { const timer = setTimeout(() => { this.wakePoll = undefined; resolve(); }, this.input.pollIntervalMs); this.wakePoll = () => { clearTimeout(timer); this.wakePoll = undefined; resolve(); }; });
    }
    this.statsValue = { ...this.statsValue, stopped: this.stopping };
    if (this.stopping) this.emit({ kind: "STOPPED", workerId: this.input.workerId });
    return this.statsValue;
  }
}
