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

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const supabase = getSupabaseAdmin();
  const access = await resolveModeAccess({
    supabase,
    userId,
    requestedMode: url.searchParams.get("mode"),
  });
  if (!access.ok) {
    return deprecatedJson(
      { ok: false, error: access.error, allowedMode: access.allowedMode, requestedMode: access.mode },
      access.status,
      access.mode
    );
  }
  const mode = access.mode;

  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", mode)
    .limit(1);

  if (error) return deprecatedJson({ ok: false, error: error.message }, 500, mode);

  const row = (data ?? [])[0] ?? null;
  const snapshot = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};

  // Prefer cash_eur column if exists, else fallback to snapshot.cashEur
  const cashFromColumn = row.cash_eur;
  const cashFromSnapshot = snapshot.cashEur;

  const cashEur = safeNumber(cashFromColumn ?? cashFromSnapshot, 0);

  const valuesBySymbol =
    snapshot.valuesBySymbol && typeof snapshot.valuesBySymbol === "object" ? snapshot.valuesBySymbol : {};

  return deprecatedJson({
    ok: true,
    mode,
    cashEur,
    valuesBySymbol,
  }, 200, mode);
}

