"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSiteLanguage } from "@/components/SiteLanguageProvider";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  Link2,
  Lock,
  PieChart,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Wallet,
} from "lucide-react";

export type InvestingSurfacePage = "daily" | "planning" | "portfolio" | "broker" | "research" | "reports" | "autonomy" | "settings";

type Tone = "good" | "warn" | "bad" | "neutral" | "info";
type RefreshDashboard = () => Promise<void>;
type SupportedSiteLang = "en" | "pt" | "fr";

const localeBySiteLang: Record<SupportedSiteLang, string> = {
  en: "en-US",
  pt: "pt-PT",
  fr: "fr-FR",
};

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

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function currentFormattingLocale() {
  if (typeof document === "undefined") return localeBySiteLang.en;
  const lang = document.documentElement.lang.slice(0, 2) as SupportedSiteLang;
  return localeBySiteLang[lang] ?? localeBySiteLang.en;
}

function fmtEUR(value: unknown, digits = 0) {
  return new Intl.NumberFormat(currentFormattingLocale(), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(num(value));
}

function fmtPct(value: unknown, digits = 1) {
  const n = num(value, Number.NaN);
  if (!Number.isFinite(n)) return "--";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtDateTime(value?: string | null) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return date.toLocaleString(currentFormattingLocale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtNumber(value: unknown) {
  return num(value).toLocaleString(currentFormattingLocale());
}

function makeClientRequestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedMoneyInput(value: string) {
  const clean = value.trim().replace(",", ".");
  return /^\d{1,10}(?:\.\d{1,8})?$/.test(clean) && Number(clean) > 0 ? clean : null;
}

function normalizedQuantityInput(value: string) {
  const clean = value.trim().replace(",", ".");
  return /^\d{1,12}(?:\.\d{1,12})?$/.test(clean) && Number(clean) > 0 ? clean : null;
}

function normalizedPastDateInput(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 60_000 ? date.toISOString() : null;
}

type HoldingSuggestion = { symbol: string; name: string };

const DEFAULT_HOLDING_SUGGESTIONS: HoldingSuggestion[] = [
  { symbol: "VWCE", name: "Vanguard FTSE All-World UCITS ETF" },
  { symbol: "IWDA", name: "iShares Core MSCI World UCITS ETF" },
  { symbol: "EUNA", name: "iShares Core Global Aggregate Bond UCITS ETF" },
  { symbol: "AGGH", name: "iShares Core Global Aggregate Bond UCITS ETF" },
  { symbol: "GLD", name: "SPDR Gold Shares" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust" },
  { symbol: "QQQ", name: "Invesco QQQ Trust" },
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corporation" },
  { symbol: "NVDA", name: "NVIDIA Corporation" },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "META", name: "Meta Platforms Inc." },
  { symbol: "BRK.B", name: "Berkshire Hathaway Inc." },
];

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function appendHoldingSuggestion(out: Map<string, HoldingSuggestion>, row: any) {
  const symbol = textValue(row?.symbol ?? row?.ticker ?? row?.assetSymbol).toUpperCase();
  if (!/^[A-Z0-9._-]{1,24}$/.test(symbol) || out.has(symbol)) return;
  const name =
    textValue(row?.name) ||
    textValue(row?.instrumentName) ||
    textValue(row?.securityName) ||
    textValue(row?.companyName) ||
    textValue(row?.assetName) ||
    textValue(row?.label) ||
    textValue(row?.rationale) ||
    symbol;
  out.set(symbol, { symbol, name });
}

function buildHoldingSuggestions(vm: ReturnType<typeof buildViewModel>) {
  const out = new Map<string, HoldingSuggestion>();
  for (const row of vm.items) appendHoldingSuggestion(out, row);
  for (const row of vm.targetRows) appendHoldingSuggestion(out, row);
  for (const row of vm.actionRows) appendHoldingSuggestion(out, row);
  for (const row of vm.opportunities) appendHoldingSuggestion(out, row);
  for (const row of DEFAULT_HOLDING_SUGGESTIONS) appendHoldingSuggestion(out, row);
  return Array.from(out.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function resolveHoldingSymbol(input: string, suggestions: HoldingSuggestion[]) {
  const raw = input.trim();
  const query = raw.toLowerCase();
  const exact = suggestions.find((item) => item.symbol.toLowerCase() === query || item.name.toLowerCase() === query);
  if (exact) return exact.symbol;
  const startsWithMatches = suggestions.filter((item) => item.symbol.toLowerCase().startsWith(query) || item.name.toLowerCase().startsWith(query));
  if (startsWithMatches.length === 1) return startsWithMatches[0].symbol;
  const includesMatches = suggestions.filter((item) => item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query));
  if (includesMatches.length === 1) return includesMatches[0].symbol;
  return raw.toUpperCase();
}

function badgeTone(tone: Tone) {
  if (tone === "good") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (tone === "warn") return "border-amber-400/24 bg-amber-400/10 text-amber-200";
  if (tone === "bad") return "border-rose-400/24 bg-rose-400/10 text-rose-200";
  if (tone === "info") return "border-sky-400/24 bg-sky-400/10 text-sky-200";
  return "border-slate-600/60 bg-slate-900/60 text-slate-200";
}

function stateTone(state?: string | null): Tone {
  const raw = String(state || "").toLowerCase();
  if (raw.includes("blocked") || raw.includes("failed") || raw.includes("bad")) return "bad";
  if (raw.includes("review") || raw.includes("warn") || raw.includes("degraded") || raw.includes("required")) return "warn";
  if (raw.includes("ready") || raw.includes("ok") || raw.includes("aligned") || raw.includes("complete") || raw.includes("cleared")) return "good";
  if (raw.includes("paper")) return "info";
  return "neutral";
}

function formatAllowedResponse(response: string) {
  return response
    .replace(/paper/gi, "demo")
    .replace(/_/g, " ");
}

function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]", badgeTone(tone))}>
      {children}
    </span>
  );
}

function Panel({
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
    <section className={clsx("rounded-lg border border-[#22314d] bg-[linear-gradient(180deg,#0d1a2f_0%,#091525_100%)] shadow-[0_18px_50px_rgba(0,0,0,.28)]", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-[#22314d] px-4 py-3">
        <div>
          <div className="text-sm font-bold text-[#eef5ff]">{title}</div>
          {subtitle ? <div className="mt-1 text-xs leading-5 text-[#8396b4]">{subtitle}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="min-h-[120px] rounded-lg border border-[#22314d] bg-[#0c192d] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg border", badgeTone(tone))}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7f91ad]">{label}</div>
          <div className="mt-1 break-words text-base font-black leading-5 text-white">{value}</div>
          {detail ? <div className="mt-1 break-words text-xs leading-5 text-[#8fa2bf]">{detail}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  tone = "info",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: Tone;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-black transition",
        tone === "good" && "border-emerald-400/30 bg-emerald-400/14 text-emerald-100 hover:bg-emerald-400/20",
        tone === "warn" && "border-amber-400/30 bg-amber-400/14 text-amber-100 hover:bg-amber-400/20",
        tone === "bad" && "border-rose-400/30 bg-rose-400/14 text-rose-100 hover:bg-rose-400/20",
        tone === "info" && "border-sky-400/30 bg-sky-400/14 text-sky-100 hover:bg-sky-400/20",
        tone === "neutral" && "border-[#263650] bg-[#0b1729] text-[#dbe7f8] hover:bg-[#102242]",
      )}
    >
      {children}
    </button>
  );
}

const navItems: Array<{ key: InvestingSurfacePage; label: string; icon: React.ReactNode }> = [
  { key: "daily", label: "Today", icon: <Target className="h-4 w-4" /> },
  { key: "portfolio", label: "Portfolio", icon: <PieChart className="h-4 w-4" /> },
  { key: "broker", label: "Broker", icon: <Link2 className="h-4 w-4" /> },
  { key: "planning", label: "Plan", icon: <SlidersHorizontal className="h-4 w-4" /> },
  { key: "research", label: "Research", icon: <BookOpen className="h-4 w-4" /> },
  { key: "reports", label: "Reports", icon: <FileText className="h-4 w-4" /> },
  { key: "autonomy", label: "Copilot", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "settings", label: "Settings", icon: <SlidersHorizontal className="h-4 w-4" /> },
];

const assetColors: Record<string, string> = {
  equity: "#2d7dff",
  bond: "#35c6d9",
  bonds: "#35c6d9",
  commodity: "#f0b64a",
  commodities: "#f0b64a",
  cash: "#8c5cff",
};

const goalOptions = [
  { key: "balanced", label: "Balanced growth", detail: "Controlled risk with diversified growth" },
  { key: "growth", label: "Long-term growth", detail: "Compounding-focused mandate" },
  { key: "income", label: "Income", detail: "Dividend and yield-oriented mandate" },
  { key: "preservation", label: "Capital preservation", detail: "Defensive mandate focused on safety" },
] as const;

const riskOptions = ["Conservative", "Balanced", "Aggressive"] as const;
const horizonOptions = ["Short", "Medium", "Long"] as const;

function inferGoalType(planGoal?: unknown, settingsGoal?: unknown) {
  const raw = `${String(planGoal || "")} ${String(settingsGoal || "")}`.toLowerCase();
  if (raw.includes("income") || raw.includes("dividend") || raw.includes("yield")) return "income";
  if (raw.includes("preserv") || raw.includes("protect") || raw.includes("safety")) return "preservation";
  if (raw.includes("growth") || raw.includes("compound")) return "growth";
  return "balanced";
}

function normalizeAssetClass(value: unknown) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("bond")) return "bonds";
  if (raw.includes("cash")) return "cash";
  if (raw.includes("gold") || raw.includes("commodity")) return "commodity";
  return "equity";
}

function assetLabel(value: string) {
  if (value === "bonds") return "Bonds";
  if (value === "commodity") return "Gold";
  if (value === "cash") return "Cash";
  return "Equity";
}

function inferAsset(symbol: string, targetBySymbol: Map<string, string>) {
  const known = targetBySymbol.get(symbol.toUpperCase());
  if (known) return known;
  if (symbol.toUpperCase() === "AGGH") return "bonds";
  if (symbol.toUpperCase() === "GLD") return "commodity";
  if (["EUR", "USD", "CASH"].includes(symbol.toUpperCase())) return "cash";
  return "equity";
}

function Donut({ rows, center }: { rows: Array<{ label: string; value: number; color: string }>; center: React.ReactNode }) {
  let cursor = 0;
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const gradient =
    total > 0
      ? rows
          .map((row) => {
            const start = cursor;
            cursor += (Math.max(0, row.value) / total) * 100;
            return `${row.color} ${start}% ${cursor}%`;
          })
          .join(", ")
      : "#263754 0% 100%";
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-[18px] flex items-center justify-center rounded-full bg-[#081424] text-center text-xs font-black text-white shadow-inner">
          {center}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2 text-[#a8bad5]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
              {row.label}
            </span>
            <span className="font-bold text-white">{row.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#2a3c5f] bg-[#081424] p-4 text-sm text-[#9fb1ca]">
      <div className="font-bold text-white">{title}</div>
      <div className="mt-1 leading-6">{detail}</div>
    </div>
  );
}

function buildViewModel(data: any) {
  const decision = data?.daily?.customerDecision ?? data?.derived?.customerDecision ?? null;
  const runtime = data?.daily?.investingEngine ?? null;
  const opportunities = Array.isArray(data?.daily?.opportunities) ? data.daily.opportunities : [];
  const portfolio = data?.portfolio ?? {};
  const items = Array.isArray(portfolio?.items) ? portfolio.items : [];
  const totalEur = num(portfolio?.totalEur ?? decision?.portfolio?.totalEur);
  const cashEur = num(portfolio?.cashEur ?? decision?.portfolio?.cashEur);
  const targetRows = Array.isArray(decision?.portfolio?.targetAllocations) ? decision.portfolio.targetAllocations : [];
  const actionRows = Array.isArray(decision?.portfolio?.actions) ? decision.portfolio.actions : [];
  const primaryAction = actionRows.find((row: any) => row?.side === "buy" || row?.side === "sell") ?? null;
  const monthlyContributionEur = num(data?.settings?.monthly_contribution ?? decision?.portfolio?.monthlyContributionEur, 0);
  const targetBySymbol = new Map<string, string>();
  for (const row of targetRows) {
    targetBySymbol.set(String(row.symbol || "").toUpperCase(), normalizeAssetClass(row.assetClass));
  }
  const currentByAsset = new Map<string, number>();
  for (const item of items) {
    const symbol = String(item?.symbol || "").toUpperCase();
    const asset = inferAsset(symbol, targetBySymbol);
    currentByAsset.set(asset, (currentByAsset.get(asset) || 0) + num(item?.valueEur ?? item?.value_eur));
  }
  currentByAsset.set("cash", (currentByAsset.get("cash") || 0) + cashEur);

  const targetByAsset = new Map<string, number>();
  for (const row of targetRows) {
    const asset = normalizeAssetClass(row.assetClass);
    targetByAsset.set(asset, (targetByAsset.get(asset) || 0) + num(row.targetWeightPct));
  }
  const assets = Array.from(new Set(["equity", "bonds", "commodity", "cash", ...Array.from(currentByAsset.keys()), ...Array.from(targetByAsset.keys())]));
  const allocationRows = assets.map((asset) => {
    const currentWeight = totalEur > 0 ? ((currentByAsset.get(asset) || 0) / totalEur) * 100 : 0;
    const targetWeight = targetByAsset.get(asset) || 0;
    return {
      asset,
      label: assetLabel(asset),
      color: assetColors[asset] || "#64748b",
      currentWeight,
      targetWeight,
      drift: currentWeight - targetWeight,
    };
  });
  const activeAllocationRows = allocationRows.filter((row) => row.currentWeight > 0 || row.targetWeight > 0);
  const maxDrift = activeAllocationRows.reduce((max, row) => Math.max(max, Math.abs(row.drift)), 0);
  const largestDriftRow = activeAllocationRows.reduce<(typeof allocationRows)[number] | null>(
    (largest, row) => (!largest || Math.abs(row.drift) > Math.abs(largest.drift) ? row : largest),
    null,
  );
  const isPortfolioAligned = Boolean(targetRows.length && Number.isFinite(totalEur) && totalEur > 0 && maxDrift <= 3);
  const alignmentStatus = !targetRows.length
    ? "Plan required"
    : totalEur <= 0
      ? "Portfolio required"
      : isPortfolioAligned
        ? "Aligned"
        : "Needs review";
  const alignmentDetail = !targetRows.length
    ? "Choose and save an investment plan first."
    : totalEur <= 0
      ? "Add holdings or cash so Syntrake can compare portfolio vs plan."
      : isPortfolioAligned
        ? "No portfolio action is required today."
        : `${largestDriftRow?.label || "Portfolio"} is ${largestDriftRow && largestDriftRow.drift > 0 ? "over" : "under"} target by ${Math.abs(largestDriftRow?.drift || 0).toFixed(1)}%.`;
  const todayInstruction = !targetRows.length
    ? "Create or choose a plan before making investment decisions."
    : items.length === 0
      ? "Add portfolio evidence: import holdings in Portfolio or connect a broker in Broker."
    : isPortfolioAligned
        ? `No trade needed today. Keep the plan active and keep the monthly contribution at ${fmtEUR(monthlyContributionEur)}.`
        : primaryAction
          ? `Prepare a manual ${String(primaryAction.side).toUpperCase()} review for ${String(primaryAction.symbol || "").toUpperCase()} around ${fmtEUR(Math.abs(num(primaryAction.deltaValueEur)), 2)}.`
          : "Review the drift before preparing any manual broker action.";
  const coveragePct = num(portfolio?.valuation?.coveragePct ?? decision?.dataQuality?.pricingCoveragePct, items.length ? 0 : 100);
  const accountEnvironment = String(portfolio?.environment || "").toLowerCase();
  const accountStatus = String(portfolio?.accountStatus || "").toLowerCase();
  const brokerConnection = record(data?.settings?.broker_connection);
  const brokerProvider = String(brokerConnection?.provider || "").toLowerCase();
  const legacyInternalDemoProvider = `syntrake_internal_${"sand"}${"box"}`;
  const investingBrokerConnected = brokerConnection?.mode === "investing" && String(brokerConnection?.status || "").toLowerCase() === "connected";
  const hasPaperAccount = Boolean(portfolio?.accountId && accountEnvironment === "paper" && accountStatus === "active");
  const hasDemoBroker = Boolean(investingBrokerConnected && String(brokerConnection?.brokerMode || "").toLowerCase() === "demo" && brokerProvider !== legacyInternalDemoProvider);
  const hasLiveBroker = Boolean(accountEnvironment === "live" && accountStatus === "active" && investingBrokerConnected && String(brokerConnection?.brokerMode || "").toLowerCase() === "live");
  const hasTrackingAccount = Boolean(portfolio?.accountId && accountEnvironment === "simulation" && accountStatus === "active");
  const hasActiveAccount = hasTrackingAccount || hasDemoBroker || hasLiveBroker;
  const accountModeLabel = hasLiveBroker ? "Live broker" : hasDemoBroker ? "Demo broker" : hasTrackingAccount ? "Manual tracking" : "Setup required";
  const brokerConnectionLabel = hasLiveBroker ? "Live broker connected" : hasDemoBroker ? "Demo broker connected" : "Broker not connected";
  const brokerConnectionTone: Tone = hasLiveBroker ? "good" : hasDemoBroker ? "info" : "warn";
  const valuationSource = String(portfolio?.valuation?.source || decision?.dataQuality?.valuationSource || "unknown");
  const missingPriceSymbols = Array.isArray(portfolio?.valuation?.missingPriceSymbols)
    ? portfolio.valuation.missingPriceSymbols.map((symbol: unknown) => String(symbol || "").toUpperCase()).filter(Boolean)
    : Array.isArray(decision?.dataQuality?.missingPriceSymbols)
      ? decision.dataQuality.missingPriceSymbols.map((symbol: unknown) => String(symbol || "").toUpperCase()).filter(Boolean)
      : [];
  const customerDecisionSource = String(data?.derived?.customerDecisionSource || "volatile_runtime_adapter");
  const marketSnapshotPersisted = decision?.marketSnapshot?.immutableInDatabase === true;
  const hasCashReady = cashEur > 0;
  const actionablePaperReady = hasDemoBroker && hasCashReady;
  const hasProposal = Boolean(data?.daily?.execution?.queue?.id);
  const canShowExecutableRebalance = actionablePaperReady && hasProposal;
  const valuationDetail =
    valuationSource === "cost_basis_fallback"
      ? `Estimate; missing market prices for ${missingPriceSymbols.join(", ") || "some holdings"}`
      : items.length === 0
        ? "No holdings to value yet"
      : `${coveragePct}% price coverage`;
  return {
    decision,
    runtime,
    opportunities,
    settings: data?.settings ?? null,
    plan: data?.plan ?? null,
    portfolio,
    items,
    totalEur,
    cashEur,
    monthlyContributionEur,
    targetRows,
    actionRows,
    primaryAction,
    allocationRows,
    activeAllocationRows,
    maxDrift,
    largestDriftRow,
    isPortfolioAligned,
    alignmentStatus,
    alignmentDetail,
    todayInstruction,
    coveragePct,
    accountEnvironment,
    accountStatus,
    brokerConnection,
    hasPaperAccount,
    hasDemoBroker,
    hasLiveBroker,
    hasTrackingAccount,
    hasActiveAccount,
    accountModeLabel,
    brokerConnectionLabel,
    brokerConnectionTone,
    valuationSource,
    missingPriceSymbols,
    customerDecisionSource,
    marketSnapshotPersisted,
    hasCashReady,
    actionablePaperReady,
    hasProposal,
    canShowExecutableRebalance,
    valuationDetail,
    queue: data?.daily?.execution?.queue ?? null,
    order: data?.daily?.execution?.order ?? null,
    reportSummary: data?.derived?.reportSummary ?? null,
    receipts: Array.isArray(data?.derived?.receiptsTimeline) ? data.derived.receiptsTimeline : [],
    asOf: data?.asOf ?? decision?.asOf ?? null,
    lastSnapshotAt: data?.derived?.lastSnapshotAt ?? data?.daily?.lastSnapshotAt ?? null,
  };
}

type MissionStatus = "done" | "active" | "locked";

function missionTone(status: MissionStatus) {
  if (status === "done") return "border-emerald-400/20 bg-emerald-400/8 text-emerald-100";
  if (status === "active") return "border-sky-400/25 bg-sky-400/10 text-sky-100";
  return "border-[#263650] bg-[#081424] text-[#8fa2bf]";
}

function buildGuidedMission(vm: ReturnType<typeof buildViewModel>) {
  const hasPlan = Boolean(vm.plan);
  const hasPortfolioEvidence = vm.items.length > 0;
  const nextPage: InvestingSurfacePage = !hasPlan ? "planning" : !hasPortfolioEvidence ? "portfolio" : "daily";
  const steps: Array<{
    key: InvestingSurfacePage;
    label: string;
    detail: string;
    status: MissionStatus;
  }> = [
    {
      key: "planning",
      label: "1. Plan",
      detail: hasPlan ? "Investment policy is saved." : "Choose objective, risk, horizon, target and monthly amount.",
      status: hasPlan ? "done" : "active",
    },
    {
      key: "portfolio",
      label: "2. Portfolio",
      detail: hasPortfolioEvidence ? "Holdings are available for plan alignment." : "Import holdings or review a Syntrake prepared portfolio.",
      status: hasPlan ? (hasPortfolioEvidence ? "done" : "active") : "locked",
    },
    {
      key: "daily",
      label: "3. Today",
      detail: hasPlan && hasPortfolioEvidence ? "Read the exact action for today." : "Unlocked after plan and portfolio evidence.",
      status: hasPlan && hasPortfolioEvidence ? "active" : "locked",
    },
  ];
  return { nextPage, hasPlan, hasPortfolioEvidence, steps };
}

function guidedRedirectPage(page: InvestingSurfacePage, vm: ReturnType<typeof buildViewModel>): InvestingSurfacePage | null {
  if (page !== "daily") return null;
  const mission = buildGuidedMission(vm);
  if (!mission.hasPlan) return "planning";
  if (!mission.hasPortfolioEvidence) return "portfolio";
  return null;
}

function StatusRow({ label, value, tone = "neutral" }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#22314d] py-2 text-sm last:border-0">
      <span className="text-[#8fa2bf]">{label}</span>
      <span className={clsx("text-right font-bold", tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-rose-300" : "text-white")}>{value}</span>
    </div>
  );
}

function GuidedMissionPanel({ vm, page }: { vm: ReturnType<typeof buildViewModel>; page: InvestingSurfacePage }) {
  const router = useRouter();
  const mission = buildGuidedMission(vm);
  const showNextAction = page !== mission.nextPage && page !== "settings" && page !== "broker";
  return (
    <section className="mb-4 rounded-lg border border-[#22314d] bg-[#081424] p-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="grid gap-2 md:grid-cols-3">
          {mission.steps.map((step) => (
            <button
              key={step.key}
              type="button"
              onClick={() => step.status !== "locked" ? router.push(`/app?tab=${step.key}&mode=investing`) : undefined}
              className={clsx("min-h-[82px] rounded-lg border p-3 text-left transition", missionTone(step.status), step.status !== "locked" && "hover:border-sky-300/45")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-[0.08em]">{step.label}</span>
                {step.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : step.status === "active" ? <Target className="h-4 w-4 text-sky-200" /> : <Lock className="h-4 w-4 text-[#6f829d]" />}
              </div>
              <div className="mt-2 text-xs leading-5 opacity-85">{step.detail}</div>
            </button>
          ))}
        </div>
        {showNextAction ? (
          <ActionButton tone="good" onClick={() => router.push(`/app?tab=${mission.nextPage}&mode=investing`)}>
            Continue setup
          </ActionButton>
        ) : null}
      </div>
    </section>
  );
}

function buildMissionBrief(page: InvestingSurfacePage, vm: ReturnType<typeof buildViewModel>, mode: "beginner" | "pro") {
  if (!vm.plan) {
    return {
      title: "Define the investment contract",
      now: mode === "beginner"
        ? "Choose the goal, risk level, investment horizon, target amount, and monthly contribution. This tells Syntrake what it is allowed to compare against."
        : "Create the mandate inputs that drive target allocation, drift bands, governance and daily action sizing.",
      why: "Without a saved plan, every portfolio or broker action would be unanchored.",
      done: "This step is done when Plan shows an active investment policy.",
      next: "After saving the plan, move to Portfolio and add evidence of what the user owns or wants Syntrake to prepare.",
    };
  }
  if (vm.items.length === 0) {
    return {
      title: "Give Syntrake portfolio evidence",
      now: mode === "beginner"
        ? "Either import the holdings already owned, or review the portfolio Syntrake prepares from the plan. Broker connection is optional and stays in Broker."
        : "Create the canonical position base needed for current weights, target gap, valuation source and rebalance deltas.",
      why: "Today cannot say buy, sell or hold with confidence until there is a real portfolio state to compare with the plan.",
      done: "This step is done when Portfolio has at least one canonical holding or prepared portfolio evidence.",
      next: "After portfolio evidence exists, Today becomes the primary decision page.",
    };
  }
  if (page === "daily") {
    return {
      title: "Follow today's decision",
      now: mode === "beginner"
        ? "Read the action, then the how and why. If it says no trade, do nothing. If it shows a manual review, use Broker only after checking the evidence."
        : "Review mandate alignment, pricing coverage, execution state, estimated cost, expiry and approval status before any manual broker submit.",
      why: "Today is the operating page: it turns plan plus portfolio plus market data into one clear action.",
      done: "This step is done when the user understands whether to hold, add cash, prepare a review, or submit manually in Broker.",
      next: "Use Portfolio for holding detail, Research for opportunities, Reports for receipt history, and Broker only for broker connection or manual submit.",
    };
  }
  if (page === "portfolio") {
    return {
      title: "Inspect the portfolio",
      now: mode === "beginner"
        ? "Click a holding to see cost, current value, profit/loss, latest price source and whether Syntrake had to use fallback data."
        : "Validate valuation source, position-level P/L, allocation drift, current vs target weights and missing quote warnings.",
      why: "Portfolio explains what the user owns and whether those holdings match the chosen plan.",
      done: "This step is done when holdings, valuation and plan alignment are understandable.",
      next: "Return to Today for the exact action or Broker for manual execution workflow.",
    };
  }
  if (page === "research") {
    return {
      title: "Review safer opportunities",
      now: mode === "beginner"
        ? "Look at opportunities that fit the current plan. Treat anything marked lab promotion pending as a research idea, not an instruction."
        : "Inspect fit, score, target value, price provenance, warnings and lab validation status before considering plan changes.",
      why: "Research should improve the plan and portfolio without exposing raw internal lab output.",
      done: "This step is done when an opportunity is either ignored, monitored, or reviewed against the active plan.",
      next: "Use Plan to change the mandate, Portfolio to compare holdings, and Today for actual action.",
    };
  }
  if (page === "reports") {
    return {
      title: "Read the operating record",
      now: mode === "beginner"
        ? "Check how many daily receipts exist this month and quarter, then read current value, cash, holdings and P/L."
        : "Use report v1 for receipt coverage, latest valuation, unrealized P/L, pricing coverage and stated attribution limitations.",
      why: "Reports are proof of what Syntrake saw and decided, not a promise of performance.",
      done: "This step is done when the user knows what data is recorded and what is still only a limitation.",
      next: "Save more daily cycles over time to strengthen monthly and quarterly reporting.",
    };
  }
  if (page === "broker") {
    return {
      title: "Connect or submit manually",
      now: mode === "beginner"
        ? "Use a demo broker connector to test without live money. Use a live broker only when a real connector exists. Syntrake does not auto-submit live orders."
        : "Manage demo connection, cash, proposal generation, manual submit state, live connector gating and order receipt flow.",
      why: "Broker is isolated so execution controls never leak into Portfolio, Today, or Research.",
      done: "This step is done when the connection and manual submit state are clear.",
      next: "Return to Today after broker state changes so the decision can be reviewed again.",
    };
  }
  return {
    title: "Understand the current workspace",
    now: mode === "beginner"
      ? "Use the mission steps to move through Plan, Portfolio and Today."
      : "Inspect canonical state, governance, data quality and execution boundaries.",
    why: "The workflow is supervised investing guidance, not automatic trading.",
    done: "This step is done when the current page has a clear next action.",
    next: "Continue through the guided mission.",
  };
}

function normalizeMissionBriefMode(value: unknown): "beginner" | "pro" {
  return value === "pro" ? "pro" : "beginner";
}

function MissionBriefPanel({ vm, page, onRefresh }: { vm: ReturnType<typeof buildViewModel>; page: InvestingSurfacePage; onRefresh: RefreshDashboard }) {
  const uiState = record(vm.settings?.investing_ui_state);
  const [mode, setMode] = useState<"beginner" | "pro">(() => normalizeMissionBriefMode(uiState?.missionBriefMode));
  const [hidden, setHidden] = useState(() => uiState?.missionBriefHidden === true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(normalizeMissionBriefMode(uiState?.missionBriefMode));
    setHidden(uiState?.missionBriefHidden === true);
  }, [uiState?.missionBriefMode, uiState?.missionBriefHidden]);

  async function persist(next: { mode?: "beginner" | "pro"; hidden?: boolean }) {
    const nextMode = next.mode ?? mode;
    const nextHidden = next.hidden ?? hidden;
    setMode(nextMode);
    setHidden(nextHidden);
    setBusy(true);
    try {
      const result = await fetchJSON("/api/investing/preferences", {
        method: "POST",
        body: JSON.stringify({
          action: "update_mission_brief",
          missionBriefMode: nextMode,
          missionBriefHidden: nextHidden,
        }),
      });
      if (result.ok) await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  if (hidden) {
    return (
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#22314d] bg-[#081424] p-3">
        <div>
          <div className="text-sm font-black text-white">Mission brief hidden</div>
          <div className="mt-1 text-xs leading-5 text-[#8fa2bf]">The guided setup still controls Plan, Portfolio and Today.</div>
        </div>
        <ActionButton tone="info" onClick={() => void persist({ hidden: false })}>{busy ? "Saving..." : "Show mission brief"}</ActionButton>
      </section>
    );
  }

  const brief = buildMissionBrief(page, vm, mode);
  return (
    <section className="mb-4 rounded-lg border border-[#22314d] bg-[linear-gradient(180deg,#0b1729_0%,#081424_100%)] p-3">
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-[#8fa2bf]">Mission brief</div>
            <button type="button" onClick={() => void persist({ hidden: true })} className="text-xs font-bold text-[#8fa2bf] underline-offset-4 hover:text-white hover:underline">
              Hide
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-lg border border-[#263650] bg-[#050b14]">
            {(["beginner", "pro"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => void persist({ mode: option })}
                className={clsx("min-h-10 px-3 text-xs font-black uppercase tracking-[0.08em] transition", mode === option ? "bg-sky-400/18 text-sky-100" : "text-[#8fa2bf] hover:bg-[#102242]")}
              >
                {option}
              </button>
            ))}
          </div>
          {busy ? <div className="mt-2 text-xs font-bold text-sky-200">Saving preference...</div> : null}
        </div>
        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3">
            <div className="text-sm font-black text-white">{brief.title}</div>
            <div className="mt-2 text-sm leading-6 text-[#dbe7f8]">{brief.now}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-3 text-xs leading-5 text-[#9fb1ca]"><span className="font-black text-white">Why: </span>{brief.why}</div>
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-3 text-xs leading-5 text-[#9fb1ca]"><span className="font-black text-white">Done when: </span>{brief.done}</div>
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-3 text-xs leading-5 text-[#9fb1ca]"><span className="font-black text-white">Next: </span>{brief.next}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Shell({
  page,
  data,
  loading,
  error,
  children,
  onRefresh,
}: {
  page: InvestingSurfacePage;
  data: any;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
  onRefresh: RefreshDashboard;
}) {
  const vm = buildViewModel(data);
  const pageTitle = navItems.find((item) => item.key === page)?.label || "Today";
  return (
    <div className="rounded-xl border border-[#263650] bg-[#06101f] p-3 shadow-[0_28px_90px_rgba(0,0,0,.4)]">
      <div className="min-h-[760px]">
        <main className="min-w-0 rounded-lg border border-[#1f2e49] bg-[radial-gradient(circle_at_top_left,#102242_0%,#071326_34%,#06101f_100%)] p-4">
          <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#7f91ad]">Syntrake Investing</div>
              <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] text-white">{pageTitle}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-lg border border-[#263650] bg-[#081424] px-3 py-2 text-xs text-[#8fa2bf]">
                As of <span className="font-bold text-white">{fmtDateTime(vm.asOf)}</span>
              </div>
              {page === "broker" || page === "settings" ? <Badge tone={vm.brokerConnectionTone}>{vm.brokerConnectionLabel}</Badge> : null}
              {page === "broker" || page === "settings" ? <Badge tone={vm.hasLiveBroker ? "good" : "warn"}>{vm.hasLiveBroker ? "Live manual ready" : "Live broker connector required"}</Badge> : null}
            </div>
          </header>
          {error ? <div className="mb-4 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</div> : null}
          {!loading && !error ? <GuidedMissionPanel vm={vm} page={page} /> : null}
          {!loading && !error && page !== "settings" ? <MissionBriefPanel vm={vm} page={page} onRefresh={onRefresh} /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function TopMetrics({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const accountValue = vm.accountModeLabel;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <MetricCard icon={<Target className="h-4 w-4" />} label="Active plan" value={vm.plan ? "Active" : "Missing"} detail={vm.decision?.risk?.objective || "Long-term mandate"} tone={vm.plan ? "good" : "warn"} />
      <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Account mode" value={accountValue} detail={vm.accountStatus || "No active account"} tone={vm.hasActiveAccount ? "info" : "warn"} />
      <MetricCard icon={<Wallet className="h-4 w-4" />} label="Cash available" value={fmtEUR(vm.cashEur)} detail="Canonical cash balance" tone={vm.hasDemoBroker || vm.hasLiveBroker ? "good" : vm.hasTrackingAccount ? "neutral" : "warn"} />
      <MetricCard icon={<BarChart3 className="h-4 w-4" />} label="Portfolio value" value={fmtEUR(vm.totalEur)} detail={vm.valuationDetail} tone={vm.coveragePct >= 90 && vm.valuationSource === "market_quotes" ? "good" : "warn"} />
      <MetricCard icon={<CalendarDays className="h-4 w-4" />} label="Last daily cycle" value={fmtDateTime(vm.lastSnapshotAt)} detail={vm.receipts.length ? `${vm.receipts.length} receipts` : "No receipts yet"} tone={vm.lastSnapshotAt ? "good" : "warn"} />
    </div>
  );
}

function AllocationPanel({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const rows = vm.allocationRows.filter((row) => row.currentWeight > 0 || row.targetWeight > 0);
  return (
    <Panel title="Current vs Target Allocation" subtitle="Canonical portfolio compared with mandate policy" right={<Badge tone={stateTone(vm.decision?.researchPublication?.validationStatus)}> {vm.decision?.researchPublication?.validationStatus || "unavailable"} </Badge>}>
      {rows.length ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(220px,320px)_1fr]">
          <Donut rows={rows.map((row) => ({ label: row.label, value: row.targetWeight, color: row.color }))} center={<div>Target<br />Policy</div>} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[#7f91ad]">
                <tr>
                  <th className="py-2">Asset class</th>
                  <th className="py-2 text-right">Current</th>
                  <th className="py-2 text-right">Target</th>
                  <th className="py-2 text-right">Drift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22314d]">
                {rows.map((row) => (
                  <tr key={row.asset}>
                    <td className="py-2 font-semibold text-white"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />{row.label}</td>
                    <td className="py-2 text-right text-[#dbe7f8]">{row.currentWeight.toFixed(1)}%</td>
                    <td className="py-2 text-right text-[#dbe7f8]">{row.targetWeight.toFixed(1)}%</td>
                    <td className={clsx("py-2 text-right font-bold", Math.abs(row.drift) <= 1 ? "text-emerald-300" : row.drift > 0 ? "text-rose-300" : "text-emerald-300")}>{fmtPct(row.drift)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="Allocation unavailable" detail="Create a plan and start tracking holdings before allocation can be displayed." />
      )}
    </Panel>
  );
}

function PlanAlignmentPanel({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const rows = [...vm.activeAllocationRows].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  const tone: Tone = vm.alignmentStatus === "Aligned" ? "good" : vm.alignmentStatus.includes("required") ? "warn" : "info";
  return (
    <Panel title="Portfolio Alignment To Plan" subtitle="How the current portfolio compares with the selected plan" right={<Badge tone={tone}>{vm.alignmentStatus}</Badge>}>
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="rounded-lg border border-[#263650] bg-[#081424] p-4">
          <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">Current answer</div>
          <div className="mt-2 text-xl font-black text-white">{vm.isPortfolioAligned ? "Portfolio matches the plan" : vm.alignmentStatus}</div>
          <div className="mt-2 text-sm leading-6 text-[#9fb1ca]">{vm.alignmentDetail}</div>
          <div className="mt-3 rounded-lg border border-[#22314d] bg-[#050b14] p-3 text-xs text-[#8fa2bf]">
            Max drift: <span className="font-black text-white">{vm.maxDrift.toFixed(1)}%</span>
          </div>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[#7f91ad]"><tr><th className="py-2">Asset</th><th className="py-2 text-right">Current</th><th className="py-2 text-right">Plan</th><th className="py-2 text-right">Gap</th><th className="py-2 text-right">Meaning</th></tr></thead>
              <tbody className="divide-y divide-[#22314d]">
                {rows.map((row) => {
                  const under = row.drift < -1;
                  const over = row.drift > 1;
                  return (
                    <tr key={row.asset}>
                      <td className="py-2 font-bold text-white">{row.label}</td>
                      <td className="py-2 text-right text-[#dbe7f8]">{row.currentWeight.toFixed(1)}%</td>
                      <td className="py-2 text-right text-[#dbe7f8]">{row.targetWeight.toFixed(1)}%</td>
                      <td className={clsx("py-2 text-right font-black", Math.abs(row.drift) <= 1 ? "text-emerald-300" : "text-amber-300")}>{fmtPct(row.drift)}</td>
                      <td className="py-2 text-right text-[#dbe7f8]">{under ? "Under plan" : over ? "Over plan" : "On plan"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Alignment unavailable" detail="Save a plan and add portfolio data before Syntrake can compare current allocation with target allocation." />
        )}
      </div>
    </Panel>
  );
}

function TodayPage({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const action = vm.decision?.action;
  const actionTone: Tone = vm.alignmentStatus === "Aligned" ? "good" : vm.alignmentStatus.includes("required") ? "warn" : "info";
  const howToDo = !vm.plan
    ? "Open Plan, choose objective, risk, horizon, target value, and monthly contribution. Save the plan before touching broker actions."
    : vm.items.length === 0
      ? "Open Portfolio to start manual tracking and import holdings. Use Broker only if you want a demo or live broker connection."
      : vm.alignmentStatus === "Aligned"
        ? `Do not create or submit a broker order. Keep the plan active, keep the monthly contribution at ${fmtEUR(vm.monthlyContributionEur)}, and review Today after portfolio or market data changes.`
        : vm.hasProposal
          ? "Open Broker, review the prepared ticket, check cost and risk, then submit manually only if you agree."
          : "Open Plan to review the alignment gap, then use Portfolio or Broker to prepare a manual proposal. No live order is sent automatically.";
  const whyThisMatters = !vm.plan
    ? "Without a saved plan, Syntrake has no mandate to compare against the portfolio."
    : vm.items.length === 0
      ? "Without holdings, cash, or broker state, Syntrake cannot know whether the real portfolio matches the selected plan."
      : vm.alignmentStatus === "Aligned"
        ? "The portfolio is close enough to the selected plan, so trading today would add unnecessary cost and operational risk."
        : `${vm.alignmentDetail} The client should understand this gap before preparing any broker action.`;
  const decisionRows = [
    ["Plan", vm.plan ? vm.decision?.risk?.objective || vm.plan?.goal || "Active mandate" : "Missing"],
    ["Portfolio state", vm.hasActiveAccount ? vm.accountModeLabel : "Portfolio or broker setup required"],
    ["Alignment", `${vm.alignmentStatus} - ${vm.alignmentDetail}`],
    ["Broker order", vm.hasProposal ? "Prepared for manual review" : "No order waiting for submission"],
    ["Estimated cost", fmtEUR(vm.decision?.costs?.estimatedRoundTripCostEur || 0, 2)],
    ["Valid until", action?.expiresAt ? fmtDateTime(action.expiresAt) : "Manual review window"],
  ];
  const checklistRows = [
    ["1", "Read the instruction", vm.todayInstruction],
    ["2", "Follow the route", howToDo],
    ["3", "Check the reason", whyThisMatters],
    ["4", "Stop condition", vm.hasProposal ? "Only submit after manual review in Broker." : "Do not submit a broker order today."],
  ];
  return (
    <div className="space-y-3">
      <Panel title="What To Do Today" subtitle="Exactly what the client should do, how to do it, and why" right={<Badge tone={actionTone}>{vm.alignmentStatus}</Badge>}>
        <div className="space-y-4">
          <div className="rounded-lg border border-sky-400/20 bg-sky-400/8 p-5">
            <div className="text-xs font-black uppercase tracking-[0.08em] text-sky-100/80">Do this</div>
            <div className="mt-2 text-3xl font-black leading-tight text-white">{vm.todayInstruction}</div>
            <div className="mt-3 text-sm leading-6 text-sky-100">{vm.alignmentDetail}</div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-4">
              <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">How to do it</div>
              <div className="mt-2 text-base font-bold leading-7 text-white">{howToDo}</div>
            </div>
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-4">
              <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">Why</div>
              <div className="mt-2 text-base font-bold leading-7 text-white">{whyThisMatters}</div>
            </div>
          </div>
          <div className="divide-y divide-[#22314d] rounded-lg border border-[#263650] bg-[#081424]">
            {checklistRows.map(([step, label, detail]) => (
              <div key={step} className="grid gap-3 p-3 text-sm md:grid-cols-[48px_180px_1fr]">
                <div className="font-black text-sky-200">{step}</div>
                <div className="font-black text-white">{label}</div>
                <div className="leading-6 text-[#9fb1ca]">{detail}</div>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Decision Evidence" subtitle="Only the minimum context needed to understand today's instruction" right={<Badge tone={stateTone(vm.decision?.state)}>{vm.decision?.state || "setup required"}</Badge>}>
        <div className="divide-y divide-[#22314d] rounded-lg border border-[#263650] bg-[#081424]">
          {decisionRows.map(([label, value]) => (
            <div key={label} className="grid gap-3 p-3 text-sm md:grid-cols-[180px_1fr]">
              <div className="font-black text-[#8fa2bf]">{label}</div>
              <div className="font-bold leading-6 text-white">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(action?.allowedResponses || ["refresh"]).map((response: string) => <Badge key={response} tone="info">{formatAllowedResponse(response)}</Badge>)}
        </div>
      </Panel>
    </div>
  );
}

function PortfolioSnapshot({ vm, compact = false }: { vm: ReturnType<typeof buildViewModel>; compact?: boolean }) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const visibleItems = vm.items.slice(0, compact ? 5 : 12);
  const selectedItem = visibleItems.find((item: any) => String(item.symbol || "").toUpperCase() === selectedSymbol) ?? visibleItems[0] ?? null;
  return (
    <Panel title="Portfolio Snapshot" subtitle="Canonical holdings" className={compact ? "" : "xl:col-span-2"}>
      {visibleItems.length ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[#7f91ad]"><tr><th className="py-2">Symbol</th><th className="py-2 text-right">Value</th><th className="py-2 text-right">P/L</th><th className="py-2 text-right">Weight</th><th className="py-2 text-right">Coverage</th></tr></thead>
              <tbody className="divide-y divide-[#22314d]">
                {visibleItems.map((item: any) => {
                  const symbol = String(item.symbol || "").toUpperCase();
                  const value = num(item.valueEur ?? item.value_eur);
                  const pnl = num(item.unrealizedPnlEur ?? item.unrealized_pnl_eur);
                  const weight = vm.totalEur > 0 ? (value / vm.totalEur) * 100 : 0;
                  const price = num(item.price);
                  const selected = selectedItem && symbol === String(selectedItem.symbol || "").toUpperCase();
                  return (
                    <tr key={symbol} className={selected ? "bg-sky-400/8" : undefined}>
                      <td className="py-2">
                        <button type="button" onClick={() => setSelectedSymbol(symbol)} className="text-left font-bold text-white underline-offset-4 hover:text-sky-200 hover:underline">
                          {symbol}
                        </button>
                      </td>
                      <td className="py-2 text-right text-[#dbe7f8]">{fmtEUR(value)}</td>
                      <td className={clsx("py-2 text-right font-black", pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{fmtEUR(pnl, 2)}</td>
                      <td className="py-2 text-right text-[#dbe7f8]">{weight.toFixed(1)}%</td>
                      <td className="py-2 text-right">{price > 0 ? <span className="text-emerald-300">Fresh</span> : <span className="text-amber-300">Fallback</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedItem ? (
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-4">
              {(() => {
                const symbol = String(selectedItem.symbol || "").toUpperCase();
                const value = num(selectedItem.valueEur ?? selectedItem.value_eur);
                const costBasis = num(selectedItem.costBasisEur ?? selectedItem.cost_basis_eur);
                const pnl = num(selectedItem.unrealizedPnlEur ?? selectedItem.unrealized_pnl_eur);
                const pnlPct = selectedItem.unrealizedPnlPct ?? selectedItem.unrealized_pnl_pct;
                const price = num(selectedItem.price);
                const weight = vm.totalEur > 0 ? (value / vm.totalEur) * 100 : 0;
                const priceSource = String(selectedItem.priceSource ?? selectedItem.price_source ?? selectedItem.valuationSource ?? "unavailable");
                const priceAsOf = selectedItem.priceAsOf ?? selectedItem.price_as_of ?? null;
                return (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">Holding Detail</div>
                        <div className="mt-1 text-2xl font-black text-white">{symbol}</div>
                        <div className="mt-1 text-xs leading-5 text-[#8fa2bf]">{selectedItem.name || symbol}</div>
                      </div>
                      <Badge tone={price > 0 ? "good" : "warn"}>{price > 0 ? "Market priced" : "Cost fallback"}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-[#22314d] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Quantity</div><div className="mt-1 font-black text-white">{fmtNumber(selectedItem.qty)}</div></div>
                      <div className="rounded-lg border border-[#22314d] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Weight</div><div className="mt-1 font-black text-white">{weight.toFixed(1)}%</div></div>
                      <div className="rounded-lg border border-[#22314d] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Market value</div><div className="mt-1 font-black text-white">{fmtEUR(value, 2)}</div></div>
                      <div className="rounded-lg border border-[#22314d] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Cost basis</div><div className="mt-1 font-black text-white">{fmtEUR(costBasis, 2)}</div></div>
                    </div>
                    <div className="mt-3 rounded-lg border border-[#22314d] bg-[#050b14] p-3">
                      <div className="text-xs text-[#8fa2bf]">Unrealized P/L</div>
                      <div className={clsx("mt-1 text-xl font-black", pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>
                        {fmtEUR(pnl, 2)} {pnlPct == null ? "" : `(${fmtPct(pnlPct, 2)})`}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2 text-xs">
                      <StatusRow label="Last price" value={price > 0 ? fmtEUR(price, 2) : "Unavailable"} tone={price > 0 ? "good" : "warn"} />
                      <StatusRow label="Price source" value={priceSource.replace(/_/g, " ")} tone={price > 0 ? "good" : "warn"} />
                      <StatusRow label="Price time" value={fmtDateTime(priceAsOf)} tone={priceAsOf ? "good" : "warn"} />
                      <StatusRow label="Position updated" value={fmtDateTime(selectedItem.positionUpdatedAt ?? selectedItem.position_updated_at)} tone={selectedItem.positionUpdatedAt || selectedItem.position_updated_at ? "good" : "neutral"} />
                    </div>
                    {price <= 0 ? (
                      <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                        This holding is using stored cost basis because a fresh provider price was not available.
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title="No canonical holdings" detail="The page does not invent positions. Start manual tracking, import an existing holding, or use a broker connection." />
      )}
      {vm.valuationSource === "cost_basis_fallback" ? (
        <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          Current market value is partial. Holdings without a provider price are shown using stored cost basis and are not treated as fresh market valuation.
        </div>
      ) : null}
    </Panel>
  );
}

function DataLineagePanel({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const decisionSourceLabel = vm.customerDecisionSource === "persisted_daily_cycle" ? "Persisted daily cycle" : "Current read fallback";
  return (
    <Panel title="Decision & Data Lineage" subtitle="Customer-safe provenance for the current view">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={<Database className="h-4 w-4" />} label="Decision source" value={decisionSourceLabel} detail={vm.customerDecisionSource === "persisted_daily_cycle" ? "Frozen customer decision" : "Not yet frozen today"} tone={vm.customerDecisionSource === "persisted_daily_cycle" ? "good" : "warn"} />
        <MetricCard icon={<BarChart3 className="h-4 w-4" />} label="Valuation source" value={vm.valuationSource.replace(/_/g, " ")} detail={vm.valuationDetail} tone={vm.valuationSource === "market_quotes" ? "good" : "warn"} />
        <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Market snapshot" value={vm.marketSnapshotPersisted ? "Persisted" : "Read-time"} detail={vm.marketSnapshotPersisted ? "Immutable in database" : "Provider read during request"} tone={vm.marketSnapshotPersisted ? "good" : "warn"} />
      </div>
    </Panel>
  );
}

function GovernancePanel({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  return (
    <Panel title="Governance & Execution" subtitle="Manual approval and broker guardrails">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Clearance</span><span className="font-bold text-white">{vm.decision?.risk?.executionClearance || "unknown"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Approval</span><span className="font-bold text-white">{vm.decision?.action?.approvalStatus || "not available"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Turnover</span><span className="font-bold text-white">{vm.decision?.risk?.turnoverBucket || "unknown"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Live broker</span><span className={clsx("font-bold", vm.hasLiveBroker ? "text-emerald-300" : "text-amber-300")}>{vm.hasLiveBroker ? "Connected, manual submit only" : "Connector required"}</span></div>
      </div>
    </Panel>
  );
}

function BenchmarkPanel({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  return (
    <Panel title="Benchmark & Data Quality" subtitle={vm.decision?.researchPublication?.benchmarkName || "Benchmark relative validation"}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 text-sm"><span className="text-[#8fa2bf]">Validation</span><Badge tone={stateTone(vm.decision?.researchPublication?.validationStatus)}>{vm.decision?.researchPublication?.validationStatus || "unavailable"}</Badge></div>
        <div className="flex items-center justify-between gap-3 text-sm"><span className="text-[#8fa2bf]">Price coverage</span><span className="font-bold text-white">{vm.valuationDetail}</span></div>
        <div className="flex items-center justify-between gap-3 text-sm"><span className="text-[#8fa2bf]">Market snapshot</span><span className="font-bold text-white">{vm.marketSnapshotPersisted ? "Persisted" : "Read-time"}</span></div>
      </div>
    </Panel>
  );
}

function BrokerExecutionPanel({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const marketDataState =
    vm.valuationSource === "market_quotes"
      ? "Provider quotes available"
      : vm.valuationSource === "cost_basis_fallback"
        ? "Partial quote coverage"
        : "No holdings priced";
  return (
    <Panel title="Broker Execution" subtitle="Manual review, demo broker, and order state">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Queue</span><span className="font-bold text-white">{vm.queue?.operational_state || "No pending queue"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Latest order</span><span className="font-bold text-white">{vm.order?.status || "No order submitted"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Broker mode</span><span className="font-bold text-white">{vm.accountModeLabel}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[#8fa2bf]">Market data</span><span className={clsx("font-bold", vm.valuationSource === "market_quotes" ? "text-emerald-300" : "text-amber-300")}>{marketDataState}</span></div>
      </div>
    </Panel>
  );
}

function PlanPage({ vm, onRefresh }: { vm: ReturnType<typeof buildViewModel>; onRefresh: RefreshDashboard }) {
  const [goalType, setGoalType] = useState(() => inferGoalType(vm.plan?.goal, vm.settings?.goal_type));
  const [riskProfile, setRiskProfile] = useState(String(vm.settings?.risk_profile || "Balanced"));
  const [horizon, setHorizon] = useState(String(vm.settings?.horizon || "Long"));
  const [targetValue, setTargetValue] = useState(String(vm.settings?.goal_target_value || vm.settings?.goal_amount || "25000"));
  const [monthlyContribution, setMonthlyContribution] = useState(String(vm.settings?.monthly_contribution || "250"));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);

  useEffect(() => {
    setGoalType(inferGoalType(vm.plan?.goal, vm.settings?.goal_type));
    setRiskProfile(String(vm.settings?.risk_profile || "Balanced"));
    setHorizon(String(vm.settings?.horizon || "Long"));
    setTargetValue(String(vm.settings?.goal_target_value || vm.settings?.goal_amount || "25000"));
    setMonthlyContribution(String(vm.settings?.monthly_contribution || "250"));
  }, [vm.plan?.id, vm.plan?.goal, vm.settings?.risk_profile, vm.settings?.horizon, vm.settings?.goal_target_value, vm.settings?.goal_amount, vm.settings?.monthly_contribution, vm.settings?.goal_type]);

  async function savePlan(createNew: boolean) {
    if (busy) return;
    const cleanTarget = normalizedMoneyInput(targetValue);
    const cleanMonthly = monthlyContribution.trim().replace(",", ".");
    if (!cleanTarget || !/^\d{1,10}(?:\.\d{1,8})?$/.test(cleanMonthly) || Number(cleanMonthly) < 0) {
      setMessage({ tone: "warn", text: "Enter a valid target value and monthly contribution." });
      return;
    }
    setBusy(createNew ? "create_plan_version" : "save_plan");
    setMessage(null);
    try {
      const result = await fetchJSON("/api/investing/plan", {
        method: "POST",
        body: JSON.stringify({
          action: createNew ? "create_plan_version" : "save_plan",
          goalType,
          riskProfile,
          horizon,
          targetValue: cleanTarget,
          monthlyContribution: cleanMonthly,
          clientRequestId: makeClientRequestId(createNew ? "investing-plan-version" : "investing-plan-save"),
        }),
      });
      if (!result.ok) throw new Error(result.data?.error || "Plan save failed.");
      setMessage({ tone: "good", text: createNew ? "New active plan version created." : "Active plan updated." });
      await onRefresh();
    } catch (error: any) {
      setMessage({ tone: "bad", text: error?.message || "Plan save failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="Investment Policy" subtitle="Persisted mandate inputs for the daily proposal engine">
        <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#8fa2bf]">Objective</div>
              <div className="grid gap-2 md:grid-cols-2">
                {goalOptions.map((option) => {
                  const selected = goalType === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setGoalType(option.key)}
                      className={clsx(
                        "min-h-[86px] rounded-lg border p-3 text-left transition",
                        selected ? "border-sky-300/70 bg-sky-400/14" : "border-[#263650] bg-[#081424] hover:border-sky-400/35 hover:bg-[#0b1b31]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black text-white">{option.label}</span>
                        {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-200" /> : <Target className="h-4 w-4 shrink-0 text-[#6f829d]" />}
                      </div>
                      <div className="mt-2 text-xs leading-5 text-[#8fa2bf]">{option.detail}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#8fa2bf]">Risk Profile</div>
                <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[#263650] bg-[#081424]">
                  {riskOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={riskProfile === option}
                      onClick={() => setRiskProfile(option)}
                      className={clsx("min-h-10 px-2 text-xs font-black transition", riskProfile === option ? "bg-sky-400/20 text-sky-100" : "text-[#8fa2bf] hover:bg-[#102242]")}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#8fa2bf]">Horizon</div>
                <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[#263650] bg-[#081424]">
                  {horizonOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={horizon === option}
                      onClick={() => setHorizon(option)}
                      className={clsx("min-h-10 px-2 text-xs font-black transition", horizon === option ? "bg-emerald-400/18 text-emerald-100" : "text-[#8fa2bf] hover:bg-[#102242]")}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#8fa2bf]">Target EUR</span>
                <input
                  inputMode="decimal"
                  value={targetValue}
                  onChange={(event) => setTargetValue(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-[#263650] bg-[#081424] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#8fa2bf]">Monthly EUR</span>
                <input
                  inputMode="decimal"
                  value={monthlyContribution}
                  onChange={(event) => setMonthlyContribution(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-[#263650] bg-[#081424] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300"
                />
              </label>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border border-[#22314d] bg-[#081424] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.08em] text-white">Policy Status</div>
                <div className="mt-1 text-xs leading-5 text-[#8fa2bf]">{vm.plan?.goal || "No active mandate saved"}</div>
              </div>
              <Badge tone={vm.plan ? "good" : "warn"}>{vm.plan ? "Active" : "Missing"}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3">
                <div className="text-[#8fa2bf]">Objective</div>
                <div className="mt-1 font-black text-white">{goalOptions.find((option) => option.key === goalType)?.label}</div>
              </div>
              <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3">
                <div className="text-[#8fa2bf]">Target</div>
                <div className="mt-1 font-black text-white">{fmtEUR(Number(targetValue.replace(",", ".")) || 0)}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!busy ? <ActionButton tone="good" onClick={() => void savePlan(false)}>{vm.plan ? "Save Changes" : "Create Plan"}</ActionButton> : null}
              {vm.plan && !busy ? <ActionButton tone="info" onClick={() => void savePlan(true)}>New Version</ActionButton> : null}
              {busy ? <div className="rounded-lg border border-sky-400/25 bg-sky-400/10 px-4 py-2 text-sm font-bold text-sky-100">Saving...</div> : null}
            </div>
            {message ? <div className={clsx("rounded-lg border p-3 text-xs leading-5", badgeTone(message.tone))}>{message.text}</div> : null}
          </div>
        </div>
      </Panel>
      <PlanAlignmentPanel vm={vm} />
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Goal & Roadmap" subtitle="Plan inputs converted into mandate rules">
          <div className="grid gap-3 md:grid-cols-2">
            <MetricCard icon={<Target className="h-4 w-4" />} label="Primary goal" value={vm.decision?.risk?.objective || "Unavailable"} tone={vm.plan ? "good" : "warn"} />
            <MetricCard icon={<Gauge className="h-4 w-4" />} label="Risk profile" value={vm.decision?.risk?.riskProfile || "Unavailable"} tone="info" />
            <MetricCard icon={<CalendarDays className="h-4 w-4" />} label="Horizon" value={vm.decision?.risk?.horizon || "Unavailable"} tone="info" />
            <MetricCard icon={<Wallet className="h-4 w-4" />} label="Cash readiness" value={fmtEUR(vm.cashEur)} tone={vm.cashEur > 0 ? "good" : "warn"} />
          </div>
        </Panel>
        <AllocationPanel vm={vm} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Starter Pack / Eligible Instruments" subtitle="Current canonical instrument universe">
          {vm.targetRows.length ? (
            <div className="grid gap-2">
              {vm.targetRows.map((row: any) => (
                <div key={row.symbol} className="rounded-lg border border-[#22314d] bg-[#081424] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div><div className="font-bold text-white">{row.symbol}</div><div className="text-xs text-[#8fa2bf]">{row.rationale}</div></div>
                    <div className="text-right text-sm font-bold text-white">{fmtPct(row.targetWeightPct)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Starter pack unavailable" detail="The mandate engine needs an active plan before instruments are shown." />}
        </Panel>
        <Panel title="Execution Path" subtitle="Plan to daily decision flow">
          <div className="grid gap-3 md:grid-cols-4">
            {["Plan", "Mandate", "Target portfolio", "Daily decision"].map((step) => <div key={step} className="rounded-lg border border-[#22314d] bg-[#081424] p-3 text-sm font-bold text-white">{step}</div>)}
          </div>
          <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/8 p-3 text-sm text-emerald-100">All displayed values are planning views only. No future performance is guaranteed.</div>
        </Panel>
      </div>
    </div>
  );
}

function PortfolioFundingPanel({ vm, onRefresh }: { vm: ReturnType<typeof buildViewModel>; onRefresh: RefreshDashboard }) {
  const router = useRouter();
  const [openingSymbol, setOpeningSymbol] = useState("");
  const [holdingSearchFocused, setHoldingSearchFocused] = useState(false);
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingTotalCost, setOpeningTotalCost] = useState("");
  const [openingAcquiredAt, setOpeningAcquiredAt] = useState("");
  const [showPreparedPortfolio, setShowPreparedPortfolio] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const accountId = String(vm.portfolio?.accountId || "");
  const hasPlan = Boolean(vm.plan);
  const hasAccount = vm.hasActiveAccount && Boolean(accountId);
  const canShowImportForm = hasPlan || hasAccount || vm.items.length > 0;
  const holdingSuggestions = useMemo(() => buildHoldingSuggestions(vm), [vm]);
  const filteredHoldingSuggestions = useMemo(() => {
    const query = openingSymbol.trim().toLowerCase();
    const source = query
      ? holdingSuggestions.filter((item) => item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
      : holdingSuggestions;
    return source.slice(0, 8);
  }, [holdingSuggestions, openingSymbol]);
  const showHoldingAutocomplete = holdingSearchFocused && filteredHoldingSuggestions.length > 0;

  function chooseHoldingSuggestion(item: HoldingSuggestion) {
    setOpeningSymbol(item.symbol);
    setHoldingSearchFocused(false);
  }

  async function run(label: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await work();
      await onRefresh();
    } catch (error: any) {
      setMessage({ tone: "bad", text: error?.message || "Investing action failed." });
    } finally {
      setBusy(null);
    }
  }

  async function openTrackingAccount() {
    await run("open_tracking_account", async () => {
      const result = await fetchJSON("/api/investing/accounts", {
        method: "POST",
        body: JSON.stringify({
          action: "open_tracking_account",
          portfolioId: "primary",
          environment: "simulation",
          currency: "EUR",
          clientRequestId: makeClientRequestId("portfolio-tracking-account"),
        }),
      });
      if (!result.ok) throw new Error(result.data?.error || "Failed to start manual tracking.");
      setMessage({ tone: "good", text: "Manual tracking is active. You can now import existing holdings without connecting a broker." });
    });
  }

  async function importOpeningPosition() {
    const symbol = resolveHoldingSymbol(openingSymbol, holdingSuggestions);
    const quantity = normalizedQuantityInput(openingQuantity);
    const totalCost = normalizedMoneyInput(openingTotalCost);
    const acquiredAt = normalizedPastDateInput(openingAcquiredAt);
    if (!accountId || !/^[A-Z0-9._-]{1,24}$/.test(symbol) || !quantity || !totalCost || !acquiredAt) {
      setMessage({ tone: "warn", text: "Enter a valid symbol, quantity, total cost, and acquisition date." });
      return;
    }
    await run("opening_position", async () => {
      const result = await fetchJSON(`/api/investing/accounts/${accountId}/movements`, {
        method: "POST",
        body: JSON.stringify({
          action: "opening_position",
          environment: "simulation",
          symbol,
          quantity,
          totalCost,
          currency: "EUR",
          acquiredAt,
          clientRequestId: makeClientRequestId(`portfolio-opening-position-${symbol.toLowerCase()}`),
        }),
      });
      if (!result.ok) throw new Error(result.data?.error || "Failed to import existing holding.");
      setOpeningSymbol("");
      setOpeningQuantity("");
      setOpeningTotalCost("");
      setOpeningAcquiredAt("");
      setMessage({ tone: "good", text: `${symbol} imported into manual tracking. Market value will use provider quotes when available.` });
    });
  }

  const steps = [
    { label: "Plan", detail: hasPlan ? "Active Investing plan found" : "Plan required first", done: hasPlan },
    { label: "Choice", detail: vm.items.length ? "Existing holdings imported" : "Import holdings or review prepared portfolio", done: vm.items.length > 0 || showPreparedPortfolio },
    { label: "Tracking", detail: hasAccount ? "Manual tracking account active" : "Start manual tracking before importing", done: hasAccount },
    { label: "Holdings", detail: vm.items.length ? `${vm.items.length} canonical holdings` : "No holdings stored yet", done: vm.items.length > 0 },
    { label: "Today", detail: vm.items.length ? "Ready for daily instruction" : "Unlocked after portfolio evidence", done: vm.items.length > 0 },
  ];

  return (
    <Panel title="Portfolio Setup & Holdings" subtitle="Import existing holdings or review a Syntrake prepared portfolio from the saved plan">
      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="grid gap-2 md:grid-cols-5">
          {steps.map((step) => (
            <div key={step.label} className="rounded-lg border border-[#22314d] bg-[#081424] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-black uppercase tracking-[0.08em] text-white">{step.label}</div>
                {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
              </div>
              <div className="mt-2 text-xs leading-5 text-[#8fa2bf]">{step.detail}</div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {!hasPlan ? <ActionButton tone="warn" onClick={() => router.push("/app?tab=planning&mode=investing")}>Open Plan</ActionButton> : null}
            {!hasAccount && !busy ? <ActionButton tone="good" onClick={openTrackingAccount}>Start manual tracking</ActionButton> : null}
            {hasPlan && !vm.items.length && !busy ? <ActionButton tone="info" onClick={() => setShowPreparedPortfolio((value) => !value)}>{showPreparedPortfolio ? "Hide prepared portfolio" : "Prepare portfolio"}</ActionButton> : null}
            {hasPlan ? <ActionButton tone="neutral" onClick={() => router.push("/app?tab=broker&mode=investing")}>Open Broker</ActionButton> : null}
            {busy ? <div className="rounded-lg border border-sky-400/25 bg-sky-400/10 px-4 py-2 text-sm font-bold text-sky-100">Working...</div> : null}
          </div>
          {hasPlan && !vm.items.length ? (
            <div className="rounded-lg border border-[#22314d] bg-[#081424] p-3">
              <div className="text-xs font-black uppercase tracking-[0.08em] text-white">No holdings yet</div>
              <div className="mt-2 text-xs leading-5 text-[#8fa2bf]">
                Choose one path: import the positions you already own, or review the portfolio Syntrake prepares from the saved plan. Broker connection stays in Broker.
              </div>
            </div>
          ) : null}
          {showPreparedPortfolio ? (
            <div className="rounded-lg border border-sky-400/20 bg-sky-400/8 p-3">
              <div className="text-xs font-black uppercase tracking-[0.08em] text-sky-100">Syntrake prepared portfolio</div>
              <div className="mt-2 text-xs leading-5 text-sky-100/85">
                Planning proposal only. Review the instruments and amounts before using Broker or importing real holdings.
              </div>
              <div className="mt-3 space-y-2">
                {vm.targetRows.length ? vm.targetRows.slice(0, 8).map((row: any) => (
                  <div key={row.symbol} className="flex items-center justify-between gap-3 rounded-lg border border-[#263650] bg-[#050b14] p-2 text-xs">
                    <div>
                      <div className="font-black text-white">{row.symbol}</div>
                      <div className="mt-1 text-[#8fa2bf]">{row.rationale}</div>
                    </div>
                    <div className="text-right font-black text-white">{fmtEUR(row.targetValueEur)}</div>
                  </div>
                )) : <EmptyState title="Prepared portfolio unavailable" detail="Save a plan before Syntrake can prepare portfolio targets." />}
              </div>
            </div>
          ) : null}
          {canShowImportForm ? (
            <div className="rounded-lg border border-[#22314d] bg-[#081424] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.08em] text-white">Import existing holding</div>
                  <div className="mt-1 text-xs leading-5 text-[#8fa2bf]">
                    {hasAccount
                      ? "Use quantity and total historical cost. Market value comes from provider quotes."
                      : "Start manual tracking first. You can still search symbols here before importing."}
                  </div>
                </div>
                <Database className="h-4 w-4 shrink-0 text-sky-200" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="relative sm:col-span-2">
                  <input
                    aria-autocomplete="list"
                    aria-controls="opening-holding-suggestion-list"
                    aria-expanded={showHoldingAutocomplete}
                    aria-label="Opening position symbol"
                    autoComplete="off"
                    role="combobox"
                    value={openingSymbol}
                    onBlur={() => setTimeout(() => setHoldingSearchFocused(false), 120)}
                    onChange={(event) => setOpeningSymbol(event.target.value)}
                    onFocus={() => setHoldingSearchFocused(true)}
                    placeholder="Search symbol or company"
                    className="w-full rounded-lg border border-[#263650] bg-[#050b14] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300"
                  />
                  {showHoldingAutocomplete ? (
                    <div
                      id="opening-holding-suggestion-list"
                      role="listbox"
                      className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-[#263650] bg-[#071221] shadow-[0_18px_45px_rgba(0,0,0,.45)]"
                    >
                      {filteredHoldingSuggestions.map((item) => (
                        <button
                          key={item.symbol}
                          type="button"
                          role="option"
                          aria-selected={openingSymbol.trim().toLowerCase() === item.symbol.toLowerCase()}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            chooseHoldingSuggestion(item);
                          }}
                          className="flex w-full items-center justify-between gap-3 border-b border-[#17243b] px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-sky-400/10 focus:bg-sky-400/10 focus:outline-none"
                        >
                          <span className="shrink-0 font-black text-white">{item.symbol}</span>
                          <span className="min-w-0 truncate text-xs font-semibold text-[#8fa2bf]">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input
                  aria-label="Opening position quantity"
                  inputMode="decimal"
                  value={openingQuantity}
                  onChange={(event) => setOpeningQuantity(event.target.value)}
                  placeholder="Quantity"
                  className="w-full rounded-lg border border-[#263650] bg-[#050b14] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300"
                />
                <input
                  aria-label="Opening position total cost"
                  inputMode="decimal"
                  value={openingTotalCost}
                  onChange={(event) => setOpeningTotalCost(event.target.value)}
                  placeholder="Total cost EUR"
                  className="w-full rounded-lg border border-[#263650] bg-[#050b14] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300"
                />
                <input
                  aria-label="Opening position acquisition date"
                  type="date"
                  value={openingAcquiredAt}
                  onChange={(event) => setOpeningAcquiredAt(event.target.value)}
                  className="w-full rounded-lg border border-[#263650] bg-[#050b14] px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-300"
                />
              </div>
              <div className="mt-3 flex justify-end">
                {!busy ? <ActionButton tone={hasAccount ? "info" : "warn"} onClick={importOpeningPosition}>{hasAccount ? "Import existing holding" : "Start tracking first"}</ActionButton> : null}
              </div>
            </div>
          ) : null}
          {message ? <div className={clsx("rounded-lg border p-3 text-xs leading-5", badgeTone(message.tone))}>{message.text}</div> : null}
        </div>
      </div>
    </Panel>
  );
}

function PortfolioPage({ vm, onRefresh }: { vm: ReturnType<typeof buildViewModel>; onRefresh: RefreshDashboard }) {
  return (
    <div className="space-y-3">
      <PortfolioFundingPanel vm={vm} onRefresh={onRefresh} />
      <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
        <AllocationPanel vm={vm} />
        <Panel title={vm.canShowExecutableRebalance ? "Concentration & Drift Analysis" : "Indicative Target Gap"} subtitle={vm.canShowExecutableRebalance ? "Instrument weight against mandate target" : "Planning view until a daily proposal exists"}>
          {vm.actionRows.length && vm.canShowExecutableRebalance ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[#7f91ad]"><tr><th className="py-2">Instrument</th><th className="py-2 text-right">Current</th><th className="py-2 text-right">Target</th><th className="py-2 text-right">Delta</th><th className="py-2 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-[#22314d]">
                  {vm.actionRows.map((row: any) => (
                    <tr key={row.symbol}><td className="py-2 font-bold text-white">{row.symbol}</td><td className="py-2 text-right">{fmtPct(row.currentWeightPct)}</td><td className="py-2 text-right">{fmtPct(row.targetWeightPct)}</td><td className="py-2 text-right font-bold">{fmtEUR(row.deltaValueEur)}</td><td className="py-2 text-right"><Badge tone={row.side === "hold" ? "neutral" : "good"}>{row.side}</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : vm.actionRows.length ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100">
                These rows are not executable yet. Create a daily proposal before the system can present manually-submitted broker trades.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#7f91ad]"><tr><th className="py-2">Instrument</th><th className="py-2 text-right">Target</th><th className="py-2 text-right">Indicative gap</th><th className="py-2 text-right">State</th></tr></thead>
                  <tbody className="divide-y divide-[#22314d]">
                    {vm.actionRows.map((row: any) => (
                      <tr key={row.symbol}><td className="py-2 font-bold text-white">{row.symbol}</td><td className="py-2 text-right">{fmtPct(row.targetWeightPct)}</td><td className="py-2 text-right font-bold">{fmtEUR(row.deltaValueEur)}</td><td className="py-2 text-right"><Badge tone="warn">proposal first</Badge></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : <EmptyState title="No rebalance rows" detail="There are no executable rebalance actions in the current customer decision projection." />}
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.3fr_.7fr]">
        <PortfolioSnapshot vm={vm} />
        <BenchmarkPanel vm={vm} />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <BrokerExecutionPanel vm={vm} />
        <Panel title="Recent Decision Receipts" subtitle="Daily cycle history">
          {vm.receipts.length ? vm.receipts.slice(0, 4).map((row: any) => <div key={row.id} className="border-b border-[#22314d] py-2 text-sm text-[#dbe7f8] last:border-0">{fmtDateTime(row.at)}</div>) : <EmptyState title="No receipts" detail="Close a daily cycle to create a receipt." />}
        </Panel>
        <Panel title="Reconciliation & Health" subtitle="Operational checks">
          <StatusRow label="Portfolio reconciliation" value={vm.receipts.length ? "Receipts present" : "Unavailable"} tone={vm.receipts.length ? "good" : "warn"} />
          <StatusRow label="Cash reconciliation" value={vm.hasActiveAccount ? "Read model only" : "Unavailable"} tone={vm.hasActiveAccount ? "warn" : "neutral"} />
          <StatusRow label="Valuation check" value={vm.valuationDetail} tone={vm.coveragePct >= 90 && vm.valuationSource === "market_quotes" ? "good" : "warn"} />
          <StatusRow label="Data integrity" value={vm.decision ? "Projection returned" : "Unavailable"} tone={vm.decision ? "warn" : "neutral"} />
        </Panel>
      </div>
    </div>
  );
}

function BrokerPage({ vm, onRefresh }: { vm: ReturnType<typeof buildViewModel>; onRefresh: RefreshDashboard }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);

  async function run(label: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await work();
      await onRefresh();
    } catch (error: any) {
      setMessage({ tone: "bad", text: error?.message || "Broker action failed." });
    } finally {
      setBusy(null);
    }
  }

  async function connectDemoBroker() {
    await run("connect_demo_broker", async () => {
      const result = await fetchJSON("/api/investing/broker/connections", {
        method: "POST",
        body: JSON.stringify({
          action: "connect_demo_broker",
          portfolioId: "primary",
          currency: "EUR",
          clientRequestId: makeClientRequestId("broker-demo"),
        }),
      });
      if (!result.ok) throw new Error(result.data?.error || "Demo broker connector required.");
      setMessage({ tone: "good", text: "Demo broker connected. Syntrake will still require manual order review and submit." });
    });
  }

  async function connectLiveBroker() {
    await run("connect_live_broker", async () => {
      const result = await fetchJSON("/api/investing/broker/connections", {
        method: "POST",
        body: JSON.stringify({
          action: "connect_live_broker",
          portfolioId: "primary",
          currency: "EUR",
          clientRequestId: makeClientRequestId("broker-live"),
        }),
      });
      if (!result.ok) throw new Error(result.data?.error || "Live broker connector required.");
      setMessage({ tone: "good", text: "Live broker connected. Syntrake will still require manual order submission." });
    });
  }

  const connectionCards = [
    {
      title: "Demo broker",
      state: vm.hasDemoBroker ? "Connected" : "Available",
      detail: "Connect a real broker demo/paper account. Until a provider connector exists, this remains connector-required.",
      tone: vm.hasDemoBroker ? "good" : "warn",
    },
    {
      title: "Live broker",
      state: vm.hasLiveBroker ? "Connected" : "Connector required",
      detail: "Use this for real accounts only after regulated broker authorization is configured. Orders remain manual.",
      tone: vm.hasLiveBroker ? "good" : "warn",
    },
    {
      title: "Manual submit",
      state: "Required",
      detail: "Syntrake can prepare a ticket; the client decides and submits. No automatic live execution.",
      tone: "warn",
    },
  ] as const;

  const clientSteps = [
    ["1. Choose connection", "Demo broker or live broker. Manual holdings stay in Portfolio and do not pretend to be a broker connection."],
    ["2. Authorize account", "The user authorizes the broker connector. Demo uses demo/paper credentials; live uses real broker authorization."],
    ["3. Sync holdings", "Broker holdings are read from the connection. Existing non-broker holdings are imported manually in Portfolio."],
    ["4. Read Syntrake proposal", "The bot explains drift, risk, target gap, cost estimate, and why action is or is not needed."],
    ["5. Review order ticket", "The client checks instrument, side, quantity, estimated cost, risk, and expiration before submit."],
    ["6. Submit manually", "Only the client presses the broker submit button. Syntrake does not auto-send live orders."],
    ["7. Store receipt", "After submit/fill, Syntrake records receipts and updates the portfolio state."],
  ];

  return (
    <div className="space-y-3">
      <Panel title="Broker Connection" subtitle="One dedicated place for demo broker and live broker setup" right={<Badge tone={vm.brokerConnectionTone}>{vm.brokerConnectionLabel}</Badge>}>
        <div className="grid gap-3 lg:grid-cols-3">
          {connectionCards.map((card) => (
            <div key={card.title} className="rounded-lg border border-[#22314d] bg-[#081424] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-white">{card.title}</div>
                  <div className="mt-2 text-xs leading-5 text-[#8fa2bf]">{card.detail}</div>
                </div>
                <Badge tone={card.tone as Tone}>{card.state}</Badge>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,360px)_1fr]">
          <div className="rounded-lg border border-[#22314d] bg-[#081424] p-4">
            <div className="text-sm font-black text-white">Broker authorization</div>
            <div className="mt-2 text-xs leading-5 text-[#8fa2bf]">
              A broker connection must be a real provider connection. Demo means the broker paper/demo account; live means the real account. Syntrake does not create a fake broker account here.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {!busy ? <ActionButton tone="info" onClick={connectDemoBroker}>Connect demo broker</ActionButton> : null}
              {!busy ? <ActionButton tone="warn" onClick={connectLiveBroker}>Connect live broker</ActionButton> : null}
              {busy ? <div className="rounded-lg border border-sky-400/25 bg-sky-400/10 px-4 py-2 text-sm font-bold text-sky-100">Working...</div> : null}
            </div>
            {vm.queue?.id ? (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                Queue is {vm.queue.operational_state || "present"} with approval {vm.queue.approval_status || "unknown"}. Broker submit appears only after a real demo/live connector exists and the user approves the ticket.
              </div>
            ) : null}
            {message ? <div className={clsx("mt-3 rounded-lg border p-3 text-xs leading-5", badgeTone(message.tone))}>{message.text}</div> : null}
          </div>
          <div className="rounded-lg border border-[#22314d] bg-[#081424] p-4">
            <div className="text-sm font-black text-white">What the client must know and do</div>
            <div className="mt-3 grid gap-2">
              {clientSteps.map(([title, detail]) => (
                <div key={title} className="rounded-lg border border-[#263650] bg-[#050b14] p-3">
                  <div className="text-xs font-black uppercase tracking-[0.08em] text-white">{title}</div>
                  <div className="mt-1 text-xs leading-5 text-[#8fa2bf]">{detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="Manual Bot Workflow" subtitle="Automated guidance without automatic execution">
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Observe", "Read plan, portfolio, prices, cash, and broker state."],
            ["Decide", "Explain the next action and the reason."],
            ["Prepare", "Build a reviewable order ticket or a no-action receipt."],
            ["Submit", "Wait for explicit client submit in demo or live broker."],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-lg border border-[#22314d] bg-[#081424] p-3">
              <div className="text-sm font-black text-white">{title}</div>
              <div className="mt-2 text-xs leading-5 text-[#8fa2bf]">{detail}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ResearchPage({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const scorecards = Array.isArray(vm.runtime?.instrumentScorecards) ? vm.runtime.instrumentScorecards : [];
  const warnings = vm.decision?.researchPublication?.warnings || [];
  const opportunities = Array.isArray(vm.opportunities) ? vm.opportunities : [];
  return (
    <div className="space-y-3">
      <Panel title="Research Opportunities" subtitle="Customer-safe ideas that may improve the selected plan and portfolio" right={<Badge tone="warn">Lab promotion pending</Badge>}>
        {opportunities.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {opportunities.slice(0, 8).map((item: any) => {
              const actionLabel = String(item.action || "").replace(/_/g, " ");
              const price = num(item.price);
              const warningCount = Array.isArray(item.warnings) ? item.warnings.length : 0;
              return (
                <div key={item.symbol} className="rounded-lg border border-[#22314d] bg-[#081424] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">{actionLabel}</div>
                      <div className="mt-1 text-xl font-black text-white">{item.symbol}</div>
                      <div className="mt-1 text-xs leading-5 text-[#8fa2bf]">{item.name || item.symbol}</div>
                    </div>
                    <Badge tone={item.fit === "high" ? "good" : item.fit === "low" ? "warn" : "info"}>{item.fit || "fit"}</Badge>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[#dbe7f8]">{item.rationale}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Target weight</div><div className="mt-1 font-black text-white">{fmtPct(item.targetWeightPct)}</div></div>
                    <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Target value</div><div className="mt-1 font-black text-white">{fmtEUR(item.targetValueEur, 2)}</div></div>
                    <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Latest price</div><div className="mt-1 font-black text-white">{price > 0 ? fmtEUR(price, 2) : "Unavailable"}</div></div>
                    <div className="rounded-lg border border-[#263650] bg-[#050b14] p-3"><div className="text-[#8fa2bf]">Score</div><div className="mt-1 font-black text-white">{item.score == null ? "n/a" : num(item.score).toFixed(0)}</div></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={item.currentState === "already_held" ? "info" : "neutral"}>{String(item.currentState || "unknown").replace(/_/g, " ")}</Badge>
                    <Badge tone={price > 0 ? "good" : "warn"}>{price > 0 ? String(item.priceSource || "priced").replace(/_/g, " ") : "price unavailable"}</Badge>
                    <Badge tone="warn">{String(item.labValidation || "not connected").replace(/_/g, " ")}</Badge>
                    {warningCount ? <Badge tone="warn">{warningCount} warnings</Badge> : null}
                  </div>
                  <div className="mt-3 rounded-lg border border-sky-400/20 bg-sky-400/8 p-3 text-xs leading-5 text-sky-100">{item.suitabilityWarning}</div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="No customer-safe opportunities yet" detail="Save a plan first. Syntrake will then derive mandate-fit opportunities without exposing the raw Research Lab." />}
      </Panel>
      <div className="grid gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <Panel title="Instrument Evidence" subtitle="Compressed scorecards used behind the opportunity list">
          {scorecards.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {scorecards.slice(0, 8).map((card: any) => <div key={card.symbol} className="rounded-lg border border-[#22314d] bg-[#081424] p-3"><div className="text-sm font-black text-white">{card.symbol}</div><div className="mt-2 text-3xl font-black text-emerald-300">{num(card.compositeScore).toFixed(0)}</div><div className="mt-1 text-xs text-[#8fa2bf]">Mandate fit: {card.mandateFit || "unknown"}</div><div className="mt-3 flex flex-wrap gap-1">{(card.strengths || []).slice(0, 2).map((s: string) => <Badge key={s} tone="good">{s.replace(/_/g, " ")}</Badge>)}</div></div>)}
            </div>
          ) : <EmptyState title="Scorecards unavailable" detail="No scorecards are present in the canonical runtime payload." />}
        </Panel>
        <BenchmarkPanel vm={vm} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Research Rationale" subtitle="Why eligible instruments fit the current mandate">
          {vm.targetRows.length ? vm.targetRows.map((row: any) => <div key={row.symbol} className="border-b border-[#22314d] py-3 last:border-0"><div className="font-bold text-white">{row.symbol}</div><div className="mt-1 text-sm leading-6 text-[#9fb1ca]">{row.rationale}</div></div>) : <EmptyState title="Rationale unavailable" detail="No target allocation rationale is available yet." />}
        </Panel>
        <Panel title="Warnings & Review Notes" subtitle="Validation notes only">
          {warnings.length ? warnings.slice(0, 8).map((warning: string) => <div key={warning} className="flex gap-3 border-b border-[#22314d] py-3 text-sm last:border-0"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><span className="text-[#dbe7f8]">{warning}</span></div>) : <EmptyState title="No review notes" detail="No heuristic warnings were returned by the current runtime." />}
          <div className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/8 p-3 text-xs leading-5 text-sky-100">{vm.decision?.researchPublication?.disclaimer || "This page is validation oriented and does not claim published institutional research."}</div>
        </Panel>
      </div>
    </div>
  );
}

function ReportsPage({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const attribution = vm.decision?.performanceAttribution;
  const report = vm.reportSummary;
  const current = report?.current ?? {};
  const month = report?.periods?.monthToDate ?? {};
  const quarter = report?.periods?.quarterToDate ?? {};
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[1.1fr_.9fr]">
        <Panel title="Monthly & Quarterly Report" subtitle="Built from saved daily-cycle receipts and the latest portfolio snapshot" right={<Badge tone={stateTone(report?.dataQuality)}>{report?.dataQuality || "unavailable"}</Badge>}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-4">
              <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">Month to date</div>
              <div className="mt-1 text-2xl font-black text-white">{month.label || "Unavailable"}</div>
              <div className="mt-2 text-sm leading-6 text-[#9fb1ca]">{num(month.snapshotCount)} saved daily receipts available for this period.</div>
            </div>
            <div className="rounded-lg border border-[#263650] bg-[#081424] p-4">
              <div className="text-xs font-black uppercase tracking-[0.08em] text-[#8fa2bf]">Quarter to date</div>
              <div className="mt-1 text-2xl font-black text-white">{quarter.label || "Unavailable"}</div>
              <div className="mt-2 text-sm leading-6 text-[#9fb1ca]">{num(quarter.snapshotCount)} saved daily receipts available for this period.</div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <MetricCard icon={<Wallet className="h-4 w-4" />} label="Total value" value={fmtEUR(current.totalEur ?? vm.totalEur, 2)} tone="info" />
            <MetricCard icon={<PieChart className="h-4 w-4" />} label="Holdings" value={fmtEUR(current.holdingsValueEur ?? Math.max(0, vm.totalEur - vm.cashEur), 2)} tone="info" />
            <MetricCard icon={<Wallet className="h-4 w-4" />} label="Monthly plan" value={fmtEUR(current.monthlyContributionEur ?? vm.monthlyContributionEur, 2)} tone="good" />
            <MetricCard icon={<Database className="h-4 w-4" />} label="Receipts" value={report?.snapshotsAvailable ?? vm.receipts.length} tone={vm.receipts.length ? "good" : "warn"} />
          </div>
        </Panel>
        <Panel title="Decision & Execution Summary" subtitle="Receipts and broker lifecycle">
          <div className="grid gap-3 md:grid-cols-2">
            <MetricCard icon={<Target className="h-4 w-4" />} label="Decision receipts" value={vm.receipts.length} tone={vm.receipts.length ? "good" : "warn"} />
            <MetricCard icon={<Activity className="h-4 w-4" />} label="Latest queue" value={vm.queue?.operational_state || "None"} tone={stateTone(vm.queue?.operational_state)} />
            <MetricCard icon={<Wallet className="h-4 w-4" />} label="Broker order" value={vm.order?.status || "None"} tone={stateTone(vm.order?.status)} />
            <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Reconciliation" value={vm.receipts.length ? "Receipts present" : "Unavailable"} tone={vm.receipts.length ? "good" : "warn"} />
          </div>
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Activity Timeline" subtitle="Latest daily receipts">
          {vm.receipts.length ? vm.receipts.slice(0, 6).map((row: any) => <div key={row.id} className="border-b border-[#22314d] py-2 text-sm last:border-0"><div className="font-bold text-white">{fmtDateTime(row.at)}</div><div className="text-xs text-[#8fa2bf]">{row.dayKey || row.day_key || "daily cycle"}</div></div>) : <EmptyState title="No activity timeline" detail="No daily-cycle receipts were returned." />}
        </Panel>
        <Panel title="Allocation & Drift Report" subtitle="By asset class">
          <div className="space-y-2">
            {vm.allocationRows.filter((row) => row.currentWeight > 0 || row.targetWeight > 0).map((row) => (
              <div key={row.asset} className="flex items-center justify-between gap-3 border-b border-[#22314d] py-2 text-sm last:border-0">
                <span className="inline-flex items-center gap-2 font-bold text-white">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                  {row.label}
                </span>
                <span className="text-right text-[#dbe7f8]">{row.currentWeight.toFixed(1)}% / {row.targetWeight.toFixed(1)}%</span>
                <span className={clsx("text-right font-bold", Math.abs(row.drift) <= 1 ? "text-emerald-300" : "text-amber-300")}>{fmtPct(row.drift)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Cost & Governance Summary" subtitle="Estimated, not realized">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[#8fa2bf]">Estimated cost</span><span className="font-bold text-white">{fmtEUR(vm.decision?.costs?.estimatedRoundTripCostEur || 0, 2)}</span></div>
            <div className="flex justify-between"><span className="text-[#8fa2bf]">Unrealized P/L</span><span className="font-bold text-white">{current.unrealizedPnlEur == null && attribution?.totalUnrealizedPnlEur == null ? "Unavailable" : fmtEUR(current.unrealizedPnlEur ?? attribution?.totalUnrealizedPnlEur, 2)}</span></div>
            <div className="flex justify-between"><span className="text-[#8fa2bf]">Governance</span><span className="font-bold text-white">{vm.decision?.risk?.governanceStatus || "unknown"}</span></div>
            <div className="flex justify-between"><span className="text-[#8fa2bf]">Valuation source</span><span className="font-bold text-white">{String(current.valuationSource || vm.valuationSource).replace(/_/g, " ")}</span></div>
          </div>
          <div className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/8 p-3 text-xs leading-5 text-sky-100">Reports reflect manual tracking, broker activity, and operational snapshots only, not guaranteed outcomes.</div>
        </Panel>
      </div>
      <Panel title="Report Limitations" subtitle="What this v1 report can and cannot prove">
        <div className="grid gap-2 md:grid-cols-3">
          {(report?.limitations || [
            "Report v1 uses the latest dashboard valuation and the available daily-cycle receipts.",
            "It does not yet compute full time-weighted return, dividends, realized tax, fees or benchmark attribution.",
            "Monthly and quarterly figures become stronger as more immutable daily cycles are saved.",
          ]).map((item: string) => (
            <div key={item} className="rounded-lg border border-[#263650] bg-[#081424] p-3 text-sm leading-6 text-[#dbe7f8]">{item}</div>
          ))}
        </div>
      </Panel>
      <DataLineagePanel vm={vm} />
    </div>
  );
}

function AutonomyPage({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[1fr_.8fr]">
        <Panel title="Copilot Control Tower" subtitle="Advisor proposals with manual broker submission" right={<Badge tone={vm.hasLiveBroker ? "good" : "warn"}>{vm.hasLiveBroker ? "Live broker connected" : "Live broker connector required"}</Badge>}>
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Copilot mode" value="Supervised" detail="Human approval required" tone="info" />
            <MetricCard icon={<Wallet className="h-4 w-4" />} label="Environment" value={vm.accountModeLabel} detail={vm.hasLiveBroker ? "Manual submit only" : "No live connector yet"} tone={vm.hasActiveAccount ? "good" : "warn"} />
            <MetricCard icon={<Lock className="h-4 w-4" />} label="Live status" value={vm.hasLiveBroker ? "Manual" : "Connector required"} detail="No autonomous execution" tone={vm.hasLiveBroker ? "good" : "warn"} />
          </div>
          <div className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/8 p-4 text-sm leading-6 text-sky-100">The advisor can prepare and explain proposals. Broker submission remains a user-controlled manual action.</div>
        </Panel>
        <Panel title="Operational Checklist" subtitle="Readiness for supervised broker workflow">
          {[
            ["Canonical projection returned", Boolean(vm.decision)],
            ["Approval required", Boolean(vm.decision?.action?.approvalRequired)],
            ["Investing account active", vm.hasActiveAccount],
            ["Data quality high", vm.coveragePct >= 90],
            ["Autonomous live execution disabled", true],
          ].map(([label, ok]) => <div key={String(label)} className="flex items-center justify-between border-b border-[#22314d] py-2 text-sm last:border-0"><span className="text-[#dbe7f8]">{String(label)}</span>{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}</div>)}
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <GovernancePanel vm={vm} />
        <BrokerExecutionPanel vm={vm} />
        <Panel title="Diagnostics & Control" subtitle="No hidden live controls">
          <div className="space-y-2 text-sm">
            <StatusRow label="Trading execution route" value="Isolated from Investing" tone="info" />
            <StatusRow label="Worker heartbeat" value={vm.order?.updated_at ? fmtDateTime(vm.order.updated_at) : "Unavailable"} tone={vm.order?.updated_at ? "good" : "neutral"} />
            <StatusRow label="Copilot logs" value={vm.receipts.length ? "Receipts present" : "No recent logs"} tone={vm.receipts.length ? "good" : "warn"} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SettingsPage({ vm }: { vm: ReturnType<typeof buildViewModel> }) {
  const settingGroups = [
    ["Account & Execution", [["Environment", vm.accountModeLabel], ["Manual approval", vm.decision?.action?.approvalRequired ? "Required" : "Policy controlled"], ["Demo broker", vm.hasDemoBroker ? "Connected" : "Connector required"], ["Live broker", vm.hasLiveBroker ? "Connected, manual submit" : "Connector required"]]],
    ["Plan Preferences", [["Risk profile", vm.decision?.risk?.riskProfile || "Unavailable"], ["Horizon", vm.decision?.risk?.horizon || "Unavailable"], ["Target policy", vm.allocationRows.map((r) => `${r.label} ${r.targetWeight.toFixed(0)}%`).join(" / ") || "Unavailable"]]],
    ["Valuation & Data Quality", [["Price coverage", `${vm.coveragePct}%`], ["Price source status", vm.valuationSource], ["Fallback policy", "Explicitly flagged when used"]]],
    ["Notifications & Reviews", [["Daily reminders", "Not exposed"], ["Proposal expiry alerts", "Not exposed"], ["Approval notifications", "Not exposed"], ["Reconciliation alerts", "Not exposed"]]],
    ["Research & Reporting", [["Research status", vm.decision?.researchPublication?.status || "unavailable"], ["Display currency", "EUR"], ["Report format", "PDF / CSV planned"]]],
    ["Security & Access", [["Security posture", "Managed by account provider"], ["Trusted devices", "Unavailable"], ["Two-factor", "Managed by account provider"]]],
  ];
  return (
    <div className="space-y-3">
      <TopMetrics vm={vm} />
      <div className="rounded-lg border border-sky-400/20 bg-sky-400/8 p-3 text-sm text-sky-100">You are operating in a manual investing workflow. Advisor proposals do not execute without an explicit broker submit action.</div>
      <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
        <div className="grid gap-3 md:grid-cols-2">
          {settingGroups.map(([title, rows]) => (
            <Panel key={String(title)} title={title} subtitle="Controlled broker/manual setting">
              {(rows as string[][]).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-[#22314d] py-2 text-sm last:border-0">
                  <span className="text-[#8fa2bf]">{label}</span>
                  <span className={clsx("font-bold", String(value).toLowerCase().includes("blocked") ? "text-rose-300" : "text-white")}>{value}</span>
                </div>
              ))}
            </Panel>
          ))}
        </div>
        <Panel title="Settings Summary" subtitle="Review key controls at a glance">
          <div className="space-y-3">
            <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Account mode" value={vm.accountModeLabel} tone={vm.hasActiveAccount ? "good" : "warn"} />
            <MetricCard icon={<Bell className="h-4 w-4" />} label="Decision flow" value={vm.decision?.action?.approvalRequired ? "Manual approval" : "Policy controlled"} tone="warn" />
            <MetricCard icon={<Lock className="h-4 w-4" />} label="Live execution" value={vm.hasLiveBroker ? "Manual only" : "Connector required"} tone={vm.hasLiveBroker ? "good" : "warn"} />
          </div>
          <div className="mt-4 rounded-lg border border-[#263650] bg-[#0b1729] px-4 py-3 text-sm font-semibold leading-6 text-[#9fb1ca]">
            Settings reset is not exposed in this broker/manual dashboard. Enforced controls are read-only here.
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function InvestingDashboardSurface({ page }: { page: InvestingSurfacePage }) {
  const router = useRouter();
  const { lang } = useSiteLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (shouldApply: () => boolean = () => true) => {
    setLoading(true);
    setError(null);
    const result = await fetchJSON(`/api/investing/dashboard?mode=investing&_=${Date.now()}`);
    if (!shouldApply()) return;
    if (!result.ok) {
      setData(null);
      setError(result.data?.error || "Canonical Investing dashboard unavailable.");
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      await loadDashboard(() => !cancelled);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  const vm = useMemo(() => {
    void lang;
    return buildViewModel(data);
  }, [data, lang]);
  const redirectPage = !loading && !error ? guidedRedirectPage(page, vm) : null;

  useEffect(() => {
    if (!redirectPage) return;
    router.replace(`/app?tab=${redirectPage}&mode=investing`);
  }, [redirectPage, router]);

  const body =
    redirectPage ? (
      <Panel title="Guided setup required" subtitle="Syntrake Investing follows Plan, Portfolio, then Today">
        <div className="text-sm leading-6 text-[#dbe7f8]">
          Opening {navItems.find((item) => item.key === redirectPage)?.label || "the next step"} so the investing workflow has the required plan and portfolio evidence first.
        </div>
      </Panel>
    ) :
    page === "planning" ? <PlanPage vm={vm} onRefresh={loadDashboard} /> :
    page === "portfolio" ? <PortfolioPage vm={vm} onRefresh={loadDashboard} /> :
    page === "broker" ? <BrokerPage vm={vm} onRefresh={loadDashboard} /> :
    page === "research" ? <ResearchPage vm={vm} /> :
    page === "reports" ? <ReportsPage vm={vm} /> :
    page === "autonomy" ? <AutonomyPage vm={vm} /> :
    page === "settings" ? <SettingsPage vm={vm} /> :
    <TodayPage vm={vm} />;

  return (
    <Shell page={page} data={data} loading={loading} error={error} onRefresh={loadDashboard}>
      {loading && page !== "daily" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-[#22314d] bg-[#0c192d]" />)}
        </div>
      ) : body}
    </Shell>
  );
}
