import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/requestUser";
import {
  buildDisconnectedConnection,
  loadBrokerConnection,
  sanitizeConnectionForClient,
} from "@/lib/broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const conn = await loadBrokerConnection(userId);
    const safe = sanitizeConnectionForClient(conn);

    const status = !safe.connected
      ? "disconnected"
      : safe.lastSyncStatus === "error" || safe.lastReconcileStatus === "critical"
      ? "error"
      : safe.autoSync
      ? "active"
      : "connected";

    return NextResponse.json(
      {
        ok: true,
        status,
        ...safe,
        message:
          status === "error"
            ? safe.lastError || (safe.lastReconcileStatus === "critical" ? "reconcile_critical" : "last_sync_failed")
            : safe.lastReconcileStatus === "warning"
              ? "reconcile_warning"
              : null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const errMsg = String(e?.message || "status_failed");
    if (errMsg === "broker_persistence_unavailable" || errMsg === "broker_persistence_failed") {
      const fallback = sanitizeConnectionForClient(buildDisconnectedConnection(userId, "none"));
      return NextResponse.json(
        {
          ok: true,
          status: "disconnected",
          ...fallback,
          message: "broker_persistence_unavailable",
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
  }
}

