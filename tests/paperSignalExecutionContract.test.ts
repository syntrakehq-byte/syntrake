import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLatestTradingScannerSnapshots: vi.fn(),
  loadBrokerConnection: vi.fn(),
  resolveResearchPaperPromotionApproval: vi.fn(),
  readResearchLabRemoteSnapshot: vi.fn(),
  acquirePaperTradeLock: vi.fn(),
  createCanonicalPaperTradeCycle: vi.fn(),
  recordPaperTradeRun: vi.fn(),
  readCanonicalPaperRows: vi.fn(),
  reconcileCanonicalPaperTradeRuns: vi.fn(),
  reconcileCanonicalPaperTrades: vi.fn(),
  releasePaperTradeLock: vi.fn(),
  settleCanonicalPaperRows: vi.fn(),
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
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

vi.mock("@/lib/trading/scannerSnapshotStore", () => ({
  readLatestTradingScannerSnapshots: mocks.readLatestTradingScannerSnapshots,
}));

vi.mock("@/lib/broker/store", () => ({
  loadBrokerConnection: mocks.loadBrokerConnection,
}));

vi.mock("@/lib/trading/research/paperPromotion", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trading/research/paperPromotion")>(
    "@/lib/trading/research/paperPromotion",
  );
  return {
    ...actual,
    resolveResearchPaperPromotionApproval: mocks.resolveResearchPaperPromotionApproval,
  };
});

vi.mock("@/lib/trading/research/supabaseSync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trading/research/supabaseSync")>(
    "@/lib/trading/research/supabaseSync",
  );
  return {
    ...actual,
    readResearchLabRemoteSnapshot: mocks.readResearchLabRemoteSnapshot,
  };
});

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

import { runPaperBotCycleForUser } from "@/lib/trading/bot/paperRunner";
import {
  composeTradingWatchlistEntry,
  resolveTradingActionGuidance,
  type ComposeTradingLiveDecisionInput,
} from "@/lib/trading/state";

const LIVE_BASELINE = {
  baseline_id: "baseline-live-current-xau-btc-breakout-risk-shaped",
  engine_hash: "engine-hash-abc123",
  strategy_id: "baseline-live-current-xau-btc-breakout-risk-shaped",
  validation_profile: "default_live_safe",
  dataset_profile: "core_20y",
  source: "research_live_baseline" as const,
  valid: true,
  loaded_at: "2026-07-04T08:00:00.000Z",
  invalid_reason: null,
};

const SIGNAL = {
  signal_id: "sig_contract_btcusd_execute_now",
  source: "trading_scanner" as const,
  origin: "current_live_baseline" as const,
  timestamp: "2026-07-04T08:00:00.000Z",
  baseline_id: LIVE_BASELINE.baseline_id,
  engine_hash: LIVE_BASELINE.engine_hash,
  strategy_id: LIVE_BASELINE.strategy_id,
  validation_profile: LIVE_BASELINE.validation_profile,
};

function scannerCandidate(overrides: Record<string, any> = {}): ComposeTradingLiveDecisionInput {
  const base: ComposeTradingLiveDecisionInput = {
    snapshot: {
      instrument: "BTCUSD",
      snapshotAt: "2026-07-04T08:00:00.000Z",
      marketType: "crypto" as const,
      sessionProfile: "crypto" as const,
      availableTimeframes: ["15m" as const],
      timeframes: {
        "15m": [
          {
            timestamp: "2026-07-04T08:00:00.000Z",
            open: 69900,
            high: 70100,
            low: 69850,
            close: 70000,
            volume: 100,
          },
        ],
      },
    },
    market: {
      instrument: "BTCUSD",
      snapshotAt: "2026-07-04T08:00:00.000Z",
      timeframes: ["15m" as const],
      structure: { state: "uptrend", direction: "long", score: 70, confidence: 70 },
      regime: { state: "trending", score: 70, confidence: 70 },
      volatility: { state: "normal", score: 65, confidence: 65 },
      session: { marketOpen: true, session: "ny_open", confidence: 80 },
      momentum: { state: "rising", direction: "long", score: 70, confidence: 70 },
      liquidity: { state: "healthy_participation", score: 70, confidence: 70 },
    },
    setupCore: {
      setup: {
        type: "liquidity_sweep_reversal",
        direction: "long",
        triggerLevel: 70000,
        invalidationLevel: 69800,
        confidence: 78,
      },
      maturity: { state: "ready", score: 78, confidence: 78 },
      opportunityWindow: { state: "active", score: 80, confidence: 80 },
      quality: { score: 82, grade: "A", confidence: 82 },
    },
    decisionCore: {
      clarity: { level: "high", score: 80, conflictScore: 10, alignment: 85 },
      bias: { direction: "bullish", score: 75, confidence: 75 },
      environment: { state: "favorable", score: 77, confidence: 77 },
      weighting: { contextProfile: "default", weightedScores: {}, confidence: 78 },
      decision: {
        currentState: "TRADE_VALID",
        primaryMessage: "Execute now.",
        confidence: 79,
        reasons: ["execute now"],
      },
    },
    executionPlan: {
      entryZone: {
        triggerType: "touch",
        triggerLevel: 70000,
        entryZoneLow: 69950,
        entryZoneHigh: 70050,
      },
      invalidation: {
        invalidationLevel: 69800,
        invalidationType: "hard",
        confidence: 70,
      },
      tradePath: {
        targetZone: "70400",
        primaryPath: "up",
        secondaryPath: null,
        riskRewardEstimate: 2.4,
      },
      riskFraming: {
        riskPct: 0.25,
        sizeAdjustment: 1,
        riskMode: "normal",
      },
      executionStatus: {
        executionStatus: "allowed",
        reasons: [],
        nextDisciplineStep: null,
      },
    },
    scannerSnapshot: {
      source: "provider",
      providerError: null,
      dataSymbol: "BTCUSD",
      dataRelation: "direct",
      snapshotAgeMs: 1000,
      actionableFreshness: true,
      staleReason: null,
    },
    liveBaseline: LIVE_BASELINE,
    signal: SIGNAL,
  };

  return {
    ...base,
    ...overrides,
    decisionCore: {
      ...base.decisionCore,
      ...(overrides.decisionCore || {}),
      decision: {
        ...base.decisionCore.decision,
        ...(overrides.decisionCore?.decision || {}),
      },
    },
    executionPlan: {
      ...base.executionPlan,
      ...(overrides.executionPlan || {}),
      executionStatus: {
        ...base.executionPlan.executionStatus,
        ...(overrides.executionPlan?.executionStatus || {}),
      },
    },
  };
}

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

describe("paper signal execution contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadBrokerConnection.mockRejectedValue(new Error("no broker"));
    mocks.resolveResearchPaperPromotionApproval.mockResolvedValue({
      approved: false,
      source: "missing",
      reason: "Research promotion snapshot is unavailable.",
      snapshot: null,
      matched_scope: null,
      candidate_summary: null,
    });
    mocks.readResearchLabRemoteSnapshot.mockResolvedValue({
      schemaReady: true,
      error: null,
      state: null,
      runs: [],
      decisions: [],
    });
    mocks.acquirePaperTradeLock.mockResolvedValue({
      acquired: true,
      lockAcquiredAt: "2026-07-04T08:00:01.000Z",
      lockExpiresAt: "2026-07-04T08:03:01.000Z",
    });
    mocks.releasePaperTradeLock.mockResolvedValue(true);
    mocks.reconcileCanonicalPaperTradeRuns.mockResolvedValue({
      schemaReady: true,
      error: null,
      reconciled: 0,
    });
    mocks.reconcileCanonicalPaperTrades.mockResolvedValue({
      schemaReady: true,
      error: null,
      reconciled: 0,
    });
    mocks.settleCanonicalPaperRows.mockImplementation(async ({ rows }: any) => ({
      rows,
      repaired: 0,
      failures: 0,
    }));
    mocks.getSupabaseAdmin.mockReturnValue(createJournalQueryResult([]));
  });

  it("executes a persisted EXECUTE NOW signal into canonical paper storage with accepted status", async () => {
    const candidate = scannerCandidate();
    mocks.readLatestTradingScannerSnapshots.mockResolvedValue({
      schemaReady: true,
      inputs: [candidate],
      generatedAt: "2026-07-04T08:00:00.000Z",
      excludedStaleOpenCount: 0,
      error: null,
    });

    const historyRows = [
      {
        id: "paper-1",
        title: "Paper bot BTCUSD BUY",
        created_at: "2026-07-04T08:00:00.000Z",
        details: {
          planned: { action: "ready" },
          execution: { status: "accepted", message: "Paper bracket order accepted. No real broker order was sent." },
          intent: {
            instrument: "BTCUSD",
            side: "buy",
            estimatedEntry: 70000,
            stopLoss: 69800,
            takeProfit: 70400,
            signalId: candidate.signal.signal_id,
            idempotencyKey: `owner_1:${candidate.signal.signal_id}`,
          },
          paperOutcome: {
            status: "open",
            checkedAt: "2026-07-04T08:00:00.000Z",
            closedAt: null,
            resultR: null,
            exitPrice: null,
            reason: "",
          },
          scannerContext: {
            liveBaseline: candidate.liveBaseline,
            signal: candidate.signal,
          },
        },
      },
    ];

    mocks.createCanonicalPaperTradeCycle.mockResolvedValue({
      schemaReady: true,
      error: null,
      data: {
        created: true,
        paper_trade_id: "paper-1",
        journal_entry_id: "journal-1",
      },
    });
    mocks.readCanonicalPaperRows
      .mockResolvedValueOnce({ schemaReady: true, rows: [], error: null })
      .mockResolvedValueOnce({ schemaReady: true, rows: [], error: null })
      .mockResolvedValueOnce({ schemaReady: true, rows: historyRows, error: null })
      .mockResolvedValueOnce({ schemaReady: true, rows: historyRows, error: null });

    const result = await runPaperBotCycleForUser({
      userId: "owner_1",
      triggerSource: "cron",
      cronScheduledAt: "2026-07-04T07:00:00.000Z",
      allowDuplicateIntent: true,
      maxTradesPerDay: 3,
    });

    expect(result.status).toBe("accepted");
    expect(mocks.createCanonicalPaperTradeCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "owner_1",
        source: "cron",
        trigger_source: "cron",
        instrument: "BTCUSD",
        side: "buy",
        broker: "syntrake_paper_broker",
        execution_status: "accepted",
        status: "open",
        entry_price: 70000,
        stop_price: 69800,
        target_price: 70400,
        signal_id: candidate.signal.signal_id,
        idempotency_key: `owner_1:${candidate.signal.signal_id}`,
        cron_scheduled_at: "2026-07-04T07:00:00.000Z",
        cron_fired_at: expect.any(String),
      }),
    );
    expect(result.history[0]).toMatchObject({
      instrument: "BTCUSD",
      side: "buy",
      status: "accepted",
      entry: 70000,
      stopLoss: 69800,
      takeProfit: 70400,
    });
    expect(mocks.recordPaperTradeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "cron",
        lifecycleStatus: "accepted",
        idempotencyKey: `owner_1:${candidate.signal.signal_id}`,
      }),
    );
  });

  it.each([
    ["WAIT", "allowed"],
    ["TRADE_VALID", "restricted"],
  ] as const)("does not persist a paper trade when the signal is %s / %s", async (state, executionStatus) => {
    mocks.readLatestTradingScannerSnapshots.mockResolvedValue({
      schemaReady: true,
      inputs: [
        scannerCandidate({
          decisionCore: {
            decision: {
              currentState: state,
              primaryMessage: state === "WAIT" ? "Wait." : "Restricted.",
              reasons: [state === "WAIT" ? "wait" : "restricted"],
            },
          },
          executionPlan: {
            executionStatus: {
              executionStatus,
              reasons: executionStatus === "restricted" ? ["restricted"] : [],
            },
          },
        }),
      ],
      generatedAt: "2026-07-04T08:00:00.000Z",
      excludedStaleOpenCount: 0,
      error: null,
    });
    mocks.readCanonicalPaperRows.mockResolvedValue({ schemaReady: true, rows: [], error: null });

    const result = await runPaperBotCycleForUser({
      userId: "owner_1",
      triggerSource: "cron",
      allowDuplicateIntent: true,
      maxTradesPerDay: 3,
    });

    expect(result.status).toBe("blocked");
    expect(mocks.createCanonicalPaperTradeCycle).not.toHaveBeenCalled();
  });

  it("allows Execute now only when the Current Live Baseline identity is valid", async () => {
    const withBaseline = scannerCandidate();
    const validEntry = composeTradingWatchlistEntry(withBaseline);

    expect(resolveTradingActionGuidance(validEntry)).toMatchObject({
      intent: "execute_now",
      label: "Execute now",
    });
    expect(validEntry.liveDecision.liveBaseline).toMatchObject({
      baseline_id: LIVE_BASELINE.baseline_id,
      engine_hash: LIVE_BASELINE.engine_hash,
    });
    expect(validEntry.liveDecision.signal).toMatchObject({
      signal_id: SIGNAL.signal_id,
      baseline_id: LIVE_BASELINE.baseline_id,
      engine_hash: LIVE_BASELINE.engine_hash,
    });

    const withoutBaseline = scannerCandidate({
      liveBaseline: null,
    });
    const noBaselineEntry = composeTradingWatchlistEntry(withoutBaseline);

    expect(resolveTradingActionGuidance(noBaselineEntry).intent).not.toBe("execute_now");
    expect(noBaselineEntry.liveDecision.liveBaseline).toBeNull();

    const withoutSignal = scannerCandidate({
      signal: null,
    });
    const noSignalEntry = composeTradingWatchlistEntry(withoutSignal);

    expect(resolveTradingActionGuidance(noSignalEntry).intent).not.toBe("execute_now");
    expect(noSignalEntry.liveDecision.signal).toBeNull();
  });
});
