// lib/signalcore/supabaseRepo.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------- Types ----------
export type Mode = "Investing";

export type PortfolioHolding = {
  symbol: string;
  qty?: number;
  value?: number; // EUR value (or base currency value; we treat as EUR in MVP)
};

export type PortfolioSnapshot = {
  baseCurrency: string;
  asOf: number;
  cashBase: number;
  holdings: PortfolioHolding[];
};

export type UserSettingsRow = any;

// ---------- Helpers ----------
export function normMode(x: any): Mode {
  void x;
  return "Investing";
}

function nowMs() {
  return Date.now();
}

function normalizeSnapshot(raw: any): PortfolioSnapshot {
  const snap = raw ?? {};
  return {
    baseCurrency: snap.baseCurrency ?? snap.base_currency ?? "EUR",
    asOf: typeof snap.asOf === "number" ? snap.asOf : nowMs(),
    cashBase:
      typeof snap.cashBase === "number"
        ? snap.cashBase
        : typeof snap.cash_base === "number"
        ? snap.cash_base
        : typeof snap.cash === "number"
        ? snap.cash
        : 0,
    holdings: Array.isArray(snap.holdings) ? snap.holdings : [],
  };
}

function sumHoldingsValue(holdings: any[]) {
  return (holdings ?? []).reduce((s, h) => s + (Number(h?.value) || 0), 0);
}

function portfolioTotalEUR(p: PortfolioSnapshot) {
  const cash = Number(p.cashBase) || 0;
  const hv = sumHoldingsValue(p.holdings ?? []);
  return cash + hv;
}

function dayKeyUTC(ts: number) {
  // YYYY-MM-DD in UTC
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function isMissingColumnError(msg: string) {
  const m = (msg || "").toLowerCase();
  return m.includes("does not exist") || m.includes("column") || m.includes("unknown column");
}

function pickFirstDefined<T>(...xs: T[]) {
  for (const x of xs) if (x !== undefined && x !== null) return x;
  return undefined;
}

function normalizeRiskProfile(x: any) {
  const s = String(x ?? "").toLowerCase().trim();
  if (s === "conservative") return "Conservative";
  if (s === "balanced") return "Balanced";
  if (s === "aggressive" || s === "growth") return "Aggressive";
  return "Balanced";
}

function normalizeHorizon(x: any) {
  const s = String(x ?? "").toLowerCase().trim();
  if (s === "short") return "Short";
  if (s === "medium" || s === "mid") return "Medium";
  if (s === "long") return "Long";
  // sometimes already "Long"
  if (x === "Short" || x === "Medium" || x === "Long") return x;
  return "Long";
}

// ---------- User settings ----------
export async function readUserSettings(userId: string): Promise<UserSettingsRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Investing-aware plan builder:
 * - If settings already have a goal_type, use it
 * - Otherwise fallback to investing (so user never gets "activate a plan first")
 */
export function planFromSettings(settings: UserSettingsRow | null, mode?: Mode) {
  const s = settings ?? {};
  const goalType: Mode = normMode(pickFirstDefined(s.goal_type, s.goalType, mode, "Investing") as any);

  const targetValue =
    Number(pickFirstDefined(s.goal_target_value, s.target_value, s.targetValue, 50000)) || 50000;

  const riskProfile = normalizeRiskProfile(pickFirstDefined(s.risk_profile, s.riskProfile, "balanced"));
  const horizon = normalizeHorizon(pickFirstDefined(s.horizon, s.plan_horizon, "Long"));

  // guardrails default (if none)
  const guardrails =
    s.guardrails ??
    {
      maxSinglePositionPct: 20,
      maxTop5Pct: 60,
    };

  return {
    goalType,
    targetValue,
    riskProfile,
    horizon,
    buckets: s.buckets ?? undefined,
    guardrails,
  } as any;
}

/**
 * Creates a default plan in user_settings if missing.
 * This prevents UI ever depending on “Activate plan first”.
 *
 * Schema-proof strategy:
 * - Try richer payload
 * - If DB complains about missing columns, retry with a smaller payload
 */
export async function upsertDefaultPlanIfMissing(userId: string, mode: Mode, existing?: UserSettingsRow | null) {
  const s = existing ?? null;

  // If it already looks like it has a plan, do nothing
  const alreadyHasPlan =
    Boolean(s?.plan_active) ||
    Boolean(s?.plan_v1) ||
    Boolean(s?.goal_type) ||
    Boolean(s?.risk_profile) ||
    Boolean(s?.horizon);

  if (alreadyHasPlan) return { ok: true, created: false };

  const sb = supabaseAdmin();

  const base = {
    user_id: userId,
  } as any;

  // A “nice” default plan
  const desired = {
    goal_type: mode,
    goal_target_value: 50000,
    risk_profile: "balanced",
    horizon: "Long",
    guardrails: {
      maxSinglePositionPct: 20,
      maxTop5Pct: 60,
    },
    plan_active: true,
    plan_v1: {
      goalType: mode,
      targetValue: 50000,
      riskProfile: "balanced",
      horizon: "Long",
      createdAt: new Date().toISOString(),
      source: "auto-default",
    },
    updated_at: new Date().toISOString(),
  } as any;

  // Try payloads from most complete -> minimal, in case schema differs
  const attempts: any[] = [
    { ...base, ...desired },
    { ...base, goal_type: desired.goal_type, risk_profile: desired.risk_profile, horizon: desired.horizon, goal_target_value: desired.goal_target_value },
    { ...base, goal_type: desired.goal_type },
    { ...base },
  ];

  let lastErr: any = null;

  for (const payload of attempts) {
    try {
      const { error } = await sb.from("user_settings").upsert(payload, { onConflict: "user_id" } as any);
      if (!error) return { ok: true, created: true };
      // if missing column, try next smaller payload
      if (isMissingColumnError(String(error.message ?? ""))) {
        lastErr = error;
        continue;
      }
      // other errors should stop
      throw new Error(error.message);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (isMissingColumnError(msg)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }

  // If we got here, table exists but schema is too different
  return { ok: false, created: false, warning: "user_settings schema mismatch", message: String(lastErr?.message ?? "") };
}

// ---------- Legacy portfolio snapshot compatibility ----------
type PortfolioRow = Record<string, any>;

async function tryReadPortfolio(args: { userId: string; mode: Mode; modeCol: string; snapCol: string }) {
  const sb = supabaseAdmin();
  const { userId, mode, modeCol, snapCol } = args;

  const { data, error } = await sb
    .from("portfolios")
    .select(`${snapCol}`)
    .eq("user_id", userId)
    .eq(modeCol as any, mode as any)
    .maybeSingle();

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.toLowerCase().includes("does not exist")) return null;
    throw new Error(error.message);
  }

  if (!data) return null;
  const row = data as PortfolioRow;
  const snap = row[snapCol];
  if (!snap) return null;

  return normalizeSnapshot(snap);
}

/**
 * Compatibility read for legacy portfolio snapshots.
 *
 * Trading/shared runtime holdings are canonical in portfolio_items via /api/portfolio-items.
 * Investing runtime holdings are canonical in investing_positions via /api/investing/dashboard.
 * Keep this reader only for older plan/setup paths that still expect a compact
 * snapshot object while migration is completed.
 */
export async function readPortfolioSnapshot(userId: string, mode: Mode): Promise<PortfolioSnapshot | null> {
  const modeCols = ["mode", "autopilot_mode", "goal_type"];
  const snapCols = ["snapshot", "portfolio_snapshot", "data"];

  for (const mcol of modeCols) {
    for (const scol of snapCols) {
      const got = await tryReadPortfolio({ userId, mode, modeCol: mcol, snapCol: scol });
      if (got) return got;
    }
  }
  return null;
}

// ---------- Daily snapshots (Money Confidence Layer REAL) ----------
export async function upsertDailySnapshot(args: { userId: string; mode: Mode; portfolio: PortfolioSnapshot; meta?: any }) {
  const sb = supabaseAdmin();

  const total = portfolioTotalEUR(args.portfolio);
  const cash = Number(args.portfolio.cashBase) || 0;
  const dk = dayKeyUTC(args.portfolio.asOf ?? nowMs());

  const row = {
    user_id: args.userId,
    mode: args.mode,
    day_key: dk,
    as_of: new Date(args.portfolio.asOf ?? nowMs()).toISOString(),
    total_eur: total,
    cash_eur: cash,
    holdings: args.portfolio.holdings ?? [],
    meta: args.meta ?? {},
  };

  const { error } = await sb.from("daily_snapshots").upsert(row as any, { onConflict: "user_id,mode,day_key" } as any);
  if (error) throw new Error(error.message);

  return { ok: true, dayKey: dk, totalEUR: total };
}

export async function readRecentDailySnapshots(args: { userId: string; mode: Mode; limit?: number }) {
  const sb = supabaseAdmin();
  const limit = Math.max(3, Math.min(30, args.limit ?? 10));

  const { data, error } = await sb
    .from("daily_snapshots")
    .select("day_key, as_of, total_eur, cash_eur")
    .eq("user_id", args.userId)
    .eq("mode", args.mode)
    .order("day_key", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ day_key: string; as_of: string; total_eur: number; cash_eur: number }>;
}

/**
 * Compute confirmed profits from snapshots:
 * - confirmedToday = today_total - yesterday_total
 * - confirmedThisWeek = today_total - total_from_7_days_ago (nearest available)
 */
export function computeConfirmedFromSnapshots(rows: Array<{ day_key: string; total_eur: number }>) {
  if (!rows?.length) return { confirmedToday: 0, confirmedThisWeek: 0 };

  // rows are desc by day_key
  const today = Number(rows[0]?.total_eur) || 0;
  const yesterday = Number(rows[1]?.total_eur) || 0;

  const confirmedToday = Math.round(today - yesterday);

  // pick nearest row ~7 days back (index 7 if you have daily; else last)
  const weekRow = rows.length >= 8 ? rows[7] : rows[rows.length - 1];
  const weekTotal = Number(weekRow?.total_eur) || 0;

  const confirmedThisWeek = Math.round(today - weekTotal);

  return { confirmedToday, confirmedThisWeek };
}
