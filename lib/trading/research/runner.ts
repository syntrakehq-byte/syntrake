import path from "node:path";

import {
  runTradingSecondLayerRiskStudy,
  runTradingContextBlockStudy,
  type TradingContextBlockStudyScenario,
  type TradingSecondLayerRiskStudyScenario,
} from "@/lib/trading/backtest";

import {
  buildResearchRunArtifactPaths,
  initializeResearchRunArtifacts,
  writeResearchDecisionArtifact,
  writeResearchFailureArtifacts,
  writeResearchRunChecksums,
} from "./artifactContract";
import { ensureResearchBaselineSnapshot } from "./baseline";
import { loadResearchConfig } from "./config";
import { decideResearchRun } from "./decisionEngine";
import { buildResearchDatasetHealthReport, writeResearchDatasetHealthReport } from "./datasetHealth";
import { classifyResearchFailure } from "./forensics";
import { buildResearchMetricSummary } from "./metrics";
import { ensureDirectory, appendJsonLine, fileExists, readJsonFile, writeJsonAtomic } from "./fs";
import { computeResearchTaskFingerprint, readFingerprintIndexEntry, writeRunIndexEntry, type ResearchRunIndexEntry } from "./idempotency";
import { acquireResearchLock, classifyResearchLockHealth, readResearchLock, releaseResearchLock, updateResearchLockHeartbeat } from "./lock";
import { runResearchContextMonteCarloValidation, runResearchRiskMonteCarloValidation } from "./monteCarlo";
import { buildResearchPromotionBoard, writeResearchPromotionBoard } from "./promotionBoard";
import { buildResearchPromotionPackageReport, writeResearchPromotionPackageReport } from "./promotionPackages";
import { readResearchQueue, selectNextResearchTask, setResearchQueueActiveRun, updateResearchTaskStatus, writeResearchQueue, finalizeResearchTask } from "./queue";
import { autoEnqueueNextResearchTask, getSupportedPlannerTaskTypes } from "./planner";
import { buildResearchPreservationReport, writeResearchPreservationReport } from "./preservation";
import { recoverResearchRunner } from "./recovery";
import {
  runResearchContextCostStressValidation,
  runResearchContextFinalHoldoutValidation,
  runResearchContextRobustnessValidation,
  runResearchRiskCostStressValidation,
  runResearchRiskFinalHoldoutValidation,
  runResearchRiskRobustnessValidation,
} from "./robustness";
import {
  buildDailyResearchReport,
  buildResearchCycleReport,
  buildResearchWindowReport,
  writeDailyResearchReport,
  writeResearchCycleReport,
  writeResearchWindowReport,
} from "./report";
import { refreshResearchBundleValidationReportIfNeeded } from "./bundleValidation";
import {
  buildResearchOpportunityReviewReport,
  writeResearchOpportunityReviewReport,
} from "./opportunityReview";
import {
  buildResearchNegativeKnowledgeReport,
  writeResearchNegativeKnowledgeReport,
} from "./negativeKnowledge";
import { buildResearchRegistryReport, writeResearchRegistryReport } from "./registry";
import { buildResearchStatisticalValidation } from "./statisticalValidation";
import { resolveEffectiveResearchInstruments } from "./taskScope";
import { evaluateResearchValidationGates } from "./validationGates";
import type { TradingHistoricalPeriod } from "@/lib/trading/backtest/periods";
import type {
  ResearchConfig,
  ResearchDecisionLedgerEntry,
  ResearchMetricSummary,
  ResearchPostCycleOpportunityOutputs,
  ResearchProcessReportOutputs,
  ResearchRunComparison,
  ResearchRunDecision,
  ResearchRunManifest,
  ResearchRunStatus,
  ResearchSupplementalValidation,
  ResearchTask,
  ResearchTaskExecutorContext,
  ResearchTaskExecutor,
  ResearchTaskExecutorMap,
  ResearchTaskRunnerDependencies,
} from "./types";
import type { TradingBacktestTrade } from "@/lib/trading/backtest/types";

export function buildMetricSummary(
  input: Partial<ResearchMetricSummary> | ResearchMetricSummary | null | undefined,
  annualizationPeriods?: TradingHistoricalPeriod[] | null,
): ResearchMetricSummary {
  return buildResearchMetricSummary(input, annualizationPeriods);
}

export function buildResearchRiskScenarioFromTask(args: {
  task: ResearchTask;
  fallbackInstruments: string[];
}): TradingSecondLayerRiskStudyScenario {
  const task = args.task;
  const mutation = task.candidate_mutation;
  if (mutation.kind !== "risk_multiplier" && mutation.kind !== "aggressive_risk_cap") {
    throw new Error(`Unsupported risk_shaping mutation '${mutation.kind}'.`);
  }

  const instruments = resolveEffectiveResearchInstruments({
    scope: args.task.candidate_scope,
    fallbackInstruments: args.fallbackInstruments,
  });
  if (instruments.length === 0) {
    throw new Error(
      `Research task "${args.task.id}" must target at least one instrument or provide study instruments.`,
    );
  }

  return {
    id: task.id,
    description: task.notes ?? task.id,
    rules: instruments.map((instrument) => ({
      instrument,
      sessions: task.candidate_scope.sessions as any,
      setupTypes: task.candidate_scope.setup_types as any,
      riskModes: task.candidate_scope.risk_modes as any,
      executionStatuses: task.candidate_scope.execution_statuses as any,
      qualityGrades: task.candidate_scope.quality_grades as any,
      clarityLevels: task.candidate_scope.clarity_levels as any,
      environmentStates: task.candidate_scope.environment_states as any,
      riskMultiplier: mutation.kind === "risk_multiplier" ? mutation.value : null,
      riskPct: mutation.kind === "aggressive_risk_cap" ? mutation.value : null,
      reason: `Research task ${task.id}`,
    })),
  };
}

export function buildResearchContextScenarioFromTask(args: {
  task: ResearchTask;
  fallbackInstruments: string[];
}): TradingContextBlockStudyScenario {
  const task = args.task;
  if (task.candidate_mutation.kind !== "blocked_context") {
    throw new Error(`Unsupported context_filter mutation '${task.candidate_mutation.kind}'.`);
  }

  const instruments = resolveEffectiveResearchInstruments({
    scope: args.task.candidate_scope,
    fallbackInstruments: args.fallbackInstruments,
  });
  if (instruments.length === 0) {
    throw new Error(
      `Research task "${args.task.id}" must target at least one instrument or provide study instruments.`,
    );
  }

  return {
    id: task.id,
    description: task.notes ?? task.id,
    rules: instruments.map((instrument) => ({
      instrument,
      sessions: task.candidate_scope.sessions as any,
      setupTypes: task.candidate_scope.setup_types as any,
      qualityGrades: task.candidate_scope.quality_grades as any,
      clarityLevels: task.candidate_scope.clarity_levels as any,
      environmentStates: task.candidate_scope.environment_states as any,
      reason: `Research task ${task.id}`,
    })),
  };
}

function buildRunId(task: ResearchTask, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `run-${stamp}-${task.id}`;
}

function buildInitialRunStatus(runId: string, taskId: string, startedAt: string): ResearchRunStatus {
  return {
    run_id: runId,
    task_id: taskId,
    status: "running",
    stage: "aggregate",
    started_at: startedAt,
    updated_at: startedAt,
    stage_started_at: startedAt,
    stage_elapsed_ms: 0,
    progress_note: "Starting aggregate/crisis/walk-forward evaluation.",
    completed_stages: [],
    failed_stage: null,
    error: null,
  };
}

function buildRunStatusHeartbeat(
  status: ResearchRunStatus,
  stage: ResearchRunStatus["stage"],
  overrides: Partial<ResearchRunStatus> = {},
): ResearchRunStatus {
  const now = new Date();
  const updatedAt = now.toISOString();
  const stageStartedAt =
    status.stage === stage
      ? status.stage_started_at ?? status.started_at
      : updatedAt;
  const stageStartedMs = new Date(stageStartedAt).getTime();
  const stageElapsedMs = Number.isFinite(stageStartedMs)
    ? Math.max(0, now.getTime() - stageStartedMs)
    : 0;

  return {
    ...status,
    ...overrides,
    stage,
    updated_at: updatedAt,
    stage_started_at: overrides.stage_started_at ?? stageStartedAt,
    stage_elapsed_ms: overrides.stage_elapsed_ms ?? stageElapsedMs,
  };
}

function buildPromotedMetrics(comparison: ResearchRunComparison): Record<string, number | null> {
  return {
    aggregateExpectancy: comparison.aggregate.current.expectancy,
    aggregateProfitFactor: comparison.aggregate.current.profitFactor,
    crisisExpectancy: comparison.crisis.current.expectancy,
    crisisProfitFactor: comparison.crisis.current.profitFactor,
    walkForwardExpectancy: comparison.walkForward.current.expectancy,
    walkForwardProfitFactor: comparison.walkForward.current.profitFactor,
    holdoutExpectancy: comparison.robustness?.holdout?.current.expectancy ?? null,
    holdoutProfitFactor: comparison.robustness?.holdout?.current.profitFactor ?? null,
    finalHoldoutExpectancy: comparison.robustness?.finalHoldout?.current.expectancy ?? null,
    finalHoldoutProfitFactor: comparison.robustness?.finalHoldout?.current.profitFactor ?? null,
    perturbationExpectancy: comparison.robustness?.perturbation?.current.expectancy ?? null,
    perturbationProfitFactor: comparison.robustness?.perturbation?.current.profitFactor ?? null,
    monteCarloExpectancy: comparison.robustness?.monteCarlo?.current.expectancy ?? null,
    monteCarloProfitFactor: comparison.robustness?.monteCarlo?.current.profitFactor ?? null,
    monteCarloMaxDrawdown: comparison.robustness?.monteCarlo?.current.maxDrawdown ?? null,
    costStressExpectancy: comparison.robustness?.costStress?.current.expectancy ?? null,
    costStressProfitFactor: comparison.robustness?.costStress?.current.profitFactor ?? null,
    costStressMaxDrawdown: comparison.robustness?.costStress?.current.maxDrawdown ?? null,
  };
}

function buildResearchComparison(args: {
  aggregateBaseline: ResearchMetricSummary;
  aggregateCurrent: ResearchMetricSummary;
  crisisBaseline: ResearchMetricSummary;
  crisisCurrent: ResearchMetricSummary;
  walkForwardBaseline: ResearchMetricSummary;
  walkForwardCurrent: ResearchMetricSummary;
  affectedInstruments: string[];
  thresholds: ResearchConfig["validationProfiles"][keyof ResearchConfig["validationProfiles"]]["thresholds"];
  robustness?: ResearchSupplementalValidation | null;
  baselineTrades?: TradingBacktestTrade[];
  currentTrades?: TradingBacktestTrade[];
  independentTrialCount?: number;
  annualizationPeriods?: TradingHistoricalPeriod[] | null;
}): ResearchRunComparison {
  const aggregateBaseline = buildMetricSummary(
    args.aggregateBaseline,
    args.annualizationPeriods,
  );
  const aggregateCurrent = buildMetricSummary(args.aggregateCurrent, args.annualizationPeriods);
  const crisisBaseline = buildMetricSummary(args.crisisBaseline);
  const crisisCurrent = buildMetricSummary(args.crisisCurrent);
  const walkForwardBaseline = buildMetricSummary(args.walkForwardBaseline);
  const walkForwardCurrent = buildMetricSummary(args.walkForwardCurrent);

  const statisticalValidation =
    Array.isArray(args.baselineTrades) &&
    args.baselineTrades.length > 0 &&
    Array.isArray(args.currentTrades) &&
    args.currentTrades.length > 0
      ? buildResearchStatisticalValidation({
          baselineTrades: args.baselineTrades,
          currentTrades: args.currentTrades,
          aggregateCurrent,
          walkForwardCurrent,
          robustness: args.robustness,
          independentTrialCount: args.independentTrialCount ?? 1,
        })
      : null;

  return {
    aggregate: {
      baseline: aggregateBaseline,
      current: aggregateCurrent,
    },
    crisis: {
      baseline: crisisBaseline,
      current: crisisCurrent,
    },
    walkForward: {
      baseline: walkForwardBaseline,
      current: walkForwardCurrent,
      affectedInstruments: args.affectedInstruments,
    },
    robustness: args.robustness,
    statistical_validation: statisticalValidation,
    gates: evaluateResearchValidationGates({
      aggregateBaseline,
      aggregateCurrent,
      crisisBaseline,
      crisisCurrent,
      walkForwardBaseline,
      walkForwardCurrent,
      holdoutBaseline: args.robustness?.holdout?.baseline,
      holdoutCurrent: args.robustness?.holdout?.current,
      finalHoldoutBaseline: args.robustness?.finalHoldout?.baseline,
      finalHoldoutCurrent: args.robustness?.finalHoldout?.current,
      perturbationBaseline: args.robustness?.perturbation?.baseline,
      perturbationCurrent: args.robustness?.perturbation?.current,
      monteCarloBaseline: args.robustness?.monteCarlo?.baseline,
      monteCarloCurrent: args.robustness?.monteCarlo?.current,
      costStressBaseline: args.robustness?.costStress?.baseline,
      costStressCurrent: args.robustness?.costStress?.current,
      statisticalValidation: statisticalValidation ?? undefined,
      thresholds: args.thresholds,
    }),
  };
}

async function reportBacktestProgress(
  context: ResearchTaskExecutorContext,
  progress: {
    stage: "aggregate" | "crisis" | "walkforward";
    scenarioId?: string;
    message: string;
  },
) {
  const completed: ResearchRunStatus["completed_stages"] =
    progress.stage === "aggregate"
      ? []
      : progress.stage === "crisis"
        ? ["aggregate"]
        : ["aggregate", "crisis"];
  await context.reportProgress?.({
    stage: progress.stage,
    progress_note: progress.message,
    completed_stages: completed,
  });
}

export function buildDefaultResearchExecutorMap(): ResearchTaskExecutorMap {
  const riskShapingExecutor: ResearchTaskExecutor = async (context) => {
    const scenario = buildResearchRiskScenarioFromTask({
      task: context.task,
      fallbackInstruments: context.config.study.instruments,
    });
    const report = await runTradingSecondLayerRiskStudy({
      yearlyPeriods: context.config.study.yearlyPeriods,
      crisisPeriods: context.config.study.crisisPeriods,
      scenarios: [scenario],
      instruments: context.config.study.instruments,
      timeframes: context.config.study.timeframes,
      sourcePreference: context.config.study.sourcePreference,
      walkForward: {
        mode: "actual",
        from: context.config.study.walkForward.from,
        to: context.config.study.walkForward.to,
        windowing: context.config.study.walkForward.windowing,
      },
      backtest: {
        captureSteps: false,
      },
      baseline: {
        yearlyComparatives: [context.baseline.aggregateComparative],
        crisisComparatives: [context.baseline.crisisComparative],
      },
      onProgress: (progress) => reportBacktestProgress(context, progress),
    });

    const scenarioResult = report.scenarios[0];
    const walkKey = scenarioResult.affectedInstruments.slice().sort().join(",");
    const walkBaseline = report.baseline.walkForwardByAffectedInstruments[walkKey];
    const thresholds = context.config.validationProfiles[context.task.validation_profile].thresholds;
    await context.reportProgress?.({
      stage: "robustness",
      progress_note: "Running holdout, perturbation, and stress robustness checks.",
      completed_stages: ["aggregate", "crisis", "walkforward"],
    });
    let robustness = await runResearchRiskRobustnessValidation({
      context,
      scenario,
      affectedInstruments: scenarioResult.affectedInstruments,
    });
    let comparison = buildResearchComparison({
      aggregateBaseline: report.baseline.aggregate,
      aggregateCurrent: scenarioResult.aggregate.current,
      crisisBaseline: report.baseline.crisis,
      crisisCurrent: scenarioResult.crisis.current,
      walkForwardBaseline: walkBaseline,
      walkForwardCurrent: scenarioResult.walkForward.current,
      affectedInstruments: scenarioResult.affectedInstruments,
      thresholds,
      robustness,
      baselineTrades: report.baseline.aggregateTrades,
      currentTrades: scenarioResult.aggregate.trades,
      independentTrialCount: 1,
      annualizationPeriods: context.config.study.yearlyPeriods,
    });

    if (context.config.study.robustness?.monteCarlo?.enabled && comparison.gates.allHardGatesPass) {
      await context.reportProgress?.({
        stage: "robustness",
        progress_note: "Running Monte Carlo robustness validation.",
        completed_stages: ["aggregate", "crisis", "walkforward"],
      });
      const monteCarlo = await runResearchRiskMonteCarloValidation({
        context,
        scenario,
        affectedInstruments: scenarioResult.affectedInstruments,
      });
      robustness = {
        ...(robustness ?? {}),
        monteCarlo,
      };
      comparison = buildResearchComparison({
        aggregateBaseline: report.baseline.aggregate,
        aggregateCurrent: scenarioResult.aggregate.current,
        crisisBaseline: report.baseline.crisis,
        crisisCurrent: scenarioResult.crisis.current,
        walkForwardBaseline: walkBaseline,
        walkForwardCurrent: scenarioResult.walkForward.current,
        affectedInstruments: scenarioResult.affectedInstruments,
        thresholds,
        robustness,
        baselineTrades: report.baseline.aggregateTrades,
        currentTrades: scenarioResult.aggregate.trades,
        independentTrialCount: 1,
        annualizationPeriods: context.config.study.yearlyPeriods,
      });
    }

    if (context.config.study.robustness?.finalHoldout?.enabled && comparison.gates.allHardGatesPass) {
      await context.reportProgress?.({
        stage: "robustness",
        progress_note: "Running final holdout robustness validation.",
        completed_stages: ["aggregate", "crisis", "walkforward"],
      });
      const finalHoldout = await runResearchRiskFinalHoldoutValidation({
        context,
        scenario,
        affectedInstruments: scenarioResult.affectedInstruments,
      });
      robustness = {
        ...(robustness ?? {}),
        finalHoldout,
      };
      comparison = buildResearchComparison({
        aggregateBaseline: report.baseline.aggregate,
        aggregateCurrent: scenarioResult.aggregate.current,
        crisisBaseline: report.baseline.crisis,
        crisisCurrent: scenarioResult.crisis.current,
        walkForwardBaseline: walkBaseline,
        walkForwardCurrent: scenarioResult.walkForward.current,
        affectedInstruments: scenarioResult.affectedInstruments,
        thresholds,
        robustness,
        baselineTrades: report.baseline.aggregateTrades,
        currentTrades: scenarioResult.aggregate.trades,
        independentTrialCount: 1,
        annualizationPeriods: context.config.study.yearlyPeriods,
      });
    }

    if (context.config.study.robustness?.costStress?.enabled && comparison.gates.allHardGatesPass) {
      await context.reportProgress?.({
        stage: "robustness",
        progress_note: "Running cost-stress robustness validation.",
        completed_stages: ["aggregate", "crisis", "walkforward"],
      });
      const costStress = await runResearchRiskCostStressValidation({
        context,
        scenario,
        affectedInstruments: scenarioResult.affectedInstruments,
      });
      robustness = {
        ...(robustness ?? {}),
        costStress,
      };
      comparison = buildResearchComparison({
        aggregateBaseline: report.baseline.aggregate,
        aggregateCurrent: scenarioResult.aggregate.current,
        crisisBaseline: report.baseline.crisis,
        crisisCurrent: scenarioResult.crisis.current,
        walkForwardBaseline: walkBaseline,
        walkForwardCurrent: scenarioResult.walkForward.current,
        affectedInstruments: scenarioResult.affectedInstruments,
        thresholds,
        robustness,
        baselineTrades: report.baseline.aggregateTrades,
        currentTrades: scenarioResult.aggregate.trades,
        independentTrialCount: 1,
        annualizationPeriods: context.config.study.yearlyPeriods,
      });
    }

    return {
      affectedInstruments: scenarioResult.affectedInstruments,
      comparison,
      artifacts: {
        aggregateReport: {
          baseline: report.baseline.aggregate,
          current: scenarioResult.aggregate.current,
          delta: scenarioResult.aggregate.delta,
        },
        crisisReport: {
          baseline: report.baseline.crisis,
          current: scenarioResult.crisis.current,
          delta: scenarioResult.crisis.delta,
        },
        walkForwardReport: {
          baseline: walkBaseline,
          current: scenarioResult.walkForward.current,
          delta: scenarioResult.walkForward.delta,
          robustness,
        },
      },
    };
  };

  const contextFilterExecutor: ResearchTaskExecutor = async (context) => {
    const scenario = buildResearchContextScenarioFromTask({
      task: context.task,
      fallbackInstruments: context.config.study.instruments,
    });
    const report = await runTradingContextBlockStudy({
      yearlyPeriods: context.config.study.yearlyPeriods,
      crisisPeriods: context.config.study.crisisPeriods,
      scenarios: [scenario],
      instruments: context.config.study.instruments,
      timeframes: context.config.study.timeframes,
      sourcePreference: context.config.study.sourcePreference,
      walkForward: {
        from: context.config.study.walkForward.from,
        to: context.config.study.walkForward.to,
        windowing: context.config.study.walkForward.windowing,
      },
      backtest: {
        captureSteps: false,
      },
      baseline: {
        yearlyComparatives: [context.baseline.aggregateComparative],
        crisisComparatives: [context.baseline.crisisComparative],
      },
      onProgress: (progress) => reportBacktestProgress(context, progress),
    });

    const scenarioResult = report.scenarios[0];
    const walkKey = scenarioResult.affectedInstruments.slice().sort().join(",");
    const walkBaseline = report.baseline.walkForwardByAffectedInstruments[walkKey];
    const thresholds = context.config.validationProfiles[context.task.validation_profile].thresholds;
    await context.reportProgress?.({
      stage: "robustness",
      progress_note: "Running holdout, perturbation, and stress robustness checks.",
      completed_stages: ["aggregate", "crisis", "walkforward"],
    });
    let robustness = await runResearchContextRobustnessValidation({
      context,
      scenario,
      affectedInstruments: scenarioResult.affectedInstruments,
    });
    let comparison = buildResearchComparison({
      aggregateBaseline: report.baseline.aggregate,
      aggregateCurrent: scenarioResult.aggregate.current,
      crisisBaseline: report.baseline.crisis,
      crisisCurrent: scenarioResult.crisis.current,
      walkForwardBaseline: walkBaseline,
      walkForwardCurrent: scenarioResult.walkForward.current,
      affectedInstruments: scenarioResult.affectedInstruments,
      thresholds,
      robustness,
      baselineTrades: report.baseline.aggregateTrades,
      currentTrades: scenarioResult.aggregate.trades,
      independentTrialCount: 1,
      annualizationPeriods: context.config.study.yearlyPeriods,
    });

    if (context.config.study.robustness?.monteCarlo?.enabled && comparison.gates.allHardGatesPass) {
      await context.reportProgress?.({
        stage: "robustness",
        progress_note: "Running Monte Carlo robustness validation.",
        completed_stages: ["aggregate", "crisis", "walkforward"],
      });
      const monteCarlo = await runResearchContextMonteCarloValidation({
        context,
        scenario,
        affectedInstruments: scenarioResult.affectedInstruments,
      });
      robustness = {
        ...(robustness ?? {}),
        monteCarlo,
      };
      comparison = buildResearchComparison({
        aggregateBaseline: report.baseline.aggregate,
        aggregateCurrent: scenarioResult.aggregate.current,
        crisisBaseline: report.baseline.crisis,
        crisisCurrent: scenarioResult.crisis.current,
        walkForwardBaseline: walkBaseline,
        walkForwardCurrent: scenarioResult.walkForward.current,
        affectedInstruments: scenarioResult.affectedInstruments,
        thresholds,
        robustness,
        baselineTrades: report.baseline.aggregateTrades,
        currentTrades: scenarioResult.aggregate.trades,
        independentTrialCount: 1,
        annualizationPeriods: context.config.study.yearlyPeriods,
      });
    }

    if (context.config.study.robustness?.finalHoldout?.enabled && comparison.gates.allHardGatesPass) {
      await context.reportProgress?.({
        stage: "robustness",
        progress_note: "Running final holdout robustness validation.",
        completed_stages: ["aggregate", "crisis", "walkforward"],
      });
      const finalHoldout = await runResearchContextFinalHoldoutValidation({
        context,
        scenario,
        affectedInstruments: scenarioResult.affectedInstruments,
      });
      robustness = {
        ...(robustness ?? {}),
        finalHoldout,
      };
      comparison = buildResearchComparison({
        aggregateBaseline: report.baseline.aggregate,
        aggregateCurrent: scenarioResult.aggregate.current,
        crisisBaseline: report.baseline.crisis,
        crisisCurrent: scenarioResult.crisis.current,
        walkForwardBaseline: walkBaseline,
        walkForwardCurrent: scenarioResult.walkForward.current,
        affectedInstruments: scenarioResult.affectedInstruments,
        thresholds,
        robustness,
        baselineTrades: report.baseline.aggregateTrades,
        currentTrades: scenarioResult.aggregate.trades,
        independentTrialCount: 1,
        annualizationPeriods: context.config.study.yearlyPeriods,
      });
    }

    if (context.config.study.robustness?.costStress?.enabled && comparison.gates.allHardGatesPass) {
      await context.reportProgress?.({
        stage: "robustness",
        progress_note: "Running cost-stress robustness validation.",
        completed_stages: ["aggregate", "crisis", "walkforward"],
      });
      const costStress = await runResearchContextCostStressValidation({
        context,
        scenario,
        affectedInstruments: scenarioResult.affectedInstruments,
      });
      robustness = {
        ...(robustness ?? {}),
        costStress,
      };
      comparison = buildResearchComparison({
        aggregateBaseline: report.baseline.aggregate,
        aggregateCurrent: scenarioResult.aggregate.current,
        crisisBaseline: report.baseline.crisis,
        crisisCurrent: scenarioResult.crisis.current,
        walkForwardBaseline: walkBaseline,
        walkForwardCurrent: scenarioResult.walkForward.current,
        affectedInstruments: scenarioResult.affectedInstruments,
        thresholds,
        robustness,
        baselineTrades: report.baseline.aggregateTrades,
        currentTrades: scenarioResult.aggregate.trades,
        independentTrialCount: 1,
        annualizationPeriods: context.config.study.yearlyPeriods,
      });
    }

    return {
      affectedInstruments: scenarioResult.affectedInstruments,
      comparison,
      artifacts: {
        aggregateReport: {
          baseline: report.baseline.aggregate,
          current: scenarioResult.aggregate.current,
          delta: scenarioResult.aggregate.delta,
        },
        crisisReport: {
          baseline: report.baseline.crisis,
          current: scenarioResult.crisis.current,
          delta: scenarioResult.crisis.delta,
        },
        walkForwardReport: {
          baseline: walkBaseline,
          current: scenarioResult.walkForward.current,
          delta: scenarioResult.walkForward.delta,
          robustness,
        },
      },
    };
  };

  return {
    risk_shaping: riskShapingExecutor,
    context_filter: contextFilterExecutor,
  };
}

async function refreshResearchOpportunities(
  config: ResearchConfig,
): Promise<ResearchPostCycleOpportunityOutputs> {
  const bundleRefresh = await refreshResearchBundleValidationReportIfNeeded({
    config,
  });
  const boardReport = await buildResearchPromotionBoard(config);
  const boardOutputs = await writeResearchPromotionBoard({
    config,
    report: boardReport,
  });
  const packageReport = await buildResearchPromotionPackageReport({
    config,
    boardReport,
  });
  const packageOutputs = await writeResearchPromotionPackageReport({
    config,
    report: packageReport,
  });
  const opportunityReviewReport = await buildResearchOpportunityReviewReport(config, {
    boardReport,
    packageReport,
  });
  const opportunityReviewOutputs = await writeResearchOpportunityReviewReport({
    config,
    report: opportunityReviewReport,
  });
  const datasetHealthReport = await buildResearchDatasetHealthReport(config);
  const datasetHealthOutputs = await writeResearchDatasetHealthReport({
    config,
    report: datasetHealthReport,
  });
  const registryReport = await buildResearchRegistryReport(config);
  const registryOutputs = await writeResearchRegistryReport({
    config,
    report: registryReport,
  });
  const negativeKnowledgeReport = await buildResearchNegativeKnowledgeReport(config);
  const negativeKnowledgeOutputs = await writeResearchNegativeKnowledgeReport({
    config,
    report: negativeKnowledgeReport,
  });
  const preservationReport = await buildResearchPreservationReport(config);
  const preservationOutputs = await writeResearchPreservationReport({
    config,
    report: preservationReport,
  });

  return {
    bundle: bundleRefresh.report
      ? {
          refreshed: bundleRefresh.refreshed,
          jsonPath: bundleRefresh.outputs?.jsonPath ?? null,
          markdownPath: bundleRefresh.outputs?.markdownPath ?? null,
        }
      : null,
    board: {
      jsonPath: boardOutputs.latestJsonPath,
      markdownPath: boardOutputs.latestMarkdownPath,
    },
    packages: {
      jsonPath: packageOutputs.latestJsonPath,
      markdownPath: packageOutputs.latestMarkdownPath,
    },
    review: {
      jsonPath: opportunityReviewOutputs.latestJsonPath,
      markdownPath: opportunityReviewOutputs.latestMarkdownPath,
    },
    datasetHealth: {
      jsonPath: datasetHealthOutputs.latestJsonPath,
      markdownPath: datasetHealthOutputs.latestMarkdownPath,
    },
    registry: {
      jsonPath: registryOutputs.latestJsonPath,
      markdownPath: registryOutputs.latestMarkdownPath,
    },
    knowledgeBase: negativeKnowledgeOutputs,
    preservation: preservationOutputs,
  };
}

async function appendDecisionLedgerEntry(
  config: ResearchConfig,
  entry: ResearchDecisionLedgerEntry,
): Promise<void> {
  await appendJsonLine(config.paths.decisionsPath, entry);
}

async function finalizeTaskFromIndexedRun(args: {
  config: ResearchConfig;
  task: ResearchTask;
  runIndex: ResearchRunIndexEntry;
}): Promise<void> {
  const queue = await readResearchQueue(args.config);
  const decision = await readJsonFile<ResearchRunDecision>(args.runIndex.decision_path);
  const runningQueue = updateResearchTaskStatus(queue, args.task.id, "running", {
    started_at: new Date().toISOString(),
    last_run_id: args.runIndex.run_id,
    run_fingerprint: args.runIndex.run_fingerprint,
  });
  const awaitingDecisionQueue = updateResearchTaskStatus(
    setResearchQueueActiveRun(runningQueue, args.runIndex.run_id),
    args.task.id,
    "awaiting_decision",
    {
      last_run_id: args.runIndex.run_id,
      run_fingerprint: args.runIndex.run_fingerprint,
    },
  );
  const completed = finalizeResearchTask(awaitingDecisionQueue, args.task.id, {
    status: "completed",
    finishedAt: new Date().toISOString(),
    runId: args.runIndex.run_id,
    runFingerprint: args.runIndex.run_fingerprint,
    decision: decision.decision,
    decisionReason: `Reused completed run: ${decision.reason}`,
  });
  await writeResearchQueue(args.config, completed);
  await appendDecisionLedgerEntry(args.config, {
    event_id: `evt-reuse-${args.runIndex.run_id}`,
    timestamp: new Date().toISOString(),
    run_id: args.runIndex.run_id,
    task_id: args.task.id,
    baseline_id: args.task.baseline_id,
    run_fingerprint: args.runIndex.run_fingerprint,
    decision: decision.decision,
    reason: `Reused completed run: ${decision.reason}`,
    planner_family_id: args.task.planner_source?.family_id ?? null,
    planner_template_id: args.task.planner_source?.template_id ?? null,
    planner_campaign_id: args.task.planner_source?.campaign_id ?? null,
    planner_campaign_objective: args.task.planner_source?.campaign_objective ?? null,
    ranking_score: decision.ranking?.score ?? null,
    ranking_band: decision.ranking?.band ?? null,
    failure_forensics: decision.failure_forensics ?? null,
  });
}

async function runSingleResearchTask(
  config: ResearchConfig,
  task: ResearchTask,
  dependencies: ResearchTaskRunnerDependencies,
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const pid = dependencies.pid ?? (() => process.pid);
  const executors = {
    ...buildDefaultResearchExecutorMap(),
    ...(dependencies.executors ?? {}),
  };

  const executor = executors[task.type];
  if (!executor) {
    const queue = await readResearchQueue(config);
    const blocked = finalizeResearchTask(queue, task.id, {
      status: "blocked",
      finishedAt: now().toISOString(),
      runId: null,
      runFingerprint: null,
      decision: null,
      decisionReason: `Unsupported research task type '${task.type}'.`,
      error: `Unsupported research task type '${task.type}'.`,
    });
    await writeResearchQueue(config, blocked);
    return;
  }

  if (
    resolveEffectiveResearchInstruments({
      scope: task.candidate_scope,
      fallbackInstruments: config.study.instruments,
    }).length === 0
  ) {
    const queue = await readResearchQueue(config);
    const blocked = finalizeResearchTask(queue, task.id, {
      status: "blocked",
      finishedAt: now().toISOString(),
      runId: null,
      runFingerprint: null,
      decision: null,
      decisionReason: `Research task "${task.id}" does not resolve to any effective instrument.`,
      error: `Research task "${task.id}" must target at least one instrument or provide study instruments.`,
    });
    await writeResearchQueue(config, blocked);
    return;
  }

  const baseline = await ensureResearchBaselineSnapshot(config);
  const runFingerprint = computeResearchTaskFingerprint({
    task,
    baselineId: baseline.manifest.baseline_id,
    datasetManifestHash: baseline.manifest.dataset_manifest_hash,
    engineManifestHash: baseline.manifest.engine_manifest_hash,
    validationProfileId: task.validation_profile,
    studyConfig: config.study,
  });

  const existingRun = await readFingerprintIndexEntry(config, runFingerprint);
  if (existingRun && (await fileExists(existingRun.decision_path))) {
    await finalizeTaskFromIndexedRun({
      config,
      task,
      runIndex: existingRun,
    });
    return;
  }

  const runId = buildRunId(task, now());
  const startedAt = now().toISOString();
  const lock = await acquireResearchLock(config, {
    runId,
    taskId: task.id,
    runFingerprint,
    baselineId: task.baseline_id,
    pid: pid(),
    stage: "aggregate",
  });
  let activeLock = lock;
  let activeStage: ResearchRunStatus["stage"] = "aggregate";

  const runPaths = buildResearchRunArtifactPaths(config.paths.runsDir, runId);
  const manifest: ResearchRunManifest = {
    version: 1,
    run_id: runId,
    task_id: task.id,
    task_type: task.type,
    baseline_id: task.baseline_id,
    run_fingerprint: runFingerprint,
    started_at: startedAt,
    dataset_profile: task.dataset_profile,
    validation_profile: task.validation_profile,
    dataset_manifest_hash: baseline.manifest.dataset_manifest_hash,
    engine_manifest_hash: baseline.manifest.engine_manifest_hash,
    dataset_snapshot_id: baseline.manifest.dataset_snapshot_id,
    dataset_snapshot_version: baseline.manifest.dataset_snapshot_version,
  };
  const status: ResearchRunStatus = {
    ...buildInitialRunStatus(runId, task.id, startedAt),
    stage_warn_ms: config.timing.stageWarnMs ?? null,
    stage_hard_timeout_ms: config.timing.stageHardTimeoutMs ?? null,
  };
  let activeStatus = status;

  const queue = await readResearchQueue(config);
  const runningQueue = setResearchQueueActiveRun(
    updateResearchTaskStatus(queue, task.id, "running", {
      started_at: startedAt,
      attempt: task.attempt + 1,
      last_run_id: runId,
      run_fingerprint: runFingerprint,
      error: null,
    }),
    runId,
  );
  await writeResearchQueue(config, runningQueue);
  await initializeResearchRunArtifacts({
    paths: runPaths,
    manifest,
    input: task,
    status,
  });

  const writeStatusHeartbeat = async () => {
    activeStatus = buildRunStatusHeartbeat(activeStatus, activeStage);
    await writeJsonAtomic(runPaths.statusPath, activeStatus);
  };
  const reportProgress: NonNullable<ResearchTaskExecutorContext["reportProgress"]> = async (progress) => {
    activeStage = progress.stage;
    activeLock = await updateResearchLockHeartbeat(config, activeLock, activeStage);
    activeStatus = buildRunStatusHeartbeat(activeStatus, activeStage, {
      progress_note: progress.progress_note,
      completed_stages: progress.completed_stages ?? activeStatus.completed_stages,
    });
    await writeJsonAtomic(runPaths.statusPath, activeStatus);
  };

  const heartbeatTimer = setInterval(() => {
    void updateResearchLockHeartbeat(config, activeLock, activeStage)
      .then(async (updatedLock) => {
        activeLock = updatedLock;
        await writeStatusHeartbeat();
      })
      .catch(() => {
        // Keep the task running; recovery will handle any persistent lock issues later.
      });
  }, config.timing.heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  try {
    const result = await executor({
      config,
      task,
      baseline,
      reportProgress,
    });

    activeStage = "decision";
    activeLock = await updateResearchLockHeartbeat(config, activeLock, activeStage);
    activeStatus = buildRunStatusHeartbeat(activeStatus, activeStage, {
      completed_stages: ["aggregate", "crisis", "walkforward", "robustness"],
    });
    await writeJsonAtomic(runPaths.statusPath, activeStatus);
    await writeJsonAtomic(runPaths.aggregateReportPath, result.artifacts.aggregateReport);
    await writeJsonAtomic(runPaths.crisisReportPath, result.artifacts.crisisReport);
    await writeJsonAtomic(runPaths.walkForwardReportPath, result.artifacts.walkForwardReport);
    await writeJsonAtomic(runPaths.comparisonPath, result.comparison);

    const awaitingDecisionQueue = updateResearchTaskStatus(
      await readResearchQueue(config),
      task.id,
      "awaiting_decision",
      {
        last_run_id: runId,
        run_fingerprint: runFingerprint,
      },
    );
    await writeResearchQueue(config, awaitingDecisionQueue);

    const decision = decideResearchRun({
      runId,
      taskId: task.id,
      gates: result.comparison.gates,
      promotedMetrics: buildPromotedMetrics(result.comparison),
      comparison: result.comparison,
    });
    await writeResearchDecisionArtifact(runPaths.decisionPath, decision);

    activeStatus = {
      ...activeStatus,
      status: "completed",
      stage: "completed",
      updated_at: new Date().toISOString(),
      completed_stages: ["aggregate", "crisis", "walkforward", "robustness", "decision"],
      failed_stage: null,
      error: null,
    } satisfies ResearchRunStatus;
    await writeJsonAtomic(runPaths.statusPath, activeStatus);
    await writeResearchRunChecksums(runPaths);

    const completedQueue = finalizeResearchTask(
      setResearchQueueActiveRun(await readResearchQueue(config), null),
      task.id,
      {
        status: "completed",
        finishedAt: new Date().toISOString(),
        runId,
        runFingerprint,
        decision: decision.decision,
        decisionReason: decision.reason,
      },
    );
    await writeResearchQueue(config, completedQueue);

    const indexEntry: ResearchRunIndexEntry = {
      run_id: runId,
      task_id: task.id,
      run_fingerprint: runFingerprint,
      completed_at: new Date().toISOString(),
      decision: decision.decision,
      decision_path: runPaths.decisionPath,
      run_dir: runPaths.runDir,
    };
    await writeRunIndexEntry(config, indexEntry);
    await appendDecisionLedgerEntry(config, {
      event_id: `evt-${runId}`,
      timestamp: new Date().toISOString(),
      run_id: runId,
      task_id: task.id,
      baseline_id: task.baseline_id,
      run_fingerprint: runFingerprint,
      decision: decision.decision,
      reason: decision.reason,
      aggregate_summary: result.comparison.aggregate.current,
      crisis_summary: result.comparison.crisis.current,
      walkforward_summary: result.comparison.walkForward.current,
      planner_family_id: task.planner_source?.family_id ?? null,
      planner_template_id: task.planner_source?.template_id ?? null,
      planner_campaign_id: task.planner_source?.campaign_id ?? null,
      planner_campaign_objective: task.planner_source?.campaign_objective ?? null,
      ranking_score: decision.ranking?.score ?? null,
      ranking_band: decision.ranking?.band ?? null,
      failure_forensics: decision.failure_forensics ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research runner error.";
    const failureForensics = classifyResearchFailure({
      reason: message,
      error: message,
    });
    activeStatus = {
      ...activeStatus,
      status: "failed",
      stage: "failed",
      updated_at: new Date().toISOString(),
      failed_stage: activeStage,
      error: message,
    } satisfies ResearchRunStatus;
    await writeResearchFailureArtifacts({
      paths: runPaths,
      manifest,
      input: task,
      status: activeStatus,
      error: message,
      failureForensics,
    });
    const failedQueue = finalizeResearchTask(
      setResearchQueueActiveRun(await readResearchQueue(config), null),
      task.id,
      {
        status: "failed",
        finishedAt: new Date().toISOString(),
        runId,
        runFingerprint,
        decision: null,
        decisionReason: message,
        error: message,
      },
    );
    await writeResearchQueue(config, failedQueue);
    await appendDecisionLedgerEntry(config, {
      event_id: `evt-failed-${runId}`,
      timestamp: new Date().toISOString(),
      run_id: runId,
      task_id: task.id,
      baseline_id: task.baseline_id,
      run_fingerprint: runFingerprint,
      decision: "failed",
      reason: message,
      error: message,
      planner_family_id: task.planner_source?.family_id ?? null,
      planner_template_id: task.planner_source?.template_id ?? null,
      planner_campaign_id: task.planner_source?.campaign_id ?? null,
      planner_campaign_objective: task.planner_source?.campaign_objective ?? null,
      ranking_score: null,
      ranking_band: null,
      failure_forensics: failureForensics,
    });
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    await releaseResearchLock(config);
  }
}

export async function processResearchQueue(
  config: ResearchConfig,
  dependencies: ResearchTaskRunnerDependencies = {},
): Promise<{
  processedRunIds: string[];
  autoEnqueuedTaskIds: string[];
  reportOutputs: ResearchProcessReportOutputs | null;
}> {
  const now = dependencies.now ?? (() => new Date());
  const cycleStartedAt = now();
  const processedRunIds: string[] = [];
  const autoEnqueuedTaskIds: string[] = [];
  const executors = {
    ...buildDefaultResearchExecutorMap(),
    ...(dependencies.executors ?? {}),
  };
  const plannerSupportedTypes = getSupportedPlannerTaskTypes(executors);

  await ensureDirectory(config.paths.queueDir);
  await ensureDirectory(config.paths.baselinesDir);
  await ensureDirectory(config.paths.runsDir);
  await ensureDirectory(path.dirname(config.paths.decisionsPath));
  await ensureDirectory(config.paths.runIndexDir);
  await ensureDirectory(config.paths.fingerprintIndexDir);

  const existingLock = await readResearchLock(config);
  if (existingLock && classifyResearchLockHealth(config, existingLock) === "healthy") {
    return {
      processedRunIds,
      autoEnqueuedTaskIds,
      reportOutputs: null,
    };
  }

  await recoverResearchRunner(config);

  while (true) {
    const queue = await readResearchQueue(config);
    if (!queue.live_baseline_id || queue.live_baseline_id !== config.liveBaselineSource.baselineId) {
      await writeResearchQueue(config, {
        ...queue,
        live_baseline_id: config.liveBaselineSource.baselineId,
      });
    }

    const nextTask = selectNextResearchTask(await readResearchQueue(config));
    if (!nextTask) {
      const plannerResult = await autoEnqueueNextResearchTask({
        config,
        supportedTypes: plannerSupportedTypes,
        now,
      });
      if (plannerResult.action === "idle") {
        break;
      }
      autoEnqueuedTaskIds.push(plannerResult.taskId);
      continue;
    }

    try {
      await runSingleResearchTask(config, nextTask, {
        ...dependencies,
        executors,
      });
    } catch {
      // The task is already persisted as failed. Continue to the next queued task.
    }

    const updatedQueue = await readResearchQueue(config);
    const completedTask = updatedQueue.tasks.find((task) => task.id === nextTask.id);
    if (completedTask?.last_run_id) {
      processedRunIds.push(completedTask.last_run_id);
      if (dependencies.postRunOpportunityRefresh) {
        await dependencies.postRunOpportunityRefresh(config);
      }
    }
  }

  const cycleFinishedAt = now();
  const dailyReport = await buildDailyResearchReport(config, cycleFinishedAt);
  const dailyOutputs = await writeDailyResearchReport(config, dailyReport);
  const cycleReport = await buildResearchCycleReport(config, {
    processedRunIds,
    autoEnqueuedTaskIds,
    startedAt: cycleStartedAt,
    finishedAt: cycleFinishedAt,
  });
  const cycleOutputs = await writeResearchCycleReport(config, cycleReport);
  const windowReport = await buildResearchWindowReport(config, {
    date: cycleFinishedAt,
  });
  await writeResearchWindowReport(config, windowReport);
  const opportunityOutputs = await (
    dependencies.postCycleOpportunityRefresh ?? refreshResearchOpportunities
  )(config);

  return {
    processedRunIds,
    autoEnqueuedTaskIds,
    reportOutputs: {
      daily: dailyOutputs,
      cycle: cycleOutputs,
      bundle: opportunityOutputs.bundle,
      board: opportunityOutputs.board,
      packages: opportunityOutputs.packages,
      review: opportunityOutputs.review,
      datasetHealth: opportunityOutputs.datasetHealth,
      registry: opportunityOutputs.registry,
    },
  };
}

export async function processResearchQueueFromDefaultConfig(
  dependencies: ResearchTaskRunnerDependencies = {},
): Promise<{
  config: ResearchConfig;
  processedRunIds: string[];
  autoEnqueuedTaskIds: string[];
  reportOutputs: ResearchProcessReportOutputs | null;
}> {
  const config = await loadResearchConfig();
  const result = await processResearchQueue(config, dependencies);
  return {
    config,
    processedRunIds: result.processedRunIds,
    autoEnqueuedTaskIds: result.autoEnqueuedTaskIds,
    reportOutputs: result.reportOutputs,
  };
}
