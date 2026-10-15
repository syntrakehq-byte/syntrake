import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { buildResearchRunArtifactPaths } from "@/lib/trading/research/artifactContract";
import { loadResearchConfig } from "@/lib/trading/research/config";
import {
  buildResearchDataAcquisitionPlan,
  buildResearchDatasetRequirementsReport,
  type ResearchDataAcquisitionPlan,
  type ResearchDatasetRequirementsReport,
} from "@/lib/trading/research/datasetRequirements";
import type { MarketDataBackfillRunReport } from "@/lib/trading/research/marketDataBackfill";
import { readJsonIfExists } from "@/lib/trading/research/fs";
import {
  buildResearchIntelligenceReport,
  type ResearchIntelligenceReport,
} from "@/lib/trading/research/intelligence";
import { buildResearchMetricSummary } from "@/lib/trading/research/metrics";
import { readResearchQueue } from "@/lib/trading/research/queue";
import { canonicalizeResearchRunSnapshot } from "@/lib/trading/research/runCanonicalization";
import type { TwelveDataArchiveReport } from "@/lib/trading/research/twelveDataFullArchive";
import {
  buildResearchLatestReportsOverview,
  buildResearchPromotionReadinessOverview,
  emptyResearchPromotionReadinessOverview,
  type ResearchLatestReportsOverview,
  type ResearchPromotionReadinessOverview,
} from "@/lib/trading/research/reportsOverview";
import { buildResearchRuntimeHealth } from "@/lib/trading/research/runtimeHealth";
import { readResearchLabRemoteSnapshot } from "@/lib/trading/research/supabaseSync";
import type {
  ResearchBaselineManifest,
  ResearchConfig,
  ResearchMetricSummary,
  ResearchQueue,
  ResearchRunStatus,
  ResearchTaskStatus,
} from "@/lib/trading/research/types";

export type ResearchLabDecisionEntry = {
  timestamp: string | null;
  runId: string | null;
  taskId: string | null;
  decision: "candidate" | "failed" | "promote" | "reject" | string;
  reason: string | null;
  campaignId: string | null;
  campaignObjective: string | null;
  rankingScore: number | null;
  rankingBand: string | null;
  aggregateSummary: ResearchMetricSummary | null;
  crisisSummary: ResearchMetricSummary | null;
  walkforwardSummary: ResearchMetricSummary | null;
  failureSummary: string | null;
};

export type ResearchLabRunEntry = {
  runId: string;
  taskId: string | null;
  status: ResearchRunStatus["status"] | "missing";
  stage: ResearchRunStatus["stage"] | null;
  startedAt: string | null;
  updatedAt: string | null;
  failedStage: string | null;
  error: string | null;
};

export type ResearchLabOverview = {
  generatedAt: string;
  config: {
    queueId: string;
    baselineId: string;
    datasetProfile: string;
    validationProfile: string;
    instruments: string[];
    timeframes: string[];
    paths: {
      queuePath: string;
      runsDir: string;
      decisionsPath: string;
    };
  };
  runtime: Awaited<ReturnType<typeof buildResearchRuntimeHealth>>;
  baseline: ResearchBaselineManifest | null;
  queue: {
    activeRunId: string | null;
    idleReason: string | null;
    counts: Record<ResearchTaskStatus, number>;
    recentTasks: Array<{
      id: string;
      type: string;
      status: ResearchTaskStatus;
      priority: number;
      decision: string | null;
      campaignId: string | null;
      campaignObjective: string | null;
      error: string | null;
      createdAt: string;
      finishedAt: string | null;
    }>;
  };
  decisions: {
    counts: Record<string, number>;
    recent: ResearchLabDecisionEntry[];
    promotedOrCandidate: ResearchLabDecisionEntry[];
    rejectedOrFailed: ResearchLabDecisionEntry[];
  };
  runs: {
    recent: ResearchLabRunEntry[];
  };
  reports: ResearchLatestReportsOverview;
  promotionReadiness: ResearchPromotionReadinessOverview;
  researchIntelligence: ResearchIntelligenceReport;
  datasetRequirements: ResearchDatasetRequirementsReport;
  dataAcquisitionPlan: ResearchDataAcquisitionPlan;
  twelveDataTransfer: {
    available: boolean;
    generatedAt: string | null;
    localArchiveFiles: number;
    downloadedThisCycle: number;
    restrictedAccess: number;
    failed: number;
    missingRemote: number;
    instruments: Array<{
      instrument: string;
      providerSymbol: string | null;
      localArchiveFiles: number;
      downloadedThisCycle: number;
      restrictedAccess: number;
      failed: number;
      missingRemote: number;
      candleCount: number;
      latestPeriodLabel: string | null;
    }>;
  };
  twelveDataArchive: {
    available: boolean;
    generatedAt: string | null;
    archiveRoot: string | null;
    markets: string[];
    instrumentsRequested: string[];
    timeframesRequested: string[];
    fullHistory: boolean;
    totalInstruments: number;
    totalTimeframes: number;
    scopeEntries: number;
    availableScopes: number;
    restrictedScopes: number;
    missingRemoteScopes: number;
    localArchiveFiles: number;
    pendingYears: number;
    downloaded: number;
    existing: number;
    failed: number;
    instruments: Array<{
      instrument: string;
      market: string;
      providerSymbol: string | null;
      providerRelation: string | null;
      localArchiveFiles: number;
      pendingYears: number;
      availableTimeframes: number;
      restrictedTimeframes: number;
      missingRemoteTimeframes: number;
      timeframes: Array<{
        timeframe: string;
        earliestAvailableAt: string | null;
        localArchiveFiles: number;
        localArchiveYears: number[];
        pendingYears: number[];
        restrictionReason: string | null;
        note: string | null;
      }>;
    }>;
  };
  operatorActions: Array<{
    label: string;
    command: string;
    note: string;
  }>;
  storage: {
    localArtifactBacked: boolean;
    remoteBacked: boolean;
    remoteSchemaReady: boolean;
    note: string;
  };
};

const TASK_STATUSES: ResearchTaskStatus[] = [
  "pending",
  "running",
  "awaiting_decision",
  "completed",
  "failed",
  "blocked",
  "cancelled",
];

function emptyTaskCounts(): Record<ResearchTaskStatus, number> {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<ResearchTaskStatus, number>;
}

function metricSummary(value: unknown): ResearchMetricSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ResearchMetricSummary>;
  if (!Number.isFinite(Number(raw.totalTrades))) return null;
  return {
    totalTrades: Number(raw.totalTrades),
    winRate: Number(raw.winRate ?? 0),
    averageRiskReward: raw.averageRiskReward === null ? null : Number(raw.averageRiskReward ?? 0),
    expectancy: Number(raw.expectancy ?? 0),
    profitFactor: raw.profitFactor === null ? null : Number(raw.profitFactor ?? 0),
    maxDrawdown: Number(raw.maxDrawdown ?? 0),
  };
}

function normalizeDecision(raw: any): ResearchLabDecisionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : null,
    runId: typeof raw.run_id === "string" ? raw.run_id : null,
    taskId: typeof raw.task_id === "string" ? raw.task_id : null,
    decision: String(raw.decision ?? "unknown"),
    reason: typeof raw.reason === "string" ? raw.reason : null,
    campaignId: typeof raw.planner_campaign_id === "string" ? raw.planner_campaign_id : null,
    campaignObjective: typeof raw.planner_campaign_objective === "string" ? raw.planner_campaign_objective : null,
    rankingScore: Number.isFinite(Number(raw.ranking_score)) ? Number(raw.ranking_score) : null,
    rankingBand: typeof raw.ranking_band === "string" ? raw.ranking_band : null,
    aggregateSummary: metricSummary(raw.aggregate_summary),
    crisisSummary: metricSummary(raw.crisis_summary),
    walkforwardSummary: metricSummary(raw.walkforward_summary),
    failureSummary:
      typeof raw.failure_forensics?.summary === "string"
        ? raw.failure_forensics.summary
        : typeof raw.error === "string"
          ? raw.error
          : null,
  };
}

async function readDecisionEntries(decisionsPath: string): Promise<ResearchLabDecisionEntry[]> {
  try {
    const text = await readFile(decisionsPath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeDecision(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ResearchLabDecisionEntry => Boolean(entry))
      .sort((left, right) => String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? "")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readRecentRuns(
  config: ResearchConfig,
  queue: ResearchQueue,
  decisions: ResearchLabDecisionEntry[],
  limit = 16,
): Promise<ResearchLabRunEntry[]> {
  let runDirs: string[] = [];
  try {
    runDirs = (await readdir(config.paths.runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const runs = await Promise.all(
    runDirs.slice(-200).map(async (runId) => {
      const paths = buildResearchRunArtifactPaths(config.paths.runsDir, runId);
      const status = await readJsonIfExists<ResearchRunStatus>(paths.statusPath);
      const canonical = canonicalizeResearchRunSnapshot(
        {
          runId,
          taskId: status?.task_id ?? null,
          status: status?.status ?? "missing",
          stage: status?.stage ?? null,
          startedAt: status?.started_at ?? null,
          updatedAt: status?.updated_at ?? null,
          failedStage: status?.failed_stage ?? null,
          error: status?.error ?? null,
        },
        {
          queue,
          decisions: decisions.map((entry) => ({
            event_id: `overview-${entry.runId ?? "unknown"}-${entry.timestamp ?? "unknown"}`,
            timestamp: entry.timestamp ?? new Date(0).toISOString(),
            run_id: entry.runId ?? "",
            task_id: entry.taskId ?? "",
            baseline_id: "",
            run_fingerprint: "",
            decision: entry.decision === "failed" ? "failed" : "reject",
            reason: entry.reason ?? "",
            error: entry.failureSummary ?? null,
          })),
        },
      );

      return {
        runId,
        taskId: canonical.taskId,
        status: canonical.status,
        stage: canonical.stage,
        startedAt: canonical.startedAt,
        updatedAt: canonical.updatedAt,
        failedStage: canonical.failedStage,
        error: canonical.error,
      } satisfies ResearchLabRunEntry;
    }),
  );

  return runs
    .sort((left, right) => String(right.updatedAt ?? right.startedAt ?? "").localeCompare(String(left.updatedAt ?? left.startedAt ?? "")))
    .slice(0, limit);
}

function summarizeQueue(queue: ResearchQueue): ResearchLabOverview["queue"] {
  const counts = emptyTaskCounts();
  for (const task of queue.tasks) {
    counts[task.status] += 1;
  }

  return {
    activeRunId: queue.active_run_id,
    idleReason: queue.idle_reason,
    counts,
    recentTasks: [...queue.tasks]
      .sort((left, right) => String(right.finished_at ?? right.started_at ?? right.created_at).localeCompare(String(left.finished_at ?? left.started_at ?? left.created_at)))
      .slice(0, 14)
      .map((task) => ({
        id: task.id,
        type: task.type,
        status: task.status,
        priority: task.priority,
        decision: task.decision,
        campaignId: task.planner_source?.campaign_id ?? null,
        campaignObjective: task.planner_source?.campaign_objective ?? null,
        error: task.error,
        createdAt: task.created_at,
        finishedAt: task.finished_at,
      })),
  };
}

function operatorActions(): ResearchLabOverview["operatorActions"] {
  return [
    {
      label: "Start supervisor",
      command: "npm run research:supervisor:start",
      note: "Starts the supervisor process that actually runs the lab.",
    },
    {
      label: "Recover active run",
      command: "npm run research:recover",
      note: "Use when the lab reports a stale lock, hung stage, or incomplete artifact contract.",
    },
    {
      label: "Backfill market data",
      command: "npm run research:data-backfill",
      note: "Downloads supported missing historical files before new candidates are trusted.",
    },
    {
      label: "Data hunter",
      command: "npm run research:data-hunter",
      note: "Audits coverage, downloads supported gaps, and writes the missing-data wishlist.",
    },
    {
      label: "Runtime health",
      command: "npm run research:lab-health",
      note: "Prints the same core health object used by this page.",
    },
    {
      label: "Sync lab to Supabase",
      command: "npm run research:sync",
      note: "Pushes local/VPS research state to Supabase so /ops/lab can run without local artifacts.",
    },
  ];
}

async function readTwelveDataTransferSummary(config: ResearchConfig): Promise<ResearchLabOverview["twelveDataTransfer"]> {
  const reportPath = path.join(config.paths.reportsDir, "datasets", "market-data-backfill-latest.json");
  const report = await readJsonIfExists<MarketDataBackfillRunReport>(reportPath);
  const activeEntries = Array.isArray(report?.sync?.activeResult) ? report!.sync.activeResult : [];

  if (!report || activeEntries.length === 0) {
    return {
      available: false,
      generatedAt: report?.generatedAt ?? null,
      localArchiveFiles: 0,
      downloadedThisCycle: 0,
      restrictedAccess: 0,
      failed: 0,
      missingRemote: 0,
      instruments: [],
    };
  }

  const grouped = new Map<string, ResearchLabOverview["twelveDataTransfer"]["instruments"][number]>();
  for (const entry of activeEntries) {
    const current = grouped.get(entry.instrument) ?? {
      instrument: entry.instrument,
      providerSymbol: entry.providerSymbol ?? null,
      localArchiveFiles: 0,
      downloadedThisCycle: 0,
      restrictedAccess: 0,
      failed: 0,
      missingRemote: 0,
      candleCount: 0,
      latestPeriodLabel: null,
    };

    if (!current.providerSymbol && entry.providerSymbol) current.providerSymbol = entry.providerSymbol;
    if (entry.status === "existing" || entry.status === "downloaded") current.localArchiveFiles += 1;
    if (entry.status === "downloaded") current.downloadedThisCycle += 1;
    if (entry.status === "restricted_remote_access") current.restrictedAccess += 1;
    if (entry.status === "failed") current.failed += 1;
    if (entry.status === "missing_remote") current.missingRemote += 1;
    current.candleCount += Number(entry.candleCount ?? 0);
    if (!current.latestPeriodLabel || String(entry.periodLabel).localeCompare(String(current.latestPeriodLabel)) > 0) {
      current.latestPeriodLabel = entry.periodLabel;
    }
    grouped.set(entry.instrument, current);
  }

  const instruments = Array.from(grouped.values()).sort((left, right) => {
    if (right.downloadedThisCycle !== left.downloadedThisCycle) {
      return right.downloadedThisCycle - left.downloadedThisCycle;
    }
    if (right.localArchiveFiles !== left.localArchiveFiles) {
      return right.localArchiveFiles - left.localArchiveFiles;
    }
    return left.instrument.localeCompare(right.instrument);
  });

  return {
    available: true,
    generatedAt: report.generatedAt ?? null,
    localArchiveFiles: activeEntries.filter((entry) => entry.status === "existing" || entry.status === "downloaded").length,
    downloadedThisCycle: activeEntries.filter((entry) => entry.status === "downloaded").length,
    restrictedAccess: activeEntries.filter((entry) => entry.status === "restricted_remote_access").length,
    failed: activeEntries.filter((entry) => entry.status === "failed").length,
    missingRemote: activeEntries.filter((entry) => entry.status === "missing_remote").length,
    instruments,
  };
}

async function readTwelveDataArchiveSummary(config: ResearchConfig): Promise<ResearchLabOverview["twelveDataArchive"]> {
  const reportPath = path.join(config.paths.reportsDir, "datasets", "twelvedata-full-archive-latest.json");
  const report = await readJsonIfExists<TwelveDataArchiveReport>(reportPath);

  if (!report) {
    return {
      available: false,
      generatedAt: null,
      archiveRoot: null,
      markets: [],
      instrumentsRequested: [],
      timeframesRequested: [],
      fullHistory: false,
      totalInstruments: 0,
      totalTimeframes: 0,
      scopeEntries: 0,
      availableScopes: 0,
      restrictedScopes: 0,
      missingRemoteScopes: 0,
      localArchiveFiles: 0,
      pendingYears: 0,
      downloaded: 0,
      existing: 0,
      failed: 0,
      instruments: [],
    };
  }

  return {
    available: true,
    generatedAt: report.generatedAt,
    archiveRoot: report.storage.archiveRoot,
    markets: report.scope.markets,
    instrumentsRequested: report.scope.instruments,
    timeframesRequested: report.scope.timeframes,
    fullHistory: report.scope.fullHistory,
    totalInstruments: report.summary.instruments,
    totalTimeframes: report.summary.timeframes,
    scopeEntries: report.summary.scopeEntries,
    availableScopes: report.summary.available,
    restrictedScopes: report.summary.restricted,
    missingRemoteScopes: report.summary.missingRemote,
    localArchiveFiles: report.summary.localArchiveFiles,
    pendingYears: report.summary.pendingYears,
    downloaded: report.summary.downloaded,
    existing: report.summary.existing,
    failed: report.summary.failed,
    instruments: report.instruments
      .map((entry) => ({
        instrument: entry.instrument,
        market: entry.market,
        providerSymbol: entry.providerSymbol,
        providerRelation: entry.providerRelation,
        localArchiveFiles: entry.localArchiveFiles,
        pendingYears: entry.pendingYears,
        availableTimeframes: entry.availableTimeframes,
        restrictedTimeframes: entry.restrictedTimeframes,
        missingRemoteTimeframes: entry.missingRemoteTimeframes,
        timeframes: entry.timeframes.map((timeframe) => ({
          timeframe: timeframe.timeframe,
          earliestAvailableAt: timeframe.earliestAvailableAt,
          localArchiveFiles: timeframe.localArchiveFiles,
          localArchiveYears: timeframe.localArchiveYears,
          pendingYears: timeframe.pendingYears,
          restrictionReason: timeframe.restrictionReason,
          note: timeframe.note,
        })),
      }))
      .sort((left, right) => {
        if (right.pendingYears !== left.pendingYears) {
          return right.pendingYears - left.pendingYears;
        }
        if (right.localArchiveFiles !== left.localArchiveFiles) {
          return right.localArchiveFiles - left.localArchiveFiles;
        }
        return left.instrument.localeCompare(right.instrument);
      }),
  };
}

function queueFromRemote(value: any): ResearchLabOverview["queue"] {
  const counts = emptyTaskCounts();
  for (const [status, count] of Object.entries((value?.counts ?? {}) as Record<string, unknown>)) {
    if (status in counts) counts[status as ResearchTaskStatus] = Number(count) || 0;
  }
  return {
    activeRunId: typeof value?.activeRunId === "string" ? value.activeRunId : null,
    idleReason: typeof value?.idleReason === "string" ? value.idleReason : null,
    counts,
    recentTasks: Array.isArray(value?.recentTasks)
      ? value.recentTasks.slice(0, 14).map((task: any) => ({
          id: String(task.id ?? "unknown"),
          type: String(task.type ?? "unknown"),
          status: TASK_STATUSES.includes(task.status) ? task.status : "failed",
          priority: Number(task.priority ?? 0),
          decision: typeof task.decision === "string" ? task.decision : null,
          campaignId: typeof task.planner_source?.campaign_id === "string" ? task.planner_source.campaign_id : null,
          campaignObjective:
            typeof task.planner_source?.campaign_objective === "string" ? task.planner_source.campaign_objective : null,
          error: typeof task.error === "string" ? task.error : null,
          createdAt: typeof task.created_at === "string" ? task.created_at : new Date(0).toISOString(),
          finishedAt: typeof task.finished_at === "string" ? task.finished_at : null,
        }))
      : [],
  };
}

function decisionFromRemote(row: any): ResearchLabDecisionEntry {
  const payload = row?.payload ?? {};
  return {
    timestamp: typeof row?.timestamp === "string" ? row.timestamp : null,
    runId: typeof row?.run_id === "string" ? row.run_id : null,
    taskId: typeof row?.task_id === "string" ? row.task_id : null,
    decision: String(row?.decision ?? "unknown"),
    reason: typeof row?.reason === "string" ? row.reason : null,
    campaignId: typeof payload?.planner_campaign_id === "string" ? payload.planner_campaign_id : null,
    campaignObjective:
      typeof payload?.planner_campaign_objective === "string" ? payload.planner_campaign_objective : null,
    rankingScore: Number.isFinite(Number(payload?.ranking_score)) ? Number(payload.ranking_score) : null,
    rankingBand: typeof payload?.ranking_band === "string" ? payload.ranking_band : null,
    aggregateSummary: metricSummary(row?.aggregate_summary),
    crisisSummary: metricSummary(row?.crisis_summary),
    walkforwardSummary: metricSummary(row?.walkforward_summary),
    failureSummary:
      typeof payload?.failure_forensics?.summary === "string"
        ? payload.failure_forensics.summary
        : typeof row?.error === "string"
          ? row.error
          : null,
  };
}

function runFromRemote(row: any): ResearchLabRunEntry {
  return {
    runId: String(row?.run_id ?? "unknown"),
    taskId: typeof row?.task_id === "string" ? row.task_id : null,
    status: row?.status ?? "missing",
    stage: typeof row?.stage === "string" ? row.stage : null,
    startedAt: typeof row?.started_at === "string" ? row.started_at : null,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
    failedStage: row?.payload?.status?.failed_stage ?? null,
    error: typeof row?.error === "string" ? row.error : null,
  };
}

function hydrateRemoteBaselineAnnualizedTrades(args: {
  report: ResearchIntelligenceReport;
  baseline: ResearchBaselineManifest | null;
  config: ResearchConfig;
}): ResearchIntelligenceReport {
  const existingAnnualizedTrades = args.report.evidence.baselineAnnualizedTrades;
  if (
    existingAnnualizedTrades !== null &&
    existingAnnualizedTrades !== undefined &&
    Number.isFinite(Number(existingAnnualizedTrades))
  ) {
    return args.report;
  }

  const liveSummary = args.baseline?.live_summary;
  if (!liveSummary) return args.report;

  const summary = buildResearchMetricSummary(liveSummary, args.config.study.yearlyPeriods);
  if (summary.annualizedTrades === null || summary.annualizedTrades === undefined) return args.report;

  return {
    ...args.report,
    evidence: {
      ...args.report.evidence,
      baselineTradeCount: args.report.evidence.baselineTradeCount ?? summary.totalTrades,
      baselineAnnualizedTrades: summary.annualizedTrades,
    },
  };
}

export async function buildResearchLabOverview(args: {
  config?: ResearchConfig;
  now?: Date;
} = {}): Promise<ResearchLabOverview> {
  const config = args.config ?? await loadResearchConfig();
  const generatedAt = (args.now ?? new Date()).toISOString();
  const [datasetRequirements, dataAcquisitionPlan, twelveDataTransfer, twelveDataArchive] = await Promise.all([
    buildResearchDatasetRequirementsReport(config),
    buildResearchDataAcquisitionPlan(config),
    readTwelveDataTransferSummary(config),
    readTwelveDataArchiveSummary(config),
  ]);

  const baselinePath = path.join(
    config.paths.baselinesDir,
    config.liveBaselineSource.baselineId,
    "baseline-manifest.json",
  );
  const [runtime, queue, baseline, decisions, reports, promotionReadiness] = await Promise.all([
    buildResearchRuntimeHealth({ config, now: args.now }),
    readResearchQueue(config, { createIfMissing: false }),
    readJsonIfExists<ResearchBaselineManifest>(baselinePath),
    readDecisionEntries(config.paths.decisionsPath),
    buildResearchLatestReportsOverview(config),
    buildResearchPromotionReadinessOverview({ config }),
  ]);
  const researchIntelligence = await buildResearchIntelligenceReport({
    config,
    queue,
    baseline,
    generatedAt,
  });
  const recentRuns = await readRecentRuns(config, queue, decisions);
  const decisionCounts = decisions.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.decision] = (acc[entry.decision] ?? 0) + 1;
    return acc;
  }, {});
  const promotedOrCandidate = decisions
    .filter((entry) => entry.decision === "promote" || entry.decision === "candidate")
    .slice(0, 10);
  const rejectedOrFailed = decisions
    .filter((entry) => entry.decision === "reject" || entry.decision === "failed")
    .slice(0, 14);
  const localArtifactBacked = Boolean(
    baseline ||
      decisions.length > 0 ||
      recentRuns.length > 0 ||
      queue.tasks.length > 0 ||
      queue.active_run_id ||
      queue.idle_reason,
  );

  if (!localArtifactBacked) {
    const remote = await readResearchLabRemoteSnapshot({ runLimit: 40, decisionLimit: 120 });
    const remotePayload = remote.state?.payload ?? null;

    if (remote.schemaReady && remote.state && remotePayload?.runtime) {
      const remoteDecisions = remote.decisions.map(decisionFromRemote);
      const remoteBaseline = (remotePayload.baseline ?? null) as ResearchBaselineManifest | null;
      const remoteResearchIntelligence = remotePayload.researchIntelligence
        ? hydrateRemoteBaselineAnnualizedTrades({
            report: remotePayload.researchIntelligence,
            baseline: remoteBaseline,
            config,
          })
        : researchIntelligence;
      const decisionCounts = remoteDecisions.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.decision] = (acc[entry.decision] ?? 0) + 1;
        return acc;
      }, {});

      return {
        generatedAt: remote.state.generated_at ?? generatedAt,
        config: {
          queueId: config.queueId,
          baselineId: config.liveBaselineSource.baselineId,
          datasetProfile: config.liveBaselineSource.datasetProfile,
          validationProfile: config.liveBaselineSource.validationProfile,
          instruments: config.study.instruments,
          timeframes: config.study.timeframes,
          paths: {
            queuePath: config.paths.queuePath,
            runsDir: config.paths.runsDir,
            decisionsPath: config.paths.decisionsPath,
          },
        },
        runtime: remotePayload.runtime,
        baseline: remoteBaseline,
        queue: queueFromRemote(remotePayload.queueOverview),
        decisions: {
          counts: decisionCounts,
          recent: remoteDecisions.slice(0, 18),
          promotedOrCandidate: remoteDecisions
            .filter((entry) => entry.decision === "promote" || entry.decision === "candidate")
            .slice(0, 10),
          rejectedOrFailed: remoteDecisions
            .filter((entry) => entry.decision === "reject" || entry.decision === "failed")
            .slice(0, 14),
        },
        runs: {
          recent: remote.runs.map(runFromRemote),
        },
        reports: remotePayload.reportsOverview ?? {
          bundleValidation: null,
          promotionBoard: null,
          promotionPackages: null,
          opportunityReview: null,
          datasetHealth: null,
          registry: null,
        },
        promotionReadiness:
          remotePayload.promotionReadiness ??
          (remotePayload.paperPromotion
            ? {
                ...emptyResearchPromotionReadinessOverview(),
                paperGate: {
                  readyPackageCount: Number(remotePayload.paperPromotion.ready_package_count ?? 0),
                  executableTaskScopeCount: Number(remotePayload.paperPromotion.executable_task_scope_count ?? 0),
                  bundleOnlyReadyPackageCount: Number(remotePayload.paperPromotion.bundle_only_ready_package_count ?? 0),
                  status:
                    Number(remotePayload.paperPromotion.executable_task_scope_count ?? 0) > 0
                      ? "ready"
                      : Number(remotePayload.paperPromotion.bundle_only_ready_package_count ?? 0) > 0
                        ? "bundle_only"
                        : Number(remotePayload.paperPromotion.ready_package_count ?? 0) > 0
                          ? "blocked"
                          : "idle",
                },
              }
            : emptyResearchPromotionReadinessOverview()),
        researchIntelligence: remoteResearchIntelligence,
        datasetRequirements: remotePayload.datasetRequirements ?? datasetRequirements,
        dataAcquisitionPlan: remotePayload.dataAcquisitionPlan ?? dataAcquisitionPlan,
        twelveDataTransfer: remotePayload.twelveDataTransfer ?? twelveDataTransfer,
        twelveDataArchive: remotePayload.twelveDataArchive ?? twelveDataArchive,
        operatorActions: operatorActions(),
        storage: {
          localArtifactBacked: false,
          remoteBacked: true,
          remoteSchemaReady: true,
          note: "This view is reading Research Lab state from Supabase, synced by the external worker/VPS.",
        },
      };
    }
  }

  return {
    generatedAt,
    config: {
      queueId: config.queueId,
      baselineId: config.liveBaselineSource.baselineId,
      datasetProfile: config.liveBaselineSource.datasetProfile,
      validationProfile: config.liveBaselineSource.validationProfile,
      instruments: config.study.instruments,
      timeframes: config.study.timeframes,
      paths: {
        queuePath: config.paths.queuePath,
        runsDir: config.paths.runsDir,
        decisionsPath: config.paths.decisionsPath,
      },
    },
    runtime,
    baseline,
    queue: summarizeQueue(queue),
    decisions: {
      counts: decisionCounts,
      recent: decisions.slice(0, 18),
      promotedOrCandidate,
      rejectedOrFailed,
    },
    runs: {
      recent: recentRuns,
    },
    reports,
    promotionReadiness,
    researchIntelligence,
    datasetRequirements,
    dataAcquisitionPlan,
    twelveDataTransfer,
    twelveDataArchive,
    operatorActions: operatorActions(),
    storage: {
      localArtifactBacked,
      remoteBacked: false,
      remoteSchemaReady: false,
      note: localArtifactBacked
        ? "This view is reading canonical local Research Lab artifacts from the current workspace. Supabase remains a mirror/read model only and was not queried."
        : "No local lab artifacts are available in this runtime. Sync lab state to Supabase to make this page complete in production.",
    },
  };
}
