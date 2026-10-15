import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  hasConnectionEvidence,
  INVESTING_SHARED_BROKER_SYNC_BLOCKED,
  isInvestingSharedBrokerBlocked,
  loadBrokerConnection,
  normalizeBrokerConnection,
  reconcileWithPortfolio,
  resolveActiveModeForUser,
  resolveEffectiveSharedBrokerMode,
  sanitizeConnectionForClient,
  saveBrokerConnection,
  syncBrokerToPortfolio,
} from "@/lib/broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBodyMode(req: Request, body: any) {
  const url = new URL(req.url);
  const q = url.searchParams.get("mode");
  if (body.mode) return String(body.mode);
  return q;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const effectiveMode = await resolveEffectiveSharedBrokerMode({
    userId,
    requestedMode: parseBodyMode(req, body),
  });
  let mode = effectiveMode.mode;
  if (!isInvestingSharedBrokerBlocked(mode)) {
    mode = await resolveActiveModeForUser(userId, mode);
  }
  if (isInvestingSharedBrokerBlocked(mode)) {
    return NextResponse.json(
      {
        ok: false,
        error: INVESTING_SHARED_BROKER_SYNC_BLOCKED,
        mode,
        spoofed: effectiveMode.spoofed,
        replacement: "/api/investing/dashboard",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const connection = await loadBrokerConnection(userId);
  const proofOk = hasConnectionEvidence({
    connectionMethod: connection.connectionMethod,
    connectionReference: connection.connectionReference,
    csvImported: connection.csvImported,
  });

  if (!connection.connected || !proofOk) {
    return NextResponse.json(
      {
        ok: false,
        error: "broker_not_connected",
        message: "Connect broker first, then run reconcile.",
      },
      { status: 409 }
    );
  }

  let current = connection;
  if (body.refresh === true) {
    try {
      const out = await syncBrokerToPortfolio({
        userId,
        mode,
        connection: current,
      });
      current = normalizeBrokerConnection(
        {
          ...current,
          lastSyncAt: out.snapshot.asOf,
          lastSyncStatus: "ok",
          lastError: null,
          snapshot: out.snapshot,
          proofCheckedAt: new Date().toISOString(),
        },
        userId,
        current.source || "memory"
      );
      current = await saveBrokerConnection(userId, current, "reconcile_refresh_sync");
    } catch (e: any) {
      current = await saveBrokerConnection(
        userId,
        normalizeBrokerConnection(
          {
            ...current,
            lastSyncStatus: "error",
            lastError: String(e.message || "sync_failed_before_reconcile"),
            proofCheckedAt: new Date().toISOString(),
          },
          userId,
          current.source || "memory"
        ),
        "reconcile_refresh_error"
      );
      return NextResponse.json(
        {
          ok: false,
          error: String(e.message || "sync_failed_before_reconcile"),
          status: "error",
          connection: sanitizeConnectionForClient(current),
        },
        { status: 502 }
      );
    }
  }

  try {
    const result = await reconcileWithPortfolio({
      userId,
      mode,
      snapshot: current.snapshot,
    });
    const reconcileStatus =
      result.ok && typeof result.status === "string" ? String(result.status) : "missing_snapshot";
    const intentStatus =
      result.ok && typeof (result as any)?.investingIntent?.status === "string"
        ? String((result as any).investingIntent.status)
        : null;
    const effectiveStatus =
      intentStatus === "critical"
        ? "critical"
        : intentStatus === "warning" && reconcileStatus === "aligned"
          ? "warning"
          : reconcileStatus;
    const reconcileScoreRaw = Number((result as any).score);
    const reconcileScore =
      Number.isFinite(reconcileScoreRaw) ? Math.max(0, Math.min(100, Math.round(reconcileScoreRaw))) : null;
    const mismatchCount = Math.max(0, Math.round(Number((result as any).mismatchCount || 0)));
    const intentMismatchCount = Math.max(0, Math.round(Number((result as any)?.investingIntent?.mismatchCount || 0)));

    const next = normalizeBrokerConnection(
      {
        ...current,
        lastReconcileAt: new Date().toISOString(),
        lastReconcileStatus: effectiveStatus as any,
        lastReconcileScore: reconcileScore,
        lastReconcileMismatchCount: mismatchCount + intentMismatchCount,
        lastError:
          effectiveStatus === "critical"
            ? `Reconcile critical (${mismatchCount + intentMismatchCount} mismatches).`
            : effectiveStatus === "warning"
              ? `Reconcile warning (${mismatchCount + intentMismatchCount} mismatches).`
              : current.lastError,
      },
      userId,
      current.source || "memory"
    );
    const saved = await saveBrokerConnection(userId, next, "reconcile_run");

    return NextResponse.json(
      {
        ok: true,
        mode,
        reconcile: result,
        connection: sanitizeConnectionForClient(saved),
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message || "reconcile_failed") }, { status: 500 });
  }
}

