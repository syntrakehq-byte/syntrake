export type MarketQuery = Readonly<{ listingId: string; startDate: string; endDate: string; asOf: string }>;

/** The UI contract treats the cutoff as an ISO-8601 UTC instant, including Z. */
export function buildMarketDataUrl(base: string, query: MarketQuery): string {
  const params = new URLSearchParams({ ...query, interval: "1day", adjustment: "none" });
  return `${base}?${params.toString()}`;
}

export function canPresentMarketData(status: string): boolean { return status === "AVAILABLE"; }

/** Cancels older requests and prevents late responses from winning the UI race. */
export class LatestMarketRequest {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): { generation: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return { generation: this.generation, signal: this.controller.signal };
  }

  invalidate(): void { this.controller?.abort(); this.controller = null; this.generation += 1; }
  accepts(generation: number): boolean { return generation === this.generation; }
}
