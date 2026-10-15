// app/api/portfolio-meta/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { AutopilotMode } from "@/lib/signalcore/modes";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveModeAccess } from "@/lib/signalcore/modeAccess";
import {
  attachLegacyPortfolioBoundary,
  legacyPortfolioBoundary,
  legacyPortfolioBoundaryHeaders,
} from "@/lib/signalcore/legacyPortfolioBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400, mode?: string | null) {
  const boundary = legacyPortfolioBoundary(mode);
  return NextResponse.json(
    attachLegacyPortfolioBoundary({
      ok: false,
      error: msg,
    }, mode),
    {
      status,
      headers: legacyPortfolioBoundaryHeaders(boundary),
    }
  );
}

function ok(body: Record<string, unknown>, status = 200, mode?: string | null) {
  const boundary = legacyPortfolioBoundary(mode);
  return NextResponse.json(
    attachLegacyPortfolioBoundary(body, mode),
    {
      status,
      headers: legacyPortfolioBoundaryHeaders(boundary),
    }
  );
}

function accessDenied(args: {
  status: number;
  error: string | null;
  allowedMode: string;
  requestedMode: string;
}) {
  const boundary = legacyPortfolioBoundary(args.requestedMode);
  return NextResponse.json(
    attachLegacyPortfolioBoundary({
      ok: false,
      error: args.error || "upgrade_required",
      allowedMode: args.allowedMode,
      requestedMode: args.requestedMode,
    }, args.requestedMode),
    {
      status: args.status,
      headers: legacyPortfolioBoundaryHeaders(boundary),
    }
  );
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return bad("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const sb = getSupabaseAdmin();
  const access = await resolveModeAccess({
    supabase: sb,
    userId,
    requestedMode: searchParams.get("mode"),
  });
  if (!access.ok) {
    return accessDenied({
      status: access.status,
      error: access.error,
      allowedMode: access.allowedMode,
      requestedMode: access.mode,
    });
  }
  const mode = access.mode;
  const { data, error } = await sb
    .from("portfolio_meta")
    .select("cash_eur, values_by_symbol, updated_at")
    .eq("user_id", userId)
    .eq("mode", mode)
    .maybeSingle();

  if (error) return bad(error.message, 500, mode);

  return ok({
    ok: true,
    mode,
    meta: data ?? { cash_eur: 0, values_by_symbol: {}, updated_at: null },
  }, 200, mode);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return bad("Unauthorized", 401);

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON");

  const sb = getSupabaseAdmin();
  const access = await resolveModeAccess({
    supabase: sb,
    userId,
    requestedMode: body.mode,
  });
  if (!access.ok) {
    return accessDenied({
      status: access.status,
      error: access.error,
      allowedMode: access.allowedMode,
      requestedMode: access.mode,
    });
  }
  const mode = access.mode as AutopilotMode;
  const cashEur = Number(body.cashEur ?? 0);
  const valuesBySymbol =
    body.valuesBySymbol && typeof body.valuesBySymbol === "object" ? body.valuesBySymbol : {};

  if (!Number.isFinite(cashEur) || cashEur < 0) return bad("cashEur must be a non-negative number", 400, mode);

  const upsertRow = {
    user_id: userId,
    mode,
    cash_eur: cashEur,
    values_by_symbol: valuesBySymbol,
  };

  const { data, error } = await sb
    .from("portfolio_meta")
    .upsert(upsertRow, { onConflict: "user_id,mode" })
    .select("cash_eur, values_by_symbol, updated_at")
    .single();

  if (error) return bad(error.message, 500, mode);

  return ok({ ok: true, mode, meta: data }, 200, mode);
}

