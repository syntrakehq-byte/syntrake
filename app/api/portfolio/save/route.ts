import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { resolveModeAccess } from "@/lib/signalcore/modeAccess";
import {
  attachLegacyPortfolioBoundary,
  legacyPortfolioBoundary,
  legacyPortfolioBoundaryHeaders,
} from "@/lib/signalcore/legacyPortfolioBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deprecatedJson(body: Record<string, unknown>, status = 200, mode?: string | null) {
  const boundary = legacyPortfolioBoundary(mode);
  return NextResponse.json(
    attachLegacyPortfolioBoundary(body, mode),
    {
      status,
      headers: legacyPortfolioBoundaryHeaders(boundary),
    }
  );
}

function safeNumber(x: any, fallback: number) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return deprecatedJson({ ok: false, error: "Unauthorized" }, 401);

  const supabase = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const access = await resolveModeAccess({
    supabase,
    userId,
    requestedMode: body?.mode,
  });
  if (!access.ok) {
    return deprecatedJson(
      { ok: false, error: access.error, allowedMode: access.allowedMode, requestedMode: access.mode },
      access.status,
      access.mode
    );
  }
  const mode = access.mode;
  const cashEur = body.cashEur !== undefined ? safeNumber(body.cashEur, 0) : undefined;
  const valuesBySymbol =
    body.valuesBySymbol && typeof body.valuesBySymbol === "object" ? body.valuesBySymbol : undefined;

  // 1) Load existing portfolio row (if any)
  const { data: existingRows, error: readErr } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", mode)
    .limit(1);

  if (readErr) return deprecatedJson({ ok: false, error: readErr.message }, 500, mode);

  const existing = (existingRows ?? [])[0] ?? null;
  const existingSnapshot = (existing.snapshot && typeof existing.snapshot === "object") ? existing.snapshot : {};

  // Merge snapshot
  const nextSnapshot: any = { ...(existingSnapshot || {}) };

  if (cashEur !== undefined) nextSnapshot.cashEur = cashEur;

  if (valuesBySymbol) {
    // normalize structure: { "AAPL": 123, ... }
    const nextValues: Record<string, number> = {};
    for (const [k, v] of Object.entries(valuesBySymbol)) {
      const sym = String(k || "").trim().toUpperCase();
      if (!sym) continue;
      const num = safeNumber(v, NaN);
      if (!Number.isFinite(num)) continue;
      nextValues[sym] = Math.max(0, num);
    }
    nextSnapshot.valuesBySymbol = nextValues;
  }

  // 2) Try to write into portfolios.cash_eur if it exists. If not, fallback to snapshot only.
  const upsertBase: any = {
    user_id: userId,
    mode,
    snapshot: nextSnapshot,
    updated_at: new Date().toISOString(),
  };

  if (cashEur !== undefined) upsertBase.cash_eur = cashEur; // may fail if column doesn't exist

  // Attempt upsert
  const { error: writeErr } = await supabase.from("portfolios").upsert(upsertBase, {
    onConflict: "user_id,mode",
  });

  if (!writeErr) {
    return deprecatedJson({ ok: true, mode, saved: true, cashEur: nextSnapshot.cashEur ?? 0 }, 200, mode);
  }

  // Fallback: remove cash_eur and retry
  const msg = String(writeErr.message || "");
  if (msg.toLowerCase().includes("cash_eur")) {
    const withoutCashColumn = { ...upsertBase };
    delete withoutCashColumn.cash_eur;

    const { error: fallbackErr } = await supabase.from("portfolios").upsert(withoutCashColumn, {
      onConflict: "user_id,mode",
    });

    if (fallbackErr) return deprecatedJson({ ok: false, error: fallbackErr.message }, 500, mode);

    return deprecatedJson({
      ok: true,
      mode,
      saved: true,
      cashEur: nextSnapshot.cashEur ?? 0,
      note: "Saved cashEur inside portfolios.snapshot (cash_eur column missing).",
    }, 200, mode);
  }

  return deprecatedJson({ ok: false, error: writeErr.message }, 500, mode);
}

