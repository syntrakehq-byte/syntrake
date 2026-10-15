import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { cookies, headers } from "next/headers";

import LabControlPanel from "./LabControlPanel";
import { LOCAL_QA_USER_ID, isLocalQaBypassServerAccess } from "@/lib/auth/localQaAuth";
import { buildResearchLabOverview } from "@/lib/ops/researchLabOverview";
import { isOwnerUserId } from "@/lib/signalcore/owner";
import { readPaperHistoryPayloadSafe } from "@/lib/trading/bot/paperRunner";
import type { ResearchMetricSummary } from "@/lib/trading/research/types";

export const metadata: Metadata = {
  title: "Research Lab | Syntrake Ops",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tone(status: string | null | undefined) {
  if (["error", "failed", "fail", "timed_out", "hung", "weak"].includes(String(status))) {
    return "border-red-400/40 bg-red-500/10 text-red-100";
  }
  if (["warn", "long_running", "stale", "reject", "blocked", "watch", "insufficient_evidence"].includes(String(status))) {
    return "border-amber-300/40 bg-amber-400/10 text-amber-100";
  }
  if (["promote", "candidate", "ok", "healthy", "strong", "completed"].includes(String(status))) {
    return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  }
  return "border-slate-600/50 bg-slate-900/70 text-slate-200";
}

function fmt(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 10000) / 10000}${suffix}`;
}

function time(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("en-GB", { timeZone: "UTC" });
}

function Card({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20">
      <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/60">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function intelligenceValue(metric: Awaited<ReturnType<typeof buildResearchLabOverview>>["researchIntelligence"]["summary"]["confidence"]) {
  if (metric.value === null) return "n/a";
  if (metric.unit === "percent" || metric.unit === "ratio") return `${fmt(metric.value)}%`;
  if (metric.unit === "risk") return `${fmt(metric.value)}/100`;
  return fmt(metric.value);
}

function candidateEvidenceValue(value: number | null | undefined, usefulDecisions: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return usefulDecisions > 0 ? "n/a" : "no candidate yet";
}

function ResearchIntelligencePanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const intelligence = lab.researchIntelligence;
  const metrics = Object.values(intelligence.summary);
  const usefulDecisions = intelligence.evidence.candidates + intelligence.evidence.promotes;

  return (
    <section className="mt-7 rounded-[30px] border border-cyan-300/20 bg-cyan-400/10 p-6 text-cyan-50 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-100/70">Research intelligence</p>
          <h2 className="mt-2 text-2xl font-black text-white">Engine health and quality evidence</h2>
          <p className="mt-3 max-w-4xl text-sm text-cyan-50/80">
            Derived from canonical Research Lab artifacts only: queue, decisions, baseline manifest, candidate library
            and run comparisons. Missing evidence is shown explicitly instead of being scored artificially.
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/55">
            Snapshot {time(intelligence.generatedAt)} · decisions/templates are point-in-time values and can move during an active lab cycle.
          </p>
        </div>
        <div className={`rounded-full border px-4 py-2 text-sm font-black uppercase tracking-[0.18em] ${tone(intelligence.summary.confidence.grade)}`}>
          {intelligence.summary.confidence.grade}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {metrics.map((item) => (
          <div key={item.label} className={`rounded-2xl border p-4 ${tone(item.grade)}`}>
            <p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">{item.label}</p>
            <div className="mt-2 text-xl font-black text-white">{intelligenceValue(item)}</div>
            <p className="mt-2 text-xs opacity-80">{item.evidence}</p>
            {item.missingEvidence.length > 0 ? (
              <p className="mt-2 text-xs opacity-80">Missing: {item.missingEvidence.join(", ")}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Decision events" value={intelligence.evidence.decisionEvents} />
        <Metric label="Explored templates" value={`${intelligence.evidence.exploredTemplates}/${intelligence.evidence.enabledTemplates}`} />
        <Metric label="Baseline trades/year" value={intelligence.evidence.baselineAnnualizedTrades ?? "n/a"} />
        <Metric label="Runs / candidate" value={candidateEvidenceValue(intelligence.evidence.scientificRunsPerCandidate, usefulDecisions)} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Templates / candidate" value={candidateEvidenceValue(intelligence.evidence.templatesPerCandidate, usefulDecisions)} />
        <Metric label="Operational failures" value={intelligence.evidence.operationalFailures} />
        <Metric label="Stat validations" value={`${intelligence.evidence.comparisonsWithStatisticalValidation}/${intelligence.evidence.comparisonsInspected}`} />
        <Metric label="First candidate after" value={candidateEvidenceValue(intelligence.evidence.firstCandidateAfterDecisions, usefulDecisions)} />
        <Metric label="Templates to candidate" value={candidateEvidenceValue(intelligence.evidence.templatesUntilFirstCandidate, usefulDecisions)} />
      </div>
    </section>
  );
}

function DataCoveragePanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const backfill = lab.runtime.backfill;
  const hunter = lab.runtime.dataHunter;
  const coverageTone =
    hunter.status === "error"
      ? tone("error")
      : (backfill.missingDownloadable ?? 0) > 0
        ? tone("warn")
        : tone("ok");

  return (
    <section className={`mt-7 rounded-[30px] border p-6 shadow-2xl shadow-black/20 ${coverageTone}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] opacity-70">Data coverage</p>
          <h2 className="mt-2 text-2xl font-black text-white">Autonomous material pipeline</h2>
          <p className="mt-3 max-w-3xl text-sm opacity-85">
            The lab can keep running while the Data Hunter audits candles, downloads supported official gaps, and lists
            anything that still needs a new source. It does not invent candles or scrape random websites.
          </p>
        </div>
        <div className="rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm font-black uppercase tracking-[0.18em]">
          {hunter.status ?? "not run yet"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="Existing files" value={backfill.existing ?? "n/a"} />
        <Metric label="Auto gaps" value={backfill.missingDownloadable ?? "n/a"} />
        <Metric label="Manual gaps" value={backfill.missingManual ?? "n/a"} />
        <Metric label="Unsupported" value={backfill.unsupported ?? "n/a"} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/15 bg-black/20 p-4 text-sm">
          <p className="font-bold text-white">Next action</p>
          <p className="mt-2 opacity-85">{hunter.nextAction ?? "Run npm run research:data-hunter on the VPS."}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-black/20 p-4 text-sm">
          <p className="font-bold text-white">Last hunter cycle</p>
          <p className="mt-2 opacity-85">{time(hunter.generatedAt)}</p>
        </div>
      </div>
    </section>
  );
}

function DatasetRequirementsPanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const requirements = lab.datasetRequirements;
  const officialGaps = requirements.summary.officialGapCount;
  const pendingRows = requirements.rows.filter((row) =>
    row.status === "downloadable" || row.status === "missing_manual" || row.status === "unsupported",
  );

  return (
    <section className="mt-7 rounded-[30px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/60">Dataset requirements</p>
          <h2 className="mt-2 text-2xl font-black text-white">Official gap ledger</h2>
          <p className="mt-3 max-w-4xl text-sm text-slate-300">
            This section reads the canonical Research Lab coverage artifacts and approved source catalogs. It does not
            invent a second truth layer in the UI.
          </p>
        </div>
        <div className="rounded-full border border-white/15 bg-slate-950/45 px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-slate-100">
          Audit {time(requirements.lastAuditAt)}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="Official gaps" value={officialGaps} />
        <Metric label="Unsupported" value={requirements.summary.unsupportedCount} />
        <Metric label="Staged only" value={requirements.summary.stagedOnlyCount} />
        <Metric label="Blocks core research" value={requirements.summary.blockingCount} />
      </div>

      {officialGaps === 0 ? (
        <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 text-sm text-emerald-100">
          <p className="font-black text-white">0 gaps oficiais</p>
          <p className="mt-2">
            The supported universe is fully covered in the canonical reports. Only {requirements.summary.unsupportedCount} unsupported
            periods remain outside the approved automatic scope.
          </p>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/35">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
            <tr>
              <th className="px-4 py-3">Instrument</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">TF</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Block core</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Expected path</th>
            </tr>
          </thead>
          <tbody>
            {(pendingRows.length > 0 ? pendingRows : requirements.rows.filter((row) => row.status === "staged_only").slice(0, 12)).map((row) => (
              <tr key={`${row.instrument}-${row.periodLabel}-${row.status}`} className="border-t border-white/5 align-top">
                <td className="px-4 py-3 font-bold text-white">{row.instrument}</td>
                <td className="px-4 py-3">{row.periodLabel}</td>
                <td className="px-4 py-3">{row.timeframe}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ${tone(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3">{row.priority}</td>
                <td className="px-4 py-3">{row.blocksCoreResearch ? "yes" : "no"}</td>
                <td className="px-4 py-3 text-slate-300">{row.recommendedSource}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{row.expectedPath}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DataAcquisitionAgentPanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const plan = lab.dataAcquisitionPlan;

  return (
    <section className="mt-7 rounded-[30px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/60">Data acquisition agent</p>
          <h2 className="mt-2 text-2xl font-black text-white">Safe-mode operational plan</h2>
          <p className="mt-3 max-w-4xl text-sm text-slate-300">
            This is an audited plan over the existing VPS pipeline. It reuses Data Hunter, backfill, dataset health and
            sync artifacts instead of creating a parallel downloader.
          </p>
        </div>
        <div className={`rounded-full border px-4 py-2 text-sm font-black uppercase tracking-[0.18em] ${tone(plan.status)}`}>
          {plan.status}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="Official gaps" value={plan.summary.officialGapCount} />
        <Metric label="Downloadable" value={plan.summary.downloadableCount} />
        <Metric label="Manual" value={plan.summary.manualCount} />
        <Metric label="Unsupported" value={plan.summary.unsupportedCount} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <p className="font-black text-white">Safety gates already in place</p>
          <div className="mt-3 space-y-3">
            {plan.safeguards.map((guard) => (
              <div key={guard.id} className={`rounded-2xl border p-3 text-sm ${tone(guard.status)}`}>
                <p className="font-black">{guard.label}</p>
                <p className="mt-1 opacity-85">{guard.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <p className="font-black text-white">Canonical operator sequence</p>
          <div className="mt-3 space-y-3">
            {plan.steps.map((step) => (
              <div key={step.id} className="rounded-2xl border border-white/10 bg-black/25 p-3 text-sm">
                <p className="font-black text-white">{step.label}</p>
                <code className="mt-2 block rounded-xl bg-black/35 px-3 py-2 text-xs text-cyan-100">{step.command}</code>
                <p className="mt-2 text-slate-400">{step.purpose}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TwelveDataTransferPanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const transfer = lab.twelveDataTransfer;

  return (
    <section className="mt-7 rounded-[30px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/60">Twelve Data transfer</p>
          <h2 className="mt-2 text-2xl font-black text-white">What the Lab already pulled</h2>
          <p className="mt-3 max-w-4xl text-sm text-slate-300">
            This block reads the canonical market-data backfill report and shows which yearly local archives were already
            materialized from Twelve Data for active Research Lab markets.
          </p>
        </div>
        <div className="rounded-full border border-white/15 bg-slate-950/45 px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-slate-100">
          Report {time(transfer.generatedAt)}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <Metric label="Local archive files" value={transfer.localArchiveFiles} />
        <Metric label="Downloaded this cycle" value={transfer.downloadedThisCycle} />
        <Metric label="Restricted access" value={transfer.restrictedAccess} />
        <Metric label="Missing remote" value={transfer.missingRemote} />
        <Metric label="Failed" value={transfer.failed} />
      </div>

      {!transfer.available ? (
        <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          No canonical Twelve Data transfer report is available in this runtime yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/35">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Instrument</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Local files</th>
                <th className="px-4 py-3">Downloaded now</th>
                <th className="px-4 py-3">Candles</th>
                <th className="px-4 py-3">Restricted</th>
                <th className="px-4 py-3">Missing remote</th>
                <th className="px-4 py-3">Failed</th>
                <th className="px-4 py-3">Latest period</th>
              </tr>
            </thead>
            <tbody>
              {transfer.instruments.map((entry) => (
                <tr key={entry.instrument} className="border-t border-white/5 align-top">
                  <td className="px-4 py-3 font-bold text-white">{entry.instrument}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.providerSymbol ?? "n/a"}</td>
                  <td className="px-4 py-3">{entry.localArchiveFiles}</td>
                  <td className="px-4 py-3">{entry.downloadedThisCycle}</td>
                  <td className="px-4 py-3">{entry.candleCount}</td>
                  <td className="px-4 py-3">{entry.restrictedAccess}</td>
                  <td className="px-4 py-3">{entry.missingRemote}</td>
                  <td className="px-4 py-3">{entry.failed}</td>
                  <td className="px-4 py-3">{entry.latestPeriodLabel ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TwelveDataArchivePanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const archive = lab.twelveDataArchive;

  return (
    <section className="mt-7 rounded-[30px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/60">Twelve Data full archive</p>
          <h2 className="mt-2 text-2xl font-black text-white">Dedicated remote-history vault</h2>
          <p className="mt-3 max-w-4xl text-sm text-slate-300">
            Separate from the canonical lab archive. This is the raw Twelve Data vault used to prove what the provider
            makes available, what was already downloaded, and what years are still pending before any future promotion.
          </p>
        </div>
        <div className="rounded-full border border-white/15 bg-slate-950/45 px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-slate-100">
          Report {time(archive.generatedAt)}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <Metric label="Archive files" value={archive.localArchiveFiles} />
        <Metric label="Pending years" value={archive.pendingYears} />
        <Metric label="Instruments" value={archive.totalInstruments} />
        <Metric label="Timeframes" value={archive.totalTimeframes} />
        <Metric label="Provider available" value={archive.availableScopes} />
        <Metric label="Restricted" value={archive.restrictedScopes} />
        <Metric label="Missing remote" value={archive.missingRemoteScopes} />
        <Metric label="Downloaded now" value={archive.downloaded} />
        <Metric label="Existing now" value={archive.existing} />
        <Metric label="Failed now" value={archive.failed} />
        <Metric label="Markets" value={archive.markets.join(", ") || "all"} />
        <Metric label="Requested scope" value={archive.instrumentsRequested.join(", ") || "all"} />
        <Metric label="Requested TFs" value={archive.timeframesRequested.join(", ") || "all"} />
        <Metric label="History mode" value={archive.fullHistory ? "1980 -> provider max" : "manual / detected"} />
      </div>

      {!archive.available ? (
        <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          No dedicated Twelve Data full-archive report exists yet in this runtime.
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
            <p>
              <span className="font-bold text-white">Archive root:</span>{" "}
              <span className="break-all">{archive.archiveRoot ?? "n/a"}</span>
            </p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/35">
            <table className="min-w-full text-left text-sm text-slate-200">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Instrument</th>
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Local files</th>
                  <th className="px-4 py-3">Pending years</th>
                  <th className="px-4 py-3">TF ready</th>
                  <th className="px-4 py-3">TF restricted</th>
                  <th className="px-4 py-3">Per timeframe</th>
                </tr>
              </thead>
              <tbody>
                {archive.instruments.map((entry) => (
                  <tr key={entry.instrument} className="border-t border-white/5 align-top">
                    <td className="px-4 py-3 font-bold text-white">{entry.instrument}</td>
                    <td className="px-4 py-3">{entry.market}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {entry.providerSymbol ?? "n/a"}
                      {entry.providerRelation ? ` (${entry.providerRelation})` : ""}
                    </td>
                    <td className="px-4 py-3">{entry.localArchiveFiles}</td>
                    <td className="px-4 py-3">{entry.pendingYears}</td>
                    <td className="px-4 py-3">
                      {entry.availableTimeframes}/{entry.timeframes.length}
                    </td>
                    <td className="px-4 py-3">{entry.restrictedTimeframes}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      <div className="space-y-2">
                        {entry.timeframes.map((timeframe) => (
                          <div key={`${entry.instrument}-${timeframe.timeframe}`} className="rounded-xl border border-white/10 bg-black/20 p-2">
                            <p className="font-bold text-white">
                              {timeframe.timeframe} · earliest {time(timeframe.earliestAvailableAt)}
                            </p>
                            <p>
                              files {timeframe.localArchiveFiles}
                              {" · "}
                              years {timeframe.localArchiveYears.length > 0 ? timeframe.localArchiveYears.join(", ") : "none"}
                            </p>
                            <p>
                              pending {timeframe.pendingYears.length > 0 ? timeframe.pendingYears.join(", ") : "0"}
                            </p>
                            <p>{timeframe.restrictionReason ?? timeframe.note ?? "n/a"}</p>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function PromotionReadinessPanel({ lab }: { lab: Awaited<ReturnType<typeof buildResearchLabOverview>> }) {
  const promotion = lab.promotionReadiness;
  const board = promotion.board;
  const packages = promotion.packages;
  const opportunity = promotion.opportunity;
  const paperGate = promotion.paperGate;
  const challenger = promotion.challengerGovernance;
  const panelTone = tone(
    paperGate?.status === "ready"
      ? "ok"
      : (packages?.blockedCount ?? 0) > 0 || paperGate?.status === "blocked"
        ? "blocked"
        : paperGate?.status === "bundle_only"
          ? "warn"
          : "idle",
  );

  return (
    <section className={`mt-7 rounded-[30px] border p-6 shadow-2xl shadow-black/20 ${panelTone}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] opacity-70">Promote to paper</p>
          <h2 className="mt-2 text-2xl font-black text-white">Canonical handoff readiness</h2>
          <p className="mt-3 max-w-4xl text-sm opacity-85">
            This panel reads the canonical promotion board, promotion packages, opportunity review, and current paper
            gate snapshot. It shows whether promoted research can actually flow into paper without ambiguity.
          </p>
        </div>
        <div className="rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm font-black uppercase tracking-[0.18em]">
          {paperGate?.status ?? "unavailable"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="Board review ready" value={board?.reviewReadyCount ?? "n/a"} />
        <Metric label="Live-review packages" value={packages?.readyForLiveReviewCount ?? "n/a"} />
        <Metric label="Blocked packages" value={packages?.blockedCount ?? "n/a"} />
        <Metric label="Executable paper scopes" value={paperGate?.executableTaskScopeCount ?? "n/a"} />
        <Metric label="Bundle confirmed" value={board?.bundleConfirmedCount ?? "n/a"} />
        <Metric label="Reviewed opportunities" value={opportunity?.reviewedItemCount ?? "n/a"} />
        <Metric label="Bundle status" value={opportunity?.bundleStatus ?? "n/a"} />
        <Metric label="Bundle-only ready" value={paperGate?.bundleOnlyReadyPackageCount ?? "n/a"} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/15 bg-black/20 p-4 text-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-black text-white">Challenger governance</p>
            <p className="mt-2 opacity-85">
              {challenger?.reason ??
                "No challenger governance snapshot is available from the canonical promotion artifacts."}
            </p>
          </div>
          <div className="rounded-full border border-white/20 bg-slate-950/35 px-4 py-2 text-xs font-black uppercase tracking-[0.18em]">
            {challenger?.status ?? "unavailable"}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <Metric label="Watchlist" value={challenger?.candidateWatchlistCount ?? "n/a"} />
          <Metric label="Challenger review" value={challenger?.challengerReviewCount ?? "n/a"} />
          <Metric label="Confirmed" value={challenger?.challengerConfirmedCount ?? "n/a"} />
          <Metric label="Paper eligible" value={challenger?.paperEligibleCount ?? "n/a"} />
          <Metric label="Baseline replacements" value={challenger?.baselineReplacementReadyCount ?? "n/a"} />
        </div>
        <p className="mt-3 text-xs opacity-70">
          Auto baseline promotion: {challenger?.autoBaselinePromotionEnabled ? "enabled" : "disabled by governance"}.
        </p>
      </div>

      {packages?.topBlockers?.length ? (
        <div className="mt-4 rounded-2xl border border-white/15 bg-black/20 p-4 text-sm">
          <p className="font-bold text-white">Current blockers</p>
          <div className="mt-3 space-y-2">
            {packages.topBlockers.map((blocker) => (
              <p key={blocker} className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 opacity-90">
                {blocker}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/15 bg-black/20 p-4 text-sm opacity-85">
          {paperGate?.status === "ready"
            ? "At least one promoted research scope is currently executable by the paper planner without ambiguity."
            : "No explicit promotion-package blocker is currently recorded in the latest canonical artifacts."}
        </div>
      )}
    </section>
  );
}

function PaperTradingPanel({ paper }: { paper: Awaited<ReturnType<typeof readPaperHistoryPayloadSafe>> }) {
  const summary = paper.summary;
  const observability = paper.observability;
  const source = observability.schemaReady ? "paper_trades" : "paper_trades unavailable";

  return (
    <section className="mt-7 rounded-[30px] border border-emerald-300/20 bg-emerald-400/10 p-6 text-emerald-50 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-100/70">Paper trading</p>
          <h2 className="mt-2 text-2xl font-black text-white">Canonical source of truth</h2>
          <p className="mt-3 max-w-3xl text-sm text-emerald-50/80">
            OPS and /app/bot now read the same canonical paper lifecycle. Metrics are derived from persisted outcomes,
            not separate runtime counters.
          </p>
        </div>
        <div className="rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm font-black uppercase tracking-[0.18em]">
          {source}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="Saved cycles" value={paper.history.length} />
        <Metric label="Closed" value={summary.closed} />
        <Metric label="Wins / losses" value={`${summary.wins} / ${summary.losses}`} />
        <Metric label="Open" value={summary.open} />
        <Metric label="Retryable" value={summary.retryable ?? 0} />
        <Metric label="Rejected" value={summary.rejected} />
        <Metric label="Unavailable" value={summary.unavailable} />
        <Metric label="WR" value={summary.winRate == null ? "n/a" : `${summary.winRate}%`} />
        <Metric label="PF" value={paper.research.overall.profitFactor ?? "n/a"} />
        <Metric label="Net R" value={`${summary.netR}R`} />
        <Metric label="Unsettled" value={observability.unsettledCycleCount} />
        <Metric label="Retry queue" value={observability.retryableSettlementCount ?? 0} />
        <Metric label="Last settlement" value={time(observability.lastSettlementAt)} />
        <Metric label="Reconciliation" value={observability.reconciliationStatus} />
      </div>

      {observability.error ? (
        <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          {observability.error}
        </p>
      ) : null}
    </section>
  );
}

function SummaryMetrics({ summary }: { summary: ResearchMetricSummary | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Trades" value={summary?.totalTrades ?? "n/a"} />
      <Metric label="WR" value={summary ? fmt(summary.winRate, "%") : "n/a"} />
      <Metric label="PF" value={summary ? fmt(summary.profitFactor) : "n/a"} />
      <Metric label="Expectancy" value={summary ? `${fmt(summary.expectancy)}R` : "n/a"} />
      <Metric label="RR" value={summary ? fmt(summary.averageRiskReward) : "n/a"} />
      <Metric label="Max DD" value={summary ? fmt(summary.maxDrawdown) : "n/a"} />
    </div>
  );
}

export default async function ResearchLabPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, headerStore, cookieStore, resolvedSearchParams] = await Promise.all([
    auth(),
    headers(),
    cookies(),
    searchParams ?? Promise.resolve({}),
  ]);
  const pageSearchParams = resolvedSearchParams as Record<string, string | string[] | undefined>;
  const pageUserId =
    userId ||
    (isLocalQaBypassServerAccess({
      host: headerStore.get("host"),
      headerAuth: headerStore.get("x-syntrake-qa-auth"),
      cookieAuth: cookieStore.get("syntrake_qa_auth")?.value ?? null,
      qa: typeof pageSearchParams.qa === "string" ? pageSearchParams.qa : null,
      qaAuth: typeof pageSearchParams.__qa_auth === "string" ? pageSearchParams.__qa_auth : null,
    })
      ? LOCAL_QA_USER_ID
      : null);
  if (!pageUserId || (!isOwnerUserId(pageUserId) && pageUserId !== LOCAL_QA_USER_ID)) {
    return (
      <main className="min-h-screen bg-[#07111f] px-6 py-16 text-white">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-slate-500">Syntrake Lab</p>
          <h1 className="mt-3 text-3xl font-bold">Owner access required</h1>
          <p className="mt-3 text-slate-300">This research cockpit is limited to configured owner accounts.</p>
        </div>
      </main>
    );
  }

  const lab = await buildResearchLabOverview();
  const paper = await readPaperHistoryPayloadSafe(pageUserId, { days: 183, maxSettlements: 4 });
  const totalDecisions = Object.values(lab.decisions.counts).reduce((sum, count) => sum + count, 0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#17385d_0,#07111f_38%,#030712_100%)] px-5 py-8 text-white md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[34px] border border-white/10 bg-slate-950/55 p-7 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.34em] text-cyan-200/70">Syntrake Research Lab</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Lab control room</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Baseline, crise, runtime, decisões e candidatos num cockpit interno. Sem promessas bonitas: só aquilo
                que passou, falhou, ficou pendente ou precisa de reparação.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/ops"
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10"
              >
                Back to Ops
              </a>
              <span className={`rounded-full border px-4 py-2 text-sm font-bold ${tone(lab.runtime.severity)}`}>
                {lab.runtime.severity}
              </span>
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <Metric label="Baseline" value={lab.config.baselineId} />
            <Metric label="Dataset" value={lab.config.datasetProfile} />
            <Metric label="Validation" value={lab.config.validationProfile} />
            <Metric label="Generated UTC" value={time(lab.generatedAt)} />
          </div>
        </header>

        {lab.storage.remoteBacked ? (
          <div className="mt-6 rounded-[28px] border border-emerald-300/30 bg-emerald-400/10 p-5 text-emerald-50">
            <p className="font-black">Remote Research Lab sync active</p>
            <p className="mt-2 text-sm text-emerald-100/80">{lab.storage.note}</p>
          </div>
        ) : !lab.storage.localArtifactBacked ? (
          <div className="mt-6 rounded-[28px] border border-amber-300/30 bg-amber-400/10 p-5 text-amber-50">
            <p className="font-black">Lab artifacts not synced to this runtime</p>
            <p className="mt-2 text-sm text-amber-100/80">{lab.storage.note}</p>
          </div>
        ) : null}

        <LabControlPanel />

        <ResearchIntelligencePanel lab={lab} />

        <DataCoveragePanel lab={lab} />

        <DatasetRequirementsPanel lab={lab} />

        <DataAcquisitionAgentPanel lab={lab} />

        <TwelveDataArchivePanel lab={lab} />

        <TwelveDataTransferPanel lab={lab} />

        <PromotionReadinessPanel lab={lab} />

        <PaperTradingPanel paper={paper} />

        <div className="mt-7 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card eyebrow="Baseline" title="Current live baseline">
            <SummaryMetrics summary={lab.baseline?.live_summary ?? null} />
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
              <p>
                <span className="font-bold text-white">Created:</span> {time(lab.baseline?.created_at)}
              </p>
              <p className="mt-1">
                <span className="font-bold text-white">Engine hash:</span>{" "}
                <span className="break-all">{lab.baseline?.engine_manifest_hash ?? "n/a"}</span>
              </p>
            </div>
          </Card>

          <Card eyebrow="Crisis" title="Crisis validation">
            <SummaryMetrics summary={lab.baseline?.crisis_summary ?? null} />
            <p className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-100">
              Crisis remains the hard gate. Candidates should not promote unless crisis improves without killing the
              220-320 annual trade cadence.
            </p>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card eyebrow="Runtime" title="Supervisor health">
            <div className="grid gap-3">
              <Metric label="Lock" value={lab.runtime.lock.health} />
              <Metric label="Active run" value={lab.runtime.queue.activeRunId ? "running" : "idle"} />
              <Metric label="Stage" value={lab.runtime.activeRun.stage ?? "none"} />
              <Metric label="Stage health" value={lab.runtime.activeRun.stageHealth} />
              <Metric label="Idle reason" value={lab.runtime.queue.idleReason ?? "none"} />
            </div>
            {lab.runtime.alerts.length > 0 ? (
              <div className="mt-4 space-y-2">
                {lab.runtime.alerts.map((alert) => (
                  <p key={alert.id} className={`rounded-2xl border p-3 text-sm ${tone(alert.severity)}`}>
                    {alert.message}
                  </p>
                ))}
              </div>
            ) : null}
          </Card>

          <Card eyebrow="Queue" title="Task pipeline">
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(lab.queue.counts).map(([status, count]) => (
                <Metric key={status} label={status} value={count} />
              ))}
            </div>
          </Card>

          <Card eyebrow="Operator" title="Local controls">
            <div className="space-y-3">
              {lab.operatorActions.map((action) => (
                <div key={action.command} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <p className="font-bold text-white">{action.label}</p>
                  <code className="mt-2 block rounded-xl bg-black/35 px-3 py-2 text-xs text-cyan-100">{action.command}</code>
                  <p className="mt-2 text-xs text-slate-400">{action.note}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card eyebrow="Decisions" title="Accepted / promoted watch">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Total decisions" value={totalDecisions} />
              <Metric label="Promote" value={lab.decisions.counts.promote ?? 0} />
              <Metric label="Candidate" value={lab.decisions.counts.candidate ?? 0} />
            </div>
            <div className="mt-5 space-y-3">
              {lab.decisions.promotedOrCandidate.length > 0 ? lab.decisions.promotedOrCandidate.map((entry) => (
                <div key={`${entry.runId}-${entry.timestamp}`} className={`rounded-2xl border p-4 text-sm ${tone(entry.decision)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-black">{entry.decision}</p>
                    <p className="text-xs opacity-80">{time(entry.timestamp)}</p>
                  </div>
                  <p className="mt-2">{entry.reason ?? "No reason recorded."}</p>
                  <p className="mt-2 text-xs opacity-80">PF {fmt(entry.aggregateSummary?.profitFactor)} | Crisis PF {fmt(entry.crisisSummary?.profitFactor)} | Score {fmt(entry.rankingScore)}</p>
                </div>
              )) : (
                <p className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
                  No promoted/candidate records yet.
                </p>
              )}
            </div>
          </Card>

          <Card eyebrow="Rejections" title="Rejected / failed candidates">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Reject" value={lab.decisions.counts.reject ?? 0} />
              <Metric label="Failed" value={lab.decisions.counts.failed ?? 0} />
              <Metric label="Recent shown" value={lab.decisions.rejectedOrFailed.length} />
            </div>
            <div className="mt-5 max-h-[620px] space-y-3 overflow-y-auto pr-1">
              {lab.decisions.rejectedOrFailed.map((entry) => (
                <div key={`${entry.runId}-${entry.timestamp}`} className={`rounded-2xl border p-4 text-sm ${tone(entry.decision)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-black">{entry.decision}</p>
                    <p className="text-xs opacity-80">{time(entry.timestamp)}</p>
                  </div>
                  <p className="mt-2">{entry.failureSummary ?? entry.reason ?? "No failure reason recorded."}</p>
                  <p className="mt-2 text-xs opacity-80">Campaign {entry.campaignId ?? "n/a"} | Band {entry.rankingBand ?? "n/a"} | Score {fmt(entry.rankingScore)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card eyebrow="Runs" title="Recent run history">
            <div className="space-y-3">
              {lab.runs.recent.length > 0 ? lab.runs.recent.map((run) => (
                <div key={run.runId} className={`rounded-2xl border p-4 text-sm ${tone(run.status)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="break-all font-black">{run.runId}</p>
                    <span>{run.status}</span>
                  </div>
                  <p className="mt-2 text-xs opacity-80">Stage {run.stage ?? "n/a"} | Updated {time(run.updatedAt)}</p>
                  {run.error ? <p className="mt-2 text-xs opacity-80">{run.error}</p> : null}
                </div>
              )) : (
                <p className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
                  No run folders available in this runtime.
                </p>
              )}
            </div>
          </Card>

          <Card eyebrow="Queue detail" title="Recent tasks">
            <div className="space-y-3">
              {lab.queue.recentTasks.length > 0 ? lab.queue.recentTasks.map((task) => (
                <div key={task.id} className={`rounded-2xl border p-4 text-sm ${tone(task.status)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="break-all font-black">{task.id}</p>
                    <span>{task.status}</span>
                  </div>
                  <p className="mt-2 text-xs opacity-80">Type {task.type} | Priority {task.priority} | Decision {task.decision ?? "n/a"}</p>
                  <p className="mt-1 text-xs opacity-80">Campaign {task.campaignId ?? "n/a"} | Objective {task.campaignObjective ?? "n/a"}</p>
                  {task.error ? <p className="mt-2 text-xs opacity-80">{task.error}</p> : null}
                </div>
              )) : (
                <p className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
                  No queue tasks available in this runtime.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
