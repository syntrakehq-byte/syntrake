"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AutopilotMode } from "@/lib/signalcore/modes";
import { searchMarket, type MarketHit } from "@/lib/signalcore/marketSearch";
import { useSiteLanguage } from "@/components/SiteLanguageProvider";
import { pickByLang } from "@/lib/i18n/siteLanguage";
import { isLeakResolved } from "@/lib/fixNow/leakResolution";

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

function normalizeMode(x: any): AutopilotMode {
  const m = String(x || "investing").toLowerCase().trim();
  void m;
  return "investing";
}

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function normSymbol(x: any) {
  return String(x || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^\w\.\-:]/g, "");
}

function safeNum(x: any, fallback: number | null = null) {
  if (x === "" || x == null) return fallback;
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function parseSymbolsFromText(txt: string) {
  const raw = String(txt || "")
    .replace(/[,;\n\r\t]+/g, " ")
    .split(" ")
    .map((s) => normSymbol(s))
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, 200);
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
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[18px] border border-[#23314c] bg-[linear-gradient(180deg,#111c31_0%,#0d1729_100%)] shadow-[0_18px_50px_rgba(0,0,0,.28)]">
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

function fmtAge(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "-";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

function fmtPrice(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
  return `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

function MiniExposureBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#17284a]">
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,#4d7eff_0%,#59d0ff_62%,#6f7df6_100%)] shadow-[0_0_18px_rgba(89,208,255,.35)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}


type HoldingRow = {
  id: string;
  symbol: string;
  name?: string | null;
  qty?: number | null;
  valueEur?: number | null;
  value_eur?: number | null;
};

type ExperienceLevel = "beginner" | "medium" | "pro";

type FixVisualGuide = {
  title: string;
  subtitle: string;
  targetCoverage: number;
  steps: Array<{ title: string; detail: string; visual: string }>;
};

type PortfolioSimpleAction = "add_first" | "prepare_starter" | "fix_rows" | "recheck" | "daily";
type PortfolioSimpleGuide = {
  step: number;
  total: number;
  title: string;
  detail: string;
  actionLabel: string;
  action: PortfolioSimpleAction;
  tone: "good" | "warn" | "bad";
};

type FixNowAction = "BUY" | "SELL" | "HOLD" | "FIX_DATA";

function fixNowActionLabel(action: FixNowAction): string {
  if (action === "FIX_DATA") return "Data repair";
  return action;
}

type FixNowPriority = "high" | "med" | "low";
type FixNowExecutionRow = {
  symbol: string;
  action: FixNowAction;
  priority: FixNowPriority;
  currentValueEur: number | null;
  targetValueEur: number | null;
  deltaValueEur: number | null;
  qtyHint: string | null;
  reason: string;
};

const HANDS_FREE_FIXNOW_KEY = "sc_hands_free_fixnow_v1";
const STARTER_BUDGET_KEY = "sc_starter_budget_v1";
const STARTER_WARMUP_KEY = "sc_starter_warmup_v1";
const EMPTY_SYMBOLS: string[] = [];

function clampStarterBudget(v: number) {
  if (!Number.isFinite(v)) return 1000;
  return Math.max(100, Math.min(50000, Math.round(v)));
}

function defaultStarterBudget(mode: AutopilotMode) {
  void mode;
  return 1000;
}

function readStarterBudget(mode: AutopilotMode) {
  if (typeof window === "undefined") return defaultStarterBudget(mode);
  try {
    const raw = window.localStorage.getItem(STARTER_BUDGET_KEY);
    if (!raw) return inferStarterBudgetFromProfile(mode);
    const parsed = JSON.parse(raw) as Partial<Record<AutopilotMode, number>>;
    const val = Number(parsed?.[mode]);
    if (!Number.isFinite(val) || val <= 0) return inferStarterBudgetFromProfile(mode);
    const profileBudgetCap = readStarterBudgetCapFromSetup();
    if (profileBudgetCap != null) return clampStarterBudget(Math.min(val, profileBudgetCap));
    return clampStarterBudget(val);
  } catch {
    return inferStarterBudgetFromProfile(mode);
  }
}

function readGoalQuiz() {
  if (typeof window === "undefined") return null as {
    hasExistingHoldings?: boolean;
    goalType?: string;
    riskProfile?: string;
    startingCapital?: number;
    monthlyContribution?: number;
    targetCapital?: number;
  } | null;
  try {
    const raw = window.localStorage.getItem("sc_goal_quiz_v1");
    if (!raw) return null;
    return JSON.parse(raw) as {
      hasExistingHoldings?: boolean;
      goalType?: string;
      riskProfile?: string;
      startingCapital?: number;
      monthlyContribution?: number;
      targetCapital?: number;
    };
  } catch {
    return null;
  }
}

function readWealthPlan() {
  if (typeof window === "undefined") return null as { startingCapital?: number; monthlyContribution?: number } | null;
  try {
    const raw = window.localStorage.getItem("sc_wealth_plan_v1");
    if (!raw) return null;
    return JSON.parse(raw) as { startingCapital?: number; monthlyContribution?: number };
  } catch {
    return null;
  }
}

function inferStarterBudgetFromProfile(mode: AutopilotMode) {
  const setupCap = readStarterBudgetCapFromSetup();
  if (setupCap != null) return setupCap;
  return defaultStarterBudget(mode);
}

function readStarterBudgetCapFromSetup() {
  const goalQuiz = readGoalQuiz();
  const wealthPlan = readWealthPlan();
  const starting = Number(wealthPlan?.startingCapital ?? goalQuiz?.startingCapital ?? NaN);
  if (Number.isFinite(starting) && starting > 0) return clampStarterBudget(starting);
  const monthly = Number(wealthPlan?.monthlyContribution ?? goalQuiz?.monthlyContribution ?? NaN);
  if (Number.isFinite(monthly) && monthly > 0) return clampStarterBudget(monthly * 6);
  return null;
}

function writeStarterWarmup(mode: AutopilotMode) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STARTER_WARMUP_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<Record<AutopilotMode, string>>;
    parsed[mode] = new Date().toISOString();
    window.localStorage.setItem(STARTER_WARMUP_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

function fmtEUR(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  const n = Math.round(Number(v));
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} EUR`;
}

function fmtQty(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

function concentrationTargetPct(mode: AutopilotMode) {
  void mode;
  return 33;
}

function concentrationDiversifierSymbols(mode: AutopilotMode) {
  void mode;
  return ["SPY", "QQQ", "AGGH", "GLD", "EFA"];
}

function starterReasonFallback(mode: AutopilotMode, index: number) {
  void mode;
  if (index === 0) {
    return "Core anchor for long-term compounding with disciplined volatility.";
  }
  if (index === 1) return "Growth sleeve aligned with your selected risk profile and target horizon.";
  return "Diversifier to reduce concentration and smooth drawdowns over time.";
}

function normalizeExperienceLevel(x: unknown): ExperienceLevel {
  const raw = String(x || "").toLowerCase().trim();
  if (raw === "beginner" || raw === "medium" || raw === "pro") return raw;
  return "beginner";
}

function buildFixVisualGuide(fixKey: string): FixVisualGuide {
  if (fixKey === "no_holdings") {
    return {
      title: "FixNow: add holdings first",
      subtitle: "Without holdings, the system cannot calculate drift, concentration or incomplete-data risks.",
      targetCoverage: 80,
      steps: [
        { title: "Add symbols", detail: "Add 3-10 holdings using search or paste list.", visual: "Search/Paste -> Add" },
        { title: "Add inputs", detail: "For each row add Qty or Value EUR.", visual: "Row -> Qty/Value" },
        { title: "Re-check", detail: "Run quality check until coverage reaches the safe zone.", visual: "Save -> Re-check" },
      ],
    };
  }

  if (fixKey === "concentration_high" || fixKey === "concentration_med") {
    return {
      title: "FixNow: concentration rebalance",
      subtitle: "One position is too large. Reduce concentration before adding new risk.",
      targetCoverage: 80,
      steps: [
        { title: "Find oversized row", detail: "Identify your largest holding in the list.", visual: "Top position -> Identify" },
        { title: "Trim position", detail: "Reduce size gradually in smaller orders.", visual: "Trim -> Stage 1/2/3" },
        { title: "Validate posture", detail: "Return to Daily and confirm directive improves.", visual: "Re-check -> Daily" },
      ],
    };
  }

  if (fixKey === "pricing_stale_high" || fixKey === "pricing_stale_med") {
    return {
      title: "FixNow: refresh stale pricing",
      subtitle: "Data is delayed. Refresh and validate symbols before taking action.",
      targetCoverage: 85,
      steps: [
        { title: "Refresh quality", detail: "Use Re-check to fetch fresher data.", visual: "Refresh -> New prices" },
        { title: "Validate symbols", detail: "Remove invalid tickers or rows with broken data.", visual: "Clean rows -> Save" },
        { title: "Confirm freshness", detail: "Only act when age and coverage are back in range.", visual: "Age/Coverage -> OK" },
      ],
    };
  }

  if (fixKey === "pricing_low" || fixKey === "valuation_zero") {
    return {
      title: "FixNow: repair missing pricing",
      subtitle: "Current data is incomplete. Complete rows before using directives.",
      targetCoverage: 90,
      steps: [
        { title: "Locate missing rows", detail: "Use highlighted rows marked Missing pricing input.", visual: "Amber rows -> Focus" },
        { title: "Fill row data", detail: "Enter Qty or Value EUR for each missing row.", visual: "Input -> Save" },
        { title: "Reach safe coverage", detail: "Re-check quality until coverage reaches target.", visual: "Coverage >= target" },
      ],
    };
  }

  if (fixKey === "no_plan") {
    return {
      title: "FixNow: activate plan first",
      subtitle: "Without an active plan, guardrails are missing and fixes are not reliable.",
      targetCoverage: 85,
      steps: [
        { title: "Open Planning", detail: "Go to Planning and activate your plan.", visual: "Open -> Planning" },
        { title: "Set constraints", detail: "Confirm risk level, horizon and target.", visual: "Risk/Horizon -> Save" },
        { title: "Return to Daily", detail: "After plan is active, run Daily again.", visual: "Back -> Daily" },
      ],
    };
  }

  if (fixKey === "cash_drag_high" || fixKey === "cash_drag_med") {
    return {
      title: "FixNow: rebalance cash drag",
      subtitle: "This leak is solved in Planning by adjusting allocation and deployment pace.",
      targetCoverage: 85,
      steps: [
        { title: "Open Planning", detail: "Set your target cash buffer for this mode.", visual: "Planning -> Cash target" },
        { title: "Adjust deployment", detail: "Break entries into smaller staged allocations.", visual: "Stage orders -> 2/4 steps" },
        { title: "Re-check Daily", detail: "Return to Daily and verify leak severity drops.", visual: "Daily -> Refresh" },
      ],
    };
  }

  return {
    title: "FixNow: portfolio quality",
    subtitle: "Follow this quick sequence to restore reliable signals.",
    targetCoverage: 85,
    steps: [
      { title: "Open fix area", detail: "Go to holdings section and review flagged rows.", visual: "Open -> Holdings" },
      { title: "Correct inputs", detail: "Fix missing or invalid qty/value fields.", visual: "Edit -> Save" },
      { title: "Re-check quality", detail: "Refresh data and verify metrics are healthy.", visual: "Re-check -> Good" },
    ],
  };
}

function buildFixExecutionRows(args: {
  fixKey: string;
  items: HoldingRow[];
  bundle: any;
  autopilotMode: AutopilotMode;
  missingSymbols: string[];
}): FixNowExecutionRow[] {
  const fixKey = String(args.fixKey || "").toLowerCase().trim();
  if (!fixKey) return [];

  const normalized = (args.items || [])
    .map((it) => {
      const symbol = String(it?.symbol || "").toUpperCase();
      const qty = safeNum(it?.qty, null);
      const value = safeNum(it?.valueEur ?? it?.value_eur, null);
      const hasQty = qty != null;
      const hasValue = value != null && value > 0;
      return { symbol, qty, value, hasQty, hasValue };
    })
    .filter((x) => x.symbol.length > 0);

  if (fixKey === "no_holdings") {
    const starter = Array.isArray(args.bundle?.daily?.starterPack) ? args.bundle.daily.starterPack : [];
    if (starter.length > 0) {
      return starter
        .map((s: any) => {
          const symbol = String(s?.symbol || "").trim().toUpperCase();
          if (!symbol) return null;
          const targetValue = safeNum(s?.value_eur ?? s?.valueEur, null);
          return {
            symbol,
            action: "BUY" as const,
            priority: "high" as const,
            currentValueEur: 0,
            targetValueEur: targetValue,
            deltaValueEur: targetValue,
            qtyHint: null,
            reason: "Starter allocation to unlock monitoring and risk control.",
          };
        })
        .filter(Boolean) as FixNowExecutionRow[];
    }

    return [
      {
        symbol: "-",
        action: "BUY",
        priority: "high",
        currentValueEur: null,
        targetValueEur: null,
        deltaValueEur: null,
        qtyHint: null,
        reason: "Add at least 3 holdings first, then re-check quality.",
      },
    ];
  }

  if (normalized.length === 0) return [];

  if (fixKey === "concentration_high" || fixKey === "concentration_med") {
    const withValue = normalized.filter((x) => x.hasValue) as Array<{
      symbol: string;
      qty: number | null;
      value: number;
      hasQty: boolean;
      hasValue: boolean;
    }>;
    const total = withValue.reduce((sum, x) => sum + (x.value || 0), 0);

    if (withValue.length === 0 || total <= 0) {
      return normalized.slice(0, 8).map((x) => ({
        symbol: x.symbol,
        action: "FIX_DATA",
        priority: "high",
        currentValueEur: x.value,
        targetValueEur: null,
        deltaValueEur: null,
        qtyHint: null,
        reason: "Missing valuation. Add qty or EUR value before calculating rebalance.",
      }));
    }

    const targetPct = concentrationTargetPct(args.autopilotMode);
    const sorted = [...withValue].sort((a, b) => (b.value || 0) - (a.value || 0));
    const top = sorted[0];
    const targetValue = (total * targetPct) / 100;
    const excess = Math.max(0, top.value - targetValue);
    const sellQty = top.hasQty && top.qty != null && top.value > 0 ? (excess / top.value) * top.qty : null;
    const others = sorted.slice(1);
    const receiverMin = 3;
    const heldSet = new Set(sorted.map((x) => x.symbol));

    const receivers: Array<{
      symbol: string;
      qty: number | null;
      value: number;
      hasQty: boolean;
      hasValue: boolean;
      synthetic: boolean;
    }> = others.map((x) => ({ ...x, synthetic: false }));

    const missingReceivers = Math.max(0, receiverMin - receivers.length);
    const diversifierSymbols = concentrationDiversifierSymbols(args.autopilotMode)
      .map((s) => String(s || "").toUpperCase())
      .filter((s) => s && s !== top.symbol && !heldSet.has(s));

    for (const sym of diversifierSymbols.slice(0, missingReceivers)) {
      receivers.push({
        symbol: sym,
        qty: null,
        value: 0,
        hasQty: false,
        hasValue: false,
        synthetic: true,
      });
    }

    const rows: FixNowExecutionRow[] = [];
    rows.push({
      symbol: top.symbol,
      action: excess > 0 ? "SELL" : "HOLD",
      priority: "high",
      currentValueEur: top.value,
      targetValueEur: Math.max(0, targetValue),
      deltaValueEur: excess > 0 ? -excess : 0,
      qtyHint: sellQty != null && sellQty > 0 ? `Sell about ${fmtQty(sellQty)} units` : "Reduce by EUR value if qty unknown",
      reason: `Top position is above safe concentration target (~${targetPct}% max).`,
    });

    if (excess > 0 && receivers.length > 0) {
      const perReceiver = excess / receivers.length;
      for (const x of receivers.slice(0, 8)) {
        const buyQty = !x.synthetic && x.hasQty && x.qty != null && x.value > 0 ? (perReceiver / x.value) * x.qty : null;
        const currentValue = x.value > 0 ? x.value : 0;
        rows.push({
          symbol: x.symbol,
          action: "BUY",
          priority: "med",
          currentValueEur: currentValue,
          targetValueEur: currentValue + perReceiver,
          deltaValueEur: perReceiver,
          qtyHint:
            buyQty != null && buyQty > 0
              ? `Buy about ${fmtQty(buyQty)} units`
              : x.synthetic
                ? "Create this holding and allocate target EUR value"
                : "Increase value by EUR amount",
          reason: x.synthetic
            ? "Add this diversifier to reduce single-position concentration."
            : "Reallocate concentration proceeds to diversify and stabilize exposure.",
        });
      }
    } else {
      for (const x of others.slice(0, 8)) {
        rows.push({
          symbol: x.symbol,
          action: "HOLD",
          priority: "low",
          currentValueEur: x.value,
          targetValueEur: x.value,
          deltaValueEur: 0,
          qtyHint: null,
          reason: "Keep stable while concentration leak is being reduced.",
        });
      }
    }

    return rows;
  }

  if (fixKey === "pricing_low" || fixKey === "valuation_zero") {
    const missingQuoteSet = new Set((args.missingSymbols || []).map((x: any) => String(x || "").toUpperCase()));
    const valuedRows = normalized.filter((x) => x.value != null && x.value > 0);
    const valuedTotal = valuedRows.reduce((sum, x) => sum + (x.value || 0), 0);
    const suggestedMissingValue =
      valuedRows.length > 0
        ? Math.max(250, Math.round((valuedTotal / valuedRows.length) * 0.4))
        : 500;
    return normalized
      .map((x) => {
        const missingInput = !x.hasQty && !x.hasValue;
        const missingQuote = missingQuoteSet.has(x.symbol);
        const targetValue = missingInput
          ? suggestedMissingValue
          : x.value != null && x.value > 0
            ? x.value
            : suggestedMissingValue;
        if (missingInput || missingQuote) {
          return {
            symbol: x.symbol,
            action: "FIX_DATA" as const,
            priority: "high" as const,
            currentValueEur: x.value,
            targetValueEur: targetValue,
            deltaValueEur: null,
            qtyHint: null,
            reason: missingInput
              ? `Add qty or EUR value. Suggested seed value: ${fmtEUR(suggestedMissingValue)}.`
              : "Quote unavailable: keep the row, add a manual EUR value, or switch to a supported symbol.",
          };
        }
        return {
          symbol: x.symbol,
          action: "HOLD" as const,
          priority: "low" as const,
          currentValueEur: x.value,
          targetValueEur: x.value,
          deltaValueEur: 0,
          qtyHint: null,
          reason: "Data looks valid for now.",
        };
      })
      .sort((a, b) => {
        const rank = (p: FixNowPriority) => (p === "high" ? 3 : p === "med" ? 2 : 1);
        return rank(b.priority) - rank(a.priority);
      })
      .slice(0, 12);
  }

  if (fixKey === "pricing_stale_high" || fixKey === "pricing_stale_med") {
    return normalized.slice(0, 8).map((x) => ({
      symbol: x.symbol,
      action: "HOLD",
      priority: "med",
      currentValueEur: x.value,
      targetValueEur: x.value,
      deltaValueEur: 0,
      qtyHint: null,
      reason: "Wait for fresh pricing first. Refresh and re-check before any trade.",
    }));
  }

  return normalized.slice(0, 8).map((x) => ({
    symbol: x.symbol,
    action: "HOLD",
    priority: "low",
    currentValueEur: x.value,
    targetValueEur: x.value,
    deltaValueEur: 0,
    qtyHint: null,
    reason: "No direct change required for this holding right now.",
  }));
}

function getActionableFixRows(rows: FixNowExecutionRow[]) {
  return rows.filter((r) => {
    if (!r.symbol || r.symbol === "-") return false;
    if (r.action === "HOLD") return false;
    return r.targetValueEur != null && Number.isFinite(r.targetValueEur);
  });
}

function isAutoFixableLeakKey(key: string | null | undefined) {
  const leak = String(key || "").toLowerCase().trim();
  return leak === "no_holdings" || leak === "concentration_high" || leak === "concentration_med" || leak === "pricing_low" || leak === "valuation_zero";
}

function manualFixCtaForLeak(key: string | null | undefined, mode: AutopilotMode) {
  const leak = String(key || "").toLowerCase().trim();
  if (leak === "no_plan" || leak === "cash_drag_high" || leak === "cash_drag_med") {
    return { label: "Open Planning", href: `/app?tab=planning&mode=${mode}` };
  }
  if (leak === "pricing_stale_high" || leak === "pricing_stale_med") {
    return { label: "Back to Daily", href: `/app?tab=daily&mode=${mode}` };
  }
  return null;
}

function clearFixQueryFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("fixNow");
    u.searchParams.delete("fixKey");
    u.searchParams.delete("fixFrom");
    window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
  } catch {
    // ignore
  }
}

function canonicalPortfolioItemsFromDashboard(data: any): HoldingRow[] {
  const rows = Array.isArray(data?.portfolio?.items) ? data.portfolio.items : [];
  return rows
    .map((item: any) => {
      const symbol = String(item?.symbol || "").trim().toUpperCase();
      if (!symbol) return null;
      const qty = safeNum(item?.qty, null);
      const valueEur = safeNum(item?.valueEur ?? item?.value_eur, null);
      return {
        id: item?.id ? String(item.id) : `canonical:${symbol}`,
        symbol,
        name: item?.name ? String(item.name) : symbol,
        qty,
        valueEur,
        value_eur: valueEur,
      } satisfies HoldingRow;
    })
    .filter(Boolean) as HoldingRow[];
}

function buildCanonicalPortfolioDiagnostics(data: any, items: HoldingRow[]) {
  const hasPlan = Boolean(data?.derived?.hasPlan ?? data?.plan);
  const hasHoldings = items.length > 0;
  const coveragePct =
    typeof data?.portfolio?.valuation?.coveragePct === "number"
      ? Number(data.portfolio.valuation.coveragePct)
      : hasHoldings
        ? 0
        : 100;
  const riskLeaks: Array<Record<string, any>> = [];

  if (!hasPlan) {
    riskLeaks.push({
      key: "no_plan",
      title: "Plan missing",
      severity: "high",
      detail: "Create an active Investing plan before portfolio decisions.",
      fix: { href: "/app?tab=planning&mode=investing" },
    });
  }
  if (!hasHoldings) {
    riskLeaks.push({
      key: "no_holdings",
      title: "No canonical Paper positions",
      severity: "high",
      detail: "Fund Paper and create a reviewed proposal before portfolio monitoring can start.",
      fix: { href: "/app?tab=daily&mode=investing" },
    });
  } else if (coveragePct < 80) {
    riskLeaks.push({
      key: "pricing_low",
      title: "Pricing coverage is low",
      severity: coveragePct < 50 ? "high" : "med",
      detail: `Only ${Math.round(coveragePct)}% of canonical positions have fresh prices.`,
      fix: { href: "/app?tab=daily&mode=investing" },
    });
  }

  return {
    pricing: {
      coveragePct,
      missingSymbols: items
        .filter((item) => safeNum(item.valueEur ?? item.value_eur, null) == null)
        .map((item) => item.symbol),
      priceAgeSeconds: null,
    },
    diagnostics: {
      ...(data?.derived?.diagnostics && typeof data.derived.diagnostics === "object" ? data.derived.diagnostics : {}),
      riskLeaks,
    },
  };
}

function normalizeInvestingDashboardBundle(data: any) {
  const items = canonicalPortfolioItemsFromDashboard(data);
  const canonical = buildCanonicalPortfolioDiagnostics(data, items);
  const cashEur = safeNum(data?.portfolio?.cashEur, 0) ?? 0;
  const totalEur = safeNum(data?.portfolio?.totalEur, 0) ?? 0;
  const deployedEur = Math.max(0, totalEur - cashEur);
  const exposurePct = totalEur > 0 ? Math.round((deployedEur / totalEur) * 100) : 0;
  const cashPct = totalEur > 0 ? Math.round((cashEur / totalEur) * 100) : 100;

  return {
    ...(data && typeof data === "object" ? data : {}),
    portfolio: {
      ...(data?.portfolio && typeof data.portfolio === "object" ? data.portfolio : {}),
      items,
      cash: cashEur,
      cashEur,
      total: totalEur,
      totalEur,
      valuation: {
        ...(data?.portfolio?.valuation && typeof data.portfolio.valuation === "object" ? data.portfolio.valuation : {}),
        cashEur,
        totalEur,
        coveragePct: canonical.pricing.coveragePct,
      },
    },
    daily: {
      ...(data?.daily && typeof data.daily === "object" ? data.daily : {}),
      capitalStatus: {
        posture: items.length > 0 ? "STABLE" : "SETUP",
        planAlignment: data?.derived?.hasPlan ? "CANONICAL" : "PENDING",
        exposurePct,
        cashPct,
      },
    },
    derived: {
      ...(data?.derived && typeof data.derived === "object" ? data.derived : {}),
      hasHoldings: items.length > 0,
      pricing: canonical.pricing,
      diagnostics: canonical.diagnostics,
    },
  };
}

function hydrateDraftsFromItems(args: {
  items: HoldingRow[];
  setDraftQty: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setDraftVal: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  args.setDraftQty((prev) => {
    const next = { ...(prev || {}) };
    for (const it of args.items) {
      const sym = String(it?.symbol || "").toUpperCase();
      if (!sym) continue;
      if (next[sym] == null) next[sym] = it?.qty == null ? "" : String(it.qty);
    }
    return next;
  });

  args.setDraftVal((prev) => {
    const next = { ...(prev || {}) };
    for (const it of args.items) {
      const sym = String(it?.symbol || "").toUpperCase();
      const value = it?.valueEur ?? it?.value_eur;
      if (!sym) continue;
      if (next[sym] == null) next[sym] = value == null ? "" : String(value);
    }
    return next;
  });
}

export default function PortfolioTab({
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
  const search = useSearchParams();
  const fromSetup = (search?.get("fromSetup") ?? "") === "1";
  const addHoldingsNow = (search?.get("addHoldingsNow") ?? "") === "1";
  const starterReady = (search?.get("starterReady") ?? "") === "1";
  const onboardingFromSetupRef = useRef(fromSetup);

  const [items, setItems] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applyingStarter, setApplyingStarter] = useState(false);
  const [clearingStarterFreshStart, setClearingStarterFreshStart] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissFixGuide, setDismissFixGuide] = useState(false);
  const [handsFreeFixNow, setHandsFreeFixNow] = useState(false);
  const [goalQuiz, setGoalQuiz] = useState<ReturnType<typeof readGoalQuiz>>(null);
  const lastHandsFreeRunRef = useRef<string>("");
  const onboardingHintShownRef = useRef(false);
  const onboardingAutoFreshStartRef = useRef(false);
  const onboardingDailyRedirectedRef = useRef(false);

  // data quality (from the canonical Investing dashboard)
  const [bundle, setBundle] = useState<any>(null);
  const pricing = bundle?.derived?.pricing ?? null; // {coveragePct, missingSymbols, priceAgeSeconds}
  const diagnostics = bundle?.derived?.diagnostics ?? null; // includes riskLeaks
  const portfolioQuotes = bundle?.portfolio?.quotes ?? {};
  const portfolioValuation = bundle?.portfolio?.valuation ?? null;
  const portfolioCash = Math.max(0, safeNum(bundle?.portfolio?.cash, 0) ?? 0);
  const capitalStatus = bundle?.daily?.capitalStatus ?? null;

  // add UI
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MarketHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [qty, setQty] = useState<string>("");

  // paste UI
  const [paste, setPaste] = useState("");

  // editing state
  const [draftQty, setDraftQty] = useState<Record<string, string>>({});
  const [draftVal, setDraftVal] = useState<Record<string, string>>({});
  const [rowSaving, setRowSaving] = useState<Record<string, boolean>>({});

  const starterPack = useMemo(() => {
    const raw = Array.isArray(bundle?.daily?.starterPack) ? bundle.daily.starterPack : [];
    return raw
      .map((x: any) => ({
        symbol: String(x?.symbol || "").toUpperCase(),
        name: x?.name ? String(x.name) : null,
        valueEur: Number(x?.value_eur ?? x?.valueEur ?? 0),
        qty: x?.qty == null ? null : Number(x.qty),
        rationale: x?.rationale ? String(x.rationale) : "",
      }))
      .filter((x: any) => x.symbol.length > 0 && Number.isFinite(x.valueEur) && x.valueEur > 0)
      .slice(0, 10);
  }, [bundle?.daily?.starterPack]);
  const starterPackMeta = bundle?.daily?.starterPackMeta ?? null;
  const starterSource = String(starterPackMeta?.source || "").toLowerCase().trim();
  const starterUsesLiveQuotes = starterSource === "market_quotes";

  const normalizedSymbol = useMemo(() => normSymbol(q), [q]);
  const qtyNumber = useMemo(() => {
    const n = safeNum(qty, null);
    return n == null ? null : n;
  }, [qty]);

  const hasHoldings = items.length > 0;
  const hasStarterCandidate = !hasHoldings && starterPack.length > 0;
  const setupHasExistingHoldings =
    typeof goalQuiz?.hasExistingHoldings === "boolean" ? Boolean(goalQuiz.hasExistingHoldings) : null;
  const onboardingFreshStartConflict =
    onboardingFromSetupRef.current && starterReady && setupHasExistingHoldings === false && hasHoldings;
  const starterRationale = useMemo(() => {
    const reasons = starterPack
      .map((x: any) => String(x?.rationale || "").trim())
      .filter((x: string) => x.length > 0);
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const r of reasons) {
      const key = r.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(r);
      if (uniq.length >= 3) break;
    }
    return uniq;
  }, [starterPack]);
  const starterExplainRows = useMemo(() => {
    return starterPack.map((x: any, idx: number) => ({
      symbol: String(x.symbol || "").toUpperCase(),
      valueEur: Number(x.valueEur || 0),
      reason: String(x?.rationale || "").trim() || starterReasonFallback(autopilotMode, idx),
    }));
  }, [starterPack, autopilotMode]);
  const showStarterWhyPanel =
    onboardingFromSetupRef.current && setupHasExistingHoldings !== true && starterExplainRows.length > 0;
  const showStarterApplyTopCard = showStarterWhyPanel && !hasHoldings;
  const starterFallbackInfoTable =
    !hasHoldings && !starterUsesLiveQuotes ? (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="text-xs font-semibold text-amber-900">Starter em modo provisorio (aplicacao continua disponivel).</div>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs text-zinc-800">
            <thead>
              <tr className="text-left text-zinc-600">
                <th className="pr-3 pb-1 font-semibold">Check</th>
                <th className="pr-3 pb-1 font-semibold">Estado</th>
                <th className="pb-1 font-semibold">Significado</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-amber-200/70">
                <td className="pr-3 py-1">Cobertura de quotes reais</td>
                <td className="pr-3 py-1 font-semibold text-amber-900">Limitada</td>
                <td className="py-1">O Syntrake usou alocacao segura de fallback para te deixar arrancar hoje.</td>
              </tr>
              <tr className="border-t border-amber-200/70">
                <td className="pr-3 py-1">Apply Starter Pack</td>
                <td className="pr-3 py-1 font-semibold text-emerald-700">Ativo</td>
                <td className="py-1">Podes aplicar ja e criar o portfolio inicial sem bloqueio.</td>
              </tr>
              <tr className="border-t border-amber-200/70">
                <td className="pr-3 py-1">Passo seguinte</td>
                <td className="pr-3 py-1 font-semibold text-zinc-900">Reavaliar no Daily</td>
                <td className="py-1">Depois de aplicar, abre o Daily para atualizar decisoes com melhor cobertura real.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    ) : null;
  const fixNow = (search?.get("fixNow") ?? "") === "1";
  const fixKey = String(search?.get("fixKey") ?? "").toLowerCase();
  const fixFrom = String(search?.get("fixFrom") ?? "engine").toLowerCase();
  const fixGuide = useMemo(() => buildFixVisualGuide(fixKey), [fixKey]);

  // auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setDismissFixGuide(false);
  }, [fixNow, fixKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(HANDS_FREE_FIXNOW_KEY);
    setHandsFreeFixNow(raw === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncGoalQuiz = () => setGoalQuiz(readGoalQuiz());
    syncGoalQuiz();
    window.addEventListener("focus", syncGoalQuiz);
    window.addEventListener("storage", syncGoalQuiz);
    return () => {
      window.removeEventListener("focus", syncGoalQuiz);
      window.removeEventListener("storage", syncGoalQuiz);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HANDS_FREE_FIXNOW_KEY, handsFreeFixNow ? "1" : "0");
    if (!handsFreeFixNow) lastHandsFreeRunRef.current = "";
  }, [handsFreeFixNow]);

  async function loadServerItems() {
    setLoading(true);
    try {
      const r = await fetchJSON(`/api/investing/dashboard?mode=${encodeURIComponent(String(autopilotMode))}&_=${Date.now()}`, { method: "GET" });
      if (!r.ok) return [] as HoldingRow[];

      const normalized = normalizeInvestingDashboardBundle(r.data);
      const list = canonicalPortfolioItemsFromDashboard(normalized);
      setItems(list);
      setBundle(normalized);
      hydrateDraftsFromItems({ items: list, setDraftQty, setDraftVal });

      return list as HoldingRow[];
    } finally {
      setLoading(false);
    }
  }

  async function loadBundle() {
    const r = await fetchJSON(`/api/investing/dashboard?mode=${encodeURIComponent(String(autopilotMode))}&_=${Date.now()}`, { method: "GET" });
    if (r.ok) {
      const normalized = normalizeInvestingDashboardBundle(r.data);
      const list = canonicalPortfolioItemsFromDashboard(normalized);
      setBundle(normalized);
      setItems(list);
      hydrateDraftsFromItems({ items: list, setDraftQty, setDraftVal });
      return normalized;
    }
    return null;
  }

  function topLeakKeyFromBundle(data: any): string | null {
    const k = data?.derived?.diagnostics?.riskLeaks?.[0]?.key;
    const raw = String(k || "").toLowerCase().trim();
    return raw || null;
  }

  async function recheckFixResolution(targetLeakKey: string, attempts = 3) {
    const target = String(targetLeakKey || "").toLowerCase().trim();
    if (!target) return { resolved: true, currentLeakKey: null as string | null };

    let current: string | null = null;
    for (let i = 0; i < attempts; i++) {
      const data = await loadBundle();
      current = topLeakKeyFromBundle(data);
      if (isLeakResolved({ targetLeakKey: target, currentLeakKey: current })) {
        return { resolved: true, currentLeakKey: current };
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    return { resolved: false, currentLeakKey: current };
  }

  useEffect(() => {
    loadServerItems();
    loadBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotMode]);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setToast("Could not update portfolio data within 10 seconds. Last confirmed values remain visible.");
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [loading]);

  useEffect(() => {
    if (loading || hasHoldings) return;
    if (addHoldingsNow) focusAddHoldingInput();
    if (!starterReady) return;
    if (!onboardingFromSetupRef.current) return;
    if (onboardingHintShownRef.current) return;
    onboardingHintShownRef.current = true;
    setToast("Starter ready. Apply it in Portfolio and continue to Daily.");
  }, [loading, hasHoldings, addHoldingsNow, starterReady]);

  useEffect(() => {
    if (!onboardingFreshStartConflict) return;
    if (onboardingAutoFreshStartRef.current) return;
    onboardingAutoFreshStartRef.current = true;
    setToast("Previous holdings detected. Starting with a clean portfolio...");
    void clearForStarterFreshStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingFreshStartConflict]);

  // close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // debounce market search
  useEffect(() => {
    const s = q.trim();
    if (s.length < 1) {
      setHits([]);
      setOpen(false);
      return;
    }

    const t = setTimeout(async () => {
      const out = await searchMarket(s);
      setHits(out);
      setActiveIdx(0);
      setOpen(true);
    }, 140);

    return () => clearTimeout(t);
  }, [q]);

  const missingForPricing = useMemo(() => {
    // A holding is "pricing-missing" if both qty and value are empty -> engine can't price it.
    const miss: string[] = [];
    for (const it of items) {
      const sym = String(it?.symbol || "").toUpperCase();
      if (!sym) continue;
      const qv = draftQty[sym];
      const vv = draftVal[sym];
      const hasQty = safeNum(qv, null) != null;
      const hasVal = safeNum(vv, null) != null;
      if (!hasQty && !hasVal) miss.push(sym);
    }
    return miss;
  }, [items, draftQty, draftVal]);

  const coveragePct = typeof pricing?.coveragePct === "number" ? pricing.coveragePct : null;
  const priceAgeSeconds = typeof pricing?.priceAgeSeconds === "number" ? pricing.priceAgeSeconds : null;
  const missingSymbols = useMemo<string[]>(() => {
    return Array.isArray(pricing?.missingSymbols) ? pricing.missingSymbols : EMPTY_SYMBOLS;
  }, [pricing?.missingSymbols]);

  const dataQualityTone = useMemo(() => {
    if (!hasHoldings) return "neutral";
    const cov = coveragePct ?? 0;
    if (cov >= 90 && (priceAgeSeconds ?? 0) < 60 * 60) return "good";
    if (cov >= 70) return "warn";
    return "bad";
  }, [hasHoldings, coveragePct, priceAgeSeconds]);

  useEffect(() => {
    if (loading) return;
    if (!onboardingFromSetupRef.current) return;
    if (!(addHoldingsNow || starterReady)) return;
    if (!hasHoldings) return;
    if (missingForPricing.length > 0) return;
    if ((coveragePct ?? 0) < 80) return;
    if (onboardingDailyRedirectedRef.current) return;
    onboardingDailyRedirectedRef.current = true;
    setToast("Portfolio ready. Redirecting to Daily...");
    setTimeout(() => {
      window.location.href = `/app?tab=daily&mode=${autopilotMode}&fresh=${Date.now()}`;
    }, 500);
  }, [loading, addHoldingsNow, starterReady, hasHoldings, missingForPricing.length, coveragePct, autopilotMode]);

  const showFixGuide = fixNow && !dismissFixGuide;
  const leakAutoFixable = isAutoFixableLeakKey(fixKey);
  const manualLeakCta = useMemo(() => manualFixCtaForLeak(fixKey, autopilotMode), [fixKey, autopilotMode]);
  const fixGuideDone = useMemo(() => {
    if (!showFixGuide) return false;
    const cov = typeof coveragePct === "number" ? coveragePct : 0;
    return missingForPricing.length === 0 && cov >= fixGuide.targetCoverage;
  }, [showFixGuide, coveragePct, missingForPricing.length, fixGuide.targetCoverage]);

  useEffect(() => {
    if (!showFixGuide) return;
    if (!fixKey) return;
    if (!bundle) return;

    const currentLeakKey = topLeakKeyFromBundle(bundle);
    if (!isLeakResolved({ targetLeakKey: fixKey, currentLeakKey })) return;

    setDismissFixGuide(true);
    clearFixQueryFromUrl();
    setToast(
      currentLeakKey
        ? `Top leak changed to ${currentLeakKey}. Open FixNow again from Daily.`
        : "No active leak detected. Fix guide closed."
    );
  }, [showFixGuide, fixKey, bundle]);

  const fixExecutionRows = useMemo<FixNowExecutionRow[]>(() => {
    if (!showFixGuide) return [];
    return buildFixExecutionRows({
      fixKey,
      items,
      bundle,
      autopilotMode,
      missingSymbols,
    });
  }, [showFixGuide, fixKey, items, bundle, autopilotMode, missingSymbols]);

  const autoFixActionableRows = useMemo(() => {
    return getActionableFixRows(fixExecutionRows);
  }, [fixExecutionRows]);

  const handsFreeRunKey = useMemo(() => {
    const keyRows = autoFixActionableRows
      .map((r) => `${r.symbol}:${r.action}:${r.targetValueEur ?? "na"}`)
      .join("|");
    return `${autopilotMode}:${fixKey}:${keyRows}`;
  }, [autoFixActionableRows, autopilotMode, fixKey]);

  useEffect(() => {
    if (!showFixGuide) return;
    if (!handsFreeFixNow) return;
    if (busy) return;
    if (autoFixActionableRows.length === 0) return;
    if (lastHandsFreeRunRef.current === handsFreeRunKey) return;

    lastHandsFreeRunRef.current = handsFreeRunKey;
    void autoApplyFixNow("handsfree");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFixGuide, handsFreeFixNow, busy, autoFixActionableRows.length, handsFreeRunKey]);

  const simpleGuide = useMemo<PortfolioSimpleGuide>(() => {
    if (!hasHoldings) {
      if (starterPack.length > 0 && setupHasExistingHoldings !== true) {
        return {
          step: 1,
          total: 3,
          title: pickByLang(lang, {
            en: "Step 1: no holdings? Syntrake prepares them",
            pt: "Passo 1: sem holdings? o Syntrake prepara",
            es: "Paso 1: sin holdings? Syntrake las prepara",
            fr: "Etape 1 : pas de positions ? Syntrake les prepare",
            de: "Schritt 1: Keine Holdings? Syntrake bereitet sie vor",
            it: "Passo 1: niente posizioni? Syntrake le prepara",
          }),
          detail: pickByLang(lang, {
            en: "Apply Starter Pack to begin with a plan-aligned allocation, then refine manually if needed.",
            pt: "Aplica o Starter Pack para comecar com uma alocacao alinhada ao plano e depois ajusta se precisares.",
            es: "Aplica Starter Pack para empezar con una asignacion alineada al plan y luego ajusta si hace falta.",
            fr: "Appliquez le Starter Pack pour demarrer avec une allocation alignee au plan, puis ajustez si besoin.",
            de: "Starter Pack anwenden, um mit einer plan-konformen Allokation zu starten; danach optional anpassen.",
            it: "Applica lo Starter Pack per iniziare con un allocazione allineata al piano, poi regola se necessario.",
          }),
          actionLabel: pickByLang(lang, {
            en: "Prepare holdings for me",
            pt: "Preparar holdings por mim",
            es: "Preparar holdings por mi",
            fr: "Preparer mes positions",
            de: "Holdings fuer mich vorbereiten",
            it: "Prepara posizioni per me",
          }),
          action: "prepare_starter",
          tone: "good",
        };
      }
      return {
        step: 1,
        total: 3,
        title: pickByLang(lang, {
          en: "Step 1: add your first holdings",
          pt: "Passo 1: adiciona as primeiras holdings",
          es: "Paso 1: agrega tus primeras holdings",
          fr: "Etape 1 : ajoutez vos premieres positions",
          de: "Schritt 1: Fuege die ersten Positionen hinzu",
          it: "Passo 1: aggiungi le prime posizioni",
        }),
        detail: pickByLang(lang, {
          en: "Add one holding or import progressively. Confidence depends on covered capital, not the number of assets.",
          pt: "Adiciona pelo menos 3 simbolos para gerar analise fiavel.",
          es: "Agrega al menos 3 simbolos para un analisis fiable.",
          fr: "Ajoutez au moins 3 symboles pour une analyse fiable.",
          de: "Fuege mindestens 3 Symbole hinzu fuer verlaessliche Analyse.",
          it: "Aggiungi almeno 3 simboli per un analisi affidabile.",
        }),
        actionLabel: pickByLang(lang, {
          en: "Add holdings now",
          pt: "Adicionar holdings",
          es: "Agregar holdings",
          fr: "Ajouter des positions",
          de: "Positionen hinzufuegen",
          it: "Aggiungi posizioni",
        }),
        action: "add_first",
        tone: "warn",
      };
    }

    if (missingForPricing.length > 0) {
      return {
        step: 2,
        total: 3,
        title: pickByLang(lang, {
          en: "Step 2: fill missing values",
          pt: "Passo 2: preencher valores em falta",
          es: "Paso 2: completar valores faltantes",
          fr: "Etape 2 : remplir les valeurs manquantes",
          de: "Schritt 2: Fehlende Werte eintragen",
          it: "Passo 2: completa i valori mancanti",
        }),
        detail: pickByLang(lang, {
          en: "Some rows still need Qty or Value EUR. Fill them and save each row.",
          pt: "Algumas linhas precisam de Qty ou Valor EUR. Preenche e guarda.",
          es: "Algunas filas necesitan Qty o Valor EUR. Completa y guarda.",
          fr: "Certaines lignes demandent Qty ou Valeur EUR. Remplissez et enregistrez.",
          de: "Einige Zeilen brauchen Qty oder EUR-Wert. Ausfuellen und speichern.",
          it: "Alcune righe richiedono Qty o Valore EUR. Compila e salva.",
        }),
        actionLabel: pickByLang(lang, {
          en: "Open rows to fix",
          pt: "Abrir linhas para corrigir",
          es: "Abrir filas para corregir",
          fr: "Ouvrir les lignes a corriger",
          de: "Zeilen zum Korrigieren oeffnen",
          it: "Apri righe da correggere",
        }),
        action: "fix_rows",
        tone: "bad",
      };
    }

    if ((coveragePct ?? 0) < 80) {
      return {
        step: 3,
        total: 3,
        title: pickByLang(lang, {
          en: "Step 3: improve data quality",
          pt: "Passo 3: melhorar qualidade dos dados",
          es: "Paso 3: mejorar calidad de datos",
          fr: "Etape 3 : ameliorer la qualite des donnees",
          de: "Schritt 3: Datenqualitaet verbessern",
          it: "Passo 3: migliora la qualita dei dati",
        }),
        detail: pickByLang(lang, {
          en: "Coverage is still low. Re-check quality before following directives.",
          pt: "A cobertura ainda esta baixa. Revalida antes de seguir diretivas.",
          es: "La cobertura aun es baja. Vuelve a validar antes de actuar.",
          fr: "La couverture est encore faible. Verifiez avant d agir.",
          de: "Die Abdeckung ist noch niedrig. Vor Aktionen neu pruefen.",
          it: "La copertura e ancora bassa. Ricontrolla prima di agire.",
        }),
        actionLabel: pickByLang(lang, {
          en: "Re-check quality",
          pt: "Revalidar qualidade",
          es: "Revalidar calidad",
          fr: "Reverifier la qualite",
          de: "Qualitaet neu pruefen",
          it: "Ricontrolla qualita",
        }),
        action: "recheck",
        tone: "warn",
      };
    }

    return {
      step: 3,
      total: 3,
      title: pickByLang(lang, {
        en: "Portfolio is ready",
        pt: "Portfolio pronto",
        es: "Portfolio listo",
        fr: "Portfolio pret",
        de: "Portfolio ist bereit",
        it: "Portfolio pronto",
      }),
      detail: pickByLang(lang, {
        en: "Data looks healthy. Go back to Daily and follow one clear action.",
        pt: "Dados estao saudaveis. Volta ao Daily e segue uma acao clara.",
        es: "Datos saludables. Vuelve a Daily y sigue una accion clara.",
        fr: "Les donnees sont saines. Retournez a Daily et suivez une action claire.",
        de: "Daten sind gesund. Zurueck zu Daily und eine klare Aktion ausfuehren.",
        it: "Dati in buono stato. Torna a Daily e segui un azione chiara.",
      }),
      actionLabel: pickByLang(lang, {
        en: "Back to Daily",
        pt: "Voltar ao Daily",
        es: "Volver a Daily",
        fr: "Retour a Daily",
        de: "Zurueck zu Daily",
        it: "Torna a Daily",
      }),
      action: "daily",
      tone: "good",
    };
  }, [hasHoldings, starterPack.length, setupHasExistingHoldings, missingForPricing.length, coveragePct, lang]);

  async function runSimpleGuideAction() {
    if (simpleGuide.action === "add_first") {
      focusAddHoldingInput();
      return;
    }
    if (simpleGuide.action === "prepare_starter") {
      await applyStarterPack();
      return;
    }
    if (simpleGuide.action === "fix_rows") {
      scrollToFix();
      return;
    }
    if (simpleGuide.action === "recheck") {
      await loadBundle();
      setToast("Quality re-checked");
      return;
    }
    goDaily();
  }

  async function applyStarterPack() {
    if (busy || applyingStarter) return;
    if (!starterPack.length) {
      await loadBundle();
      setToast("Starter pack not ready yet. Refresh and try again.");
      return;
    }

    setApplyingStarter(true);
    setBusy(true);
    try {
      const budgetFromPack = starterPack.reduce((sum: number, item: any) => {
        const value = Number(item?.valueEur ?? item?.value_eur ?? 0);
        return sum + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0);
      const requestedBudget =
        Number.isFinite(Number(starterPackMeta?.budgetEur)) && Number(starterPackMeta?.budgetEur) > 0
          ? Number(starterPackMeta.budgetEur)
          : budgetFromPack > 0
            ? budgetFromPack
            : readStarterBudget(autopilotMode);
      const initialDeposit = String(clampStarterBudget(Number(requestedBudget || 0)));

      const r = await fetchJSON("/api/investing/paper/accounts", {
        method: "POST",
        body: JSON.stringify({
          action: "open_paper_account",
          portfolioId: "primary",
          environment: "paper",
          currency: "EUR",
          initialDeposit,
          clientRequestId: `portfolio-starter-paper-${new Date().toISOString().slice(0, 10)}-${initialDeposit}`,
        }),
      });
      if (!r.ok) {
        setToast(String(r.data?.error || "Failed to prepare persistent Paper account."));
        return;
      }

      writeStarterWarmup(autopilotMode);
      setToast(
        starterUsesLiveQuotes
          ? "Persistent Paper funded. Review the canonical proposal in Daily..."
          : "Persistent Paper funded with provisional starter budget. Review the canonical proposal in Daily..."
      );
      await loadServerItems();
      await loadBundle();
      onboardingDailyRedirectedRef.current = true;
      setTimeout(() => goDaily("starter_pack"), 500);
    } finally {
      setApplyingStarter(false);
      setBusy(false);
    }
  }

  async function clearForStarterFreshStart() {
    if (busy || clearingStarterFreshStart) return;
    setClearingStarterFreshStart(true);
    setBusy(true);
    try {
      await loadServerItems();
      await loadBundle();
      setToast("Investing now uses canonical Paper positions. Legacy portfolio clearing is disabled.");
    } finally {
      setClearingStarterFreshStart(false);
      setBusy(false);
    }
  }

  async function applyFixRows(args: {
    rows: FixNowExecutionRow[];
    source: "manual" | "handsfree";
    leakKey: string;
    itemSnapshot: HoldingRow[];
  }) {
    void args;
    if (!args.rows.length) {
      return { ok: false as const, count: 0, error: "Nothing to apply." };
    }
    return {
      ok: false as const,
      count: 0,
      error: "FixNow legacy writes are disabled for Investing. Use Daily to generate a canonical Paper proposal.",
    };
  }

  async function autoApplyFixNow(source: "manual" | "handsfree" = "manual") {
    if (busy) return { applied: false, resolved: false, remainingLeakKey: null as string | null };
    if (!autoFixActionableRows.length) {
      if (source === "manual") setToast("No automatic actions available.");
      return { applied: false, resolved: false, remainingLeakKey: null as string | null };
    }

    setBusy(true);
    try {
      const applied = await applyFixRows({
        rows: autoFixActionableRows,
        source,
        leakKey: fixKey || "general",
        itemSnapshot: items,
      });
      if (!applied.ok) {
        if (source === "manual") setToast(applied.error);
        return { applied: false, resolved: false, remainingLeakKey: fixKey || null };
      }

      const count = applied.count;
      await loadServerItems();
      await loadBundle();

      let resolved = true;
      let remainingLeakKey: string | null = null;
      if (fixKey) {
        const check = await recheckFixResolution(fixKey, source === "handsfree" ? 2 : 4);
        resolved = check.resolved;
        remainingLeakKey = check.currentLeakKey;
      }

      if (resolved) {
        setDismissFixGuide(true);
        clearFixQueryFromUrl();
      }

      if (source === "handsfree") {
        setToast(
          resolved
            ? `Hands-free fixed ${count} holdings.`
            : `Hands-free applied ${count} fixes. Remaining leak: ${remainingLeakKey || fixKey || "unknown"}.`
        );
      } else {
        setToast(
          resolved
            ? `Auto-fix applied to ${count} holdings. Leak cleared.`
            : `Auto-fix applied to ${count} holdings. Remaining leak: ${remainingLeakKey || fixKey || "unknown"}.`
        );
      }

      return { applied: true, resolved, remainingLeakKey };
    } finally {
      setBusy(false);
    }
  }

  async function autoFixAllAndReturnDaily(options?: { alwaysReturnToDaily?: boolean }) {
    const alwaysReturnToDaily = options?.alwaysReturnToDaily !== false;
    if (busy) {
      setToast("Fix is already running...");
      return;
    }

    setBusy(true);
    try {
      await loadServerItems();
      await loadBundle();
      setToast("FixAll legacy writes are disabled for Investing. Use Daily to generate a canonical Paper proposal.");
      if (alwaysReturnToDaily) {
        setTimeout(() => goDaily(), 350);
      }
    } catch (e: any) {
      const msg = String(e?.message || "FixAll failed.");
      setToast(msg);
    } finally {
      setBusy(false);
    }
  }

  function goDaily(source?: "starter_pack") {
    const sourceParam = source ? `&source=${encodeURIComponent(source)}` : "";
    window.location.href = `/app?tab=daily&mode=${autopilotMode}&fresh=${Date.now()}${sourceParam}`;
  }

  function focusAddHoldingInput() {
    const input = document.querySelector<HTMLInputElement>('input[placeholder^="Search"]');
    input?.focus();
  }

  function scrollToFix() {
    const el = document.getElementById("sc-fix-pricing");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function addOne(hit?: MarketHit) {
    if (busy) return;

    const symbol = normSymbol(hit?.symbol || normalizedSymbol);
    if (!symbol) {
      setToast("Missing symbol.");
      return;
    }

    void hit;
    void qtyNumber;
    setToast(`${symbol} was not added. Investing portfolio now comes from canonical Paper positions.`);
  }

  async function addFromPaste() {
    if (busy) return;

    const symbols = parseSymbolsFromText(paste);
    if (symbols.length === 0) {
      setToast("Paste some symbols first.");
      return;
    }

    void symbols;
    setToast("Paste import is disabled for Investing. Use canonical Paper proposals from Daily.");
  }

  async function remove(id: string, symbol?: string) {
    if (busy) return;
    void id;
    const label = symbol ? ` ${String(symbol).toUpperCase()}` : "";
    setToast(`Cannot remove${label} here. Canonical Paper positions change through orders, fills, cash movements and reconciliation.`);
  }

  async function saveRow(symbol: string, name?: string | null) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return;
    if (rowSaving[sym]) return;

    const qv = draftQty[sym];
    const vv = draftVal[sym];

    const qtyN = safeNum(qv, null);
    // value can be explicitly cleared by empty string -> null
    const valueN = vv === "" ? null : safeNum(vv, null);

    setRowSaving((p) => ({ ...(p || {}), [sym]: true }));
    try {
      void name;
      void qtyN;
      void valueN;
      setToast(`Cannot save ${sym} here. Investing uses canonical Paper positions, not browser-edited holdings.`);
      await loadServerItems();
      await loadBundle();
    } finally {
      setRowSaving((p) => ({ ...(p || {}), [sym]: false }));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) {
      if (e.key === "Enter" && normalizedSymbol) {
        e.preventDefault();
        addOne(undefined);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((x) => Math.min(hits.length - 1, x + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((x) => Math.max(0, x - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = hits[activeIdx];
      addOne(pick);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
  }

  const portfolioControlLabel = !hasHoldings
    ? showStarterApplyTopCard || hasStarterCandidate
      ? "Starter allocation"
      : "Build first holdings"
    : showFixGuide
      ? "Leak repair"
      : (coveragePct ?? 0) < 80
        ? "Improve pricing quality"
        : "Ready for Daily";

  const totalCapitalEur = useMemo(() => {
    const liveTotal = safeNum((portfolioValuation as any)?.totalEur, null);
    if (liveTotal != null && liveTotal > 0) return liveTotal;
    return items.reduce((sum, it) => sum + Math.max(0, safeNum(it?.valueEur ?? it?.value_eur, 0) ?? 0), 0);
  }, [items, portfolioValuation]);

  const deployedCapitalPct = totalCapitalEur > 0 ? Math.max(0, Math.min(100, ((totalCapitalEur - portfolioCash) / totalCapitalEur) * 100)) : 0;
  const cashBufferPct = totalCapitalEur > 0 ? Math.max(0, Math.min(100, (portfolioCash / totalCapitalEur) * 100)) : 0;
  const topLeak = diagnostics?.riskLeaks?.[0] ?? null;
  const topLeakSeverity = String(topLeak?.severity || "").toLowerCase().trim();
  const riskTemperatureLabel = !hasHoldings
    ? "Pending"
    : showFixGuide || topLeakSeverity === "high"
      ? "Elevated"
      : topLeakSeverity === "med"
        ? "Balanced"
        : "Stable";
  const overviewStatusChips = [
    {
      label: "Plan alignment",
      value: capitalStatus?.planAlignment ? String(capitalStatus.planAlignment).replace(/_/g, " ") : hasHoldings ? "Stable" : "Pending",
      tone: hasHoldings ? "good" : "warn",
    },
    {
      label: "Data coverage",
      value: typeof coveragePct === "number" ? `${coveragePct}%` : "Pending",
      tone: typeof coveragePct === "number" ? (coveragePct >= 90 ? "good" : coveragePct >= 70 ? "warn" : "bad") : "warn",
    },
    {
      label: "Risk temperature",
      value: riskTemperatureLabel,
      tone: showFixGuide || topLeakSeverity === "high" ? "warn" : hasHoldings ? "good" : "warn",
    },
  ] as const;

  const riskCoverageRows = [
    {
      label: "Diversification",
      value: items.length >= 6 ? "Balanced" : items.length >= 3 ? "Moderate" : "Narrow",
    },
    {
      label: "Liquidity coverage",
      value: typeof coveragePct === "number" ? (coveragePct >= 90 ? "High" : coveragePct >= 70 ? "Moderate" : "Low") : "Pending",
    },
    {
      label: "Pricing health",
      value: typeof priceAgeSeconds === "number" ? (priceAgeSeconds < 60 * 60 ? "Stable" : priceAgeSeconds < 6 * 60 * 60 ? "Aging" : "Stale") : "Pending",
    },
  ];
  const portfolioDataState = !hasHoldings
    ? "empty"
    : coveragePct == null
      ? "unavailable"
      : typeof priceAgeSeconds === "number" && priceAgeSeconds >= 6 * 60 * 60
        ? "stale"
        : coveragePct < 90 || missingForPricing.length > 0
          ? "partial"
          : "fresh";

  return (
    <div className="w-full max-w-[1280px] mx-auto px-[26px] py-[26px]">
      {/* Header */}
      <div className="mb-[18px] flex items-end justify-between gap-[18px] max-[980px]:flex-col max-[980px]:items-start">
        <div className="space-y-2">
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#93a4bf]">Composition and mandate alignment</div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2 text-[30px] font-black leading-none tracking-[-0.06em] text-[#e7effc]">Portfolio</h1>
            <Badge tone={hasHoldings ? "good" : "warn"}>{hasHoldings ? `Holdings: ${items.length}` : "Holdings: none"}</Badge>
            <Pill>Mode: {autopilotMode}</Pill>
            {!isBeginnerUX && typeof coveragePct === "number" ? <Pill>Coverage: {coveragePct}%</Pill> : null}
            {!isBeginnerUX && typeof priceAgeSeconds === "number" ? <Pill>Price age: {fmtAge(priceAgeSeconds)}</Pill> : null}
          </div>
          <div className="text-sm text-[#95a6c2]">
            See how every position affects concentration, risk and progress toward your objective.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (showFixGuide && autoFixActionableRows.length > 0) {
                void autoFixAllAndReturnDaily({ alwaysReturnToDaily: true });
                return;
              }
              goDaily();
            }}
            className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
          >
            {busy && showFixGuide && autoFixActionableRows.length > 0
              ? "Applying fixes..."
              : showFixGuide && autoFixActionableRows.length > 0
                ? "Fix all + back to Daily"
                : "Back to Daily"}
          </button>
          <button
            onClick={async () => {
              await loadServerItems();
              await loadBundle();
            }}
            disabled={loading || busy}
            className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white disabled:opacity-50"
          >
            {loading
              ? pickByLang(lang, {
                  en: "Loading...",
                  pt: "A carregar...",
                  es: "Cargando...",
                  fr: "Chargement...",
                  de: "Laden...",
                  it: "Caricamento...",
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
      </div>

      {/* Toast */}
      {toast ? (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {toast}
        </div>
      ) : null}

      <div role={portfolioDataState === "fresh" ? "status" : "alert"} className={clsx("mb-5 rounded-[16px] border px-4 py-3 text-sm", portfolioDataState === "fresh" ? "border-[#1f4a3b] bg-[#102d28] text-[#9de9cb]" : portfolioDataState === "empty" ? "border-[#31415f] bg-[#0d182d] text-[#c4d2e5]" : "border-[#4a3514] bg-[#362813] text-[#f4cf91]")}>
        <div className="font-bold capitalize">Data state: {portfolioDataState}</div>
        <div className="mt-1">
          {portfolioDataState === "fresh" ? `Pricing coverage is ${coveragePct}% and can support portfolio diagnostics.` : portfolioDataState === "empty" ? "No positions yet. Add one asset, an ETF, or import progressively; a single holding is valid." : portfolioDataState === "stale" ? `Prices are ${fmtAge(priceAgeSeconds!)} old. Actionable recommendations and broker-ready output are blocked until refresh.` : portfolioDataState === "partial" ? `Coverage is ${coveragePct}%. Diagnostics are indicative and cannot produce a definitive recommendation.` : "Pricing status is unavailable. The last confirmed portfolio is preserved without generating a new recommendation."}
        </div>
      </div>

      <div className="space-y-5">
        <div className={clsx("grid gap-5", hasHoldings && !isBeginnerUX ? "xl:grid-cols-[1.45fr_.95fr]" : "")}>
          <div className="rounded-[24px] border border-[#23314c] bg-[radial-gradient(circle_at_top_left,_rgba(88,160,255,.22),_transparent_38%),linear-gradient(180deg,#131f37_0%,#0d1627_100%)] px-6 py-6 shadow-[0_20px_55px_rgba(0,0,0,.34)]">
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-[#31415f] bg-[#0d182d] px-3 py-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#9eb1cb]">
                  Portfolio overview
                </span>
                <Badge tone={simpleGuide.tone}>
                  {pickByLang(lang, { en: "Step", pt: "Passo", es: "Paso", fr: "Etape", de: "Schritt", it: "Passo" })} {simpleGuide.step}/{simpleGuide.total}
                </Badge>
                <Chip tone={!hasHoldings ? "warn" : showFixGuide ? "bad" : (coveragePct ?? 0) < 80 ? "warn" : "good"}>{portfolioControlLabel}</Chip>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
                <div className="space-y-4">
                  <div>
                    <div className="text-[34px] font-black leading-[0.96] tracking-[-0.06em] text-[#eef5ff]">
                      {hasHoldings && !showFixGuide && (coveragePct ?? 0) >= 80 ? "Healthy Allocation" : simpleGuide.title}
                    </div>
                    <div className="mt-2 max-w-[760px] text-sm leading-6 text-[#9cb1cc]">
                      {hasHoldings && !showFixGuide && (coveragePct ?? 0) >= 80
                        ? "Portfolio aligned with current plan assumptions. No structural risk detected."
                        : simpleGuide.detail}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-[18px] border border-[#273654] bg-[#101a2d]/88 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[.14em] text-[#7d93b2]">Capital</div>
                      <div className="mt-2 text-[28px] font-black tracking-[-0.05em] text-[#eef5ff]">{fmtEUR(totalCapitalEur)}</div>
                    </div>
                    <div className="rounded-[18px] border border-[#273654] bg-[#101a2d]/88 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[.14em] text-[#7d93b2]">Exposure</div>
                      <div className="mt-2 text-[28px] font-black tracking-[-0.05em] text-[#eef5ff]">{Math.round(deployedCapitalPct)}%</div>
                    </div>
                    <div className="rounded-[18px] border border-[#273654] bg-[#101a2d]/88 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[.14em] text-[#7d93b2]">Cash Buffer</div>
                      <div className="mt-2 text-[28px] font-black tracking-[-0.05em] text-[#eef5ff]">{Math.round(cashBufferPct)}%</div>
                    </div>
                    <div className="rounded-[18px] border border-[#273654] bg-[#101a2d]/88 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[.14em] text-[#7d93b2]">Assets</div>
                      <div className="mt-2 text-[28px] font-black tracking-[-0.05em] text-[#eef5ff]">{items.length}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[20px] border border-[#273654] bg-[#101a2d]/86 p-4">
                  <div className="grid gap-3">
                    {overviewStatusChips.map((status) => (
                      <div key={status.label} className="flex items-center justify-between rounded-2xl border border-[#273654] bg-[#0d182d]/88 px-4 py-3">
                        <span className="text-sm font-medium text-[#d7e4f8]">{status.label}</span>
                        <Badge tone={status.tone as any}>{status.value}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runSimpleGuideAction}
                  className={clsx(
                    "rounded-xl px-4 py-2 text-sm font-semibold text-white",
                    simpleGuide.tone === "bad"
                      ? "bg-rose-600 hover:bg-rose-700"
                      : simpleGuide.tone === "good"
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-zinc-900 hover:bg-black"
                  )}
                >
                  {simpleGuide.actionLabel}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await loadServerItems();
                    await loadBundle();
                  }}
                  disabled={loading || busy}
                  className="rounded-xl border border-[#31415f] bg-[#0d182d] px-4 py-2 text-sm font-semibold text-[#eef5ff] disabled:opacity-50"
                >
                  Sync portfolio
                </button>
                <button
                  type="button"
                  onClick={scrollToFix}
                  className="rounded-xl border border-[#31415f] bg-[#0d182d] px-4 py-2 text-sm font-semibold text-[#eef5ff]"
                >
                  Repair pricing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (showFixGuide && autoFixActionableRows.length > 0) {
                      void autoFixAllAndReturnDaily({ alwaysReturnToDaily: true });
                      return;
                    }
                    goDaily();
                  }}
                  className="rounded-xl border border-[#31415f] bg-[#0d182d] px-4 py-2 text-sm font-semibold text-[#eef5ff]"
                >
                  {showFixGuide && autoFixActionableRows.length > 0 ? "Fix all + back to Daily" : "Back to Daily"}
                </button>
              </div>
            </div>
          </div>

          {!isBeginnerUX ? (
            <div className="space-y-5">
              <Card
                title="Capital Allocation"
                subtitle="Current deployed capital remains inside plan constraints."
                right={<div className="text-right"><div className="text-[10px] uppercase tracking-[.12em] text-[#7f95b3]">Deployed</div><div className="text-[28px] font-black tracking-[-0.05em] text-[#eef5ff]">{Math.round(deployedCapitalPct)}%</div></div>}
              >
                <div className="space-y-4">
                  <MiniExposureBar value={deployedCapitalPct} />
                  <div className="flex items-center justify-between text-sm text-[#dbe7f8]">
                    <span>Capital allocation remains within portfolio constraints.</span>
                    <span className="font-semibold">{fmtEUR(totalCapitalEur - portfolioCash)} deployed</span>
                  </div>
                </div>
              </Card>

              <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
                <Card
                  title="Risk & Coverage"
                  subtitle="Readiness and pricing integrity for the active portfolio."
                  right={<Badge tone={dataQualityTone as any}>{dataQualityTone === "good" ? "Stable" : dataQualityTone === "warn" ? "Balanced" : "Needs repair"}</Badge>}
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Chip tone={showFixGuide || topLeakSeverity === "high" ? "bad" : topLeakSeverity === "med" ? "warn" : "good"}>{riskTemperatureLabel}</Chip>
                      <Chip tone={typeof coveragePct === "number" && coveragePct >= 90 ? "good" : "warn"}>
                        Coverage {typeof coveragePct === "number" ? `${coveragePct}%` : "-"}
                      </Chip>
                      <Chip tone={typeof priceAgeSeconds === "number" && priceAgeSeconds < 60 * 60 ? "good" : "warn"}>
                        {typeof priceAgeSeconds === "number" ? `Price age ${fmtAge(priceAgeSeconds)}` : "Price age -"}
                      </Chip>
                    </div>
                    <div className="space-y-3 rounded-[18px] border border-[#23314c] bg-[#0d182d]/90 px-4 py-4">
                      {riskCoverageRows.map((row) => (
                        <div key={row.label} className="flex items-center justify-between gap-4 border-b border-[#20304c] pb-2 last:border-b-0 last:pb-0">
                          <span className="text-sm text-[#dbe7f8]">{row.label}</span>
                          <span className="text-sm font-semibold text-[#eef5ff]">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card
                  title="Portfolio Integrity"
                  subtitle="Operational integrity checks before Daily execution."
                  right={<Badge tone={hasHoldings && (coveragePct ?? 0) >= 80 && missingForPricing.length === 0 ? "good" : "warn"}>{hasHoldings ? "Live checks" : "Setup required"}</Badge>}
                >
                  <div className="space-y-4">
                    <div className="space-y-2 text-sm text-[#dbe7f8]">
                      <div className="flex items-center justify-between gap-4"><span>Pricing coverage</span><span className="font-semibold">{typeof coveragePct === "number" ? `${coveragePct}%` : "-"}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Position sync</span><span className="font-semibold">{missingForPricing.length === 0 ? "Healthy" : "Needs input"}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Data integrity</span><span className="font-semibold">{missingSymbols.length === 0 ? "Verified" : "Review symbols"}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Plan alignment</span><span className="font-semibold">{capitalStatus?.planAlignment ? String(capitalStatus.planAlignment).replace(/_/g, " ") : "Unavailable"}</span></div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!hasHoldings && hasStarterCandidate ? (
                        <button
                          onClick={() => void applyStarterPack()}
                          disabled={!hasStarterCandidate || busy || applyingStarter}
                          className="rounded-xl bg-[#3b63ff] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {applyingStarter ? "Applying starter..." : "Apply Starter Allocation"}
                        </button>
                      ) : null}
                      {(missingForPricing.length > 0 || (typeof coveragePct === "number" && coveragePct < 80)) ? (
                        <button
                          onClick={async () => {
                            await loadBundle();
                            setToast("Refreshed quality OK");
                          }}
                          className="rounded-xl border border-[#31415f] bg-[#0d182d] px-4 py-2 text-sm font-semibold text-[#eef5ff]"
                        >
                          Re-check quality
                        </button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          ) : null}
        </div>

        {showFixGuide ? (
          <Card
            title={fixGuide.title}
            subtitle={`${fixGuide.subtitle} Source: ${fixFrom}.`}
            right={<Badge tone={fixGuideDone ? "good" : "warn"}>{fixGuideDone ? "Resolved" : "Fix in progress"}</Badge>}
          >
            <div className="space-y-4">
              <div className="text-xs text-zinc-600">
                Target coverage: <span className="font-semibold text-zinc-900">{fixGuide.targetCoverage}%</span> | Current:{" "}
                <span className="font-semibold text-zinc-900">{typeof coveragePct === "number" ? `${coveragePct}%` : "-"}</span>
              </div>

              {isProUX ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">Hands-Free FixNow</div>
                      <div className="text-xs text-zinc-600">
                        When enabled, Syntrake auto-applies fix actions as soon as a leak appears.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHandsFreeFixNow((v) => !v)}
                      className={clsx(
                        "rounded-xl px-3 py-1.5 text-xs font-semibold",
                        handsFreeFixNow ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-zinc-200 bg-white text-zinc-900"
                      )}
                    >
                      {handsFreeFixNow ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {fixGuide.steps.map((s, i) => (
                  <div key={`${s.title}-${i}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                      Step {i + 1}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-zinc-900">{s.title}</div>
                    <div className="mt-1 text-xs text-zinc-700">{s.detail}</div>
                    <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                      {s.visual}
                    </div>
                  </div>
                ))}
              </div>

              {!leakAutoFixable ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">This leak requires manual workflow</div>
                  <div className="mt-1 text-xs text-amber-900/90">
                    Auto-fix is not available for <span className="font-semibold">{fixKey || "this leak"}</span>. Use the dedicated flow below.
                  </div>
                </div>
              ) : null}

              {fixExecutionRows.length > 0 ? (
                !isBeginnerUX ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white">
                    <div className="border-b border-zinc-100 px-4 py-3">
                      <div className="text-sm font-semibold text-zinc-900">FixNow execution table</div>
                      <div className="text-xs text-zinc-600">
                        Execute high-priority rows first, then re-check. This is the exact holding-level checklist.
                      </div>
                    </div>
                    <div className="table-scroll overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-zinc-50 text-zinc-600">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Priority</th>
                            <th className="px-3 py-2 text-left font-semibold">Symbol</th>
                            <th className="px-3 py-2 text-left font-semibold">Action</th>
                            <th className="px-3 py-2 text-right font-semibold">Current</th>
                            <th className="px-3 py-2 text-right font-semibold">Target</th>
                            <th className="px-3 py-2 text-right font-semibold">Delta</th>
                            <th className="px-3 py-2 text-left font-semibold">Qty hint</th>
                            <th className="px-3 py-2 text-left font-semibold">Why</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fixExecutionRows.map((row, idx) => {
                            const tone =
                              row.action === "SELL"
                                ? "bad"
                                : row.action === "BUY"
                                  ? "good"
                                  : row.action === "FIX_DATA"
                                    ? "warn"
                                    : "neutral";
                            const pr =
                              row.priority === "high" ? "HIGH" : row.priority === "med" ? "MED" : "LOW";
                            return (
                              <tr key={`${row.symbol}-${row.action}-${idx}`} className="border-t border-zinc-100">
                                <td className="px-3 py-2">
                                  <Badge tone={row.priority === "high" ? "bad" : row.priority === "med" ? "warn" : "neutral"}>{pr}</Badge>
                                </td>
                                <td className="px-3 py-2 font-semibold text-zinc-900">{row.symbol}</td>
                                <td className="px-3 py-2">
                                  <Badge tone={tone as any}>{fixNowActionLabel(row.action)}</Badge>
                                </td>
                                <td className="px-3 py-2 text-right text-zinc-900">{fmtEUR(row.currentValueEur)}</td>
                                <td className="px-3 py-2 text-right text-zinc-900">{fmtEUR(row.targetValueEur)}</td>
                                <td className={clsx("px-3 py-2 text-right font-semibold", (row.deltaValueEur ?? 0) < 0 ? "text-rose-700" : "text-emerald-700")}>
                                  {row.deltaValueEur == null ? "-" : fmtEUR(row.deltaValueEur)}
                                </td>
                                <td className="px-3 py-2 text-zinc-700">{row.qtyHint || "-"}</td>
                                <td className="px-3 py-2 text-zinc-700">{row.reason}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-sm font-semibold text-zinc-900">Fix checklist</div>
                    <div className="mt-1 text-xs text-zinc-600">Follow these rows in order.</div>
                    <div className="mt-3 space-y-2">
                      {fixExecutionRows.slice(0, 6).map((row, idx) => (
                        <div key={`${row.symbol}-${row.action}-${idx}`} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800">
                          <span className="font-semibold text-zinc-900">{row.symbol}</span> | {fixNowActionLabel(row.action)} | target {fmtEUR(row.targetValueEur)} | {row.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ) : null}

              <div className="flex flex-wrap gap-2">
                {leakAutoFixable ? (
                  <button
                    onClick={() => void autoApplyFixNow("manual")}
                    disabled={busy || autoFixActionableRows.length === 0}
                    className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy ? "Applying..." : `Auto-fix now (${autoFixActionableRows.length})`}
                  </button>
                ) : null}
                {leakAutoFixable && !isBeginnerUX ? (
                  <button
                    type="button"
                    onClick={() => void autoFixAllAndReturnDaily({ alwaysReturnToDaily: true })}
                    disabled={busy || autoFixActionableRows.length === 0}
                    className="rounded-xl px-4 py-2 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busy ? "Applying..." : "Fix all + back to Daily"}
                  </button>
                ) : null}
                {leakAutoFixable ? (
                  <button
                    onClick={scrollToFix}
                    className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white"
                  >
                    Open fix area
                  </button>
                ) : manualLeakCta ? (
                  <a
                    href={manualLeakCta.href}
                    className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white"
                  >
                    {manualLeakCta.label}
                  </a>
                ) : null}
                <button
                  onClick={async () => {
                    await loadBundle();
                    setToast("Fix guide re-checked OK");
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                >
                  Re-check now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDismissFixGuide(true);
                    clearFixQueryFromUrl();
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                >
                  Hide guide
                </button>
              </div>
            </div>
          </Card>
        ) : null}

        <div className={showStarterWhyPanel ? "grid grid-cols-1 xl:grid-cols-2 gap-5 items-start" : "space-y-5"}>
        {showStarterApplyTopCard ? (
          <div className="xl:order-1">
            <Card title="Nao tenho holdings" subtitle="Starter pronto" right={<Badge tone={hasStarterCandidate ? "good" : "warn"}>{hasStarterCandidate ? "Ready" : "Preparing"}</Badge>}>
              <div className="space-y-3">
                <div className="text-sm text-zinc-700">Aplicar starter agora com base no setup.</div>
                <div className="text-xs text-zinc-600">
                  Budget:{" "}
                  <span className="font-semibold text-zinc-900">
                    {Number.isFinite(Number(starterPackMeta?.budgetEur)) ? fmtEUR(Number(starterPackMeta?.budgetEur)) : "n/a"}
                  </span>
                  {goalQuiz?.targetCapital ? ` | Objetivo: ${fmtEUR(Number(goalQuiz.targetCapital || 0))}` : ""}
                </div>
                {starterFallbackInfoTable}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void applyStarterPack()}
                    disabled={!hasStarterCandidate || busy || applyingStarter}
                    className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                  >
                    {applyingStarter ? "A preparar..." : "Aplicar starter agora"}
                  </button>
                  <button
                    onClick={() => goDaily()}
                    className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                  >
                    Back to Daily
                  </button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {showStarterWhyPanel ? (
          <div className="xl:order-2">
          <Card
            title="Why these starter holdings"
            subtitle="Selected from your setup profile and current market context."
            right={<Badge tone="good">Explainable starter</Badge>}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[11px] text-zinc-700">
                {goalQuiz?.goalType ? <Chip tone="neutral">Goal: {String(goalQuiz.goalType)}</Chip> : null}
                {goalQuiz?.riskProfile ? <Chip tone="neutral">Risk: {String(goalQuiz.riskProfile)}</Chip> : null}
                {goalQuiz?.targetCapital ? <Chip tone="neutral">Target: {fmtEUR(Number(goalQuiz.targetCapital || 0))}</Chip> : null}
              </div>
              <div className="space-y-2">
                {starterExplainRows.map((row, idx) => (
                  <div key={`starter-why-row-${row.symbol}-${idx}`} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-900">{row.symbol}</div>
                      <div className="text-xs font-semibold text-zinc-700">Target {fmtEUR(row.valueEur)}</div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-700">{row.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          </div>
        ) : null}

        <div className={showStarterWhyPanel ? "xl:order-3 xl:col-span-2" : ""}>
        {/* Add holding */}
        <Card title="Add holding" subtitle="Search or paste. Keep symbols clean.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div ref={boxRef} className="relative md:col-span-2">
              <input
                aria-label="Search asset symbol or name"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search: AAPL, MSFT, BTC, EURUSD..."
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
              {open && hits.length > 0 ? (
                <div className="absolute z-20 mt-2 w-full rounded-2xl border border-zinc-200 bg-white shadow-lg overflow-hidden">
                  {hits.slice(0, 8).map((h, idx) => (
                    <button
                      key={`${h.symbol}-${idx}`}
                      onClick={() => addOne(h)}
                      className={clsx(
                        "w-full text-left px-4 py-3 hover:bg-zinc-50",
                        idx === activeIdx ? "bg-zinc-50" : ""
                      )}
                    >
                      <div className="text-sm font-semibold text-zinc-900">{String(h.symbol || "").toUpperCase()}</div>
                      <div className="text-xs text-zinc-600">{h.name || "-"}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex gap-2">
              <input
                aria-label="Holding quantity"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Qty (optional)"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
              <button
                onClick={() => addOne(undefined)}
                disabled={busy || !normalizedSymbol}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <textarea
              aria-label="Paste asset symbols"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste list: AAPL MSFT TSLA BTC ETH..."
              className="md:col-span-3 min-h-[88px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
            <button
              onClick={addFromPaste}
              disabled={busy}
              className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900 disabled:opacity-50"
            >
              Add list
            </button>
          </div>
        </Card>
        </div>

        <div className={showStarterApplyTopCard ? "xl:order-4 xl:col-span-2" : showStarterWhyPanel ? "xl:order-1" : ""}>
        {/* Holdings list */}
        <div id="sc-fix-pricing" />
        <Card
          title={pickByLang(lang, {
            en: "Holdings",
            pt: "Holdings",
            es: "Holdings",
            fr: "Positions",
            de: "Holdings",
            it: "Posizioni",
          })}
          subtitle={
            !hasHoldings && showStarterWhyPanel
              ? showStarterApplyTopCard
                ? "If you already have holdings, import them here. Starter action is above."
                : "Choose one start action: import existing holdings or apply the starter pack."
              : pickByLang(lang, {
                  en: "Add qty OR EUR value to improve pricing coverage. (You can leave one blank.)",
                  pt: "Adiciona quantidade OU valor EUR para melhorar cobertura de pricing. (Podes deixar um em branco.)",
                  es: "Agrega cantidad O valor EUR para mejorar cobertura de precios. (Puedes dejar uno en blanco.)",
                  fr: "Ajoutez quantite OU valeur EUR pour ameliorer la couverture des prix. (Vous pouvez en laisser un vide.)",
                  de: "Menge ODER EUR-Wert hinzufugen, um die Preisabdeckung zu verbessern. (Eines kann leer bleiben.)",
                  it: "Aggiungi quantita O valore EUR per migliorare la copertura prezzi. (Puoi lasciarne uno vuoto.)",
                })
          }
          right={
            <Badge tone={hasHoldings ? "neutral" : "warn"}>
              {hasHoldings
                ? pickByLang(lang, {
                    en: "Editable",
                    pt: "Editavel",
                    es: "Editable",
                    fr: "Editable",
                    de: "Bearbeitbar",
                    it: "Modificabile",
                  })
                : pickByLang(lang, {
                    en: "Empty",
                    pt: "Vazio",
                    es: "Vacio",
                    fr: "Vide",
                    de: "Leer",
                    it: "Vuoto",
                  })}
            </Badge>
          }
        >
          {onboardingFreshStartConflict ? (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-sm font-semibold text-amber-900">Existing holdings detected from previous session.</div>
              <div className="mt-1 text-xs text-amber-900/90">
                You selected "No holdings" in setup. Start fresh to clear old rows, then apply Starter Pack.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => void clearForStarterFreshStart()}
                  disabled={busy || clearingStarterFreshStart}
                  className="rounded-xl px-3 py-2 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {clearingStarterFreshStart ? "Clearing..." : "Start fresh (clear old holdings)"}
                </button>
                <button
                  onClick={() => void applyStarterPack()}
                  disabled={!starterPack.length || busy || applyingStarter}
                  className="rounded-xl px-3 py-2 text-xs font-semibold border border-amber-300 bg-white text-amber-900 disabled:opacity-50"
                >
                  Apply starter now
                </button>
              </div>
            </div>
          ) : null}
          {loading ? (
            <div className="text-sm text-zinc-600">
              {pickByLang(lang, {
                en: "Loading holdings...",
                pt: "A carregar holdings...",
                es: "Cargando holdings...",
                fr: "Chargement des positions...",
                de: "Holdings werden geladen...",
                it: "Caricamento posizioni...",
              })}
            </div>
          ) : items.length === 0 ? (
            showStarterWhyPanel ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                  {showStarterApplyTopCard ? (
                    <>
                      Starter action is available above. Use this card only if you already have holdings.
                    </>
                  ) : (
                    <>
                      Use this card only to choose action. The detailed rationale is in the <span className="font-semibold">Why these starter holdings</span> card.
                    </>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-zinc-200 bg-white p-3">
                    <div className="text-sm font-semibold text-zinc-900">Ja tenho holdings</div>
                    <div className="mt-1 text-xs text-zinc-600">Inserir holdings reais para analise imediata.</div>
                    <button
                      onClick={() => {
                        focusAddHoldingInput();
                      }}
                      className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white"
                    >
                      Inserir holdings
                    </button>
                  </div>
                  {!showStarterApplyTopCard ? (
                    <div className={clsx("rounded-xl border p-3", hasStarterCandidate ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-white")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-zinc-900">Nao tenho holdings</div>
                        {hasStarterCandidate ? <Badge tone="good">Starter pronto</Badge> : <Badge tone="warn">A preparar</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-zinc-600">
                        Aplicar starter agora com base no setup.
                      </div>
                      <div className="mt-2 text-[11px] text-zinc-600">
                        Budget:{" "}
                        <span className="font-semibold text-zinc-900">
                          {Number.isFinite(Number(starterPackMeta?.budgetEur)) ? fmtEUR(Number(starterPackMeta?.budgetEur)) : "n/a"}
                        </span>
                        {goalQuiz?.targetCapital ? ` | Objetivo: ${fmtEUR(Number(goalQuiz.targetCapital || 0))}` : ""}
                      </div>
                      <button
                        onClick={() => void applyStarterPack()}
                        disabled={!hasStarterCandidate || busy || applyingStarter}
                        className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                      >
                        {applyingStarter ? "A preparar..." : "Aplicar starter agora"}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => goDaily()}
                    className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                  >
                    Back to Daily
                  </button>
                  {!hasStarterCandidate ? (
                    <button
                      onClick={async () => {
                        await loadBundle();
                        setToast("Starter pack refreshed.");
                      }}
                      className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                    >
                      Refresh starter
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-zinc-600">
                  {pickByLang(lang, {
                    en: "Portfolio flow: if you already have holdings, insert them. If not, Syntrake can prepare your first allocation.",
                    pt: "Fluxo do portfolio: se ja tens holdings, insere. Se nao tens, o Syntrake prepara a tua primeira alocacao.",
                    es: "Flujo del portfolio: si ya tienes holdings, insertalas. Si no, Syntrake prepara la primera asignacion.",
                    fr: "Flux du portfolio : si vous avez deja des positions, importez-les. Sinon, Syntrake prepare la premiere allocation.",
                    de: "Portfolio-Flow: Wenn du bereits Holdings hast, trage sie ein. Sonst bereitet Syntrake die erste Allokation vor.",
                    it: "Flusso portfolio: se hai gia posizioni, inseriscile. Se non le hai, Syntrake prepara la prima allocazione.",
                  })}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className={clsx("rounded-xl border p-3", setupHasExistingHoldings === true ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white")}>
                    <div className="text-sm font-semibold text-zinc-900">Ja tenho holdings</div>
                    <div className="mt-1 text-xs text-zinc-600">Insere manualmente para o Syntrake analisar o teu portfolio real.</div>
                    <button
                      onClick={() => {
                        focusAddHoldingInput();
                      }}
                      className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white"
                    >
                      Inserir holdings
                    </button>
                  </div>
                  <div className={clsx("rounded-xl border p-3", setupHasExistingHoldings === false ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-white")}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-900">Nao tenho holdings</div>
                      {hasStarterCandidate ? <Badge tone="good">Starter pronto</Badge> : <Badge tone="warn">A preparar</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      Syntrake prepara uma alocacao inicial alinhada ao modo, risco e objetivo definidos no setup.
                    </div>
                    {starterRationale.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {starterRationale.map((reason, idx) => (
                          <div key={`starter-why-${idx}`} className="text-[11px] text-zinc-700">
                            - {reason}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-zinc-600">
                      Budget gerado:{" "}
                      <span className="font-semibold text-zinc-900">
                        {Number.isFinite(Number(starterPackMeta?.budgetEur)) ? fmtEUR(Number(starterPackMeta?.budgetEur)) : "n/a"}
                      </span>
                      {goalQuiz?.targetCapital
                        ? ` | Objetivo: ${fmtEUR(Number(goalQuiz.targetCapital || 0))}`
                        : ""}
                    </div>
                    <div className="mt-2">{starterFallbackInfoTable}</div>
                    <button
                      onClick={() => void applyStarterPack()}
                      disabled={!hasStarterCandidate || busy || applyingStarter}
                      className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                    >
                      {applyingStarter ? "A preparar..." : "Syntrake prepara por mim"}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => goDaily()}
                    className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                  >
                    Back to Daily
                  </button>
                  {!hasStarterCandidate ? (
                    <button
                      onClick={async () => {
                        await loadBundle();
                        setToast("Starter pack refreshed.");
                      }}
                      className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                    >
                      Refresh starter
                    </button>
                  ) : null}
                </div>
              </div>
            )
          ) : (
            <div className="space-y-3">
              {items.map((it) => {
                const sym = String(it.symbol || "").toUpperCase();
                const name = it.name ?? null;
                const liveQuote = portfolioQuotes?.[sym] ?? null;
                const livePrice = safeNum((liveQuote as any)?.price, null);
                const liveQuoteTs = safeNum((liveQuote as any)?.ts, null);
                const liveQuoteAgeSec =
                  liveQuoteTs != null ? Math.max(0, Math.floor(Date.now() / 1000) - Number(liveQuoteTs)) : null;
                const liveQuoteSource = String((liveQuote as any)?.source || "").trim() || null;
                const qtyValue = safeNum(it.qty, null);
                const manualValue = safeNum(it.valueEur ?? it.value_eur, null);
                const entryPrice = qtyValue != null && qtyValue > 0 && manualValue != null ? manualValue / qtyValue : null;
                const liveValueEur =
                  livePrice != null && qtyValue != null ? Math.max(0, livePrice * qtyValue) : manualValue;
                const portfolioTotalEur = Math.max(0, safeNum((portfolioValuation as any)?.totalEur, 0) || 0);
                const allocationPct =
                  portfolioTotalEur > 0 && liveValueEur != null ? Math.max(0, Math.min(100, (liveValueEur / portfolioTotalEur) * 100)) : 0;
                const weightLabel =
                  allocationPct >= 15 ? "Core weight" : allocationPct >= 8 ? "Balanced weight" : "Starter weight";
                const weightTone = allocationPct >= 15 ? "good" : allocationPct >= 8 ? "neutral" : "warn";
                const quoteTone =
                  livePrice == null ? "warn" : liveQuoteAgeSec != null && liveQuoteAgeSec > 6 * 60 * 60 ? "bad" : "good";

                const qv = draftQty[sym] ?? (it.qty == null ? "" : String(it.qty));
                const vv = draftVal[sym] ?? ((it.valueEur ?? it.value_eur) == null ? "" : String(it.valueEur ?? it.value_eur));

                const hasQty = safeNum(qv, null) != null;
                const hasVal = safeNum(vv, null) != null;

                const needsFix = !hasQty && !hasVal; // missing inputs
                const saving = !!rowSaving[sym];

                return (
                  <div
                    key={it.id}
                    className={clsx(
                      "rounded-[22px] border p-4 shadow-[0_16px_34px_rgba(0,0,0,.22)]",
                      needsFix
                        ? "border-[#5a4020] bg-[linear-gradient(180deg,#23170f_0%,#18120c_100%)]"
                        : "border-[#23314c] bg-[linear-gradient(180deg,#131f37_0%,#0e182b_100%)]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#31415f] bg-[#0d182d] text-[13px] font-black uppercase tracking-[.08em] text-white shadow-[0_0_22px_rgba(77,126,255,.14)]">
                            {sym.slice(0, 4)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[22px] font-black tracking-[-0.04em] text-[#eef5ff]">{sym}</div>
                              <Chip tone={weightTone as any}>{weightLabel}</Chip>
                              {needsFix ? <Badge tone="warn">Missing pricing input</Badge> : <Badge tone="good">Tracked</Badge>}
                              {liveQuoteSource ? <Chip tone={quoteTone as any}>{liveQuoteSource}</Chip> : <Chip tone="warn">No live quote</Chip>}
                              {liveQuoteAgeSec != null ? (
                                <Chip tone={liveQuoteAgeSec > 6 * 60 * 60 ? "bad" : liveQuoteAgeSec > 60 * 60 ? "warn" : "good"}>{fmtAge(liveQuoteAgeSec)}</Chip>
                              ) : null}
                            </div>
                            <div className="mt-1 text-sm text-[#93a4bf]">{name || "Position"}</div>
                          </div>
                          <div className="grid min-w-[180px] grid-cols-2 gap-4 text-left sm:text-right">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#7d93b2]">Entry</div>
                              <div className="mt-1 text-base font-semibold text-[#eef5ff]">{fmtPrice(entryPrice)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#7d93b2]">Current</div>
                              <div className="mt-1 text-base font-semibold text-[#eef5ff]">{fmtPrice(livePrice ?? entryPrice)}</div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_.8fr]">
                          <div className="rounded-[18px] border border-[#23314c] bg-[#0d182d]/86 px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#7d93b2]">Weight</div>
                              <div className="text-sm font-semibold text-[#eef5ff]">{allocationPct > 0 ? `${allocationPct.toFixed(1)}%` : "-"}</div>
                            </div>
                            <div className="mt-2">
                              <MiniExposureBar value={allocationPct} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#a6b7cf]">
                              <span>{weightLabel}</span>
                              <span>{liveValueEur != null ? fmtEUR(liveValueEur) : "-"}</span>
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-[#23314c] bg-[#0d182d]/86 px-4 py-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-[#eef5ff]">
                              <span className={clsx("inline-flex h-2.5 w-2.5 rounded-full", quoteTone === "good" ? "bg-emerald-400" : quoteTone === "bad" ? "bg-rose-400" : "bg-amber-300")} />
                              {livePrice != null ? "Live pricing ready" : "Manual valuation only"}
                            </div>
                            <div className="mt-2 space-y-1 text-[12px] text-[#a6b7cf]">
                              <div>Qty {qtyValue != null ? fmtQty(qtyValue) : "pending"}</div>
                              <div>{manualValue != null ? `Manual ${fmtEUR(manualValue)}` : "Awaiting manual value"}</div>
                            </div>
                          </div>
                        </div>

                        {needsFix ? (
                          <div className="text-xs text-amber-200">
                            Add <span className="font-semibold">qty</span> or <span className="font-semibold">value (EUR)</span> so the engine can price this holding.
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => remove(it.id, sym)}
                          disabled={busy}
                          className="rounded-xl border border-[#31415f] bg-[#0d182d] px-3 py-2 text-sm font-semibold text-[#eef5ff] disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-[#c9d8ed]">Qty</div>
                        <input
                          value={qv}
                          onChange={(e) => setDraftQty((p) => ({ ...(p || {}), [sym]: e.target.value }))}
                          placeholder="e.g. 10"
                          className="w-full rounded-xl border border-[#31415f] bg-[#0d182d] px-3 py-2 text-sm text-[#eef5ff] outline-none focus:ring-2 focus:ring-[#4d7eff]/25"
                        />
                      </div>

                      <div>
                        <div className="mb-1 text-xs font-semibold text-[#c9d8ed]">Value (EUR)</div>
                        <input
                          value={vv}
                          onChange={(e) => setDraftVal((p) => ({ ...(p || {}), [sym]: e.target.value }))}
                          placeholder="Optional: manual valuation"
                          className="w-full rounded-xl border border-[#31415f] bg-[#0d182d] px-3 py-2 text-sm text-[#eef5ff] outline-none focus:ring-2 focus:ring-[#4d7eff]/25"
                        />
                        <div className="mt-1 text-xs text-[#90a3bf]">
                          Tip: if quotes are missing, value in EUR unlocks valuation.
                        </div>
                      </div>

                      <div className="flex items-end gap-2">
                        <button
                          onClick={() => saveRow(sym, name)}
                          disabled={saving}
                          className="w-full rounded-xl bg-[#3b63ff] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={missingForPricing.length > 0 ? "warn" : "good"}>Missing inputs: {missingForPricing.length}</Chip>
                  {typeof coveragePct === "number" ? (
                    <Chip tone={coveragePct >= 80 ? "good" : coveragePct >= 70 ? "warn" : "bad"}>Coverage {coveragePct}%</Chip>
                  ) : (
                    <Chip tone="neutral">Coverage -</Chip>
                  )}
                </div>

                <button
                  onClick={async () => {
                    await loadBundle();
                    setToast("Re-checked OK");
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-semibold border border-zinc-200 bg-white text-zinc-900"
                >
                  Re-check quality
                </button>
              </div>
            </div>
          )}
        </Card>
        </div>
        </div>
      </div>
    </div>
  );
}

