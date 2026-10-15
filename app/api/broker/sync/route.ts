import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  brokerLabel,
  hasConnectionEvidence,
  INVESTING_SHARED_BROKER_SYNC_BLOCKED,
  isInvestingSharedBrokerBlocked,
  isConnectionMethodSupportedForBroker,
  isBrokerManualOnly,
  loadBrokerConnection,
  normalizeBrokerConnection,
  reconcileWithPortfolio,
  resolveActiveModeForUser,
  resolveEffectiveSharedBrokerMode,
  sanitizeConnectionForClient,
  saveBrokerConnection,
  syncBrokerToPortfolio,
} from "@/lib/broker";
import { createExecutionId, writeEngineEvent } from "@/lib/engine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getModeFromRequest(req: Request, body: any) {
  const url = new URL(req.url);
  const queryMode = url.searchParams.get("mode");
  const bodyMode = body?.mode ? String(body.mode) : null;
  return bodyMode || queryMode;
}

export async function POST(req: Request) {
  const startedAtMs = Date.now();
  const executionId = createExecutionId("sync");
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedMode = getModeFromRequest(req, body);
  const effectiveMode = await resolveEffectiveSharedBrokerMode({ userId, requestedMode });
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
        replacement: "/api/investing/paper/orders",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const current = await loadBrokerConnection(userId);
  if (!isConnectionMethodSupportedForBroker(current.broker, current.connectionMethod)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unsupported_connection_method",
        message: isBrokerManualOnly(current.broker)
          ? `${brokerLabel(current.broker)} supports manual CSV mode only. Switch to CSV in Broker setup.`
          : "Unsupported connection method for this broker.",
        executionId,
        status: "error",
      },
      { status: 400 }
    );
  }

  const proofOk = hasConnectionEvidence({
    connectionMethod: current.connectionMethod,
    connectionReference: current.connectionReference,
    csvImported: current.csvImported,
  });

  if (!current.connected || !proofOk) {
    await writeEngineEvent({
      userId,
      mode,
      event: "risk_blocked",
      status: "warn",
      source: "api.broker.sync",
      executionId,
      details: {
        reason: "broker_not_connected_or_invalid_proof",
        connectionMethod: current.connectionMethod,
        duration_ms: Date.now() - startedAtMs,
      },
    });
    const safe = sanitizeConnectionForClient(
      normalizeBrokerConnection(
        {
          ...current,
          connected: false,
          proofCheckedAt: new Date().toISOString(),
        },
        userId,
        current.source || "memory"
      )
    );
    return NextResponse.json(
      {
        ok: false,
        error: "broker_not_connected",
        message: "Connect broker with valid proof before syncing.",
        executionId,
        status: "disconnected",
        ...safe,
      },
      { status: 409 }
    );
  }

  try {
    await writeEngineEvent({
      userId,
      mode,
      event: "order_sent",
      status: "ok",
      source: "api.broker.sync",
      executionId,
      details: {
        broker: current.broker,
        connectionMethod: current.connectionMethod,
      },
    });

    const out = await syncBrokerToPortfolio({
      userId,
      mode,
      connection: current,
    });
    const reconcile = await reconcileWithPortfolio({
      userId,
      mode,
      snapshot: out.snapshot,
    });

    const reconcileStatus =
      reconcile.ok && typeof reconcile.status === "string"
        ? String(reconcile.status)
        : "missing_snapshot";
    const intentStatus =
      reconcile.ok && typeof (reconcile as any)?.investingIntent?.status === "string"
        ? String((reconcile as any).investingIntent.status)
        : null;
    const effectiveReconcileStatus =
      intentStatus === "critical"
        ? "critical"
        : intentStatus === "warning" && reconcileStatus === "aligned"
          ? "warning"
          : reconcileStatus;
    const reconcileScoreRaw = Number((reconcile as any).score);
    const reconcileScore = Number.isFinite(reconcileScoreRaw) ? Math.max(0, Math.min(100, Math.round(reconcileScoreRaw))) : null;
    const reconcileMismatchCount = Math.max(0, Math.round(Number((reconcile as any).mismatchCount || 0)));
    const intentMismatchCount = Math.max(0, Math.round(Number((reconcile as any)?.investingIntent?.mismatchCount || 0)));
    const totalMismatchCount = reconcileMismatchCount + intentMismatchCount;

    const synced = normalizeBrokerConnection(
      {
        ...current,
        connected: true,
        lastSyncAt: out.snapshot.asOf,
        lastSyncStatus: "ok",
        lastError:
          effectiveReconcileStatus === "critical"
            ? `Reconcile critical (${totalMismatchCount} mismatches).`
            : effectiveReconcileStatus === "warning"
              ? `Reconcile warning (${totalMismatchCount} mismatches).`
              : null,
        lastReconcileAt: new Date().toISOString(),
        lastReconcileStatus: effectiveReconcileStatus as any,
        lastReconcileScore: reconcileScore,
        lastReconcileMismatchCount: totalMismatchCount,
        snapshot: out.snapshot,
        proofCheckedAt: new Date().toISOString(),
      },
      userId,
      current.source || "memory"
    );

    const saved = await saveBrokerConnection(userId, synced, "sync_ok");
    const safe = sanitizeConnectionForClient(saved);

    await writeEngineEvent({
      userId,
      mode,
      event: "order_filled",
      status: "ok",
      source: "api.broker.sync",
      executionId,
        details: {
          inserted: out.changes.inserted,
          updated: out.changes.updated,
          deleted: out.changes.deleted,
          positions: out.snapshot.positions.length,
          totalEur: out.snapshot.totalEur,
          asOf: out.snapshot.asOf,
          reconcileStatus: effectiveReconcileStatus,
          reconcileScore,
          reconcileMismatchCount: totalMismatchCount,
          investingIntentStatus: intentStatus,
          duration_ms: Date.now() - startedAtMs,
        },
      });
    if (effectiveReconcileStatus === "critical" || effectiveReconcileStatus === "warning") {
      await writeEngineEvent({
        userId,
        mode,
        event: "risk_blocked",
        status: effectiveReconcileStatus === "critical" ? "error" : "warn",
        source: "api.broker.sync.reconcile",
        executionId,
        details: {
          reconcileStatus: effectiveReconcileStatus,
          reconcileScore,
          reconcileMismatchCount: totalMismatchCount,
          investingIntentStatus: intentStatus,
          summary: (reconcile as any).summary || null,
        },
      });
    }

    const runtimeStatus =
      effectiveReconcileStatus === "critical" ? "error" : safe.autoSync ? "active" : "connected";

    return NextResponse.json(
      {
        ok: true,
        executionId,
        mode,
        status: runtimeStatus,
        ...safe,
        sync: {
          inserted: out.changes.inserted,
          updated: out.changes.updated,
          deleted: out.changes.deleted,
          positions: out.snapshot.positions.length,
          cashEur: out.snapshot.cashEur,
          totalEur: out.snapshot.totalEur,
          source: out.snapshot.source,
          asOf: out.snapshot.asOf,
        },
        reconcile: {
          ok: Boolean((reconcile as any).ok),
          status: effectiveReconcileStatus,
          score: reconcileScore,
          mismatchCount: totalMismatchCount,
          checkedAt: (reconcile as any).checkedAt || new Date().toISOString(),
          investingIntent: (reconcile as any).investingIntent || null,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    const errMessage = String(e.message || "broker_sync_failed");
    const failed = normalizeBrokerConnection(
      {
        ...current,
        connected: true,
        lastSyncStatus: "error",
        lastError: errMessage,
        lastReconcileAt: current.lastReconcileAt,
        lastReconcileStatus: current.lastReconcileStatus,
        lastReconcileScore: current.lastReconcileScore,
        lastReconcileMismatchCount: current.lastReconcileMismatchCount,
        proofCheckedAt: new Date().toISOString(),
      },
      userId,
      current.source || "memory"
    );

    const saved = await saveBrokerConnection(userId, failed, "sync_error");
    const safe = sanitizeConnectionForClient(saved);
    await writeEngineEvent({
      userId,
      mode,
      event: "order_failed",
      status: "error",
      source: "api.broker.sync",
      executionId,
      details: {
        error: errMessage,
        broker: current.broker,
        connectionMethod: current.connectionMethod,
        duration_ms: Date.now() - startedAtMs,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: errMessage,
        executionId,
        mode,
        status: "error",
        ...safe,
      },
      { status: 502 }
    );
  }
}

