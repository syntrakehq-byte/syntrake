import type { Client } from "pg";
import { AutonomousWorker, type WorkerClientFactory, type WorkerEvent, type WorkerStats } from "./autonomousWorker";
import type { OfflineProvider } from "./offlinePipeline";
import { heartbeat } from "./supervisor";
import { safeError } from "./autonomousWorker";

export type WorkerServiceConfig = Readonly<{
  workerId: string;
  instanceId: string;
  capabilityToken: string;
  clientFactory: WorkerClientFactory;
  provider: OfflineProvider;
  exchangeTimezone: string;
  consumedCredits: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxTasks?: number;
  maxPolls?: number;
  onEvent?: (event: WorkerEvent) => void;
}>;

const DEFAULT_HEARTBEAT_MS = 5_000;
const MAX_INTERVAL_MS = 86_400_000;

function interval(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_INTERVAL_MS) throw new Error("INVALID_OPERATION_INTERVAL");
  return result;
}

/**
 * Bounded offline service lifecycle. It delegates all financial work to the
 * R3-D1 AutonomousWorker and only owns process supervision and heartbeats.
 */
export class ContinuousWorkerService {
  private stopping = false;
  private running: Promise<WorkerStats> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private worker: AutonomousWorker | undefined;
  private signalHandlers: Array<readonly [NodeJS.Signals, () => void]> = [];
  private heartbeatFailureCode: string | undefined;

  constructor(private readonly config: WorkerServiceConfig) {
    interval(config.pollIntervalMs, 1);
    interval(config.heartbeatIntervalMs, DEFAULT_HEARTBEAT_MS);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.instanceId)) throw new Error("INVALID_INSTANCE_ID");
    if (config.capabilityToken.length < 32 || config.capabilityToken.length > 256) throw new Error("INVALID_CAPABILITY");
  }

  get isRunning(): boolean { return this.running !== undefined; }
  get heartbeatError(): string | undefined { return this.heartbeatFailureCode; }

  private async sendHeartbeat(): Promise<void> {
    if (this.stopping) return;
    let db: Client | undefined;
    try {
      db = await this.config.clientFactory();
      await db.connect();
      const accepted = await heartbeat(db, this.config.workerId, this.config.instanceId, this.config.capabilityToken);
      if (!accepted) throw new Error("WORKER_IDENTITY_REJECTED");
    } catch (error) {
      this.heartbeatFailureCode = safeError(error);
      try { this.config.onEvent?.({ kind: "FAILED", workerId: this.config.workerId, error: this.heartbeatFailureCode }); } catch { /* observability cannot affect the worker */ }
    } finally {
      if (db) { try { await db.end(); } catch { /* heartbeat cleanup cannot change durable state */ } }
    }
  }

  async start(): Promise<WorkerStats> {
    if (this.running) throw new Error("WORKER_ALREADY_RUNNING");
    this.stopping = false;
    this.heartbeatFailureCode = undefined;
    this.installSignalHandlers();
    const heartbeatMs = interval(this.config.heartbeatIntervalMs, DEFAULT_HEARTBEAT_MS);
    this.heartbeatTimer = setInterval(() => { void this.sendHeartbeat(); }, heartbeatMs);
    this.worker = new AutonomousWorker({ ...this.config, heartbeat: { instanceId: this.config.instanceId, capabilityToken: this.config.capabilityToken } });
    this.running = this.worker.run();
    try { return await this.running; }
    finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      this.running = undefined;
      this.worker = undefined;
      this.removeSignalHandlers();
    }
  }

  stop(): void { this.stopping = true; this.worker?.stop(); }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.worker?.stop();
    this.removeSignalHandlers();
    // AutonomousWorker is the owner of the active run; stop is wired by the
    // run wrapper below through the service's bounded shutdown promise.
    await this.running;
  }

  installSignalHandlers(): void {
    if (this.signalHandlers.length > 0) return;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => { this.stop(); };
      process.once(signal, handler);
      this.signalHandlers.push([signal, handler]);
    }
  }

  private removeSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) process.removeListener(signal, handler);
    this.signalHandlers = [];
  }
}
