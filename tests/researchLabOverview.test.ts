import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildResearchLabOverview } from "@/lib/ops/researchLabOverview";
import * as researchSupabaseSync from "@/lib/trading/research/supabaseSync";
import {
  appendJsonLine,
  buildResearchDatasetHealthReport,
  buildResearchRegistryReport,
  writeJsonAtomic,
  writeResearchDatasetHealthReport,
  writeResearchRegistryReport,
} from "@/lib/trading/research";

import {
  createMetricSummary,
  createResearchConfig,
  createResearchQueue,
  createResearchTask,
  createResearchTempDir,
} from "./helpers/tradingResearchFixtures";

describe("research lab overview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a read-only lab overview from local artifacts", async () => {
    const rootDir = await createResearchTempDir();
    const config = await createResearchConfig(rootDir);
    const baselineDir = path.join(config.paths.baselinesDir, config.liveBaselineSource.baselineId);

    await writeJsonAtomic(config.paths.queuePath, createResearchQueue([
      createResearchTask({
        id: "task-promoted",
        status: "completed",
        decision: "promote",
        finished_at: "2026-05-17T12:00:00.000Z",
      }),
    ]));
    await writeJsonAtomic(path.join(baselineDir, "baseline-manifest.json"), {
      baseline_id: config.liveBaselineSource.baselineId,
      created_at: "2026-05-17T10:00:00.000Z",
      dataset_profile: config.liveBaselineSource.datasetProfile,
      validation_profile: config.liveBaselineSource.validationProfile,
      dataset_manifest_hash: "dataset-hash",
      engine_manifest_hash: "engine-hash",
      source_artifacts: {
        aggregate: "aggregate.json",
        crisis: "crisis.json",
        walkforward: "walkforward.json",
      },
      live_summary: createMetricSummary({ totalTrades: 243, annualizedTrades: null }),
      crisis_summary: createMetricSummary({ totalTrades: 88, expectancy: -0.068 }),
    });
    await writeJsonAtomic(path.join(baselineDir, "aggregate-baseline.json"), {
      request: {
        periods: [
          { label: "2020", from: "2020-01-01T00:00:00.000Z", to: "2020-12-31T23:59:59.000Z" },
          { label: "2021", from: "2021-01-01T00:00:00.000Z", to: "2021-12-31T23:59:59.000Z" },
          { label: "2022", from: "2022-01-01T00:00:00.000Z", to: "2022-12-31T23:59:59.000Z" },
          { label: "2023", from: "2023-01-01T00:00:00.000Z", to: "2023-12-31T23:59:59.000Z" },
          { label: "2024", from: "2024-01-01T00:00:00.000Z", to: "2024-12-31T23:59:59.000Z" },
          { label: "2025", from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z" },
        ],
      },
      aggregate: {
        summary: {
          ...createMetricSummary({ totalTrades: 243 }),
          annualizedTrades: undefined,
        },
      },
    });
    await writeJsonAtomic(path.join(baselineDir, "crisis-baseline.json"), { ok: true });
    await writeJsonAtomic(path.join(baselineDir, "walkforward-baseline.json"), { ok: true });
    await appendJsonLine(config.paths.decisionsPath, {
      timestamp: "2026-05-17T12:30:00.000Z",
      run_id: "run-1",
      task_id: "task-promoted",
      decision: "promote",
      reason: "Validated improvement.",
      aggregate_summary: createMetricSummary({ totalTrades: 250 }),
      crisis_summary: createMetricSummary({ expectancy: 0.01 }),
      ranking_score: 88,
      ranking_band: "strong",
    });
    const datasetHealth = await buildResearchDatasetHealthReport(config);
    await writeResearchDatasetHealthReport({ config, report: datasetHealth });
    const registry = await buildResearchRegistryReport(config);
    await writeResearchRegistryReport({ config, report: registry });
    await writeJsonAtomic(path.join(config.paths.reportsDir, "boards", "promotion-board-latest.json"), {
      schema_version: "research.promotion-board-report.v1",
      provenance: {
        owner: "research_lab",
        config_path: config.paths.rootDir,
        live_baseline_id: config.liveBaselineSource.baselineId,
        dataset_manifest_hash: "",
        engine_manifest_hash: "",
        dataset_refs: [],
        upstream_report_ids: [],
      },
      report_id: "board-local",
      generated_at: "2026-05-17T12:40:00.000Z",
      live_baseline_id: config.liveBaselineSource.baselineId,
      summary: {
        task_promotes: 2,
        task_candidates: 1,
        bundle_promotes: 0,
        bundle_candidates: 0,
        review_ready_count: 2,
        watchlist_count: 1,
        bundle_confirmed_count: 0,
      },
      campaign_performance: [],
      entries: [],
      top_review_ready: [],
    });
    await writeJsonAtomic(path.join(config.paths.reportsDir, "packages", "promotion-packages-latest.json"), {
      schema_version: "research.promotion-packages-report.v1",
      provenance: {
        owner: "research_lab",
        config_path: config.paths.rootDir,
        live_baseline_id: config.liveBaselineSource.baselineId,
        dataset_manifest_hash: "",
        engine_manifest_hash: "",
        dataset_refs: [],
        upstream_report_ids: ["board-local"],
      },
      report_id: "packages-local",
      generated_at: "2026-05-17T12:41:00.000Z",
      live_baseline_id: config.liveBaselineSource.baselineId,
      summary: {
        package_count: 2,
        review_ready_count: 2,
        bundle_confirmed_count: 0,
        ready_for_live_review_count: 0,
        blocked_count: 2,
      },
      packages: [
        {
          package_id: "pkg-a",
          generated_at: "2026-05-17T12:41:00.000Z",
          baseline_id: config.liveBaselineSource.baselineId,
          entry_id: "entry-a",
          source: "task",
          board_status: "review_ready",
          decision: "promote",
          summary: "Blocked by overlap.",
          task_ids: ["task-promoted"],
          campaign_ids: ["reduce_drawdown"],
          campaign_objectives: ["reduce_drawdown"],
          primary_campaign_id: "reduce_drawdown",
          primary_campaign_objective: "reduce_drawdown",
          campaign_metadata_source: "recorded",
          campaign_mode: "single",
          run_id: "run-1",
          score: 55,
          band: "promising",
          ranking_metadata_source: "recorded",
          portfolio_stress_passed: null,
          portfolio_stress_overlap_ratio: null,
          portfolio_stress_max_concurrent: null,
          statistical_validation_passed: null,
          deflated_sharpe_ratio: null,
          pbo_estimate: null,
          white_reality_check_p_value: null,
          aggregate_summary: null,
          crisis_summary: null,
          walkforward_summary: null,
          review: {
            ready_for_live_review: false,
            blockers: ["Overlapping ready-for-live-review scope with package 'pkg-b'. Canonical Promote -> Paper handoff requires a unique scope."],
            cautions: [],
            checklist: [],
          },
          artifacts: {
            board_report_id: "board-local",
            board_json_path: null,
            board_markdown_path: null,
            bundle_report_id: null,
            bundle_json_path: null,
            bundle_markdown_path: null,
            registry_report_id: registry.report_id,
            registry_json_path: null,
            run_artifacts: [],
          },
        },
      ],
    });
    await writeJsonAtomic(path.join(config.paths.reportsDir, "reviews", "opportunity-review-latest.json"), {
      schema_version: "research.opportunity-review-report.v1",
      provenance: {
        owner: "research_lab",
        config_path: config.paths.rootDir,
        live_baseline_id: config.liveBaselineSource.baselineId,
        dataset_manifest_hash: "",
        engine_manifest_hash: "",
        dataset_refs: [],
        upstream_report_ids: ["board-local", "packages-local", registry.report_id],
      },
      report_id: "opportunity-local",
      generated_at: "2026-05-17T12:42:00.000Z",
      live_baseline_id: config.liveBaselineSource.baselineId,
      source_board_report_id: "board-local",
      source_package_report_id: "packages-local",
      source_registry_report_id: registry.report_id,
      summary: {
        reviewed_item_count: 0,
        isolated_promote_count: 0,
        isolated_candidate_count: 0,
        isolated_reject_count: 0,
        package_ready_for_live_review_count: 0,
        bundle_status: "insufficient_candidates",
      },
      items: [],
      bundle: {
        status: "insufficient_candidates",
        reason: "Need at least two ready-for-review task opportunities to validate a bundle.",
        bundle_id: null,
        task_ids: [],
        decision: null,
        comparison: null,
        portfolio_stress: null,
      },
    });
    await writeJsonAtomic(path.join(config.paths.reportsDir, "datasets", "market-data-backfill-latest.json"), {
      generatedAt: "2026-05-17T12:45:00.000Z",
      after: {
        summary: {
          instruments: 2,
          periods: 2,
          existing: 1,
          missingDownloadable: 0,
          missingManual: 1,
          unsupported: 0,
        },
        entries: [
          {
            instrument: "NAS100",
            source: "active_lab",
            group: "indices",
            localFormat: "forex_ascii_yearly_m1",
            dataSymbol: "NAS100",
            autoDownload: false,
            periods: [
              {
                label: "2026",
                status: "missing_manual",
                targetPath: path.join(rootDir, "Data", "historical", "indices", "nas100", "DAT_ASCII_NAS100_M1_2026.csv"),
                existingPath: null,
                remoteUrl: null,
                note: "Local file is required before this market can be trusted by local-only research.",
              },
            ],
          },
          {
            instrument: "XAGUSD",
            source: "staged_market",
            group: "metals",
            localFormat: "histdata_ascii_yearly_m1",
            dataSymbol: "XAGUSD",
            autoDownload: false,
            periods: [
              {
                label: "2025",
                status: "existing",
                targetPath: path.join(rootDir, "data", "historical-staging", "metals", "xagusd", "DAT_ASCII_XAGUSD_M1_2025.csv"),
                existingPath: "exists",
                remoteUrl: "https://www.histdata.com/download-free-forex-historical-data/",
                note: "Staged file exists, but this market is not active in the lab yet.",
              },
            ],
          },
        ],
      },
    });
    await writeJsonAtomic(path.join(config.paths.reportsDir, "datasets", "twelvedata-full-archive-latest.json"), {
      reportId: "td-archive-local",
      generatedAt: "2026-05-17T12:46:00.000Z",
      scope: {
        instruments: [],
        markets: ["forex"],
        timeframes: ["1m", "1d"],
        fullHistory: true,
        targetFromYear: 2020,
        targetToYear: 2025,
        download: false,
        force: false,
      },
      storage: {
        archiveRoot: path.join(rootDir, "data", "historical-twelvedata"),
        reportsDir: path.join(config.paths.reportsDir, "datasets"),
      },
      summary: {
        instruments: 1,
        timeframes: 2,
        scopeEntries: 2,
        available: 2,
        restricted: 0,
        missingRemote: 0,
        localArchiveFiles: 4,
        pendingYears: 8,
        downloaded: 0,
        existing: 0,
        failed: 0,
      },
      instruments: [
        {
          instrument: "EURUSD",
          market: "forex",
          providerSymbol: "EUR/USD",
          providerRelation: "direct",
          localArchiveFiles: 4,
          pendingYears: 8,
          availableTimeframes: 2,
          restrictedTimeframes: 0,
          missingRemoteTimeframes: 0,
          timeframes: [
            {
              timeframe: "1m",
              earliestAvailableAt: "2020-04-07T16:54:00.000Z",
              earliestAvailableYear: 2020,
              localArchiveFiles: 2,
              localArchiveYears: [2020, 2021],
              targetFromYear: 2020,
              targetToYear: 2025,
              pendingYears: [2022, 2023, 2024, 2025],
              restrictionReason: null,
              note: "Pending years can be downloaded into the dedicated Twelve Data archive root without touching the canonical archive.",
            },
            {
              timeframe: "1d",
              earliestAvailableAt: "2020-04-07T16:54:00.000Z",
              earliestAvailableYear: 2020,
              localArchiveFiles: 2,
              localArchiveYears: [2020, 2021],
              targetFromYear: 2020,
              targetToYear: 2025,
              pendingYears: [2022, 2023, 2024, 2025],
              restrictionReason: null,
              note: "Pending years can be downloaded into the dedicated Twelve Data archive root without touching the canonical archive.",
            },
          ],
        },
      ],
      sync: [],
      outputs: {
        jsonPath: path.join(config.paths.reportsDir, "datasets", "twelvedata-full-archive-latest.json"),
        markdownPath: path.join(config.paths.reportsDir, "datasets", "twelvedata-full-archive-latest.md"),
      },
    });

    const overview = await buildResearchLabOverview({
      config,
      now: new Date("2026-05-17T13:00:00.000Z"),
    });

    expect(overview.baseline?.live_summary.totalTrades).toBe(243);
    expect(overview.queue.counts.completed).toBe(1);
    expect(overview.decisions.counts.promote).toBe(1);
    expect(overview.decisions.promotedOrCandidate[0]?.runId).toBe("run-1");
    expect(overview.reports.datasetHealth?.report_id).toBe(datasetHealth.report_id);
    expect(overview.reports.registry?.report_id).toBe(registry.report_id);
    expect(overview.reports.registry?.dataset_ref_count).toBe(3);
    expect(overview.promotionReadiness.board?.reviewReadyCount).toBe(2);
    expect(overview.promotionReadiness.packages?.readyForLiveReviewCount).toBe(0);
    expect(overview.promotionReadiness.packages?.blockedCount).toBe(2);
    expect(overview.promotionReadiness.paperGate?.status).toBe("blocked");
    expect(overview.promotionReadiness.opportunity?.bundleStatus).toBe("insufficient_candidates");
    expect(overview.datasetRequirements.summary.officialGapCount).toBe(1);
    expect(overview.dataAcquisitionPlan.summary.manualCount).toBe(1);
    expect(overview.twelveDataArchive.available).toBe(true);
    expect(overview.twelveDataArchive.localArchiveFiles).toBe(4);
    expect(overview.twelveDataArchive.pendingYears).toBe(8);
    expect(overview.twelveDataArchive.fullHistory).toBe(true);
    expect(overview.twelveDataArchive.timeframesRequested).toEqual(["1m", "1d"]);
    expect(overview.twelveDataArchive.instruments[0]?.instrument).toBe("EURUSD");
    expect(overview.twelveDataArchive.instruments[0]?.timeframes).toHaveLength(2);
    expect(overview.researchIntelligence.source).toBe("canonical_artifacts");
    expect(overview.researchIntelligence.evidence.decisionEvents).toBe(1);
    expect(overview.researchIntelligence.evidence.baselineAnnualizedTrades).toBeCloseTo(40.5, 1);
    expect(overview.researchIntelligence.summary.baselineResistance.value).not.toBeNull();
    expect(overview.researchIntelligence.summary.searchSpaceCoverage.grade).toBe("insufficient_evidence");
    expect(overview.researchIntelligence.summary.overfittingRisk.grade).toBe("insufficient_evidence");
    expect(overview.storage.localArtifactBacked).toBe(true);
  });

  it("keeps local artifacts canonical even when a remote mirror is available", async () => {
    const rootDir = await createResearchTempDir();
    const config = await createResearchConfig(rootDir);
    const baselineDir = path.join(config.paths.baselinesDir, config.liveBaselineSource.baselineId);

    const remoteSpy = vi.spyOn(researchSupabaseSync, "readResearchLabRemoteSnapshot").mockResolvedValue({
      schemaReady: true,
      error: null,
      state: {
        id: "default",
        generated_at: "2026-05-17T14:00:00.000Z",
        payload: {
          runtime: { severity: "warn" },
          baseline: {
            baseline_id: "remote-baseline",
            live_summary: createMetricSummary({ totalTrades: 999 }),
          },
          queueOverview: {
            activeRunId: "remote-run",
            idleReason: null,
            counts: { completed: 99 },
            recentTasks: [],
          },
          promotionReadiness: {
            board: {
              reviewReadyCount: 2,
              watchlistCount: 1,
              bundleConfirmedCount: 0,
              taskPromotes: 2,
              taskCandidates: 1,
            },
            packages: {
              packageCount: 2,
              readyForLiveReviewCount: 0,
              blockedCount: 2,
              bundleConfirmedCount: 0,
              topBlockers: ["Overlapping ready-for-live-review scope with package 'pkg-b'."],
            },
            opportunity: {
              reviewedItemCount: 0,
              packageReadyForLiveReviewCount: 0,
              isolatedPromoteCount: 0,
              isolatedCandidateCount: 0,
              isolatedRejectCount: 0,
              bundleStatus: "insufficient_candidates",
            },
            paperGate: {
              readyPackageCount: 0,
              executableTaskScopeCount: 0,
              bundleOnlyReadyPackageCount: 0,
              status: "blocked",
            },
          },
        },
      },
      runs: [],
      decisions: [],
    });

    await writeJsonAtomic(config.paths.queuePath, createResearchQueue([
      createResearchTask({
        id: "task-local",
        status: "completed",
        decision: "reject",
        finished_at: "2026-05-17T12:00:00.000Z",
      }),
    ]));
    await writeJsonAtomic(path.join(baselineDir, "baseline-manifest.json"), {
      baseline_id: config.liveBaselineSource.baselineId,
      created_at: "2026-05-17T10:00:00.000Z",
      dataset_profile: config.liveBaselineSource.datasetProfile,
      validation_profile: config.liveBaselineSource.validationProfile,
      dataset_manifest_hash: "dataset-hash",
      engine_manifest_hash: "engine-hash",
      source_artifacts: {
        aggregate: "aggregate.json",
        crisis: "crisis.json",
        walkforward: "walkforward.json",
      },
      live_summary: createMetricSummary({ totalTrades: 243 }),
      crisis_summary: createMetricSummary({ totalTrades: 88, expectancy: -0.068 }),
    });

    const overview = await buildResearchLabOverview({
      config,
      now: new Date("2026-05-17T13:00:00.000Z"),
    });

    expect(overview.generatedAt).toBe("2026-05-17T13:00:00.000Z");
    expect(overview.baseline?.baseline_id).toBe(config.liveBaselineSource.baselineId);
    expect(overview.baseline?.live_summary.totalTrades).toBe(243);
    expect(overview.storage.localArtifactBacked).toBe(true);
    expect(overview.storage.remoteBacked).toBe(false);
    expect(overview.storage.remoteSchemaReady).toBe(false);
    expect(overview.storage.note).toContain("canonical local Research Lab artifacts");
    expect(overview.storage.note).toContain("was not queried");
    expect(remoteSpy).not.toHaveBeenCalled();
  });

  it("canonicalizes stale run status when queue and decisions already finalized the run", async () => {
    const rootDir = await createResearchTempDir();
    const config = await createResearchConfig(rootDir);
    const runId = "run-stale-status";
    const runDir = path.join(config.paths.runsDir, runId);

    await writeJsonAtomic(
      config.paths.queuePath,
      createResearchQueue([
        createResearchTask({
          id: "task-finished",
          status: "completed",
          last_run_id: runId,
          finished_at: "2026-05-17T12:10:00.000Z",
          decision: "reject",
        }),
      ]),
    );
    await writeJsonAtomic(path.join(runDir, "status.json"), {
      run_id: runId,
      task_id: "task-finished",
      status: "running",
      stage: "walkforward",
      started_at: "2026-05-17T12:00:00.000Z",
      updated_at: "2026-05-17T12:05:00.000Z",
      completed_stages: ["aggregate", "crisis"],
      failed_stage: null,
      error: null,
    });
    await appendJsonLine(config.paths.decisionsPath, {
      timestamp: "2026-05-17T12:10:00.000Z",
      run_id: runId,
      task_id: "task-finished",
      decision: "reject",
      reason: "Scientific gates rejected the candidate.",
    });

    const overview = await buildResearchLabOverview({
      config,
      now: new Date("2026-05-17T13:00:00.000Z"),
    });

    expect(overview.runs.recent[0]?.runId).toBe(runId);
    expect(overview.runs.recent[0]?.status).toBe("completed");
    expect(overview.runs.recent[0]?.stage).toBe("completed");
  });

  it("uses mirrored promotion readiness when only the remote lab state is available", async () => {
    const rootDir = await createResearchTempDir();
    const config = await createResearchConfig(rootDir);
    config.study.yearlyPeriods = [
      { label: "2020", from: "2020-01-01T00:00:00.000Z", to: "2020-12-31T23:59:59.000Z" },
      { label: "2021", from: "2021-01-01T00:00:00.000Z", to: "2021-12-31T23:59:59.000Z" },
      { label: "2022", from: "2022-01-01T00:00:00.000Z", to: "2022-12-31T23:59:59.000Z" },
      { label: "2023", from: "2023-01-01T00:00:00.000Z", to: "2023-12-31T23:59:59.000Z" },
      { label: "2024", from: "2024-01-01T00:00:00.000Z", to: "2024-12-31T23:59:59.000Z" },
      { label: "2025", from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z" },
    ];

    vi.spyOn(researchSupabaseSync, "readResearchLabRemoteSnapshot").mockResolvedValue({
      schemaReady: true,
      error: null,
      state: {
        id: "default",
        generated_at: "2026-05-18T14:00:00.000Z",
        payload: {
          runtime: { severity: "ok", queue: { activeRunId: null, idleReason: null }, lock: { health: "healthy" }, activeRun: { stage: null, stageHealth: "ok" }, backfill: {}, dataHunter: {}, alerts: [] },
          baseline: {
            baseline_id: config.liveBaselineSource.baselineId,
            created_at: "2026-05-17T10:00:00.000Z",
            dataset_profile: config.liveBaselineSource.datasetProfile,
            validation_profile: config.liveBaselineSource.validationProfile,
            dataset_manifest_hash: "dataset-hash",
            engine_manifest_hash: "engine-hash",
            source_artifacts: {
              aggregate: "aggregate.json",
              crisis: "crisis.json",
              walkforward: "walkforward.json",
            },
            live_summary: createMetricSummary({ totalTrades: 243, annualizedTrades: null }),
            crisis_summary: createMetricSummary({ totalTrades: 88 }),
          },
          queueOverview: {
            activeRunId: null,
            idleReason: null,
            counts: {},
            recentTasks: [],
          },
          promotionReadiness: {
            board: {
              reviewReadyCount: 2,
              watchlistCount: 0,
              bundleConfirmedCount: 0,
              taskPromotes: 2,
              taskCandidates: 0,
            },
            packages: {
              packageCount: 2,
              readyForLiveReviewCount: 0,
              blockedCount: 2,
              bundleConfirmedCount: 0,
              topBlockers: ["Overlapping ready-for-live-review scope with package 'pkg-b'."],
            },
            opportunity: {
              reviewedItemCount: 0,
              packageReadyForLiveReviewCount: 0,
              isolatedPromoteCount: 0,
              isolatedCandidateCount: 0,
              isolatedRejectCount: 0,
              bundleStatus: "insufficient_candidates",
            },
            paperGate: {
              readyPackageCount: 0,
              executableTaskScopeCount: 0,
              bundleOnlyReadyPackageCount: 0,
              status: "blocked",
            },
          },
          researchIntelligence: {
            generatedAt: "2026-05-18T14:00:00.000Z",
            source: "canonical_artifacts",
            summary: {
              confidence: {
                label: "Research Confidence",
                value: 80,
                unit: "score",
                grade: "healthy",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              baselineResistance: {
                label: "Baseline Strength / Resistance",
                value: 75,
                unit: "score",
                grade: "healthy",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              searchSpaceCoverage: {
                label: "Search Space Coverage",
                value: 12,
                unit: "percent",
                grade: "weak",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              promotionEfficiency: {
                label: "Promotion Efficiency",
                value: 1,
                unit: "percent",
                grade: "weak",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              candidateConversion: {
                label: "Candidate Conversion",
                value: 2,
                unit: "percent",
                grade: "weak",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              researchEfficiency: {
                label: "Research Efficiency",
                value: 12,
                unit: "score",
                grade: "weak",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              engineStability: {
                label: "Engine Stability",
                value: 90,
                unit: "percent",
                grade: "strong",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              reproducibility: {
                label: "Reproducibility",
                value: 95,
                unit: "percent",
                grade: "strong",
                evidence: "remote mirror",
                missingEvidence: [],
              },
              overfittingRisk: {
                label: "Overfitting Risk",
                value: 30,
                unit: "risk",
                grade: "healthy",
                evidence: "remote mirror",
                missingEvidence: [],
              },
            },
            evidence: {
              queueTasks: 0,
              completedTasks: 0,
              failedTasks: 0,
              decisionEvents: 0,
              scientificRejects: 0,
              operationalFailures: 0,
              candidates: 0,
              promotes: 0,
              rejectGateBreakdown: {},
              enabledTemplates: 0,
              exploredTemplates: 0,
              templatesPerCandidate: null,
              templatesUntilFirstCandidate: null,
              scientificRunsPerCandidate: null,
              firstCandidateAfterDecisions: null,
              hoursToFirstCandidate: null,
              baselineId: null,
              baselineTradeCount: null,
              baselineAnnualizedTrades: null,
              crisisTradeCount: null,
              comparisonsInspected: 0,
              comparisonsWithStatisticalValidation: 0,
            },
          },
          reportsOverview: {
            bundleValidation: null,
            promotionBoard: null,
            promotionPackages: null,
            opportunityReview: null,
            datasetHealth: null,
            registry: null,
          },
        },
      },
      runs: [],
      decisions: [],
    });

    const overview = await buildResearchLabOverview({
      config,
      now: new Date("2026-05-18T15:00:00.000Z"),
    });

    expect(overview.storage.remoteBacked).toBe(true);
    expect(overview.storage.localArtifactBacked).toBe(false);
    expect(overview.promotionReadiness.packages?.blockedCount).toBe(2);
    expect(overview.promotionReadiness.paperGate?.status).toBe("blocked");
    expect(overview.researchIntelligence.summary.confidence.value).toBe(80);
    expect(overview.researchIntelligence.evidence.baselineAnnualizedTrades).toBeCloseTo(40.5, 1);
  });
});
