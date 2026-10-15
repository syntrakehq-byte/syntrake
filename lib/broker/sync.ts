import type { AutopilotMode } from "@/lib/signalcore/modes";
import { normalizeMode } from "@/lib/signalcore/modes";
import type { BrokerConnection, BrokerPosition, BrokerSnapshot } from "@/lib/broker/shared";
import { normalizeSymbol } from "@/lib/broker/shared";
import { getQuotes } from "@/lib/market/quotes";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceModeAccess } from "@/lib/signalcore/access";
import { assertSharedBrokerSyncAllowed } from "@/lib/broker/investingBoundary";

type SyncLivePayload = {
  positions: BrokerPosition[];
  cashEur: number;
  asOf: string;
  source: string;
  notes?: string[];
};

function safeNum(x: any, fallback = NaN) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function sumPositionsValue(positions: BrokerPosition[]) {
  return positions.reduce((sum, p) => sum + (Number.isFinite(p.valueEur as number) ? (p.valueEur as number) : 0), 0);
}

function dayKeyUTC(tsIso: string) {
  const d = new Date(tsIso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function isMissingColumnError(msg: string) {
  const m = String(msg || "").toLowerCase();
  return m.includes("does not exist") || m.includes("unknown column") || m.includes("column");
}

async function fetchBridgeSync(args: {
  userId: string;
  mode: AutopilotMode;
  connection: BrokerConnection;
}): Promise<SyncLivePayload> {
  const bridgeBase = process.env.SIGNALCORE_BROKER_BRIDGE_URL || process.env.BROKER_BRIDGE_URL;
  if (!bridgeBase) {
    throw new Error("broker_bridge_not_configured");
  }

  const url = `${bridgeBase.replace(/\/+$/, "")}/sync`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (process.env.SIGNALCORE_BROKER_BRIDGE_KEY) {
    headers["x-signalcore-bridge-key"] = process.env.SIGNALCORE_BROKER_BRIDGE_KEY;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: args.userId,
      mode: args.mode,
      provider: args.connection.broker,
      accountLabel: args.connection.accountLabel || undefined,
      connectionMethod: args.connection.connectionMethod,
      connectionReference: args.connection.connectionReference,
      readOnly: args.connection.readOnly,
    }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = String((data as any)?.error || `bridge_http_${res.status}`);
    throw new Error(err);
  }

  const rows =
    Array.isArray((data as any)?.positions)
      ? (data as any).positions
      : Array.isArray((data as any)?.holdings)
      ? (data as any).holdings
      : [];

  const positions = rows
    .map((x: any) => {
      const symbol = normalizeSymbol(x?.symbol);
      if (!symbol) return null;

      const qty = safeNum(x?.qty ?? x?.quantity, NaN);
      const valueEur = safeNum(x?.valueEur ?? x?.value_eur ?? x?.value, NaN);
      const name = x?.name != null ? String(x.name).trim() : null;
      const currency = x?.currency != null ? String(x.currency) : null;

      return {
        symbol,
        name,
        qty: Number.isFinite(qty) ? qty : null,
        valueEur: Number.isFinite(valueEur) ? Math.max(0, valueEur) : null,
        currency,
      } as BrokerPosition;
    })
    .filter(Boolean) as BrokerPosition[];

  const asOfRaw = String((data as any)?.asOf || "");
  const asOfDt = new Date(asOfRaw);
  const asOf = Number.isFinite(asOfDt.getTime()) ? asOfDt.toISOString() : new Date().toISOString();
  const cashEur = Math.max(0, safeNum((data as any)?.cashEur ?? (data as any)?.cash, 0) || 0);
  const source = String((data as any)?.source || `${args.connection.broker}_bridge`);
  const notes = Array.isArray((data as any)?.notes) ? (data as any).notes.map((v: any) => String(v)) : undefined;

  return { positions, cashEur, asOf, source, notes };
}

async function fillMissingPositionValues(args: {
  mode: AutopilotMode;
  positions: BrokerPosition[];
}) {
  const needsPricing = args.positions.filter((p) => (p.valueEur == null || !Number.isFinite(p.valueEur)) && Number.isFinite(p.qty as number) && (p.qty as number) > 0);
  if (!needsPricing.length) return args.positions;

  const symbols = needsPricing.map((p) => p.symbol);
  const quotes = await getQuotes({ symbols, ttlSec: 120 });
  if (!quotes || typeof quotes !== "object") return args.positions;

  return args.positions.map((p) => {
    if (p.valueEur != null && Number.isFinite(p.valueEur)) return p;
    if (!Number.isFinite(p.qty as number)) return p;
    const q = (quotes as any)[p.symbol];
    const px = safeNum(q?.price, NaN);
    if (!Number.isFinite(px) || px <= 0) return p;
    return {
      ...p,
      valueEur: Math.max(0, px * Number(p.qty || 0)),
    };
  });
}

async function readCsvLocalState(args: { userId: string; mode: AutopilotMode }): Promise<SyncLivePayload> {
  const sb = getSupabaseAdmin();
  const { data: items, error: itemsErr } = await sb
    .from("portfolio_items")
    .select("symbol,name,qty,value_eur")
    .eq("user_id", args.userId)
    .eq("mode", args.mode);

  if (itemsErr) throw new Error(itemsErr.message || "portfolio_items_read_failed");

  const positions: BrokerPosition[] = (items || [])
    .map((r: any) => {
      const symbol = normalizeSymbol(r?.symbol);
      if (!symbol) return null;
      return {
        symbol,
        name: r?.name != null ? String(r.name) : null,
        qty: Number.isFinite(safeNum(r?.qty, NaN)) ? safeNum(r?.qty, NaN) : null,
        valueEur: Number.isFinite(safeNum(r?.value_eur, NaN)) ? Math.max(0, safeNum(r?.value_eur, NaN)) : null,
      } as BrokerPosition;
    })
    .filter(Boolean) as BrokerPosition[];

  const { data: portfolios, error: portfolioErr } = await sb
    .from("portfolios")
    .select("cash_eur,snapshot")
    .eq("user_id", args.userId)
    .eq("mode", args.mode)
    .limit(1);

  if (portfolioErr && !isMissingColumnError(String(portfolioErr.message || ""))) {
    throw new Error(portfolioErr.message || "portfolio_read_failed");
  }

  const row = (portfolios || [])[0] || {};
  const snap = row?.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const cashEur = Math.max(
    0,
    safeNum((row as any)?.cash_eur ?? (snap as any)?.cashEur ?? (snap as any)?.cash ?? 0, 0) || 0
  );

  return {
    positions,
    cashEur,
    asOf: new Date().toISOString(),
    source: "csv_local_state",
    notes: ["CSV mode uses latest imported portfolio state as source."],
  };
}

async function writePortfolioState(args: {
  userId: string;
  mode: AutopilotMode;
  positions: BrokerPosition[];
  cashEur: number;
  asOf: string;
  source: string;
}) {
  const sb = getSupabaseAdmin();
  const { userId, mode, positions, cashEur, asOf, source } = args;

  const { data: existing, error: exErr } = await sb
    .from("portfolio_items")
    .select("id,symbol,name,qty,value_eur")
    .eq("user_id", userId)
    .eq("mode", mode);

  if (exErr) throw new Error(exErr.message || "portfolio_items_existing_failed");

  const existingMap = new Map<string, any>();
  for (const row of existing || []) {
    const sym = normalizeSymbol((row as any).symbol);
    if (!sym) continue;
    existingMap.set(sym, row);
  }

  const incomingMap = new Map<string, BrokerPosition>();
  for (const p of positions) {
    const sym = normalizeSymbol(p.symbol);
    if (!sym) continue;
    incomingMap.set(sym, { ...p, symbol: sym });
  }

  const inserts: any[] = [];
  const updates: Array<{ id: string; patch: Record<string, any> }> = [];
  const deletes: string[] = [];

  for (const [sym, p] of incomingMap.entries()) {
    const ex = existingMap.get(sym);
    if (!ex) {
      inserts.push({
        user_id: userId,
        mode,
        symbol: sym,
        name: p.name ?? null,
        qty: Number.isFinite(p.qty as number) ? p.qty : null,
        value_eur: Number.isFinite(p.valueEur as number) ? p.valueEur : null,
        created_at: new Date().toISOString(),
      });
      continue;
    }

    const patch: Record<string, any> = {};
    const nextName = p.name ?? null;
    const nextQty = Number.isFinite(p.qty as number) ? p.qty : null;
    const nextValue = Number.isFinite(p.valueEur as number) ? p.valueEur : null;
    if (nextName !== (ex as any).name) patch.name = nextName;
    if (nextQty !== (ex as any).qty) patch.qty = nextQty;
    if (nextValue !== (ex as any).value_eur) patch.value_eur = nextValue;
    if (Object.keys(patch).length) updates.push({ id: (ex as any).id, patch });
  }

  for (const [sym, ex] of existingMap.entries()) {
    if (!incomingMap.has(sym)) deletes.push((ex as any).id);
  }

  if (inserts.length) {
    const { error } = await sb.from("portfolio_items").insert(inserts as any);
    if (error) throw new Error(error.message || "portfolio_items_insert_failed");
  }

  for (const u of updates) {
    const { error } = await sb
      .from("portfolio_items")
      .update(u.patch as any)
      .eq("user_id", userId)
      .eq("mode", mode)
      .eq("id", u.id);

    if (error) throw new Error(error.message || "portfolio_items_update_failed");
  }

  if (deletes.length) {
    const { error } = await sb.from("portfolio_items").delete().eq("user_id", userId).eq("mode", mode).in("id", deletes as any);
    if (error) throw new Error(error.message || "portfolio_items_delete_failed");
  }

  const valuesBySymbol: Record<string, number> = {};
  for (const p of positions) {
    if (!p?.symbol) continue;
    const value = safeNum(p.valueEur, NaN);
    if (!Number.isFinite(value)) continue;
    valuesBySymbol[p.symbol] = Math.max(0, value);
  }

  const snapshot = {
    cashEur: Math.max(0, safeNum(cashEur, 0) || 0),
    valuesBySymbol,
    broker: {
      source,
      asOf,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        qty: Number.isFinite(p.qty as number) ? p.qty : null,
        valueEur: Number.isFinite(p.valueEur as number) ? p.valueEur : null,
      })),
    },
  };

  // Compatibility mirror only: portfolio_items remains the canonical holdings
  // source for /api/daily-bundle and Trading/shared workspaces. Investing
  // runtime holdings live in investing_positions via /api/investing/dashboard.
  const upsertBase: any = {
    user_id: userId,
    mode,
    snapshot,
    cash_eur: snapshot.cashEur,
    updated_at: new Date().toISOString(),
  };

  let portfolioWriteError: any = null;
  const first = await sb.from("portfolios").upsert(upsertBase, { onConflict: "user_id,mode" } as any);
  portfolioWriteError = first.error;
  if (portfolioWriteError && isMissingColumnError(String(portfolioWriteError.message || ""))) {
    const withoutCash: any = {
      user_id: userId,
      mode,
      snapshot,
      updated_at: new Date().toISOString(),
    };
    const second = await sb.from("portfolios").upsert(withoutCash, { onConflict: "user_id,mode" } as any);
    portfolioWriteError = second.error;
  }

  if (portfolioWriteError) throw new Error(portfolioWriteError.message || "portfolio_upsert_failed");

  const totalEur = Math.max(0, snapshot.cashEur + sumPositionsValue(positions));
  const dk = dayKeyUTC(asOf);
  const dsRow = {
    user_id: userId,
    mode,
    day_key: dk,
    as_of: asOf,
    total_eur: totalEur,
    cash_eur: snapshot.cashEur,
    holdings: positions.map((p) => ({
      symbol: p.symbol,
      name: p.name || null,
      qty: p.qty,
      value_eur: p.valueEur,
    })),
    meta: {
      source: "broker_sync",
      provider: source,
      holdingsCount: positions.length,
    },
    created_at: new Date().toISOString(),
  };

  const ds = await sb.from("daily_snapshots").upsert(dsRow as any, { onConflict: "user_id,mode,day_key" } as any);
  if (ds.error) {
    // non-fatal for sync correctness in portfolio layer
  }

  return {
    inserted: inserts.length,
    updated: updates.length,
    deleted: deletes.length,
    totalEur,
    cashEur: snapshot.cashEur,
    valuesBySymbolCount: Object.keys(valuesBySymbol).length,
  };
}

export async function resolveActiveModeForUser(userId: string, requested?: string | null): Promise<AutopilotMode> {
  const sb = getSupabaseAdmin();
  if (requested) {
    const requestedMode = normalizeMode(requested);
    try {
      const access = await enforceModeAccess({
        supabase: sb,
        userId,
        requestedMode,
      });
      if (access.ok) return requestedMode;
      return access.allowedMode;
    } catch {
      return "investing";
    }
  }
  try {
    const { data, error } = await sb.from("user_settings").select("active_mode").eq("user_id", userId).maybeSingle();
    if (!error && data?.active_mode) {
      const storedMode = normalizeMode(data.active_mode);
      const access = await enforceModeAccess({
        supabase: sb,
        userId,
        requestedMode: storedMode,
      });
      return access.allowedMode;
    }
  } catch {
    // ignore
  }
  return "investing";
}

export async function syncBrokerToPortfolio(args: {
  userId: string;
  mode: AutopilotMode;
  connection: BrokerConnection;
}): Promise<{ snapshot: BrokerSnapshot; changes: { inserted: number; updated: number; deleted: number } }> {
  const mode = normalizeMode(args.mode);
  assertSharedBrokerSyncAllowed(mode);
  const conn = args.connection;

  let live: SyncLivePayload;
  if (conn.connectionMethod === "csv") {
    live = await readCsvLocalState({ userId: args.userId, mode });
  } else {
    live = await fetchBridgeSync({
      userId: args.userId,
      mode,
      connection: conn,
    });
  }

  const pricedPositions = await fillMissingPositionValues({
    mode,
    positions: live.positions,
  });

  const asOf = new Date(live.asOf).toISOString();
  const totalEur = Math.max(0, Math.round((live.cashEur + sumPositionsValue(pricedPositions)) * 100) / 100);
  const snapshot: BrokerSnapshot = {
    mode,
    asOf,
    positions: pricedPositions.slice(0, 250),
    cashEur: Math.max(0, Math.round(live.cashEur * 100) / 100),
    totalEur,
    source: live.source,
    notes: live.notes,
  };

  const write = await writePortfolioState({
    userId: args.userId,
    mode,
    positions: snapshot.positions,
    cashEur: snapshot.cashEur,
    asOf: snapshot.asOf,
    source: snapshot.source,
  });

  return {
    snapshot,
    changes: {
      inserted: write.inserted,
      updated: write.updated,
      deleted: write.deleted,
    },
  };
}

export async function reconcileWithPortfolio(args: {
  userId: string;
  mode: AutopilotMode;
  snapshot: BrokerSnapshot | null;
}) {
  const mode = normalizeMode(args.mode);
  assertSharedBrokerSyncAllowed(mode);
  const sb = getSupabaseAdmin();
  const snapshot = args.snapshot;
  const checkedAt = new Date().toISOString();
  if (!snapshot) {
    return {
      ok: false,
      mode,
      score: 0,
      status: "missing_snapshot",
      checkedAt,
      snapshotAsOf: null,
      brokerCount: 0,
      portfolioCount: 0,
      mismatchCount: 0,
      mismatches: [],
      summary: "No broker snapshot found. Run sync first.",
    };
  }

  const { data, error } = await sb
    .from("portfolio_items")
    .select("symbol,qty,value_eur")
    .eq("user_id", args.userId)
    .eq("mode", mode);

  if (error) throw new Error(error.message || "portfolio_read_failed");

  const localMap = new Map<string, { qty: number | null; valueEur: number | null }>();
  for (const row of data || []) {
    const sym = normalizeSymbol((row as any).symbol);
    if (!sym) continue;
    localMap.set(sym, {
      qty: Number.isFinite(safeNum((row as any).qty, NaN)) ? safeNum((row as any).qty, NaN) : null,
      valueEur: Number.isFinite(safeNum((row as any).value_eur, NaN)) ? safeNum((row as any).value_eur, NaN) : null,
    });
  }

  const brokerMap = new Map<string, { qty: number | null; valueEur: number | null }>();
  for (const row of snapshot.positions || []) {
    const sym = normalizeSymbol(row.symbol);
    if (!sym) continue;
    brokerMap.set(sym, {
      qty: Number.isFinite(safeNum(row.qty, NaN)) ? safeNum(row.qty, NaN) : null,
      valueEur: Number.isFinite(safeNum(row.valueEur, NaN)) ? safeNum(row.valueEur, NaN) : null,
    });
  }

  const mismatches: Array<{ type: string; symbol: string; local?: any; broker?: any; detail: string }> = [];

  for (const [sym, b] of brokerMap.entries()) {
    const l = localMap.get(sym);
    if (!l) {
      mismatches.push({
        type: "missing_in_portfolio",
        symbol: sym,
        broker: b,
        detail: `${sym} exists in broker snapshot but not in portfolio table.`,
      });
      continue;
    }
    if (Number.isFinite(b.qty as number) && Number.isFinite(l.qty as number)) {
      const diffQty = Math.abs((b.qty as number) - (l.qty as number));
      if (diffQty > 0.0001) {
        mismatches.push({
          type: "qty_mismatch",
          symbol: sym,
          local: l,
          broker: b,
          detail: `${sym} quantity differs (local=${l.qty}, broker=${b.qty}).`,
        });
      }
    }
    if (Number.isFinite(b.valueEur as number) && Number.isFinite(l.valueEur as number)) {
      const abs = Math.abs((b.valueEur as number) - (l.valueEur as number));
      const tol = Math.max(5, Math.abs((b.valueEur as number) * 0.03));
      if (abs > tol) {
        mismatches.push({
          type: "value_mismatch",
          symbol: sym,
          local: l,
          broker: b,
          detail: `${sym} value differs beyond tolerance (local=${l.valueEur}, broker=${b.valueEur}).`,
        });
      }
    }
  }

  for (const [sym, l] of localMap.entries()) {
    if (!brokerMap.has(sym)) {
      mismatches.push({
        type: "missing_in_broker",
        symbol: sym,
        local: l,
        detail: `${sym} exists in portfolio table but not in broker snapshot.`,
      });
    }
  }

  let score = 100;
  for (const m of mismatches) {
    if (m.type === "qty_mismatch") score -= 8;
    else if (m.type === "value_mismatch") score -= 6;
    else score -= 12;
  }
  score = Math.max(0, Math.min(100, score));

  const baseResult = {
    ok: true,
    mode,
    score,
    status: score >= 90 ? "aligned" : score >= 70 ? "warning" : "critical",
    checkedAt,
    snapshotAsOf: snapshot.asOf,
    brokerCount: brokerMap.size,
    portfolioCount: localMap.size,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 50),
  };

  return baseResult;
}
