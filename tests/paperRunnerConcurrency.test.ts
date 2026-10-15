import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquirePaperTradeLock: vi.fn(),
  buildPaperObservability: vi.fn((args: any) => ({
    schemaReady: Boolean(args.schemaReady),
    reconciledHistoricalCycles: args.reconciledHistoricalCycles ?? 0,
    repairedThisRun: args.repairedThisRun ?? 0,
    unresolvedCycles: 0,
    unsettledCycleCount: 0,
    retryableSettlementCount: 0,
    settlementFailures: 0,
    lastSettlementAt: null,
    reconciliationStatus: args.schemaReady ? "ok" : "failed",
    error: args.error ?? null,
  })),
  createCanonicalPaperTradeCycle: vi.fn(),
  readCanonicalPaperRows: vi.fn(),
  reconcileCanonicalPaperTradeRuns: vi.fn(),
  reconcileCanonicalPaperTrades: vi.fn(),
  recordPaperTradeRun: vi.fn(),
  releasePaperTradeLock: vi.fn(),
  settleCanonicalPaperRows: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/trading/bot/paperStore", () => ({
  acquirePaperTradeLock: mocks.acquirePaperTradeLock,
  buildPaperObservability: mocks.buildPaperObservability,
  createCanonicalPaperTradeCycle: mocks.createCanonicalPaperTradeCycle,
  readCanonicalPaperRows: mocks.readCanonicalPaperRows,
  reconcileCanonicalPaperTradeRuns: mocks.reconcileCanonicalPaperTradeRuns,
  reconcileCanonicalPaperTrades: mocks.reconcileCanonicalPaperTrades,
  recordPaperTradeRun: mocks.recordPaperTradeRun,
  releasePaperTradeLock: mocks.releasePaperTradeLock,
  settleCanonicalPaperRows: mocks.settleCanonicalPaperRows,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { runPaperBotCycleForUser } from "@/lib/trading/bot/paperRunner";

function createJournalQueryResult(rows: any[]) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  return {
    from: vi.fn(() => chain),
  };
}

describe("paper runner concurrency guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquirePaperTradeLock.mockResolvedValue({
      acquired: false,
      lockAcquiredAt: null,
      lockExpiresAt: "2026-07-04T08:03:00.000Z",
    });
    mocks.readCanonicalPaperRows.mockResolvedValue({ schemaReady: true, rows: [], error: null });
    mocks.reconcileCanonicalPaperTradeRuns.mockResolvedValue({ schemaReady: true, reconciled: 0, error: null });
    mocks.reconcileCanonicalPaperTrades.mockResolvedValue({ schemaReady: true, reconciled: 0, error: null });
    mocks.settleCanonicalPaperRows.mockResolvedValue({ rows: [], repaired: 0, failures: 0 });
    mocks.getSupabaseAdmin.mockReturnValue(createJournalQueryResult([]));
  });

  it("returns lock_busy and skips persistence when another cycle holds the lease", async () => {
    const result = await runPaperBotCycleForUser({
      userId: "owner_1",
      triggerSource: "cron",
      maxTradesPerDay: 3,
    });

    expect(result.status).toBe("lock_busy");
    expect(mocks.createCanonicalPaperTradeCycle).not.toHaveBeenCalled();
    expect(mocks.recordPaperTradeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "cron",
        lifecycleStatus: "lock_busy",
        reasonCode: "lock_busy",
      }),
    );
  });
});
