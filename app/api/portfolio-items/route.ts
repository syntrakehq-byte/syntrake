import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/requestUser";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveModeAccess } from "@/lib/signalcore/modeAccess";
import {
  INVESTING_SHARED_BROKER_SYNC_BLOCKED,
  isInvestingSharedBrokerBlocked,
  resolveEffectiveSharedBrokerMode,
} from "@/lib/broker/investingBoundary";
import { legacyPortfolioBoundary } from "@/lib/signalcore/legacyPortfolioBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normSymbol(x: any) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}

function safeNumber(x: any, fallback: number | null = null) {
  if (x === "" || x === null || x === undefined) return fallback;
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const supabase = getSupabaseAdmin();
  const effectiveMode = await resolveEffectiveSharedBrokerMode({
    userId,
    requestedMode: url.searchParams.get("mode"),
    supabase,
  });
  if (isInvestingSharedBrokerBlocked(effectiveMode.mode)) {
    const boundary = legacyPortfolioBoundary("investing");
    return NextResponse.json(
      {
        ok: false,
        error: INVESTING_SHARED_BROKER_SYNC_BLOCKED,
        mode: "investing",
        spoofed: effectiveMode.spoofed,
        deprecated: true,
        ...boundary,
      },
      {
        status: 410,
        headers: {
          "Cache-Control": "no-store",
          "X-SignalCore-Deprecated": "true",
          "X-SignalCore-Canonical-Endpoint": boundary.canonicalReadEndpoint,
        },
      },
    );
  }
  const access = await resolveModeAccess({
    supabase,
    userId,
    requestedMode: effectiveMode.mode,
  });
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error, allowedMode: access.allowedMode, requestedMode: access.mode },
      { status: access.status }
    );
  }
  const mode = access.mode;

  const { data, error } = await supabase
    .from("portfolio_items")
    .select("id,user_id,mode,symbol,name,qty,value_eur,created_at")
    .eq("user_id", userId)
    .eq("mode", mode)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    mode,
    items: (data ?? []).map((r: any) => ({
      id: r.id,
      mode: r.mode,
      symbol: r.symbol,
      name: r.name ?? null,
      qty: r.qty ?? null,
      valueEur: r.value_eur ?? null,
      created_at: r.created_at ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  const effectiveMode = await resolveEffectiveSharedBrokerMode({
    userId,
    requestedMode: body?.mode,
    supabase,
  });
  if (isInvestingSharedBrokerBlocked(effectiveMode.mode)) {
    return NextResponse.json(
      { ok: false, error: INVESTING_SHARED_BROKER_SYNC_BLOCKED, mode: "investing", spoofed: effectiveMode.spoofed },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  const access = await resolveModeAccess({
    supabase,
    userId,
    requestedMode: effectiveMode.mode,
  });
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error, allowedMode: access.allowedMode, requestedMode: access.mode },
      { status: access.status }
    );
  }
  const mode = access.mode;

  const itemsRaw = Array.isArray(body?.items) ? body.items : [];
  const incoming = itemsRaw
    .map((x: any) => ({
      symbol: normSymbol(x?.symbol),
      name: x?.name != null ? String(x.name).trim() : null,
      qty: safeNumber(x?.qty, null),
      qtyProvided: Object.prototype.hasOwnProperty.call(x ?? {}, "qty"),
      valueEur: safeNumber(x?.valueEur ?? x?.value_eur, null),
      valueProvided:
        Object.prototype.hasOwnProperty.call(x ?? {}, "valueEur") ||
        Object.prototype.hasOwnProperty.call(x ?? {}, "value_eur"),
    }))
    .filter((x: any) => x.symbol.length >= 1);

  if (!incoming.length) {
    return NextResponse.json({ ok: false, error: "No items provided" }, { status: 400 });
  }

  // Dedup payload by symbol
  const seen = new Set<string>();
  const unique = incoming.filter((x) => {
    if (seen.has(x.symbol)) return false;
    seen.add(x.symbol);
    return true;
  });

  // Load existing for user+mode
  const { data: existing, error: existErr } = await supabase
    .from("portfolio_items")
    .select("id,symbol,name,qty,value_eur")
    .eq("user_id", userId)
    .eq("mode", mode);

  if (existErr) return NextResponse.json({ ok: false, error: existErr.message }, { status: 500 });

  const existingMap = new Map<string, any>();
  for (const r of existing ?? []) existingMap.set(String(r.symbol || "").toUpperCase(), r);

  const toInsert: any[] = [];
  const toUpdate: Array<{ id: string; patch: any }> = [];

  for (const it of unique) {
    const ex = existingMap.get(it.symbol);

    if (!ex) {
      toInsert.push({
        user_id: userId,
        mode,
        symbol: it.symbol,
        name: it.name,
        qty: it.qty,
        value_eur: it.valueEur,
        created_at: new Date().toISOString(),
      });
      continue;
    }

    // Update only fields explicitly provided (don’t erase)
    const patch: any = {};
    if (it.name != null && it.name !== "" && it.name !== ex.name) patch.name = it.name;
    if (it.qtyProvided) {
      if (it.qty === null) patch.qty = null;
      else if (it.qty !== ex.qty) patch.qty = it.qty;
    }

    // value_eur: allow explicit null to clear
    if (it.valueProvided) {
      if (it.valueEur === null) patch.value_eur = null;
      else if (it.valueEur !== ex.value_eur) patch.value_eur = it.valueEur;
    }

    if (Object.keys(patch).length) toUpdate.push({ id: ex.id, patch });
  }

  if (toInsert.length) {
    const { error: insErr } = await supabase.from("portfolio_items").insert(toInsert);
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  for (const u of toUpdate) {
    const { error: upErr } = await supabase
      .from("portfolio_items")
      .update(u.patch)
      .eq("user_id", userId)
      .eq("mode", mode)
      .eq("id", u.id);

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode, inserted: toInsert.length, updated: toUpdate.length });
}

export async function DELETE(req: Request) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const effectiveMode = await resolveEffectiveSharedBrokerMode({
    userId,
    requestedMode: url.searchParams.get("mode"),
    supabase,
  });
  if (isInvestingSharedBrokerBlocked(effectiveMode.mode)) {
    return NextResponse.json(
      { ok: false, error: INVESTING_SHARED_BROKER_SYNC_BLOCKED, mode: "investing", spoofed: effectiveMode.spoofed },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { error } = await supabase
    .from("portfolio_items")
    .delete()
    .eq("user_id", userId)
    .eq("mode", effectiveMode.mode)
    .eq("id", id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
