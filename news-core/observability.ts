export type NewsOperationalStateV1 = "OK" | "SOURCE_UNAVAILABLE" | "EMPTY" | "STALE" | "PROCESSING_ERROR";
export type NewsOperationalMetricsV1 = Readonly<{
  collections: number; persisted: number; classified: number; errors: number; retries: number;
  checkpointsAdvanced: number; backlog: number; lastSuccessAt: string | null;
}>;

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.replaceAll(/(authorization|cookie|token|secret|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(0, 240);
};

export class NewsObservabilityV1 {
  private readonly values = { collections: 0, persisted: 0, classified: 0, errors: 0, retries: 0, checkpointsAdvanced: 0, backlog: 0, lastSuccessAt: null as string | null };
  private currentState: NewsOperationalStateV1 = "OK";
  private lastErrorCode: string | null = null;
  recordCollection(result: "success" | "empty" | "unavailable"): void { this.values.collections++; this.currentState = result === "success" ? "OK" : result === "empty" ? "EMPTY" : "SOURCE_UNAVAILABLE"; if (result === "success") this.markSuccess(); }
  recordPersisted(count: number): void { this.values.persisted += Math.max(0, count); }
  recordClassified(count: number): void { this.values.classified += Math.max(0, count); }
  recordRetry(): void { this.values.retries++; }
  recordCheckpoint(): void { this.values.checkpointsAdvanced++; }
  setBacklog(count: number): void { this.values.backlog = Math.max(0, Math.floor(count)); }
  recordError(error: unknown, state: "PROCESSING_ERROR" | "SOURCE_UNAVAILABLE" = "PROCESSING_ERROR"): void { this.values.errors++; this.currentState = state; this.lastErrorCode = safeError(error); }
  markSuccess(): void { this.values.lastSuccessAt = new Date().toISOString(); }
  snapshot(): Readonly<{ state: NewsOperationalStateV1; metrics: NewsOperationalMetricsV1; lastErrorCode: string | null }> { return { state: this.currentState, metrics: { ...this.values }, lastErrorCode: this.lastErrorCode }; }
}

