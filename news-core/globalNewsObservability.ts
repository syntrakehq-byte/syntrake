import type { NewsSourceCycle } from "./globalNewsPoller";

export type GlobalNewsSourceHealthV1 = "HEALTHY" | "EMPTY" | "STALE" | "UNAVAILABLE" | "ERROR";
export type GlobalNewsSourceMetricsV1 = Readonly<{
  sourceId: string;
  coverage: "KNOWN" | "UNKNOWN";
  health: GlobalNewsSourceHealthV1;
  cycles: number;
  observed: number;
  lastSuccessAt: string | null;
  lastObservedAt: string | null;
  lastPublishedAt: string | null;
  freshnessSeconds: number | null;
  lastLatencyMs: number | null;
  lastErrorCode: string | null;
}>;

type Mutable = { sourceId: string; coverage: "KNOWN" | "UNKNOWN"; health: GlobalNewsSourceHealthV1; cycles: number; observed: number; lastSuccessAt: string | null; lastObservedAt: string | null; lastPublishedAt: string | null; freshnessSeconds: number | null; lastLatencyMs: number | null; lastErrorCode: string | null };

/** In-process, secret-free operational telemetry. Durable source state remains in PostgreSQL. */
export class GlobalNewsObservabilityV1 {
  private readonly values = new Map<string, Mutable>();
  constructor(private readonly staleAfterSeconds = 3600) { if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds < 1) throw new Error("GLOBAL_NEWS_STALE_POLICY_INVALID"); }
  observeSource(sourceId: string): void { if (!sourceId) throw new Error("GLOBAL_NEWS_OBSERVABILITY_INPUT_INVALID"); if (!this.values.has(sourceId)) this.values.set(sourceId, { sourceId, coverage: "UNKNOWN", health: "STALE", cycles: 0, observed: 0, lastSuccessAt: null, lastObservedAt: null, lastPublishedAt: null, freshnessSeconds: null, lastLatencyMs: null, lastErrorCode: null }); }
  recordCycle(sourceId: string, cycle: NewsSourceCycle, startedAt: number, finishedAt: number, observedAt = new Date()): void {
    if (!sourceId || !Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt || !Number.isFinite(observedAt.valueOf())) throw new Error("GLOBAL_NEWS_OBSERVABILITY_INPUT_INVALID");
    const now = observedAt.toISOString(); const previous = this.values.get(sourceId);
    const value: Mutable = previous ?? { sourceId, coverage: "UNKNOWN", health: "ERROR", cycles: 0, observed: 0, lastSuccessAt: null, lastObservedAt: null, lastPublishedAt: null, freshnessSeconds: null, lastLatencyMs: null, lastErrorCode: null };
    value.coverage = "KNOWN";
    value.cycles++; value.observed += Math.max(0, cycle.observed); value.lastObservedAt = now; value.lastLatencyMs = Math.max(0, Math.round(finishedAt - startedAt)); value.lastErrorCode = cycle.errorCode;
    if (cycle.status === "ERROR") value.health = "ERROR";
    else if (cycle.status === "NOT_MODIFIED" || cycle.observed === 0) value.health = "EMPTY";
    else { value.health = "HEALTHY"; value.lastSuccessAt = now; if (cycle.latestPublishedAt) value.lastPublishedAt = cycle.latestPublishedAt; }
    const freshnessAt = value.lastPublishedAt ?? value.lastSuccessAt;
    value.freshnessSeconds = freshnessAt ? Math.max(0, (observedAt.valueOf() - Date.parse(freshnessAt)) / 1000) : null;
    if (value.freshnessSeconds !== null && value.freshnessSeconds > this.staleAfterSeconds && value.health === "HEALTHY") value.health = "STALE";
    this.values.set(sourceId, value);
  }
  exportState(): readonly GlobalNewsSourceMetricsV1[] { return this.snapshot().sources; }
  restoreState(state: readonly GlobalNewsSourceMetricsV1[]): void { for (const item of state) { if (!item || !item.sourceId || !["KNOWN", "UNKNOWN"].includes(item.coverage)) throw new Error("GLOBAL_NEWS_OBSERVABILITY_STATE_INVALID"); this.values.set(item.sourceId, { ...item }); } }
  snapshot(now = new Date()): Readonly<{ sources: readonly GlobalNewsSourceMetricsV1[]; totals: Readonly<{ cycles: number; observed: number; errors: number; stale: number }> }> {
    const sources = [...this.values.values()].map(value => { const copy = { ...value }; const freshnessAt = copy.lastPublishedAt ?? copy.lastSuccessAt; if (freshnessAt) { copy.freshnessSeconds = Math.max(0, (now.valueOf() - Date.parse(freshnessAt)) / 1000); if (copy.freshnessSeconds > this.staleAfterSeconds && copy.health === "HEALTHY") copy.health = "STALE"; } return copy; }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    return { sources, totals: { cycles: sources.reduce((n, v) => n + v.cycles, 0), observed: sources.reduce((n, v) => n + v.observed, 0), errors: sources.filter(v => v.health === "ERROR").length, stale: sources.filter(v => v.health === "STALE").length } };
  }
}
