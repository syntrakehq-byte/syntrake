// app/api/daily-snapshot/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { createExecutionId, writeEngineEvent } from "@/lib/engine/events";
import { resolveModeAccess } from "@/lib/signalcore/modeAccess";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dayKeyUTC(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safeNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

export async function POST(req: Request) {
  const startedAtMs = Date.now();
  const executionId = createExecutionId("receipt");
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (String(body?.mode || "").toLowerCase() === "investing") {
      return NextResponse.json(
        { ok: false, error: "investing_daily_snapshot_endpoint_retired", replacement: "/api/investing/daily-cycle" },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = getSupabaseAdmin();
    const access = await resolveModeAccess({ supabase, userId, requestedMode: body?.mode });
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error, allowedMode: access.allowedMode, requestedMode: access.mode },
        { status: access.status },
      );
    }
    const mode = access.mode;
    const snapshot = body?.snapshot ?? null;
    const portfolio = snapshot?.portfolio ?? body?.portfolio ?? {};
    const cash = safeNumber(portfolio?.cash ?? portfolio?.cashEur ?? portfolio?.cash_eur);
    const holdings = Array.isArray(portfolio?.holdings)
      ? portfolio.holdings
      : Array.isArray(portfolio?.items)
        ? portfolio.items
        : [];
    const holdingsValue = holdings.reduce(
      (sum: number, holding: any) => sum + safeNumber(holding?.valueEur ?? holding?.value_eur ?? holding?.value),
      0,
    );
    const total = cash + holdingsValue;
    const now = new Date();
    const dayKey = dayKeyUTC(now);
    const pricing = snapshot?.derived?.pricing ?? snapshot?.portfolio?.valuation ?? snapshot?.derived?.diagnostics?.pricing ?? null;
    const row = {
      user_id: userId,
      mode,
      day_key: dayKey,
      as_of: now.toISOString(),
      total_eur: total,
      cash_eur: cash,
      holdings,
      meta: { source: "daily_snapshot_v3", holdingsCount: holdings.length, pricing },
      snapshot,
      created_at: now.toISOString(),
    };
    const { error } = await supabase.from("daily_snapshots").upsert(row, { onConflict: "user_id,mode,day_key" } as any);
    if (error) throw new Error(error.message);

    await supabase.from("journal_entries").insert({
      user_id: userId,
      mode,
      type: "decision_receipt",
      title: "Decision receipt",
      details: { day_key: dayKey, total_eur: total, cash_eur: cash, holdingsCount: holdings.length, pricing },
      created_at: now.toISOString(),
    });
    await writeEngineEvent({
      userId,
      mode,
      event: "daily_receipt_created",
      status: "ok",
      source: "api.daily_snapshot",
      executionId,
      details: { dayKey, totalEur: total, cashEur: cash, holdingsCount: holdings.length, duration_ms: Date.now() - startedAtMs },
    });
    return NextResponse.json({ ok: true, mode, executionId, dayKey, totalEUR: total });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Unknown error" }, { status: 500 });
  }
}
