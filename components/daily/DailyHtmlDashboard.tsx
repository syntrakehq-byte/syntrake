"use client";

import React from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Tone = "blue" | "green" | "amber" | "purple";
type Priority = "high" | "med" | "low";
type TimelineState = "done" | "active" | "idle";
type ButtonVariant = "primary" | "secondary";

type ActionConfig = {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant: ButtonVariant;
};

type DecisionStat = {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "green" | "amber";
};

type SideCard = {
  title: string;
  value?: string;
  valueTone?: "white" | "amber" | "blue";
  detail: string;
};

type BarItem = {
  name: string;
  value: number;
  label: string;
  tone: Tone;
};

type ScenarioItem = {
  name: string;
  value: number;
  tone: "blue" | "green" | "amber";
};

type ActionStep = {
  id: string;
  title: string;
  detail: string;
  priority: Priority;
};

type WatchItem = {
  label: string;
  value: string;
};

type TimelineItem = {
  label: string;
  state: TimelineState;
};

export type DailyHtmlDashboardProps = {
  lastEvaluationLabel: string;
  decision: {
    title: string;
    titleTone: "blue" | "amber";
    headline: string;
    postureLabel: string;
    impactLabel: string;
    gateLabel: string;
    summary: string;
    stats: DecisionStat[];
    whyNow: string;
    chips: string[];
    sideCards: SideCard[];
    primaryAction: ActionConfig;
    secondaryAction?: ActionConfig | null;
  };
  marketRisk: {
    marketItems: BarItem[];
    scenarioItems: ScenarioItem[];
    scenarioLead: string;
    scenarioNote: string;
    pressureGauge: number;
    pressureState: string;
    pressureDeltaLabel: string;
  };
  actionStack: {
    steps: ActionStep[];
    portfolioImpact: string;
    exposureMix: string;
  };
  dailyLoop: {
    streakLabel: string;
    provenValueLabel: string;
    receiptsLabel: string;
    whyClose: string;
    watchItems: WatchItem[];
    completionPct: number;
    timeline: TimelineItem[];
    primaryAction: ActionConfig;
  };
};

function DashboardButton({ action }: { action: ActionConfig }) {
  const className = cx(
    "inline-flex h-[42px] items-center justify-center rounded-[12px] px-4 text-[13px] font-extrabold tracking-[0.02em] transition disabled:cursor-not-allowed disabled:opacity-60",
    action.variant === "primary"
      ? "border-none bg-[linear-gradient(180deg,#4b8bff_0%,#2f6df6_100%)] text-white shadow-[0_10px_24px_rgba(47,109,246,0.22)]"
      : "border border-[#233453] bg-[#13213b] text-[#d8e5fb]"
  );

  if (action.href && !action.disabled) {
    return (
      <a href={action.href} className={className}>
        {action.label}
      </a>
    );
  }

  return (
    <button type="button" onClick={action.onClick} disabled={action.disabled} className={className}>
      {action.label}
    </button>
  );
}

function barFill(tone: Tone) {
  if (tone === "green") return "bg-[linear-gradient(90deg,#11a36a_0%,#28cc91_100%)]";
  if (tone === "amber") return "bg-[linear-gradient(90deg,#d8931f_0%,#f4bc66_100%)]";
  if (tone === "purple") return "bg-[linear-gradient(90deg,#7f67ff_0%,#b099ff_100%)]";
  return "bg-[linear-gradient(90deg,#2f6df6_0%,#58a0ff_100%)]";
}

function scenarioFill(tone: "blue" | "green" | "amber") {
  if (tone === "green") return "bg-[linear-gradient(90deg,#11a36a_0%,#2fd09a_100%)]";
  if (tone === "amber") return "bg-[linear-gradient(90deg,#d8931f_0%,#f1be72_100%)]";
  return "bg-[linear-gradient(90deg,#4f8dff_0%,#83b6ff_100%)]";
}

function priorityClasses(priority: Priority) {
  if (priority === "high") return "border-[#4a2830] bg-[#341a20] text-[#ff9b9b]";
  if (priority === "med") return "border-[#4a3514] bg-[#362813] text-[#f1c074]";
  return "border-[#1f4a3b] bg-[#102d28] text-[#79e5bc]";
}

function sideValueClasses(tone?: "white" | "amber" | "blue") {
  if (tone === "amber") return "text-[#f3a43b]";
  if (tone === "blue") return "text-[#9ec1ff]";
  return "text-[#f7fbff]";
}

function buildSparkPath(values: number[]) {
  const points = values.length ? values : [42, 72, 56, 34];
  const xs = [0, 46, 88, 140, 186, 232, 282, 300];
  const ys = [points[0], points[1] ?? points[0], points[2] ?? points[1] ?? points[0], points[3] ?? points[2] ?? points[1] ?? points[0]];
  const normalized = [ys[0], ys[1], ys[2], ys[3], ys[2], ys[1], ys[0], ys[3]].map((value) => 72 - Math.max(10, Math.min(58, value)));

  return `M${xs[0]},${normalized[0]} C18,${normalized[0] - 2} 28,${normalized[1] - 4} ${xs[1]},${normalized[1]} C64,${normalized[1] + 2} 72,${normalized[2] + 8} ${xs[2]},${normalized[2]} C104,${normalized[2] - 2} 120,${normalized[3] - 2} ${xs[3]},${normalized[3]} C160,${normalized[3] + 2} 170,${normalized[2] + 4} ${xs[4]},${normalized[2]} C202,${normalized[2] - 2} 214,${normalized[1] - 8} ${xs[5]},${normalized[1]} C250,${normalized[1] + 4} 264,${normalized[0] + 6} ${xs[6]},${normalized[0]} C292,${normalized[0] - 4} 298,${normalized[3] - 4} ${xs[7]},${normalized[3] - 6}`;
}

const heroPanelClass =
  "rounded-[22px] border border-[#23314c] bg-[linear-gradient(180deg,#101d34_0%,#0d1729_100%)] p-[26px] shadow-[0_18px_50px_rgba(0,0,0,.28)]";
const panelClass =
  "rounded-[18px] border border-[#23314c] bg-[linear-gradient(180deg,#111c31_0%,#0d1729_100%)] p-5 shadow-[0_18px_50px_rgba(0,0,0,.28)]";

export default function DailyHtmlDashboard({
  lastEvaluationLabel,
  decision,
  marketRisk,
  actionStack,
  dailyLoop,
}: DailyHtmlDashboardProps) {
  const decisionStats = Array.isArray(decision?.stats) ? decision.stats : [];
  const decisionSideCards = Array.isArray(decision?.sideCards) ? decision.sideCards : [];
  const decisionChips = Array.isArray(decision?.chips) ? decision.chips : [];
  const marketItems = Array.isArray(marketRisk?.marketItems) ? marketRisk.marketItems : [];
  const scenarioItems = Array.isArray(marketRisk?.scenarioItems) ? marketRisk.scenarioItems : [];
  const actionSteps = Array.isArray(actionStack?.steps) ? actionStack.steps : [];
  const watchItems = Array.isArray(dailyLoop?.watchItems) ? dailyLoop.watchItems : [];
  const timelineItems = Array.isArray(dailyLoop?.timeline) ? dailyLoop.timeline : [];
  const sparkPath = buildSparkPath(marketItems.map((item) => item.value));
  const freshnessValue = /live/i.test(lastEvaluationLabel) ? "Updating" : lastEvaluationLabel.replace(/^LAST EVALUATION\s*/i, "Updated ");
  const coverageValue = decisionStats.find((item) => /coverage|quality/i.test(item.label))?.value || "See evidence";
  const reviewValue = decisionSideCards.find((item) => /review|path/i.test(item.title))?.detail || "See decision window";
  const systemState = decision.title === "HOLD" ? "Stable · no capital action" : "Attention · review required";

  return (
    <main className="w-full">
      <div className="mb-[18px] flex items-end justify-between gap-[18px] max-[980px]:items-start">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.16em] text-[#7f91ad]">Today · Investing</div>
          <h1 className="m-0 text-[30px] font-black leading-none tracking-[-0.06em] text-[#e7effc]">Your capital, at a glance</h1>
          <p className="mt-2 text-sm text-[#95a6c2]">
            One verified state. One next action. Full evidence when you need it.
          </p>
        </div>
        <div className="shrink-0 rounded-[10px] border border-[#28436d] bg-[#10213d] px-3 py-[10px] font-mono text-xs text-[#b9cff2]" aria-label={`Data freshness: ${lastEvaluationLabel}`}>
          {lastEvaluationLabel}
        </div>
      </div>

      <section className={cx("relative mb-[18px] overflow-hidden", heroPanelClass)}>
        <div className="absolute right-[-80px] top-[-80px] h-[240px] w-[240px] rounded-full bg-[radial-gradient(circle,_rgba(243,164,59,.10)_0%,_rgba(243,164,59,0)_70%)]" />

        <div className="mb-6 grid gap-3 border-b border-[#23314c] pb-5 sm:grid-cols-2 xl:grid-cols-5">
          {[{label:"System",value:systemState},{label:"Data",value:freshnessValue},{label:"Coverage",value:coverageValue},{label:"Next review",value:reviewValue},{label:"Authority",value:"Approval required"}].map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#7f91ad]">{item.label}</div>
              <div className="mt-1 truncate text-[13px] font-bold text-[#e7effc]">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[1.55fr_1fr]">
          <div>
            <div className="mb-[10px] text-[10px] font-extrabold uppercase tracking-[.12em] text-[#93a4bf]">Next best action</div>
            <h2
              className={cx(
                "m-0 text-[50px] font-black leading-[.94] tracking-[-.07em] max-[980px]:text-[40px] max-[640px]:text-[34px]",
                decision.titleTone === "blue" ? "text-[#7cc4ff]" : "text-[#f3a43b]"
              )}
            >
              {decision.title}
            </h2>

            <div className="mt-[14px] flex flex-wrap gap-[10px]">
              <div className="inline-flex h-[34px] items-center rounded-full border border-[#4c3614] bg-[#362813] px-3 text-xs font-extrabold uppercase tracking-[.05em] text-[#f5c57b]">
                Posture: {decision.postureLabel}
              </div>
              <div className="inline-flex h-[34px] items-center rounded-full border border-[#20365d] bg-[#10213d] px-3 text-xs font-extrabold uppercase tracking-[.05em] text-[#9ec1ff]">
                {decision.impactLabel}
              </div>
              <div className="inline-flex h-[34px] items-center rounded-full border border-[#4a2830] bg-[#341a20] px-3 text-xs font-extrabold uppercase tracking-[.05em] text-[#ff9b9b]">
                {decision.gateLabel}
              </div>
            </div>

            <p className="mt-4 max-w-[64ch] text-[15px] leading-[1.72] text-[#b2c2d8]">{decision.summary}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {decisionStats.map((item) => (
                <div key={item.label} className="rounded-[14px] border border-[#31415f] bg-[#0e1930] p-[14px]">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-[#8da0be]">{item.label}</div>
                  <div
                    className={cx(
                      "mt-2 text-2xl font-black leading-none tracking-[-.05em]",
                      item.tone === "green" ? "text-[#14b57a]" : item.tone === "amber" ? "text-[#f3a43b]" : "text-[#f7fbff]"
                    )}
                  >
                    {item.value}
                  </div>
                  <div className="mt-1.5 text-xs text-[#71839d]">{item.note}</div>
                </div>
              ))}
            </div>

            <div className="mt-[18px] rounded-[14px] border border-[#233453] bg-[#0d182d] p-4">
              <strong className="mb-[7px] block text-[13px] text-[#e7effc]">Why this is recommended</strong>
              <span className="block text-sm leading-[1.65] text-[#a2b4cd]">{decision.whyNow}</span>
            </div>
          </div>

          <div className="grid gap-[14px]">
            {decisionSideCards.map((card) => (
              <div key={card.title} className="rounded-[14px] border border-[#31415f] bg-[#0d182d] p-4">
                <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-[#93a4bf]">{card.title}</div>
                {card.value ? (
                  <div className={cx("text-[30px] font-black leading-none tracking-[-.06em]", sideValueClasses(card.valueTone))}>{card.value}</div>
                ) : null}
                <div className="mt-[6px] text-[13px] leading-[1.6] text-[#97a9c3]">{card.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-[22px] flex flex-wrap items-end justify-between gap-[18px]">
          <div className="flex flex-wrap gap-2">
            {decisionChips.map((chip) => (
              <div key={chip} className="inline-flex h-8 items-center rounded-full border border-[#31415f] bg-[#0d182d] px-[11px] text-xs font-bold text-[#a6b7cf]">
                {chip}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-[10px]">
            <DashboardButton action={decision.primaryAction} />
          </div>
        </div>
      </section>

      <section className="mb-[18px] grid gap-[18px] xl:grid-cols-3">
        <section className={panelClass}>
          <h3 className="m-0 text-[21px] font-extrabold leading-[1.02] tracking-[-.05em] text-[#e7effc]">What changed</h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-[#91a3bc]">Only changes that can affect your plan or next decision.</p>

          <div className="mt-[18px] grid gap-[14px]">
            {marketItems.map((item) => (
              <div key={item.name} className="grid items-center gap-3 [grid-template-columns:auto_1fr_auto]">
                <div className="min-w-[74px] text-[13px] font-bold text-[#dbe7f8]">{item.name}</div>
                <div className="h-2 overflow-hidden rounded-full bg-[#13213b]">
                  <div className={cx("h-full rounded-full", barFill(item.tone))} style={{ width: `${Math.max(8, Math.min(100, Math.round(item.value)))}%` }} />
                </div>
                <div className="text-[12px] font-extrabold uppercase tracking-[.05em] text-[#8ea2c0]">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-[18px] border-t border-[#23314c] pt-4">
            <svg viewBox="0 0 300 72" preserveAspectRatio="none" className="block h-[72px] w-full" aria-label="market sparkline">
              <defs>
                <linearGradient id="dailySparkFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#4f8dff" stopOpacity=".35" />
                  <stop offset="100%" stopColor="#4f8dff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${sparkPath} L300,72 L0,72 Z`} fill="url(#dailySparkFill)" />
              <path d={sparkPath} fill="none" stroke="#4f8dff" strokeWidth="3" />
            </svg>
          </div>
        </section>

        <section className={panelClass}>
          <h3 className="m-0 text-[21px] font-extrabold leading-[1.02] tracking-[-.05em] text-[#e7effc]">Evidence range</h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-[#91a3bc]">Probability-weighted paths derived from current market state and signal quality.</p>

          <div className="mt-[18px] grid gap-3">
            {scenarioItems.map((item) => (
              <div
                key={item.name}
                className="grid items-center gap-[10px] text-xs font-bold text-[#dbe7f8] [grid-template-columns:120px_1fr_48px] max-[640px]:[grid-template-columns:96px_1fr_40px]"
              >
                <span>{item.name}</span>
                <div className="h-2 overflow-hidden rounded-full bg-[#13213b]">
                  <div className={cx("h-full rounded-full", scenarioFill(item.tone))} style={{ width: `${Math.max(6, Math.min(100, Math.round(item.value)))}%` }} />
                </div>
                <span className="text-right">{Math.round(item.value)}%</span>
              </div>
            ))}
          </div>

          <div className="mt-[14px] border-t border-[#23314c] pt-[14px] text-[13px] leading-[1.6] text-[#a0b2cc]">
            Most likely path: <strong className="text-[#f1c074]">{marketRisk.scenarioLead}</strong>. {marketRisk.scenarioNote}
          </div>
        </section>

        <section className={panelClass}>
          <h3 className="m-0 text-[21px] font-extrabold leading-[1.02] tracking-[-.05em] text-[#e7effc]">Mandate distance</h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-[#91a3bc]">Current risk pressure compared with the limits in your plan.</p>

          <div className="mt-[18px] rounded-[14px] border border-[#243553] bg-[#0d182d] p-[18px_16px_14px]">
            <div className="relative h-4 rounded-full bg-[linear-gradient(90deg,#4f8dff_0%,#4ab8ff_24%,#2bcf96_50%,#f3a43b_76%,#ef5d5d_100%)]">
              <div
                className="absolute top-1/2 h-[22px] w-[22px] -translate-y-1/2 rounded-full border-[5px] border-[#f3a43b] bg-white shadow-[0_8px_18px_rgba(0,0,0,.26)]"
                style={{ left: `calc(${Math.max(0, Math.min(100, marketRisk.pressureGauge))}% - 11px)` }}
              />
            </div>

            <div className="mt-3 flex justify-between text-[10px] font-extrabold uppercase tracking-[.09em] text-[#93a4bf]">
              <span>Cold</span>
              <span>Balanced</span>
              <span>Elevated</span>
              <span>Hot</span>
            </div>

            <div className="mt-4 flex justify-between gap-[14px] border-t border-[#23314c] pt-[14px]">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-[#93a4bf]">Current State</div>
                <div
                  className={cx(
                    "mt-[7px] text-2xl font-black leading-none tracking-[-.05em]",
                    /caution|elevated|hot/i.test(marketRisk.pressureState) || marketRisk.pressureGauge >= 55 ? "text-[#f3a43b]" : "text-[#f7fbff]"
                  )}
                >
                  {marketRisk.pressureState}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-[#93a4bf]">Change vs Yesterday</div>
                <div className="mt-[7px] text-2xl font-black leading-none tracking-[-.05em] text-[#ffb56b]">{marketRisk.pressureDeltaLabel}</div>
              </div>
            </div>
          </div>
        </section>
      </section>

      <section className="grid gap-[18px] xl:grid-cols-[1.45fr_1fr]">
        <section className={panelClass}>
          <h3 className="m-0 text-[21px] font-extrabold leading-[1.02] tracking-[-.05em] text-[#e7effc]">Action Stack</h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-[#91a3bc]">Priority-ranked tasks required to execute today&apos;s directive cleanly.</p>

          <div className="mt-[18px] grid gap-3">
            {actionSteps.map((step) => (
              <div
                key={step.id}
                className="grid items-start gap-[14px] rounded-[14px] border border-[#31415f] bg-[#0d182d] p-4 md:grid-cols-[38px_1fr_auto] max-[980px]:[grid-template-columns:38px_1fr]"
              >
                <div className="grid h-[38px] w-[38px] place-items-center rounded-full border border-[#254271] bg-[#14284a] font-mono text-[13px] font-black text-[#b8cff7]">
                  {step.id}
                </div>
                <div>
                  <strong className="block text-[15px] leading-[1.35] text-[#eef5ff]">{step.title}</strong>
                  <span className="mt-[5px] block text-[13px] leading-[1.62] text-[#97a9c3]">{step.detail}</span>
                </div>
                <div
                  className={cx(
                    "inline-flex h-7 items-center justify-center rounded-full border px-[10px] text-[11px] font-extrabold uppercase tracking-[.05em] max-[980px]:hidden",
                    priorityClasses(step.priority)
                  )}
                >
                  {step.priority === "high" ? "High" : step.priority === "med" ? "Medium" : "Low"}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-[18px] grid gap-3">
            <div className="rounded-[14px] border border-[#31415f] bg-[#0d182d] p-[15px]">
              <strong className="mb-[6px] block text-sm text-[#eef5ff]">Portfolio Impact</strong>
              <span className="block text-[13px] leading-[1.62] text-[#9cafc9]">{actionStack.portfolioImpact}</span>
            </div>

            <div className="rounded-[14px] border border-[#31415f] bg-[#0d182d] p-[15px]">
              <strong className="mb-[6px] block text-sm text-[#eef5ff]">Exposure Mix After Action</strong>
              <span className="block text-[13px] leading-[1.62] text-[#9cafc9]">{actionStack.exposureMix}</span>
            </div>
          </div>
        </section>

        <section id="daily-loop-panel" className={panelClass}>
          <h3 className="m-0 text-[21px] font-extrabold leading-[1.02] tracking-[-.05em] text-[#e7effc]">Daily Loop</h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-[#91a3bc]">Discipline, proof capture, progression tracking, and opportunity watch.</p>

          <div className="mt-[18px] grid gap-3">
            <div className="rounded-[14px] border border-[#31415f] bg-[#0d182d] p-4">
              <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-[#93a4bf]">Streak</div>
              <div className="mt-[7px] text-[30px] font-black leading-none tracking-[-.05em] text-[#f4f8ff]">{dailyLoop.streakLabel}</div>
            </div>

            <div className="rounded-[14px] border border-[#31415f] bg-[#0d182d] p-4">
              <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-[#93a4bf]">Proven Value</div>
              <div className="mt-[7px] text-[30px] font-black leading-none tracking-[-.05em] text-[#14b57a]">{dailyLoop.provenValueLabel}</div>
            </div>

            <div className="rounded-[14px] border border-[#31415f] bg-[#0d182d] p-4">
              <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-[#93a4bf]">Receipts Logged</div>
              <div className="mt-[7px] text-[30px] font-black leading-none tracking-[-.05em] text-[#f4f8ff]">{dailyLoop.receiptsLabel}</div>
            </div>
          </div>

          <div className="mt-[18px] rounded-[14px] border border-[#243553] bg-[#0d182d] p-4">
            <strong className="mb-[7px] block text-[13px] text-[#e7effc]">Why close the loop?</strong>
            <span className="block text-sm leading-[1.62] text-[#99abc5]">{dailyLoop.whyClose}</span>
          </div>

          <div className="mt-[18px] grid gap-[10px] border-t border-[#23314c] pt-4">
            {watchItems.map((item) => (
              <div key={item.label} className="grid items-center gap-[10px] text-[13px] font-bold text-[#dfe9f8] [grid-template-columns:1fr_auto]">
                <span>{item.label}</span>
                <span className="font-mono text-xs text-[#9ec1ff]">{item.value}</span>
              </div>
            ))}
          </div>

          <div className="mt-[18px] border-t border-[#23314c] pt-4">
            <div className="mb-[10px] flex items-center justify-between gap-[10px] text-xs font-extrabold uppercase tracking-[.06em] text-[#a6b7cf]">
              <span>Loop Completion</span>
              <span>{dailyLoop.completionPct}%</span>
            </div>
            <div className="h-[10px] overflow-hidden rounded-full bg-[#13213b]">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#11a36a_0%,#2fd09a_100%)]" style={{ width: `${Math.max(0, Math.min(100, dailyLoop.completionPct))}%` }} />
            </div>

            <div className="mt-[14px] flex flex-wrap items-center gap-[10px] text-[11px] font-extrabold uppercase tracking-[.05em] text-[#93a4bf]">
              {timelineItems.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className={cx("h-[10px] w-[10px] rounded-full", item.state === "done" ? "bg-[#14b57a]" : item.state === "active" ? "bg-[#4b8bff]" : "bg-[#31415f]")} />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <DashboardButton action={dailyLoop.primaryAction} />
          </div>
        </section>
      </section>
    </main>
  );
}
