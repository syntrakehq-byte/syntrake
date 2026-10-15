"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import InvestingOperatingLoopRail from "@/components/investing/InvestingOperatingLoopRail";
import ProofRail from "@/components/ProofRail";
import { track } from "@/lib/analytics/client";
import { sanitizeProductHref } from "@/lib/navigation/sanitizeProductHref";
import { buildInvestingOperatingLoopSummary } from "@/lib/signalcore/investingOperatingLoop";
import { buildDailyDecisionCtaOverride, buildDailyDecisionView } from "./dailyDecisionViewModel";
import { buildAdvisorDecisionView } from "./advisorDecisionViewModel";
import { useDecisionStability } from "./decisionStability";
import { buildScenarios, requiredMonthlyContribution } from "@/lib/signalcore/wealthMath";
import { useSiteLanguage } from "@/components/SiteLanguageProvider";
import { pickByLang } from "@/lib/i18n/siteLanguage";

type Mode = "investing";
type ExperienceLevel = "beginner" | "medium" | "pro";

function normalizeMode(x: any): Mode {
  const m = String(x || "investing").toLowerCase().trim();
  if (m === "investing") return m;
  return "investing";
}

function normalizeExperienceLevel(x: unknown): ExperienceLevel {
  const raw = String(x || "").toLowerCase().trim();
  if (raw === "beginner" || raw === "medium" || raw === "pro") return raw;
  return "beginner";
}

async function fetchJSON(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false as const, status: res.status, data };
  return { ok: true as const, status: res.status, data };
}

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const styles =
    tone === "good"
      ? "border-[#1f4a3b] bg-[#102d28] text-[#79e5bc]"
      : tone === "warn"
        ? "border-[#4a3514] bg-[#362813] text-[#f1c074]"
        : tone === "bad"
          ? "border-[#4a2830] bg-[#341a20] text-[#ff9b9b]"
          : "border-[#31415f] bg-[#0d182d] text-[#dbe7f8]";
  return <span className={clsx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold", styles)}>{children}</span>;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#31415f] bg-[#0d182d] px-3 py-1 text-xs font-semibold text-[#a6b7cf]">
      {children}
    </span>
  );
}

function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const styles =
    tone === "good"
      ? "border-[#1f4a3b] bg-[#102d28] text-[#79e5bc]"
      : tone === "warn"
        ? "border-[#4a3514] bg-[#362813] text-[#f1c074]"
        : tone === "bad"
          ? "border-[#4a2830] bg-[#341a20] text-[#ff9b9b]"
          : "border-[#31415f] bg-[#0d182d] text-[#dbe7f8]";
  return <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs", styles)}>{children}</span>;
}

function Card({
  title,
  subtitle,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-[18px] border border-[#23314c] bg-[linear-gradient(180deg,#111c31_0%,#0d1729_100%)] shadow-[0_18px_50px_rgba(0,0,0,.28)]", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-[#23314c] px-5 py-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-[#eef5ff]">{title}</div>
          {subtitle ? <div className="text-xs text-[#91a3bc]">{subtitle}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="h-2 w-full rounded-full bg-[#13213b]">
      <div className="h-2 rounded-full bg-[linear-gradient(90deg,#4b8bff_0%,#58a0ff_100%)]" style={{ width: `${v}%` }} />
    </div>
  );
}

function fmtTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

function formatIntWithSpaces(v: number) {
  const n = Math.round(Math.abs(Number.isFinite(v) ? v : 0));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtEUR(v: number) {
  const sign = Number(v) < 0 ? "-" : "";
  return `${sign}${formatIntWithSpaces(v)} EUR`;
}

function readWealthPlan() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("sc_wealth_plan_v1");
    if (!raw) return null;
    return JSON.parse(raw) as {
      startingCapital?: number;
      monthlyContribution?: number;
      targetCapital?: number;
    };
  } catch {
    return null;
  }
}

function readGoalQuiz() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("sc_goal_quiz_v1");
    if (!raw) return null;
    return JSON.parse(raw) as {
      goalType?: string;
      riskProfile?: string;
      mode?: string;
      horizonMonths?: number;
      startingCapital?: number;
      monthlyContribution?: number;
      targetCapital?: number;
      annualReturn?: number;
      verdict?: string;
    };
  } catch {
    return null;
  }
}

function readNumber(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function baseAnnualReturnFromProfile(mode: Mode, riskProfile?: string | null) {
  const risk = String(riskProfile || "").toLowerCase().trim();
  const base =
    risk === "conservative"
      ? 5.5
      : risk === "balanced"
        ? 7.5
        : risk === "aggressive"
          ? 10
          : 7.5;
  void mode;
  return base;
}

function horizonMonthsFromLabel(v: unknown) {
  const x = String(v || "").toLowerCase().trim();
  if (x === "short") return 12;
  if (x === "medium") return 36;
  if (x === "long") return 60;
  return null;
}

function horizonLabel(months: number) {
  if (months < 12) return `${Math.max(1, Math.round(months))} months`;
  if (months % 12 === 0) return `${Math.round(months / 12)} years`;
  return `${Math.round(months)} months`;
}

function monthsToTargetLabel(months: number | null) {
  if (months == null) return "Not reached in current horizon assumptions";
  if (months <= 0) return "Already at target";
  return `${horizonLabel(months)} to target`;
}

function withFixContextHref(href: string, args: { mode: Mode; leakKey: string | null; source: "daily" | "advisor" }) {
  const raw = sanitizeProductHref({
    href,
    fallbackHref: `/app?tab=daily&mode=${args.mode}`,
    mode: args.mode,
  });
  try {
    const u = new URL(raw, "http://signalcore.local");
    u.pathname = "/app";
    u.searchParams.set("tab", "daily");
    u.searchParams.set("mode", args.mode);
    u.searchParams.set("review", "1");
    u.searchParams.set("reason", args.leakKey || "general");
    u.searchParams.set("source", args.source);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return `/app?tab=daily&mode=${args.mode}&review=1&reason=${encodeURIComponent(args.leakKey || "general")}&source=${args.source}`;
  }
}

function mapAdvisorStabilityAction(args: {
  advisorAction: string;
  advisorKind: string;
  dailyAction: string;
}) {
  if (args.advisorKind === "fix_leak") return "FIX";
  if (args.advisorKind === "done_today") return "WAIT";
  if (args.advisorKind === "continue_daily") return String(args.dailyAction || "HOLD").toUpperCase();
  return String(args.advisorAction || "HOLD").toUpperCase();
}

const FIRST_ADVISOR_INTRO_SEEN_KEY = "sc_first_advisor_intro_seen_v1";

function normalizeStorageUserId(userId: string | null | undefined) {
  const clean = String(userId || "").trim();
  return clean || "anon";
}

function writeFirstAdvisorIntroSeen(mode: Mode, seen: boolean, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FIRST_ADVISOR_INTRO_SEEN_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, boolean>;
    const key = `${normalizeStorageUserId(userId)}:${mode}`;
    const next: Record<string, boolean> = { ...(parsed || {}), [key]: Boolean(seen) };
    window.localStorage.setItem(FIRST_ADVISOR_INTRO_SEEN_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export default function AdvisorTab({
  mode,
  experienceLevel,
}: {
  mode?: string;
  experienceLevel?: ExperienceLevel | string;
}) {
  const autopilotMode = normalizeMode(mode);
  const level = normalizeExperienceLevel(experienceLevel);
  const isBeginnerUX = level === "beginner";
  const isProUX = level === "pro";
  const { lang } = useSiteLanguage();
  const { user, isSignedIn } = useUser();
  const storageUserId = useMemo(() => {
    if (!isSignedIn) return null;
    const id = String(user?.id || "").trim();
    return id || null;
  }, [isSignedIn, user?.id]);

  const [bundle, setBundle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFirstAdvisorIntro, setShowFirstAdvisorIntro] = useState(false);
  const [showStrategyIntelligence, setShowStrategyIntelligence] = useState(false);
  const [showAdvancedStrategy, setShowAdvancedStrategy] = useState(false);

  async function load(initial = false) {
    try {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const r = await fetchJSON(`/api/investing/dashboard?mode=${autopilotMode}&_=${Date.now()}`, { method: "GET" });
      if (!r.ok) {
        setError(r.data?.error || `Failed (${r.status})`);
        return;
      }
      setBundle(r.data);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(true);
    track("advisor_view", { mode: autopilotMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotMode]);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setError("Could not update the analysis within 10 seconds. No new recommendation was generated.");
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [loading]);

  useEffect(() => {
    if (loading || Boolean(error)) return;
    setShowFirstAdvisorIntro(false);
  }, [loading, error, autopilotMode, storageUserId]);

  const plan = useMemo(() => bundle?.plan ?? null, [bundle]);
  const daily = useMemo<Record<string, any>>(() => {
    const next = bundle?.daily;
    return next && typeof next === "object" ? next : {};
  }, [bundle]);
  const derived = useMemo<Record<string, any>>(() => {
    const next = bundle?.derived;
    return next && typeof next === "object" ? next : {};
  }, [bundle]);
  const diagnostics = derived?.diagnostics ?? null;
  const dailyScoresNode =
    daily?.scores && typeof daily.scores === "object" ? (daily.scores as Record<string, any>) : ({} as Record<string, any>);
  const dailyReplayAudit =
    daily?.replayAudit && typeof daily.replayAudit === "object" ? (daily.replayAudit as Record<string, any>) : ({} as Record<string, any>);
  const dailyScoreAudit =
    daily?.scoreAudit && typeof daily.scoreAudit === "object" ? (daily.scoreAudit as Record<string, any>) : ({} as Record<string, any>);
  const dailyExecutionEvidence =
    daily?.executionEvidence && typeof daily.executionEvidence === "object"
      ? (daily.executionEvidence as Record<string, any>)
      : ({} as Record<string, any>);
  const dailyAuditTrail =
    daily?.auditTrail && typeof daily.auditTrail === "object" ? (daily.auditTrail as Record<string, any>) : ({} as Record<string, any>);
  const dailyCapitalStatus =
    daily?.capitalStatus && typeof daily.capitalStatus === "object" ? (daily.capitalStatus as Record<string, any>) : ({} as Record<string, any>);
  const dailyCapitalProtectionSummary =
    daily?.capitalProtectionSummary && typeof daily.capitalProtectionSummary === "object"
      ? (daily.capitalProtectionSummary as Record<string, any>)
      : (derived?.capitalProtectionSummary && typeof derived.capitalProtectionSummary === "object"
        ? (derived.capitalProtectionSummary as Record<string, any>)
        : ({} as Record<string, any>));
  const dailyPortfolioScore =
    daily?.portfolioScore && typeof daily.portfolioScore === "object" ? (daily.portfolioScore as Record<string, any>) : ({} as Record<string, any>);
  const dailyTrendsNode =
    daily?.trends && typeof daily.trends === "object" ? (daily.trends as Record<string, any>) : ({} as Record<string, any>);
  const dailyContinuitySignals =
    daily?.continuitySignals && typeof daily.continuitySignals === "object"
      ? (daily.continuitySignals as Record<string, any>)
      : ({} as Record<string, any>);
  const dailyPlanTrack =
    daily?.planTrack && typeof daily.planTrack === "object" ? (daily.planTrack as Record<string, any>) : ({} as Record<string, any>);
  const dailyWhyNow =
    daily?.whyNow && typeof daily.whyNow === "object"
      ? (daily.whyNow as Record<string, any>)
      : (bundle?.whyNow && typeof bundle.whyNow === "object"
        ? (bundle.whyNow as Record<string, any>)
        : ({} as Record<string, any>));
  const dailyExecutionCoach =
    daily?.executionCoach && typeof daily.executionCoach === "object"
      ? (daily.executionCoach as Record<string, any>)
      : (derived?.executionCoach && typeof derived.executionCoach === "object"
        ? (derived.executionCoach as Record<string, any>)
        : ({} as Record<string, any>));
  const dailyProfileBenchmark =
    daily?.profileBenchmark && typeof daily.profileBenchmark === "object"
      ? (daily.profileBenchmark as Record<string, any>)
      : (derived?.profileBenchmark && typeof derived.profileBenchmark === "object"
        ? (derived.profileBenchmark as Record<string, any>)
        : ({} as Record<string, any>));
  const dailyEngineV5 =
    daily?.engineV5 && typeof daily.engineV5 === "object" ? (daily.engineV5 as Record<string, any>) : ({} as Record<string, any>);
  const dailySyntrakeStack =
    daily?.syntrakeStack && typeof daily.syntrakeStack === "object"
      ? (daily.syntrakeStack as Record<string, any>)
      : (bundle?.syntrakeStack && typeof bundle.syntrakeStack === "object"
        ? (bundle.syntrakeStack as Record<string, any>)
        : ({} as Record<string, any>));
  const dailyAntiChurn =
    daily?.antiChurn && typeof daily.antiChurn === "object"
      ? (daily.antiChurn as Record<string, any>)
      : (derived?.antiChurn && typeof derived.antiChurn === "object"
        ? (derived.antiChurn as Record<string, any>)
        : ({} as Record<string, any>));
  const dailyWeeklyPremiumReport =
    daily?.weeklyPremiumReport && typeof daily.weeklyPremiumReport === "object"
      ? (daily.weeklyPremiumReport as Record<string, any>)
      : (derived?.weeklyPremiumReport && typeof derived.weeklyPremiumReport === "object"
        ? (derived.weeklyPremiumReport as Record<string, any>)
        : ({} as Record<string, any>));

  const hasPlan = typeof derived?.hasPlan === "boolean" ? Boolean(derived.hasPlan) : !!plan?.id || !!plan?.is_active || !!plan?.active;
  const holdingsCount = Array.isArray(bundle?.portfolio?.items) ? bundle.portfolio.items.length : 0;
  const hasHoldings = typeof derived?.hasHoldings === "boolean" ? Boolean(derived.hasHoldings) : holdingsCount > 0;

  const autopilot = derived?.autopilot ?? null; // {total,safety,growth,reasonsShort}
  const pressureV2 = derived?.pressureV2 ?? null; // {score,drivers[]}

  const autopilotScore = typeof autopilot?.total === "number" ? autopilot.total : typeof derived?.autopilotScore === "number" ? derived.autopilotScore : 0;
  const safetyScore = typeof autopilot?.safety === "number" ? autopilot.safety : null;
  const growthScore = typeof autopilot?.growth === "number" ? autopilot.growth : null;

  const pressureScore = typeof pressureV2?.score === "number" ? pressureV2.score : null;

  const riskLeaks = Array.isArray(diagnostics?.riskLeaks) ? diagnostics.riskLeaks : [];
  const topLeak = riskLeaks[0] ?? null;
  const topLeakKey = topLeak?.key ? String(topLeak.key) : null;
  const openLeakCount = riskLeaks.filter((x: any) => {
    const sev = String(x?.severity || "").toLowerCase().trim();
    return sev === "high" || sev === "med" || sev === "medium";
  }).length;
  const moneyConfirmed =
    derived?.moneyConfirmed && typeof derived.moneyConfirmed === "object"
      ? (derived.moneyConfirmed as { today?: number; week?: number; total?: number })
      : ({ today: 0, week: 0, total: 0 } as { today?: number; week?: number; total?: number });
  const weeklyConfirmedEur = Number(moneyConfirmed?.week || 0);
  const streak = typeof derived?.streak === "number" ? Math.max(0, Math.round(derived.streak)) : 0;
  const advisorExecutionScore = (() => {
    const raw = (bundle as any)?.derived?.executionScore;
    if (!raw || typeof raw !== "object") return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(Number((raw as any).score || 0)))),
      tone: String((raw as any).tone || "warn").toLowerCase().trim(),
      disciplinePct: Math.max(0, Math.min(100, Math.round(Number((raw as any).disciplinePct || 0)))),
      validationPct: Math.max(0, Math.min(100, Math.round(Number((raw as any).validationPct || 0)))),
      checklistPct: Math.max(0, Math.min(100, Math.round(Number((raw as any).checklistPct || 0)))),
    };
  })();
  const advisorAntiChurnInterventions = Array.isArray((dailyAntiChurn as any)?.interventions)
    ? ((dailyAntiChurn as any).interventions as any[]).slice(0, 3)
    : [];

  function leakFixHref(leak: any) {
    const key = leak?.key ? String(leak.key) : null;
    const fallback =
      key === "no_plan"
        ? `/app?tab=planning&mode=${autopilotMode}`
        : key === "cash_drag_high" || key === "cash_drag_med"
          ? `/app?tab=planning&mode=${autopilotMode}`
          : key === "pricing_stale_high" || key === "pricing_stale_med"
            ? `/app?tab=daily&mode=${autopilotMode}`
            : `/app?tab=portfolio&mode=${autopilotMode}`;
    const raw = leak?.fix?.href ? String(leak.fix.href) : fallback;
    return withFixContextHref(raw, { mode: autopilotMode, leakKey: key, source: "advisor" });
  }

  const topLeakFixHref = topLeak ? leakFixHref(topLeak) : null;

  const lastSnapshotAt = daily?.lastSnapshotAt ?? null;
  const doneToday = !!derived?.doneToday;
  const nextReviewAt =
    daily?.nextBestActionPreview?.nextEvaluationAt ||
    daily?.activation?.decisionPreviewState?.nextEvaluationAt ||
    daily?.decisionPreviewState?.nextEvaluationAt ||
    null;
  const investingLoopSummary = useMemo(
    () =>
      buildInvestingOperatingLoopSummary({
        hasPlan,
        hasHoldings,
        doneToday,
        receiptsCount: Number(derived?.receiptsCount || 0),
        streak,
        weeklyConfirmedEur,
        nextReviewAt,
      }),
    [derived?.receiptsCount, doneToday, hasHoldings, hasPlan, nextReviewAt, streak, weeklyConfirmedEur],
  );
  const actionGateStatus = String(((daily?.actionGate ?? derived?.actionGate) as any)?.status || "").toLowerCase().trim() || "unknown";
  const coveragePct = Math.max(0, Math.round(Number(derived?.pricing?.coveragePct ?? diagnostics?.pricing?.coveragePct ?? 0)));
  const advisorDataState = !hasHoldings ? "empty" : coveragePct < 80 ? "partial" : "fresh";
  const planGoalLabel =
    String((plan as any)?.goal || (plan as any)?.goalType || (plan as any)?.goal_type || (plan as any)?.objective || "").trim() ||
    String((dailyPlanTrack as any)?.phase?.goal || "").trim() ||
    "Not defined";
  const strategyPlanAlignmentRaw =
    String((dailyCapitalStatus as any)?.planAlignment || "").trim().toUpperCase() ||
    (Number((dailyScoresNode as any)?.planCoherence || 0) >= 70 ? "HIGH" : Number((dailyScoresNode as any)?.planCoherence || 0) >= 45 ? "MEDIUM" : "LOW");
  const strategyPostureRaw = String((dailyCapitalStatus as any)?.posture || "").trim().toUpperCase() || "SURVIVAL";
  const strategyRiskPressure = Number((dailyScoresNode as any)?.riskPressure ?? (dailyCapitalStatus as any)?.riskPressure ?? pressureScore ?? NaN);
  const strategyPortfolioScore = Number((dailyPortfolioScore as any)?.autopilotScore ?? (dailyScoresNode as any)?.autopilotScore ?? autopilotScore ?? 0);
  const strategyStatusSentence =
    strategyPlanAlignmentRaw === "HIGH" && (strategyPostureRaw === "STABLE" || strategyPostureRaw === "GROWTH")
      ? "Your strategy remains aligned with long-term capital growth."
      : "Risk posture requires optimization to improve trajectory.";
  const valueProofDeltaLine = (() => {
    const trendsNode = ((bundle as any)?.daily?.trends && typeof (bundle as any)?.daily?.trends === "object"
      ? ((bundle as any).daily.trends as Record<string, any>)
      : {}) as Record<string, any>;
    const autopilotTrend = (trendsNode as any)?.autopilotScore;
    const riskTrend = (trendsNode as any)?.riskPressure;
    const apDelta = Number((autopilotTrend as any)?.delta1);
    const apDir = String((autopilotTrend as any)?.direction || "").toUpperCase();
    if (Number.isFinite(apDelta) && apDelta !== 0) {
      if (apDir === "UP") return "Autopilot Score improved versus the previous evaluation.";
      if (apDir === "DOWN") return "Autopilot Score weakened versus the previous evaluation.";
    }
    const riskDelta = Number((riskTrend as any)?.delta1);
    const riskDir = String((riskTrend as any)?.semanticDirection || "").toUpperCase();
    if (Number.isFinite(riskDelta) && riskDelta !== 0) {
      if (riskDir === "IMPROVING" || riskDelta < 0) return "Risk pressure decreased versus the previous evaluation.";
      if (riskDir === "WORSENING" || riskDelta > 0) return "Risk pressure increased versus the previous evaluation.";
    }
    return null;
  })();
  const advisorProofStats = useMemo(
    () => [
      {
	        label: pickByLang(lang, {
	          en: "Strategy score",
	          pt: "Score estrategico",
	          es: "Score estrategico",
	          fr: "Score strategique",
	          de: "Strategie-Score",
	          it: "Score strategico",
	        }),
        value: `${Math.round(strategyPortfolioScore || 0)}/100`,
	        detail: pickByLang(lang, {
	          en: "Advisor tracks whether the current capital path is aligned or drifting.",
	          pt: "O Advisor acompanha se o caminho atual do capital esta alinhado ou a desviar.",
	          es: "Advisor sigue si el camino actual del capital esta alineado o desviandose.",
	          fr: "Advisor suit si le parcours actuel du capital est aligne ou en derive.",
	          de: "Advisor verfolgt, ob der aktuelle Kapitalpfad ausgerichtet ist oder abdriftet.",
	          it: "Advisor controlla se il percorso attuale del capitale e allineato o in deriva.",
	        }),
      },
      {
	        label: pickByLang(lang, {
	          en: "Open leaks",
	          pt: "Leaks abertos",
	          es: "Leaks abiertos",
	          fr: "Leaks ouverts",
	          de: "Offene Leaks",
	          it: "Leak aperti",
	        }),
        value: String(openLeakCount),
	        detail: pickByLang(lang, {
	          en: "Leaks are the fastest way to destroy confidence and slow compounding.",
	          pt: "Leaks sao a forma mais rapida de destruir confianca e abrandar o compounding.",
	          es: "Los leaks son la forma mas rapida de destruir confianza y frenar el compounding.",
	          fr: "Les leaks sont le moyen le plus rapide de detruire la confiance et de ralentir le compounding.",
	          de: "Leaks sind der schnellste Weg, Vertrauen zu zerstoeren und Compounding zu bremsen.",
	          it: "I leak sono il modo piu rapido per distruggere fiducia e rallentare il compounding.",
	        }),
      },
      {
	        label: pickByLang(lang, {
	          en: "Weekly confirmed",
	          pt: "Confirmado na semana",
	          es: "Confirmado en la semana",
	          fr: "Confirme cette semaine",
	          de: "Diese Woche bestaetigt",
	          it: "Confermato nella settimana",
	        }),
        value: weeklyConfirmedEur > 0 ? fmtEUR(weeklyConfirmedEur) : "0 EUR",
	        detail: pickByLang(lang, {
	          en: "Advisor becomes more credible when strategy improvements show up in receipts and execution quality.",
	          pt: "O Advisor torna-se mais credivel quando as melhorias estrategicas aparecem nos recibos e na qualidade de execucao.",
	          es: "Advisor gana credibilidad cuando las mejoras estrategicas aparecen en recibos y calidad de ejecucion.",
	          fr: "Advisor devient plus credible lorsque les ameliorations strategiques apparaissent dans les recus et la qualite d execution.",
	          de: "Advisor wird glaubwuerdiger, wenn strategische Verbesserungen in Belegen und Ausfuehrungsqualitaet sichtbar werden.",
	          it: "Advisor diventa piu credibile quando i miglioramenti strategici appaiono nelle ricevute e nella qualita di esecuzione.",
	        }),
      },
      {
	        label: pickByLang(lang, {
	          en: "Next review",
	          pt: "Proxima revisao",
	          es: "Proxima revision",
	          fr: "Prochaine revue",
	          de: "Naechste Ueberpruefung",
	          it: "Prossima revisione",
	        }),
        value: nextReviewAt ? fmtTime(nextReviewAt) : "Open now",
	        detail: pickByLang(lang, {
	          en: "The strategy layer keeps pressure, leaks, and plan changes visible between daily cycles.",
	          pt: "A camada estrategica mantem pressao, leaks e mudancas de plano visiveis entre ciclos diarios.",
	          es: "La capa estrategica mantiene presion, leaks y cambios de plan visibles entre ciclos diarios.",
	          fr: "La couche strategique garde pression, leaks et changements de plan visibles entre les cycles quotidiens.",
	          de: "Die Strategieebene haelt Druck, Leaks und Planaenderungen zwischen Tageszyklen sichtbar.",
	          it: "Il livello strategico mantiene visibili pressione, leak e modifiche al piano tra i cicli daily.",
	        }),
      },
    ],
    [lang, nextReviewAt, openLeakCount, strategyPortfolioScore, weeklyConfirmedEur],
  );
  const advisorProofCards = useMemo(
    () => [
      {
	        title: pickByLang(lang, {
	          en: "What Advisor proves",
	          pt: "O que o Advisor prova",
	          es: "Lo que prueba Advisor",
	          fr: "Ce que prouve Advisor",
	          de: "Was Advisor beweist",
	          it: "Cosa dimostra Advisor",
	        }),
	        body: pickByLang(lang, {
	          en: "Advisor is the strategic layer that explains why Syntrake wants to press, pause, protect, or fix before the next capital move.",
	          pt: "O Advisor e a camada estrategica que explica porque o Syntrake quer acelerar, pausar, proteger ou corrigir antes do proximo movimento de capital.",
	          es: "Advisor es la capa estrategica que explica por que Syntrake quiere acelerar, pausar, proteger o corregir antes del siguiente movimiento de capital.",
	          fr: "Advisor est la couche strategique qui explique pourquoi Syntrake veut accelerer, pauser, proteger ou corriger avant le prochain mouvement de capital.",
	          de: "Advisor ist die Strategieebene, die erklaert, warum Syntrake vor der naechsten Kapitalbewegung druecken, pausieren, schuetzen oder korrigieren will.",
	          it: "Advisor e il livello strategico che spiega perche Syntrake vuole accelerare, fermarsi, proteggere o correggere prima del prossimo movimento di capitale.",
	        }),
        bullets: [
	          pickByLang(lang, {
	            en: "It translates score, pressure, and leaks into one strategic posture.",
	            pt: "Traduz score, pressao e leaks numa postura estrategica unica.",
	            es: "Traduce score, presion y leaks en una postura estrategica unica.",
	            fr: "Il traduit score, pression et leaks en une posture strategique unique.",
	            de: "Es uebersetzt Score, Druck und Leaks in eine strategische Haltung.",
	            it: "Traduce score, pressione e leak in una postura strategica unica.",
	          }),
          pickByLang(lang, {
            en: "It keeps the user focused on the main blocker instead of random fixes.",
            es: "Mantiene al usuario enfocado en el bloqueo principal en vez de correcciones aleatorias.",
            fr: "Il garde l utilisateur concentre sur le blocage principal plutot que sur des corrections aleatoires.",
            de: "Es haelt den Nutzer auf den Hauptblocker fokussiert statt auf zufaellige Korrekturen.",
            it: "Mantiene l utente concentrato sul blocco principale invece che su correzioni casuali.",
            pt: "Mantem o utilizador focado no bloqueio principal em vez de correçoes aleatorias.",
          }),
          pickByLang(lang, {
            en: "It makes the monthly value feel like better decisions, not more noise.",
            es: "Hace que el valor mensual se sienta como mejores decisiones, no mas ruido.",
            fr: "Cela fait sentir la valeur mensuelle comme de meilleures decisions, pas plus de bruit.",
            de: "Es laesst den monatlichen Wert wie bessere Entscheidungen wirken, nicht wie mehr Laerm.",
            it: "Fa percepire il valore mensile come decisioni migliori, non piu rumore.",
            pt: "Faz o valor mensal parecer melhores decisoes, e nao mais ruido.",
          }),
        ],
      },
      {
        title: pickByLang(lang, {
          en: "Why this improves retention",
          es: "Por que esto mejora la retencion",
          fr: "Pourquoi cela ameliore la retention",
          de: "Warum das die Bindung verbessert",
          it: "Perche migliora la retention",
          pt: "Porque isto melhora retencao",
        }),
        body: pickByLang(lang, {
          en: "Users return when the product keeps telling them what matters now, what improved, and what still blocks the next step.",
          es: "Los usuarios vuelven cuando el producto sigue diciendo que importa ahora, que mejoro y que bloquea el siguiente paso.",
          fr: "Les utilisateurs reviennent quand le produit continue de dire ce qui compte maintenant, ce qui a progresse et ce qui bloque encore l etape suivante.",
          de: "Nutzer kommen zurueck, wenn das Produkt weiter zeigt, was jetzt zaehlt, was besser wurde und was den naechsten Schritt noch blockiert.",
          it: "Gli utenti tornano quando il prodotto continua a dire cosa conta ora, cosa e migliorato e cosa blocca ancora il prossimo passo.",
          pt: "Os utilizadores regressam quando o produto continua a dizer o que importa agora, o que melhorou e o que ainda bloqueia o proximo passo.",
        }),
        bullets: [
          pickByLang(lang, {
            en: "Top leak fix stays visible.",
            es: "La correccion del leak principal sigue visible.",
            fr: "La correction du leak principal reste visible.",
            de: "Die Korrektur des groessten Leaks bleibt sichtbar.",
            it: "La correzione del leak principale resta visibile.",
            pt: "A correcao do top leak fica sempre visivel.",
          }),
          pickByLang(lang, {
            en: "Weekly proof connects strategy to outcomes.",
            es: "La prueba semanal conecta estrategia con resultados.",
            fr: "La preuve hebdomadaire relie strategie et resultats.",
            de: "Der woechentliche Nachweis verbindet Strategie mit Ergebnissen.",
            it: "La prova settimanale collega strategia e risultati.",
            pt: "A prova semanal liga estrategia a resultados.",
          }),
          pickByLang(lang, {
            en: "Review rhythm makes the product feel alive between trades.",
            es: "El ritmo de revision hace que el producto se sienta vivo entre trades.",
            fr: "Le rythme de revue donne vie au produit entre les trades.",
            de: "Der Review-Rhythmus laesst das Produkt zwischen Trades lebendig wirken.",
            it: "Il ritmo di revisione fa sentire il prodotto vivo tra i trade.",
            pt: "O ritmo de revisao faz o produto parecer vivo entre trades.",
          }),
        ],
      },
    ],
    [lang],
  );

  const advisorValueProofCard = (
    <Card
      title="Measured Value Proof"
      subtitle="Why Syntrake is worth a subscription: measurable process quality, not just predictions."
      right={
        <Badge
          tone={
            (advisorExecutionScore?.score ?? Math.round(autopilotScore || 0)) >= 80
              ? "good"
              : (advisorExecutionScore?.score ?? Math.round(autopilotScore || 0)) >= 60
                ? "warn"
                : "bad"
          }
        >
          {(advisorExecutionScore?.score ?? Math.round(autopilotScore || 0))}/100
        </Badge>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          <span className="font-semibold text-zinc-900">What Syntrake is improving right now:</span>{" "}
          {doneToday
            ? "the system completed this cycle and preserved continuity into the next evaluation window."
            : "the system is actively managing risk, execution quality and plan coherence before the next decision."}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Autopilot score</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">
              {Number.isFinite(Number((dailyScoresNode as any)?.autopilotScore))
                ? Math.round(Number((dailyScoresNode as any).autopilotScore))
                : Math.round(Number(autopilotScore || 0))}
              /100
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Execution quality</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">
              {advisorExecutionScore ? `${advisorExecutionScore.score}/100` : Number((dailyExecutionEvidence as any)?.avgQuality14 || 0) > 0 ? `${Math.round(Number((dailyExecutionEvidence as any)?.avgQuality14 || 0))}/100` : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Open risk leaks</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">{openLeakCount}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Weekly tracked movement</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">
              {weeklyConfirmedEur >= 0 ? "+" : "-"}{fmtEUR(Math.abs(weeklyConfirmedEur))}
            </div>
          </div>
        </div>

        {advisorExecutionScore ? (
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
              <div className="font-semibold text-zinc-900">Discipline</div>
              <div className="mt-1">{advisorExecutionScore.disciplinePct}% of daily execution target</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
              <div className="font-semibold text-zinc-900">Validation</div>
              <div className="mt-1">{advisorExecutionScore.validationPct}% proof validation rate</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
              <div className="font-semibold text-zinc-900">Checklist quality</div>
              <div className="mt-1">{advisorExecutionScore.checklistPct}% manual checklist completion quality</div>
            </div>
          </div>
        ) : null}

        <div className="space-y-1 text-xs text-zinc-700">
          {valueProofDeltaLine ? <div>- {valueProofDeltaLine}</div> : null}
          <div>
            - Pricing coverage for evaluation quality: <span className="font-semibold text-zinc-900">{coveragePct}%</span>.
          </div>
          <div>
            - Continuity tracked: <span className="font-semibold text-zinc-900">{Math.max(0, streak)}</span> daily close streak.
          </div>
          {Number((dailyExecutionEvidence as any)?.proofs14 || 0) > 0 ? (
            <div>
              - Execution evidence tracked: <span className="font-semibold text-zinc-900">{Math.round(Number((dailyExecutionEvidence as any).proofs14 || 0))}</span> proofs in 14d.
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {typeof (dailyReplayAudit as any)?.replayReady === "boolean" ? (
            <Chip tone={Boolean((dailyReplayAudit as any).replayReady) ? "good" : "warn"}>
              Replay: {Boolean((dailyReplayAudit as any).replayReady) ? "Ready" : "Pending"}
            </Chip>
          ) : null}
          {typeof (dailyScoreAudit as any)?.deterministic === "boolean" ? (
            <Chip tone={Boolean((dailyScoreAudit as any).deterministic) ? "good" : "warn"}>
              Audit: {Boolean((dailyScoreAudit as any).deterministic) ? "Deterministic" : "Review"}
            </Chip>
          ) : null}
          {typeof pressureScore === "number" ? (
            <Chip tone={pressureScore >= 70 ? "bad" : pressureScore >= 40 ? "warn" : "good"}>Risk pressure: {Math.round(pressureScore)}</Chip>
          ) : null}
          <Chip tone={doneToday ? "good" : "warn"}>{doneToday ? "Cycle closed" : "Cycle open"}</Chip>
        </div>
      </div>
    </Card>
  );
  const advisorRetentionWeeklyCard = (
    <Card
      title="Retention and Weekly Report"
      subtitle="Anti-churn intervention plus weekly premium strategy summary."
      right={
        <Badge
          tone={
            String((dailyAntiChurn as any)?.riskLevel || "").toLowerCase() === "high"
              ? "bad"
              : String((dailyAntiChurn as any)?.riskLevel || "").toLowerCase() === "medium"
                ? "warn"
                : "good"
          }
        >
          {(String((dailyAntiChurn as any)?.riskLevel || "low") || "low").toUpperCase()}
        </Badge>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          {String((dailyAntiChurn as any)?.message || "Retention monitoring is active and stable.")}
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Retention score</div>
            <div className="mt-1">{Math.max(0, Math.min(100, Math.round(Number((dailyAntiChurn as any)?.score || 0))))}/100</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Weekly window</div>
            <div className="mt-1">{String((dailyWeeklyPremiumReport as any)?.periodLabel || "Current weekly cycle")}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Generated</div>
            <div className="mt-1">{fmtTime(String((dailyWeeklyPremiumReport as any)?.generatedAt || "") || null)}</div>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
          <div className="font-semibold text-zinc-900">Weekly summary</div>
          <div className="mt-1">{String((dailyWeeklyPremiumReport as any)?.summary || "Weekly summary will populate as new cycle data arrives.")}</div>
        </div>
        {advisorAntiChurnInterventions.length > 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Interventions</div>
            <div className="mt-1 space-y-1">
              {advisorAntiChurnInterventions.map((item: any, idx: number) => (
                <div key={`advisor-anti-churn-${idx}`}>- {String(item?.title || "Intervention")} - {String(item?.detail || "")}</div>
              ))}
            </div>
          </div>
        ) : null}
        {Array.isArray((dailyWeeklyPremiumReport as any)?.focusNextWeek) && (dailyWeeklyPremiumReport as any).focusNextWeek.length > 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">Focus next week</div>
            <div className="mt-1 space-y-1">
              {((dailyWeeklyPremiumReport as any).focusNextWeek as any[]).slice(0, 3).map((line: any, idx: number) => (
                <div key={`advisor-week-focus-${idx}`}>- {String(line || "")}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
  const capitalStrategyCard = (
    <Card
      title="Your Capital Strategy"
      subtitle="Long-term positioning, safety posture, and alignment quality."
      right={<Badge tone={strategyPlanAlignmentRaw === "HIGH" ? "good" : strategyPlanAlignmentRaw === "MEDIUM" ? "warn" : "bad"}>{strategyPlanAlignmentRaw}</Badge>}
    >
      <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Investment goal</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">{planGoalLabel}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Plan alignment</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">{strategyPlanAlignmentRaw}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Capital posture</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">{strategyPostureRaw}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Portfolio score</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">{Math.max(0, Math.min(100, Math.round(strategyPortfolioScore)))}/100</div>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">{strategyStatusSentence}</div>
      </div>
    </Card>
  );
  const possibleCapitalPathsCard = (() => {
    const trendChips = Array.isArray((dailyContinuitySignals as any)?.trendChips) ? ((dailyContinuitySignals as any).trendChips as any[]) : [];
    const trendText = trendChips.map((x: any) => String(x || "").toLowerCase()).join(" | ");
    const improvingTrend = trendText.includes("improv") || trendText.includes("up") || trendText.includes("forming");
    const defensiveActive = (Number.isFinite(strategyRiskPressure) && strategyRiskPressure >= 65) || strategyPostureRaw === "CAUTION" || strategyPostureRaw === "SURVIVAL";
    const acceleratedActive = strategyPlanAlignmentRaw === "HIGH" || improvingTrend;

    const paths = [
      {
        id: "defensive",
        title: "Defensive Path",
        direction: defensiveActive ? "Protection-first trajectory" : "Activated when pressure rises",
        risk: "Lower growth speed, stronger drawdown protection",
        desc: "Capital stays resilient while pressure normalizes and leaks are reduced.",
        tone: defensiveActive ? "warn" : "neutral",
      },
      {
        id: "base",
        title: "Base Path",
        direction: "Stable progression with current structure",
        risk: "Balanced risk exposure",
        desc: "Current alignment and daily consistency sustain gradual capital progression.",
        tone: "good",
      },
      {
        id: "accelerated",
        title: "Accelerated Path",
        direction: acceleratedActive ? "Higher-quality growth setup forming" : "Requires stronger consistency first",
        risk: "Higher execution discipline required",
        desc: "Accelerated growth becomes possible as execution consistency improves.",
        tone: acceleratedActive ? "good" : "warn",
      },
    ] as const;

    return (
      <Card title="Possible Capital Paths" subtitle="Direction scenarios from current strategy state (no return promises)." right={<Badge tone="neutral">Trajectory</Badge>}>
        <div className="grid gap-2 md:grid-cols-3">
          {paths.map((p) => (
            <div key={p.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900">{p.title}</div>
                <Badge tone={p.tone}>{p.tone === "good" ? "Active" : p.tone === "warn" ? "Watch" : "Standby"}</Badge>
              </div>
              <div className="mt-2 text-xs text-zinc-700">
                <span className="font-semibold text-zinc-900">Expected direction:</span> {p.direction}
              </div>
              <div className="mt-1 text-xs text-zinc-700">
                <span className="font-semibold text-zinc-900">Risk level:</span> {p.risk}
              </div>
              <div className="mt-2 text-xs text-zinc-600">{p.desc}</div>
            </div>
          ))}
        </div>
      </Card>
    );
  })();
  const growthLimitersCard = (() => {
    const patterns = Array.isArray((dailyExecutionCoach as any)?.topPatterns) ? ((dailyExecutionCoach as any).topPatterns as any[]) : [];
    const limiters: Array<{ key: string; title: string; impact: string; hint: string }> = [];

    if (topLeak) {
      limiters.push({
        key: "top_leak",
        title: String(topLeak.title || topLeak.key || "Top risk leak"),
        impact: String(topLeak.detail || "Current portfolio structure reduces growth reliability."),
        hint: String(topLeak?.fix?.label || "Resolve this leak before scaling risk."),
      });
    }
    for (const p of patterns.slice(0, 2)) {
      limiters.push({
        key: String(p.key || p.title || `pattern_${limiters.length}`),
        title: String(p.title || p.key || "Execution inconsistency"),
        impact: `Impact on ${String(p.impact || "discipline")}: recurring behavior is slowing strategy quality.`,
        hint: String(p.nextStep || "Stabilize this execution pattern before increasing speed."),
      });
    }
    if (limiters.length < 3 && coveragePct < 80) {
      limiters.push({
        key: "pricing_coverage",
        title: "Pricing coverage quality",
        impact: `Coverage is ${coveragePct}%, which can weaken valuation confidence and sizing quality.`,
        hint: "Improve holdings/pricing coverage before increasing risk.",
      });
    }

    return (
      <Card title="What limits faster growth?" subtitle="Top structural blockers and how Syntrake removes them." right={<Badge tone={limiters.length > 0 ? "warn" : "good"}>{limiters.length > 0 ? `${limiters.length} limiters` : "Clear"}</Badge>}>
        <div className="space-y-2">
          {limiters.slice(0, 3).map((x) => (
            <div key={x.key} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
              <div className="font-semibold text-zinc-900">{x.title}</div>
              <div className="mt-1"><span className="font-semibold text-zinc-900">Impact:</span> {x.impact}</div>
              <div className="mt-1"><span className="font-semibold text-zinc-900">Improvement:</span> {x.hint}</div>
            </div>
          ))}
          {limiters.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">No major structural limiter detected in this cycle.</div> : null}
        </div>
      </Card>
    );
  })();
  const investorEvolutionCard = (() => {
    const benchmarkComponents =
      (dailyProfileBenchmark as any)?.components && typeof (dailyProfileBenchmark as any).components === "object"
        ? ((dailyProfileBenchmark as any).components as Record<string, any>)
        : ({} as Record<string, any>);
    const riskControl = Number(benchmarkComponents.risk ?? (Number.isFinite(strategyRiskPressure) ? Math.max(0, 100 - strategyRiskPressure) : 0));
    const executionDiscipline = Number(benchmarkComponents.execution ?? advisorExecutionScore?.disciplinePct ?? 0);
    const consistency = Number(benchmarkComponents.consistency ?? Math.min(100, Math.max(0, streak * 12 + (doneToday ? 10 : 0))));
    const decisionQuality = Number((dailyScoresNode as any)?.decisionConfidence ?? (dailyProfileBenchmark as any)?.score ?? strategyPortfolioScore);

    const qualityTrend = String((dailyTrendsNode as any)?.decisionConfidence?.direction || (dailyTrendsNode as any)?.autopilotScore?.direction || "").toUpperCase();
    const riskTrend = String((dailyTrendsNode as any)?.riskPressure?.semanticDirection || "").toUpperCase();
    const continuityState = String((dailyContinuitySignals as any)?.directionalState || "").toUpperCase();

    const trendLabel = (kind: "risk" | "quality" | "consistency") => {
      if (kind === "risk") return riskTrend === "IMPROVING" ? "Improving" : riskTrend === "WORSENING" ? "Watch" : "Stable";
      if (kind === "quality") return qualityTrend === "UP" ? "Improving" : qualityTrend === "DOWN" ? "Watch" : "Stable";
      return continuityState === "IMPROVING" ? "Improving" : continuityState === "WORSENING" ? "Watch" : "Stable";
    };

    const dims = [
      { id: "risk", label: "Risk Control", value: Math.round(Math.max(0, Math.min(100, riskControl))), trend: trendLabel("risk") },
      { id: "execution", label: "Execution Discipline", value: Math.round(Math.max(0, Math.min(100, executionDiscipline))), trend: trendLabel("quality") },
      { id: "consistency", label: "Consistency", value: Math.round(Math.max(0, Math.min(100, consistency))), trend: trendLabel("consistency") },
      { id: "decision", label: "Decision Quality", value: Math.round(Math.max(0, Math.min(100, decisionQuality))), trend: trendLabel("quality") },
    ] as const;

    return (
      <Card title="Your Investor Evolution" subtitle="How your strategy behavior is improving over time." right={<Badge tone="neutral">{String((dailyProfileBenchmark as any)?.tier || "progress").toUpperCase()}</Badge>}>
        <div className="grid gap-2 md:grid-cols-2">
          {dims.map((d) => (
            <div key={d.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-zinc-900">{d.label}</div>
                <Badge tone={d.trend === "Improving" ? "good" : d.trend === "Watch" ? "warn" : "neutral"}>{d.trend}</Badge>
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">{d.value}/100</div>
            </div>
          ))}
        </div>
      </Card>
    );
  })();
  const capitalProtectionCard = (
    <Card title="Capital Protection" subtitle="Risk and survival controls behind long-term capital durability." right={<Badge tone={Number.isFinite(strategyRiskPressure) && strategyRiskPressure >= 65 ? "warn" : "good"}>{strategyPostureRaw}</Badge>}>
      {String((dailyCapitalProtectionSummary as any)?.summary || "").trim() ? (
        <div className="mb-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          {String((dailyCapitalProtectionSummary as any).summary)}
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Risk pressure</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{Number.isFinite(strategyRiskPressure) ? `${Math.round(strategyRiskPressure)}/100` : "-"}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Posture</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{strategyPostureRaw}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Plan coherence</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">
            {Number.isFinite(Number((dailyScoresNode as any)?.planCoherence)) ? `${Math.round(Number((dailyScoresNode as any).planCoherence))}/100` : "-"}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Alignment</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{strategyPlanAlignmentRaw}</div>
        </div>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Gate</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{String((dailyCapitalProtectionSummary as any)?.gateStatus || "-").toUpperCase()}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Kill-switch</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{String((dailyCapitalProtectionSummary as any)?.killSwitchState || "Monitoring")}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Envelope class</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{String((dailyCapitalProtectionSummary as any)?.envelopeClass || "-")}</div>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
        Syntrake continuously adjusts exposure to protect long-term capital survival.
      </div>
    </Card>
  );
  const strategicImprovementsCard = (() => {
    const phaseLabel = String((dailyPlanTrack as any)?.phase?.label || "").trim() || "Current strategic phase";
    const phaseGoal = String((dailyPlanTrack as any)?.phase?.goal || "").trim() || null;
    const phaseFocus = String((dailyPlanTrack as any)?.microStep || "").trim() || null;
    const coachNextStep =
      String((dailyExecutionCoach as any)?.nextStep || (dailyExecutionCoach as any)?.todayRule || "").trim() || null;
    const expectedOutcome = String((dailyWhyNow as any)?.expectedOutcome || "").trim() || null;

    const recs = [
      phaseGoal ? `Reduce structural drift in phase "${phaseLabel.toLowerCase()}".` : null,
      phaseFocus ? `Current strategic focus: ${phaseFocus}` : null,
      coachNextStep ? `Execution discipline improvement: ${coachNextStep}` : null,
      expectedOutcome ? `Expected structural outcome: ${expectedOutcome}` : null,
    ].filter(Boolean) as string[];

    return (
      <Card title="Strategic Improvements" subtitle="Structural upgrades to increase long-term outcome quality." right={<Badge tone="neutral">Advisor</Badge>}>
        <div className="space-y-2">
          {recs.slice(0, 4).map((r, idx) => (
            <div key={`rec-${idx}`} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
              {r}
            </div>
          ))}
          {recs.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
              No strategic blocker detected. Keep consistency high and preserve current posture.
            </div>
          ) : null}
        </div>
      </Card>
    );
  })();
  const strategyIntelligenceCard = !isBeginnerUX ? (() => {
    const reasoningSignals = Array.isArray((dailyEngineV5 as any)?.adaptiveBehavior?.nonTemplateReasoning?.reasoningSignals)
      ? ((dailyEngineV5 as any).adaptiveBehavior.nonTemplateReasoning.reasoningSignals as any[])
      : [];
    const regimeSignal = reasoningSignals
      .map((x: any) => String(x || ""))
      .find((x: string) => x.toLowerCase().includes("regime"));
    const confidence = Number((dailySyntrakeStack as any)?.decisionPipeline?.confidence ?? NaN);
    const aggression =
      Number.isFinite(confidence) && confidence >= 75 ? "High conviction"
        : Number.isFinite(confidence) && confidence >= 50 ? "Balanced conviction"
          : "Conservative conviction";
    const priorityClass =
      String((dailySyntrakeStack as any)?.diagnosticsSummary?.topLeakSeverity || "").trim().toUpperCase() === "HIGH"
        ? "High"
        : String((dailySyntrakeStack as any)?.diagnosticsSummary?.topLeakSeverity || "").trim().toUpperCase() === "MED"
          ? "Medium"
          : "Normal";
    const auditReady =
      Boolean((dailySyntrakeStack as any)?.modules?.audit?.active) ||
      Boolean((dailyEngineV5 as any)?.auditBridge?.auditAvailable) ||
      Boolean(Object.keys(dailyAuditTrail).length > 0);
    const replayReady =
      Boolean((dailyReplayAudit as any)?.replayReady) ||
      Boolean((dailySyntrakeStack as any)?.modules?.audit?.replayAudit);

    return (
      <Card
        title="Strategy Intelligence"
        subtitle="Advanced internal context for confidence and trust."
        right={
          <button
            type="button"
            onClick={() => setShowStrategyIntelligence((v) => !v)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-900"
          >
            {showStrategyIntelligence ? "Hide" : "Show"}
          </button>
        }
      >
        {showStrategyIntelligence ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"><span className="font-semibold text-zinc-900">Aggression:</span> {aggression}</div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"><span className="font-semibold text-zinc-900">Regime:</span> {regimeSignal ? regimeSignal.replace(/^regime\s*/i, "") : "Neutral regime context"}</div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"><span className="font-semibold text-zinc-900">Priority class:</span> {priorityClass}</div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"><span className="font-semibold text-zinc-900">Audit readiness:</span> {auditReady ? "Ready" : "Building evidence"}</div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"><span className="font-semibold text-zinc-900">Replay availability:</span> {replayReady ? "Available" : "Not available yet"}</div>
          </div>
        ) : (
          <div className="text-xs text-zinc-600">Open to inspect advanced strategy confidence signals.</div>
        )}
      </Card>
    );
  })() : null;
  const wealthLeversModel = useMemo(() => {
    const goalQuiz = readGoalQuiz();
    const wealthPlan = readWealthPlan();
    const bundleDaily = (bundle as any)?.daily;
    const bundleDerived = (bundle as any)?.derived;
    const suitability =
      (bundleDaily?.suitability && typeof bundleDaily.suitability === "object" ? bundleDaily.suitability : bundleDerived?.suitability) ?? {};
    const suitabilityProfile = (suitability as any)?.profile ?? {};
    const suitabilityChecks = (suitability as any)?.checks ?? {};

    const portfolioItems = Array.isArray(bundle?.portfolio?.items) ? bundle.portfolio.items : [];
    const portfolioValue = portfolioItems.reduce((acc: number, it: any) => {
      const candidate =
        Number(it?.value_eur) || Number(it?.valueEur) || Number(it?.market_value_eur) || Number(it?.marketValueEur) || 0;
      return acc + (Number.isFinite(candidate) ? candidate : 0);
    }, 0);

    const startingCapitalRaw = readNumber(wealthPlan?.startingCapital) ?? readNumber(goalQuiz?.startingCapital) ?? (portfolioValue > 0 ? Math.round(portfolioValue) : null);
    const monthlyContributionRaw = readNumber(wealthPlan?.monthlyContribution) ?? readNumber(goalQuiz?.monthlyContribution);
    const targetCapitalRaw =
      readNumber(wealthPlan?.targetCapital) ?? readNumber(goalQuiz?.targetCapital) ?? readNumber((suitabilityProfile as any)?.goalTargetValue);
    const horizonMonthsRaw = readNumber(goalQuiz?.horizonMonths) ?? horizonMonthsFromLabel((suitabilityProfile as any)?.horizon);
    const riskProfile = String(goalQuiz?.riskProfile || (suitabilityProfile as any)?.riskProfile || "").trim() || null;
    const annualReturnRaw = readNumber(goalQuiz?.annualReturn) ?? baseAnnualReturnFromProfile(autopilotMode, riskProfile);

    const startingCapital = startingCapitalRaw != null ? Math.max(0, Math.round(startingCapitalRaw)) : null;
    const monthlyContribution = monthlyContributionRaw != null ? Math.max(0, Math.round(monthlyContributionRaw)) : null;
    const targetCapital = targetCapitalRaw != null ? Math.max(0, Math.round(targetCapitalRaw)) : null;
    const horizonMonths = horizonMonthsRaw != null ? Math.max(1, Math.round(horizonMonthsRaw)) : null;
    const annualReturn = annualReturnRaw != null ? Math.max(0, Math.min(30, Number(annualReturnRaw))) : null;

    const missing: string[] = [];
    if (!(startingCapital != null && startingCapital > 0)) missing.push("starting capital");
    if (!(monthlyContribution != null && monthlyContribution >= 0)) missing.push("monthly contribution");
    if (!(targetCapital != null && targetCapital > 0)) missing.push("target capital");
    if (!(horizonMonths != null && horizonMonths > 0)) missing.push("horizon");
    if (!(annualReturn != null && Number.isFinite(annualReturn))) missing.push("return assumption");

    if (missing.length > 0) {
      return {
        ready: false as const,
        missing,
        riskProfile,
        targetRealism: (suitabilityChecks as any)?.targetRealism ? String((suitabilityChecks as any).targetRealism) : null,
      };
    }

    const scenarios = buildScenarios({
      startingCapital,
      monthlyContribution,
      targetCapital,
      horizonMonths,
      baseAnnualReturnPct: annualReturn,
    });
    const baseScenario = scenarios.find((s) => s.label === "Base") ?? scenarios[1] ?? scenarios[0];
    const upsideScenario = scenarios.find((s) => s.label === "Upside") ?? scenarios[2] ?? baseScenario;

    const highRiskAnnualReturn = Math.min(18, annualReturn + 4.5);
    const highRiskScenario =
      buildScenarios({
        startingCapital,
        monthlyContribution,
        targetCapital,
        horizonMonths,
        baseAnnualReturnPct: highRiskAnnualReturn,
      }).find((s) => s.label === "Base") ?? baseScenario;

    const requiredMonthly = requiredMonthlyContribution(startingCapital, annualReturn, horizonMonths, targetCapital);
    const baseGap = Math.max(0, Math.round(targetCapital - (baseScenario?.finalValue ?? 0)));
    const upsideGap = Math.max(0, Math.round(targetCapital - (upsideScenario?.finalValue ?? 0)));
    const highRiskGap = Math.max(0, Math.round(targetCapital - (highRiskScenario?.finalValue ?? 0)));
    const monthlyGap = Math.max(0, requiredMonthly - monthlyContribution);

    return {
      ready: true as const,
      missing: [] as string[],
      startingCapital,
      monthlyContribution,
      targetCapital,
      horizonMonths,
      annualReturn,
      riskProfile,
      targetRealism: (suitabilityChecks as any)?.targetRealism ? String((suitabilityChecks as any).targetRealism) : null,
      requiredMonthly,
      monthlyGap,
      baseScenario,
      upsideScenario,
      highRiskScenario,
      baseGap,
      upsideGap,
      highRiskGap,
      acceleratedDelta: Math.round((upsideScenario?.finalValue ?? 0) - (baseScenario?.finalValue ?? 0)),
      highRiskDelta: Math.round((highRiskScenario?.finalValue ?? 0) - (baseScenario?.finalValue ?? 0)),
    };
  }, [bundle, autopilotMode]);

  const advisorIntroScoreBars = useMemo(() => {
    const safeAuto = Math.max(0, Math.min(100, Math.round(Number(autopilotScore || 0))));
    const safeSafety =
      typeof safetyScore === "number" ? Math.max(0, Math.min(100, Math.round(safetyScore))) : Math.max(35, Math.round(safeAuto - 5));
    const safeGrowth =
      typeof growthScore === "number" ? Math.max(0, Math.min(100, Math.round(growthScore))) : Math.max(30, Math.round(safeAuto - 10));
    const riskFit = Math.round((safeSafety * 0.7 + Math.max(0, 100 - (typeof pressureScore === "number" ? pressureScore : 40)) * 0.3));
    const disciplineTrend = doneToday ? 80 : hasPlan && hasHoldings ? 55 : 30;
    return [
      {
        id: "target_path",
        label: "Target Path Score",
        value: safeAuto,
        why: "Appears first because Advisor needs a top-line view of plan quality before giving strategic guidance.",
        purpose: "Summarizes how strong your current setup is for progressing toward the goal.",
      },
      {
        id: "plan_confidence",
        label: "Plan Confidence",
        value: Math.round((safeSafety + safeGrowth) / 2),
        why: "Appears because Syntrake needs to know if your current plan assumptions are still trustworthy.",
        purpose: "Shows confidence in the current plan structure (risk + growth alignment).",
      },
      {
        id: "risk_fit",
        label: "Risk Fit",
        value: Math.max(0, Math.min(100, riskFit)),
        why: "Appears because the Advisor should reduce mismatch before suggesting growth decisions.",
        purpose: "Shows if current posture matches a safer strategic path for your profile.",
      },
      {
        id: "discipline_trend",
        label: "Discipline Trend",
        value: disciplineTrend,
        why: "Appears because strategy quality depends on whether the Daily loop is actually being completed.",
        purpose: "Shows if execution consistency supports long-term plan changes.",
      },
    ] as const;
  }, [autopilotScore, safetyScore, growthScore, pressureScore, doneToday, hasPlan, hasHoldings]);

  const rawDecisionView = useMemo(() => {
    return buildDailyDecisionView({
      mode: autopilotMode,
      daily,
      derived,
      hasPlan,
      hasHoldings,
      topLeak,
      topLeakSeverity: (topLeak?.severity as "high" | "med" | "low" | undefined) ?? null,
      pressureScore,
      opportunitiesCount: Array.isArray(daily?.opportunities) ? daily.opportunities.length : 0,
    });
  }, [autopilotMode, daily, derived, hasPlan, hasHoldings, topLeak, pressureScore]);
  const decisionView = useDecisionStability(rawDecisionView, {
    action: rawDecisionView.action,
    stateReason: rawDecisionView.stateReason,
    branch: rawDecisionView.branch,
    allowExecution: rawDecisionView.allowExecution,
    hard:
      rawDecisionView.stateReason === "no_plan" ||
      rawDecisionView.stateReason === "no_holdings" ||
      rawDecisionView.stateReason === "starter_warmup" ||
      rawDecisionView.stateReason === "fatal_fallback" ||
      rawDecisionView.stateReason === "low_data_quality",
    mode: autopilotMode,
  }, { sharedKey: `daily-decision:${autopilotMode}` });
  const starterWarmupActive = decisionView.stateReason === "starter_warmup" || Boolean((daily as any)?.starterWarmup?.active);
  const lowDataQualityActive = decisionView.stateReason === "low_data_quality";
  const fallbackActive = decisionView.branch === "fatal_fallback" || decisionView.blockerState === "fallback";
  const decisionCtaOverride = useMemo(() => {
    return buildDailyDecisionCtaOverride({
      mode: autopilotMode,
      decisionView,
      hasPlan,
      hasHoldings,
      topLeakKey,
    });
  }, [autopilotMode, decisionView, hasPlan, hasHoldings, topLeakKey]);
  const advisorFixHref = starterWarmupActive || fallbackActive ? null : decisionCtaOverride?.href ?? topLeakFixHref;
  const rawAdvisorDecision = useMemo(() => {
    return buildAdvisorDecisionView({
      lang,
      mode: autopilotMode,
      decisionView,
      hasPlan,
      hasHoldings,
      starterWarmupActive,
      fallbackActive,
      lowDataQualityActive,
      hasFixPath: Boolean(advisorFixHref),
      doneToday,
    });
  }, [
    advisorFixHref,
    autopilotMode,
    decisionView,
    doneToday,
    fallbackActive,
    hasHoldings,
    hasPlan,
    lang,
    lowDataQualityActive,
    starterWarmupActive,
  ]);
  const advisorDecision = useDecisionStability(rawAdvisorDecision, {
    action: mapAdvisorStabilityAction({
      advisorAction: rawAdvisorDecision.action,
      advisorKind: rawAdvisorDecision.kind,
      dailyAction: decisionView.action,
    }),
    stateReason: decisionView.stateReason,
    branch: decisionView.branch,
    allowExecution: decisionView.allowExecution,
    hard:
      rawAdvisorDecision.kind === "no_plan" ||
      rawAdvisorDecision.kind === "no_holdings" ||
      rawAdvisorDecision.kind === "starter_warmup" ||
      rawAdvisorDecision.kind === "fatal_fallback" ||
      rawAdvisorDecision.kind === "low_data_quality",
    mode: autopilotMode,
  });

  useEffect(() => {
    track("advisor_directive", {
      mode: autopilotMode,
      action: decisionView.action,
      stateReason: decisionView.stateReason,
      stabilitySource: advisorDecision.stabilitySource,
    });
  }, [autopilotMode, decisionView.action, decisionView.stateReason, advisorDecision.stabilitySource]);

  function completeFirstAdvisorIntro() {
    writeFirstAdvisorIntroSeen(autopilotMode, true, storageUserId);
    setShowFirstAdvisorIntro(false);
  }

  function goDaily() {
    window.location.href = `/app?tab=daily&mode=${autopilotMode}`;
  }
  function goPlanning() {
    window.location.href = `/app?tab=planning&mode=${autopilotMode}`;
  }
  function goPortfolio() {
    window.location.href = `/app?tab=portfolio&mode=${autopilotMode}`;
  }
  function goWelcome() {
    window.location.href = `/app?tab=planning&mode=${autopilotMode}&completeProfile=1`;
  }
  function runAdvisorPrimaryAction() {
    track("advisor_primary_action_click", {
      mode: autopilotMode,
      action: advisorDecision.action,
      kind: advisorDecision.kind,
      stateReason: decisionView.stateReason,
      stabilitySource: advisorDecision.stabilitySource,
    });

    if (advisorDecision.action === "planning") {
      goPlanning();
      return;
    }
    if (advisorDecision.action === "portfolio") {
      goPortfolio();
      return;
    }
    if (advisorDecision.action === "fix") {
      if (advisorFixHref) {
        window.location.href = advisorFixHref;
        return;
      }
      goPortfolio();
      return;
    }
    if (advisorDecision.action === "daily") {
      goDaily();
      return;
    }
    load(false);
  }

  const advisorStartHereCard = (
    <div className="overflow-hidden rounded-[24px] border border-[#2b3d60] bg-[radial-gradient(circle_at_top_left,#193054_0%,#111c31_48%,#0b1424_100%)] shadow-[0_28px_80px_rgba(0,0,0,.35)]">
      <div className="border-b border-[#243754] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={advisorDecision.badgeTone}>{advisorDecision.badgeLabel}</Badge>
              <Pill>State: {String(decisionView.stateReason || "unknown").replace(/_/g, " ")}</Pill>
              <Pill>Stability: {advisorDecision.stabilitySource}</Pill>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8ea4c6]">Start here</div>
              <h2 className="mt-2 text-[28px] font-black leading-[1.02] tracking-[-0.05em] text-[#f5f9ff]">
                {advisorDecision.title}
              </h2>
              <p className="mt-3 max-w-[760px] text-[14px] leading-6 text-[#b7c7dd]">{advisorDecision.detail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={runAdvisorPrimaryAction}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[#0f1728] shadow-[0_12px_30px_rgba(255,255,255,.12)] transition hover:bg-[#f3f6fb]"
          >
            {advisorDecision.actionLabel}
          </button>
        </div>
      </div>
      <div className="grid gap-3 px-6 py-5 md:grid-cols-4">
        <div className="rounded-2xl border border-[#243754] bg-[#0f1b2f] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#6f88ad]">Strategic posture</div>
          <div className="mt-2 text-sm font-semibold text-[#eef5ff]">{strategyPostureRaw}</div>
        </div>
        <div className="rounded-2xl border border-[#243754] bg-[#0f1b2f] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#6f88ad]">Plan alignment</div>
          <div className="mt-2 text-sm font-semibold text-[#eef5ff]">{strategyPlanAlignmentRaw}</div>
        </div>
        <div className="rounded-2xl border border-[#243754] bg-[#0f1b2f] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#6f88ad]">Top blocker</div>
          <div className="mt-2 text-sm font-semibold text-[#eef5ff]">
            {topLeak ? String(topLeak.title || topLeak.key || "No major blocker") : "No major blocker"}
          </div>
        </div>
        <div className="rounded-2xl border border-[#243754] bg-[#0f1b2f] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#6f88ad]">Action gate</div>
          <div className="mt-2 text-sm font-semibold text-[#eef5ff]">{actionGateStatus.toUpperCase()}</div>
        </div>
      </div>
    </div>
  );

  const modeEdgeExamples = [
    {
      key: "investing" as const,
      title: "Investing (core wealth)",
      riskLabel: "Core mode",
      riskTone: "good" as const,
      edge: [
        "Fix leak-first allocation issues before adding risk (concentration, stale pricing, drift).",
        "Improve path quality with the same monthly pace via discipline + better portfolio fit.",
        "Adjust horizon/risk assumptions when target realism is off instead of defaulting to 'deposit more'.",
      ],
      monthlyValue: [
        "Advisor recalibrates target path and levers.",
        "Daily converts strategy into one clear decision loop.",
      ],
      example:
        wealthLeversModel.ready
          ? `Current setup shows a base projection of ${fmtEUR(Math.round(wealthLeversModel.baseScenario.finalValue))} and an accelerated path lift of ${fmtEUR(
              Math.max(0, wealthLeversModel.acceleratedDelta)
            )} with the same monthly deposit if leaks and execution improve.`
          : "Syntrake can improve outcome opportunity by cleaning leaks and improving execution quality before asking for more monthly contribution.",
    },
  ];

  const modeEdgeExamplesCard = (
    <Card
      title="How Syntrake creates edge by mode"
      subtitle="Examples of how monthly value comes from better decisions, execution and risk control in each mode (not guaranteed profit)."
      right={<Badge tone="neutral">Current mode: {autopilotMode}</Badge>}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          <span className="font-semibold text-zinc-900">Why this is here:</span> to make the recurring value explicit. Syntrake should not look like a deposit calculator.
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {modeEdgeExamples.map((item) => {
            const isCurrent = item.key === autopilotMode;
            return (
              <div
                key={item.key}
                className={clsx(
                  "rounded-2xl border p-4",
                  isCurrent ? "border-zinc-900 bg-white shadow-sm" : "border-zinc-200 bg-white"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-900">{item.title}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={item.riskTone}>{item.riskLabel}</Badge>
                    {isCurrent ? <Badge tone="good">Live context</Badge> : null}
                  </div>
                </div>

                {isCurrent ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip tone={actionGateStatus === "ready" ? "good" : actionGateStatus === "caution" ? "warn" : "bad"}>
                      Gate: {actionGateStatus.toUpperCase()}
                    </Chip>
                    <Chip tone={doneToday ? "good" : "warn"}>{doneToday ? "Day closed" : "Day open"}</Chip>
                    <Chip tone={coveragePct >= 80 ? "good" : coveragePct >= 50 ? "warn" : "bad"}>Coverage: {coveragePct}%</Chip>
                    {typeof pressureScore === "number" ? (
                      <Chip tone={pressureScore >= 70 ? "bad" : pressureScore >= 40 ? "warn" : "good"}>
                        Pressure: {Math.round(pressureScore)}
                      </Chip>
                    ) : null}
                    {topLeak ? (
                      <Chip tone={topLeak.severity === "high" ? "bad" : topLeak.severity === "med" ? "warn" : "good"}>
                        Top leak: {String(topLeak.title || topLeak.key || "none")}
                      </Chip>
                    ) : (
                      <Chip tone="good">Top leak: none critical</Chip>
                    )}
                  </div>
                ) : null}

                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Where edge comes from</div>
                  <ul className="mt-1 space-y-1 text-xs text-zinc-700 list-disc pl-4">
                    {item.edge.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Why users pay monthly</div>
                  <ul className="mt-1 space-y-1 text-xs text-zinc-700 list-disc pl-4">
                    {item.monthlyValue.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Example outcome edge:</span> {item.example}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={goDaily} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
            Open Daily loop
          </button>
          <button onClick={goPlanning} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">
            Adjust plan assumptions
          </button>
          {advisorFixHref ? (
            <a
              href={advisorFixHref}
              onClick={() => track("advisor_fix_open", { mode: autopilotMode, leakKey: topLeakKey, source: "mode_edge_examples" })}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              Fix top leak
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );

  const gapToTargetCard = (
    <Card
      title="Gap to target + wealth levers"
      subtitle="Syntrake should not depend only on monthly deposits. This block shows the target gap and multiple ways to close it."
      right={
        wealthLeversModel.ready ? (
          <Badge tone={wealthLeversModel.baseGap > 0 ? "warn" : "good"}>
            {wealthLeversModel.baseGap > 0 ? "Gap open" : "On track"}
          </Badge>
        ) : (
          <Badge tone="warn">Needs setup inputs</Badge>
        )
      }
    >
      {!wealthLeversModel.ready ? (
        <div className="space-y-3 text-sm text-zinc-700">
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <span className="font-semibold text-zinc-900">Why this matters:</span> Advisor gets much sharper once your core setup numbers are in place.
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
            <span className="font-semibold text-zinc-900">Add next:</span> {wealthLeversModel.missing.join(", ")}.
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={goWelcome} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
              Finish setup in Planning
            </button>
            <button onClick={goPlanning} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">
              Open Planning now
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Inputs used by Syntrake</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Starting capital</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{fmtEUR(wealthLeversModel.startingCapital)}</div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Monthly contribution</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{fmtEUR(wealthLeversModel.monthlyContribution)}</div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Target</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{fmtEUR(wealthLeversModel.targetCapital)}</div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Horizon</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{horizonLabel(wealthLeversModel.horizonMonths)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip tone="neutral">Risk: {wealthLeversModel.riskProfile || "Unknown"}</Chip>
                <Chip tone="neutral">Base return assumption: ~{wealthLeversModel.annualReturn.toFixed(1)}%/yr</Chip>
                {wealthLeversModel.targetRealism ? (
                  <Chip
                    tone={
                      wealthLeversModel.targetRealism === "unrealistic"
                        ? "bad"
                        : wealthLeversModel.targetRealism === "stretch"
                          ? "warn"
                          : "good"
                    }
                  >
                    Target realism: {wealthLeversModel.targetRealism}
                  </Chip>
                ) : null}
              </div>
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                <span className="font-semibold text-zinc-900">What this is for:</span> show a real wealth trajectory from your setup, then expose levers beyond “deposit more”.
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Base path summary</div>
              <div className="mt-2 text-lg font-semibold text-zinc-900">
                {wealthLeversModel.baseGap > 0 ? `Gap ${fmtEUR(wealthLeversModel.baseGap)} at horizon` : "Target reached in base path"}
              </div>
              <div className="mt-1 text-sm text-zinc-700">
                Base projection: <span className="font-semibold text-zinc-900">{fmtEUR(Math.round(wealthLeversModel.baseScenario.finalValue))}</span> in{" "}
                {horizonLabel(wealthLeversModel.horizonMonths)}.
              </div>
              <div className="mt-1 text-xs text-zinc-600">{monthsToTargetLabel(wealthLeversModel.baseScenario.monthsToTarget)}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">If only using deposit lever</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    {wealthLeversModel.monthlyGap > 0
                      ? `~${fmtEUR(wealthLeversModel.requiredMonthly)} / month`
                      : "Current monthly pace is enough"}
                  </div>
                  {wealthLeversModel.monthlyGap > 0 ? (
                    <div className="mt-1 text-xs text-zinc-600">
                      Extra monthly needed: <span className="font-semibold">{fmtEUR(wealthLeversModel.monthlyGap)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Why this matters</div>
                  <div className="mt-1 text-xs text-zinc-700">
                    Deposit is only one lever. Advisor also works on leaks, execution quality and risk posture to improve the path.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900">Base plan</div>
                <Badge tone={wealthLeversModel.baseGap > 0 ? "warn" : "good"}>Core</Badge>
              </div>
              <div className="mt-2 text-lg font-semibold text-zinc-900">{fmtEUR(Math.round(wealthLeversModel.baseScenario.finalValue))}</div>
              <div className="mt-1 text-xs text-zinc-600">Target gap: {fmtEUR(wealthLeversModel.baseGap)}</div>
              <div className="mt-1 text-xs text-zinc-600">{monthsToTargetLabel(wealthLeversModel.baseScenario.monthsToTarget)}</div>
              <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                Uses your current risk profile and current contribution pace.
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-emerald-950">Accelerated (same deposits)</div>
                <Badge tone="good">Execution + fit</Badge>
              </div>
              <div className="mt-2 text-lg font-semibold text-emerald-950">{fmtEUR(Math.round(wealthLeversModel.upsideScenario.finalValue))}</div>
              <div className="mt-1 text-xs text-emerald-900/80">Target gap: {fmtEUR(wealthLeversModel.upsideGap)}</div>
              <div className="mt-1 text-xs text-emerald-900/80">{monthsToTargetLabel(wealthLeversModel.upsideScenario.monthsToTarget)}</div>
              <div className="mt-2 rounded-xl border border-emerald-200 bg-white/80 px-3 py-2 text-xs text-emerald-900">
                Potential lift vs base: <span className="font-semibold">{fmtEUR(Math.max(0, wealthLeversModel.acceleratedDelta))}</span> with the same monthly deposit if leaks and execution improve.
              </div>
            </div>

            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-rose-950">High risk (optional)</div>
                <Badge tone="bad">Separate module</Badge>
              </div>
              <div className="mt-2 text-lg font-semibold text-rose-950">{fmtEUR(Math.round(wealthLeversModel.highRiskScenario.finalValue))}</div>
              <div className="mt-1 text-xs text-rose-900/80">Target gap: {fmtEUR(wealthLeversModel.highRiskGap)}</div>
              <div className="mt-1 text-xs text-rose-900/80">{monthsToTargetLabel(wealthLeversModel.highRiskScenario.monthsToTarget)}</div>
              <div className="mt-2 rounded-xl border border-rose-200 bg-white/80 px-3 py-2 text-xs text-rose-900">
                Optional accelerator path (higher drawdown risk). Not part of the default investing loop.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-900">Levers Syntrake can use (not just deposits)</div>
              <Chip tone="neutral">Recurring value = decisions + execution + adaptation</Chip>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lever 1</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">Fix leaks before adding risk</div>
                <div className="mt-1 text-xs text-zinc-700">
                  Leak repair improves the quality of the path and prevents fake “growth” that comes from poor allocation or stale data.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lever 2</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">Execution discipline (Daily loop)</div>
                <div className="mt-1 text-xs text-zinc-700">
                  Clean daily execution keeps the plan compounding path stable and reduces unforced errors.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lever 3</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">Plan assumptions (risk / horizon)</div>
                <div className="mt-1 text-xs text-zinc-700">
                  Advisor can rebalance expectations by changing horizon or risk posture instead of blindly asking for more monthly deposit.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lever 4</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">Optional accelerator module</div>
                <div className="mt-1 text-xs text-zinc-700">
                  High-risk tactical execution can be added as a separate module with hard risk limits, not mixed into the core investing loop.
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {advisorFixHref ? (
                <a
                  href={advisorFixHref}
                  onClick={() => track("advisor_fix_open", { mode: autopilotMode, leakKey: topLeakKey, source: "wealth_levers_card" })}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  Fix top leak
                </a>
              ) : null}
              <button onClick={goDaily} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
                Open Daily loop
              </button>
              <button onClick={goPlanning} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">
                Adjust plan assumptions
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <div className="w-full max-w-[1280px] mx-auto px-[26px] py-[26px]">
      {/* Header */}
      <div className="mb-[18px] flex items-end justify-between gap-[18px] max-[980px]:flex-col max-[980px]:items-start">
        <div className="space-y-2">
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#93a4bf]">Advisor Console</div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2 text-[30px] font-black leading-none tracking-[-0.06em] text-[#e7effc]">
              {pickByLang(lang, {
                en: "Advisor",
                pt: "Advisor",
                es: "Asesor",
                fr: "Conseiller",
                de: "Berater",
                it: "Consulente",
              })}
            </h1>
            <Badge tone={hasPlan ? "good" : "warn"}>
              {hasPlan
                ? pickByLang(lang, {
                    en: "Plan active",
                    pt: "Plano ativo",
                    es: "Plan activo",
                    fr: "Plan actif",
                    de: "Plan aktiv",
                    it: "Piano attivo",
                  })
                : pickByLang(lang, {
                    en: "Plan missing",
                    pt: "Plano em falta",
                    es: "Plan ausente",
                    fr: "Plan manquant",
                    de: "Plan fehlt",
                    it: "Piano mancante",
                  })}
            </Badge>
            <Badge tone={hasHoldings ? "good" : "warn"}>
              {hasHoldings
                ? pickByLang(lang, {
                    en: `Holdings: ${holdingsCount}`,
                    pt: `Holdings: ${holdingsCount}`,
                    es: `Holdings: ${holdingsCount}`,
                    fr: `Positions : ${holdingsCount}`,
                    de: `Holdings: ${holdingsCount}`,
                    it: `Posizioni: ${holdingsCount}`,
                  })
                : pickByLang(lang, {
                    en: "Holdings: none",
                    pt: "Holdings: nenhum",
                    es: "Holdings: ninguno",
                    fr: "Positions : aucune",
                    de: "Holdings: keine",
                    it: "Posizioni: nessuna",
                  })}
            </Badge>

            {!isBeginnerUX ? (
              <Pill>
                {pickByLang(lang, {
                  en: "Last receipt",
                  pt: "Ultimo recibo",
                  es: "Ultimo recibo",
                  fr: "Dernier recu",
                  de: "Letzter Beleg",
                  it: "Ultima ricevuta",
                })}
                : {fmtTime(lastSnapshotAt)}
              </Pill>
            ) : null}
          </div>

          <div className="text-sm text-[#95a6c2]">
            {pickByLang(lang, {
              en: "Contextual recommendations linked to evidence, plan rules, alternatives and a clear validity window.",
              pt: "Recomendacoes contextuais ligadas a evidencia, regras do plano, alternativas e um prazo de validade claro.",
              es: "Esta pestana explica por que el autopilot esta actuando, con drivers institucionales.",
              fr: "Cet onglet explique pourquoi l'autopilot agit, avec des facteurs institutionnels.",
              de: "Dieser Tab erklaert, warum der Autopilot handelt, mit institutionellen Treibern.",
              it: "Questa tab spiega perche l'autopilot sta agendo, con driver istituzionali.",
            })}
          </div>
        </div>

        <button
          onClick={() => load(false)}
          disabled={loading || refreshing}
          className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white disabled:opacity-50"
        >
          {refreshing
            ? pickByLang(lang, {
                en: "Refreshing...",
                pt: "A atualizar...",
                es: "Actualizando...",
                fr: "Actualisation...",
                de: "Aktualisieren...",
                it: "Aggiornamento...",
              })
            : pickByLang(lang, {
                en: "Refresh",
                pt: "Atualizar",
                es: "Actualizar",
                fr: "Actualiser",
                de: "Aktualisieren",
                it: "Aggiorna",
              })}
        </button>
      </div>

      {false && !loading ? (
        <div className="mb-5">
          <InvestingOperatingLoopRail
            summary={investingLoopSummary}
            theme="dark"
            rightBadge={<Badge tone={doneToday ? "good" : hasPlan && hasHoldings ? "warn" : "neutral"}>{doneToday ? "Loop closed" : "Strategy open"}</Badge>}
            primaryAction={
              !hasPlan
                ? { label: "Open Planning", onClick: goPlanning }
                : !hasHoldings
                  ? { label: "Open Portfolio", onClick: goPortfolio }
                  : { label: "Open Daily loop", onClick: goDaily }
            }
            secondaryAction={
              topLeakFixHref
                ? { label: "Fix top leak", href: topLeakFixHref }
                : { label: "Refresh Advisor", onClick: () => void load(false) }
            }
          />
        </div>
      ) : null}

      {false && !loading ? (
        <div className="mb-5">
          <ProofRail
            theme="dark"
            eyebrow={pickByLang(lang, {
              en: "Advisor value proof",
              es: "Prueba de valor de Advisor",
              fr: "Preuve de valeur d Advisor",
              de: "Advisor-Wertnachweis",
              it: "Prova di valore di Advisor",
              pt: "Prova de valor do Advisor",
            })}
            title={pickByLang(lang, {
              en: "Advisor keeps the strategic layer valuable between market moves.",
              es: "Advisor mantiene valiosa la capa estrategica entre movimientos de mercado.",
              fr: "Advisor garde la couche strategique utile entre les mouvements de marche.",
              de: "Advisor haelt die Strategieebene zwischen Marktbewegungen wertvoll.",
              it: "Advisor mantiene prezioso il livello strategico tra i movimenti di mercato.",
              pt: "O Advisor mantem a camada estrategica valiosa entre movimentos de mercado.",
            })}
            body={pickByLang(lang, {
              en: "This is where Syntrake turns leaks, pressure, and plan coherence into one posture the user can actually follow.",
              es: "Aqui Syntrake convierte leaks, presion y coherencia del plan en una postura unica que el usuario puede seguir.",
              fr: "C est ici que Syntrake transforme leaks, pression et coherence du plan en une posture unique que l utilisateur peut suivre.",
              de: "Hier macht Syntrake aus Leaks, Druck und Plankoharenz eine Haltung, der der Nutzer wirklich folgen kann.",
              it: "Qui Syntrake trasforma leak, pressione e coerenza del piano in una postura unica che l utente puo seguire.",
              pt: "E aqui que o Syntrake transforma leaks, pressao e coerencia do plano numa postura unica que o utilizador consegue realmente seguir.",
            })}
            stats={advisorProofStats}
            cards={advisorProofCards}
            footnote={pickByLang(lang, {
              en: "Advisor value gets stronger as receipts, holdings, and weekly proof accumulate.",
              es: "El valor de Advisor se fortalece a medida que se acumulan recibos, posiciones y prueba semanal.",
              fr: "La valeur d Advisor augmente a mesure que les justificatifs, positions et preuves hebdomadaires s accumulent.",
              de: "Der Wert von Advisor steigt, wenn Belege, Positionen und woechentliche Nachweise zunehmen.",
              it: "Il valore di Advisor cresce man mano che si accumulano ricevute, posizioni e prova settimanale.",
              pt: "O valor do Advisor fica mais forte à medida que se acumulam recibos, holdings e prova semanal.",
            })}
          />
        </div>
      ) : null}

      {!loading && error && bundle ? (
        <div role="alert" className="mb-5 rounded-[16px] border border-[#4a3514] bg-[#362813] p-4 text-sm text-[#f4cf91]">
          Update failed. The last confirmed analysis remains visible and no new recommendation was generated. {error}
        </div>
      ) : null}

      {!loading && bundle ? (
        <div className="mb-5 grid gap-3 rounded-[16px] border border-[#23314c] bg-[#0d182d] p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="block text-[10px] font-bold uppercase tracking-[.12em] text-[#7f91ad]">Data used</span><span className="mt-1 block font-semibold text-[#eef5ff]">Plan + portfolio + pricing</span></div>
          <div><span className="block text-[10px] font-bold uppercase tracking-[.12em] text-[#7f91ad]">Last confirmed</span><span className="mt-1 block font-semibold text-[#eef5ff]">{fmtTime(lastSnapshotAt)}</span></div>
          <div><span className="block text-[10px] font-bold uppercase tracking-[.12em] text-[#7f91ad]">Coverage</span><span className="mt-1 block font-semibold text-[#eef5ff]">{coveragePct}% · {advisorDataState}</span></div>
          <div><span className="block text-[10px] font-bold uppercase tracking-[.12em] text-[#7f91ad]">Execution authority</span><span className="mt-1 block font-semibold text-[#eef5ff]">None · analysis only</span></div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="text-sm text-zinc-600">
            {pickByLang(lang, {
              en: "Loading the last confirmed analysis...",
              pt: "A carregar a ultima analise confirmada...",
              es: "Cargando...",
              fr: "Chargement...",
              de: "Laden...",
              it: "Caricamento...",
            })}
          </div>
        </div>
      ) : error && !bundle ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <div className="text-sm font-semibold text-rose-900 mb-1">
            {pickByLang(lang, {
              en: "Failed",
              pt: "Falhou",
              es: "Fallo",
              fr: "Echec",
              de: "Fehlgeschlagen",
              it: "Errore",
            })}
          </div>
          <div className="text-sm text-rose-900/90">{error}</div>
        </div>
      ) : advisorDataState !== "fresh" ? (
        <div role="alert" className="rounded-[18px] border border-[#4a3514] bg-[#362813] p-5 text-[#f4cf91]">
          <div className="text-sm font-bold">{advisorDataState === "empty" ? "Analysis unavailable" : "Partial analysis"}</div>
          <p className="mt-2 text-sm leading-6">{advisorDataState === "empty" ? "Add at least one holding before Advisor relates evidence to your plan." : `Pricing coverage is ${coveragePct}%. Advisor will not issue a definitive or execution-ready recommendation until coverage reaches 80%.`}</p>
          <button type="button" onClick={goPortfolio} className="mt-4 min-h-11 rounded-xl bg-[#2f6df6] px-4 text-sm font-semibold text-white">Open Portfolio</button>
        </div>
      ) : showFirstAdvisorIntro ? (
        <div className="space-y-5">
          <Card
            title="Advisor first-time briefing"
            subtitle="Why this tab exists and what each block is for."
            right={<Badge tone="good">First visit</Badge>}
          >
            <div className="space-y-3 text-sm text-zinc-700">
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                <span className="font-semibold text-zinc-900">Why this appears now:</span> this is your first time in Advisor, so Syntrake explains the strategy layer before showing normal review cards.
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <div className="font-semibold text-zinc-900">Daily</div>
                  <div className="mt-1 text-xs">Decision loop layer: one clear action cycle for today.</div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <div className="font-semibold text-zinc-900">Advisor</div>
                  <div className="mt-1 text-xs">Strategy layer: why the system is guiding you that way and what to adjust in the plan.</div>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Strategic score bars" subtitle="These calibrate Advisor recommendations." right={<Badge tone="neutral">Baseline</Badge>}>
            <div className="space-y-3">
              {advisorIntroScoreBars.map((bar) => (
                <div key={bar.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-zinc-900">{bar.label}</div>
                    <div className="text-sm font-semibold text-zinc-900">{bar.value}/100</div>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={bar.value} />
                  </div>
                  <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700">
                    <div><span className="font-semibold text-zinc-900">Why this is here:</span> {bar.why}</div>
                    <div className="mt-1"><span className="font-semibold text-zinc-900">What it is for:</span> {bar.purpose}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Start here card (simple)" subtitle="The first strategic step only." right={<Badge tone={advisorDecision.badgeTone}>{advisorDecision.badgeLabel}</Badge>}>
            <div className="space-y-3 text-sm text-zinc-700">
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs">
                <span className="font-semibold text-zinc-900">Why this appears now:</span> it prevents you from jumping between cards without fixing the main blocker first.
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                <span className="font-semibold text-zinc-900">What it is for:</span> gives one strategic next step (plan, holdings, leak fix, or go back to Daily).
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                <div className="text-xs text-zinc-500">Current first step</div>
                <div className="mt-1 font-semibold text-zinc-900">{advisorDecision.title}</div>
                <div className="mt-1 text-xs">{advisorDecision.detail}</div>
              </div>
            </div>
          </Card>

          <Card title="Safety + strategy blocks" subtitle="What the main Advisor sections are for." right={<Badge tone="neutral">Map</Badge>}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <div className="text-sm font-semibold text-zinc-900">Advisor summary</div>
                <div className="mt-2 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Why this appears:</span> gives one-page strategic posture before details.
                </div>
                <div className="mt-1 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Purpose:</span> tells you if the system is in protect mode or growth-allowed mode.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <div className="text-sm font-semibold text-zinc-900">Action directive</div>
                <div className="mt-2 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Why this appears:</span> shows the strategic rationale behind the current operating stance.
                </div>
                <div className="mt-1 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Purpose:</span> explain risk caps and posture, not replace the Daily decision loop.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <div className="text-sm font-semibold text-zinc-900">Plan-limit analysis</div>
                <div className="mt-2 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Why this appears:</span> capital protection comes before growth.
                </div>
                <div className="mt-1 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Purpose:</span> identify leaks to fix before scaling risk.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <div className="text-sm font-semibold text-zinc-900">Gap to target + wealth levers</div>
                <div className="mt-2 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Why this appears:</span> users should see that Syntrake improves the path using multiple levers, not only “deposit more”.
                </div>
                <div className="mt-1 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Purpose:</span> show target gap, scenario paths and which lever to use next (leaks, execution, plan assumptions, optional accelerator).
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <div className="text-sm font-semibold text-zinc-900">Investing edge</div>
                <div className="mt-2 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Why this appears:</span> users need to understand what the monthly subscription is actually improving in each mode.
                </div>
                <div className="mt-1 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Purpose:</span> make the value explicit (decision quality, execution quality, risk control, discipline), not vague "signals".
                </div>
              </div>
              {isProUX ? (
                <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-zinc-900">Decision pressure and trajectory</div>
                  <div className="mt-2 text-xs text-zinc-700">
                    <span className="font-semibold text-zinc-900">Why this appears:</span> Pro users need deeper context for strategic adjustments.
                  </div>
                  <div className="mt-1 text-xs text-zinc-700">
                    <span className="font-semibold text-zinc-900">Purpose:</span> explain institutional drivers and when growth should pause or continue.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                  <div className="text-sm font-semibold text-zinc-900">Pro blocks (optional later)</div>
                  <div className="mt-2 text-xs text-zinc-700">
                    Decision pressure and trajectory are secondary diagnostics shown when supporting evidence is available.
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="How Advisor works with Daily" subtitle="Strategy first, execution second." right={<Badge tone="good">Loop</Badge>}>
            <div className="space-y-2 text-sm text-zinc-700">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">1. Use Advisor to understand posture, leaks, and plan-level decisions.</div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">2. Apply the strategic fix/change (if needed).</div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">3. Return to Daily to continue the next decision cycle.</div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs">
                <span className="font-semibold text-zinc-900">Why this appears now:</span> to prevent using Advisor like a second Daily tab.
              </div>
              <div className="pt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={completeFirstAdvisorIntro}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Enter Advisor
                </button>
                <button
                  type="button"
                  onClick={goDaily}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900"
                >
                  Open Daily
                </button>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-5">
          {doneToday ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Daily is closed for this cycle. Advisor may show strategic adjustments for the next cycle, while execution remains in Daily.
            </div>
          ) : null}

          {advisorStartHereCard}

          <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
            {capitalStrategyCard}
            {capitalProtectionCard}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
            {possibleCapitalPathsCard}
            {strategicImprovementsCard}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
            {growthLimitersCard}
            {investorEvolutionCard}
          </div>

          {advisorValueProofCard}

          <Card
            title="Advanced strategy context"
            subtitle="Longer-form strategic context, wealth levers, and retention evidence."
            right={
              <button
                type="button"
                onClick={() => setShowAdvancedStrategy((v) => !v)}
                className="rounded-xl border border-[#31415f] bg-[#0d182d] px-3 py-1 text-xs font-semibold text-[#dbe7f8]"
              >
                {showAdvancedStrategy ? "Hide" : "Show"}
              </button>
            }
            className="border-[#1f2d47] bg-[linear-gradient(180deg,#0f182b_0%,#0b1423_100%)] shadow-[0_12px_36px_rgba(0,0,0,.18)]"
          >
            {showAdvancedStrategy ? (
              <div className="space-y-5">
                {gapToTargetCard}
                {modeEdgeExamplesCard}
                {advisorRetentionWeeklyCard}
                {strategyIntelligenceCard}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-[#23314c] bg-[#0d182d] px-3 py-3 text-xs text-[#a8b7cc]">
                  Wealth levers and target gap remain available when you need to review strategic upside beyond deposits.
                </div>
                <div className="rounded-xl border border-[#23314c] bg-[#0d182d] px-3 py-3 text-xs text-[#a8b7cc]">
                  Mode-specific edge examples, retention signals, and deeper strategy intelligence stay secondary until the main strategic step is clear.
                </div>
                <div className="rounded-xl border border-[#23314c] bg-[#0d182d] px-3 py-3 text-xs text-[#a8b7cc]">
                  Open this section only when you want more strategic context beyond the current Advisor priority.
                </div>
              </div>
            )}
          </Card>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            Syntrake continuously evaluates your capital strategy and adapts as conditions evolve.
          </div>
        </div>
      )}
    </div>
  );
}





