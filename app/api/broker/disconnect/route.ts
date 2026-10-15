import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { loadBrokerConnection, saveBrokerConnection } from "@/lib/broker/store";
import { normalizeBrokerConnection, sanitizeConnectionForClient } from "@/lib/broker/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const current = await loadBrokerConnection(userId);
    const next = normalizeBrokerConnection(
      {
        ...current,
        connected: false,
        lastError: null,
        lastSyncStatus: "idle",
      },
      userId,
      current.source || "memory"
    );

    const saved = await saveBrokerConnection(userId, next, "disconnect");
    const safe = sanitizeConnectionForClient(saved);
    return NextResponse.json(
      {
        ok: true,
        status: "disconnected",
        ...safe,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "disconnect_failed" }, { status: 500 });
  }
}

