import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  brokerLabel,
  hasConnectionEvidence,
  isConnectionMethodSupportedForBroker,
  isBrokerManualOnly,
  loadBrokerConnection,
  manualOnlyBrokerReason,
  normalizeBrokerConnection,
  normalizeBrokerProvider,
  normalizeConnectionMethod,
  sanitizeConnectionForClient,
  saveBrokerConnection,
} from "@/lib/broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLegacySnaptradeRequest(body: any) {
  const provider = String(body.provider || body.broker || "").toLowerCase().trim();
  const method = String(body.connectionMethod || "").toLowerCase().trim();
  return provider === "snaptrade" && !method;
}

function buildSnaptradeConnectUrl(userId: string) {
  const base = process.env.SIGNALCORE_SNAPTRADE_CONNECT_URL || process.env.SNAPTRADE_CONNECT_URL;
  if (!base) return null;
  try {
    const u = new URL(base);
    u.searchParams.set("clientUserId", userId);
    return u.toString();
  } catch {
    return base;
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (isLegacySnaptradeRequest(body)) {
    const connectUrl = buildSnaptradeConnectUrl(userId);
    if (!connectUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "snaptrade_not_configured",
          message: "Set SIGNALCORE_SNAPTRADE_CONNECT_URL to enable redirect-based connection.",
        },
        { status: 501 }
      );
    }
    return NextResponse.json({ ok: true, connectUrl }, { status: 200 });
  }

  try {
    const current = await loadBrokerConnection(userId);

    const broker = normalizeBrokerProvider(body.broker || body.provider || current.broker);
    const connectionMethod = normalizeConnectionMethod(body.connectionMethod || current.connectionMethod);
    const connectionReference = String(body.connectionReference ?? current.connectionReference ?? "").trim();
    const csvImported = Boolean(body.csvImported ?? current.csvImported);

    if (!isConnectionMethodSupportedForBroker(broker, connectionMethod) || connectionMethod === "none") {
      return NextResponse.json(
        {
          ok: false,
          error: "unsupported_connection_method",
          message: isBrokerManualOnly(broker)
            ? `${brokerLabel(broker)} is manual-only: use CSV import mode. API/OAuth automated execution is not supported.`
            : "Choose a supported connection method for this broker.",
        },
        { status: 400 }
      );
    }

    const proofOk = hasConnectionEvidence({
      connectionMethod,
      connectionReference,
      csvImported,
    });

    if (!proofOk) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_connection_proof",
          message:
            "Use API token (`api_...` / `key_...`), OAuth token (`oauth_...`), or CSV filename (`.csv` / `.tsv`) with CSV imported enabled.",
        },
        { status: 400 }
      );
    }

    const merged = normalizeBrokerConnection(
      {
        ...current,
        broker,
        accountLabel: String(body.accountLabel ?? current.accountLabel ?? ""),
        connectionMethod,
        connectionReference,
        csvImported,
        autoSync: isBrokerManualOnly(broker) ? false : body.autoSync != null ? Boolean(body.autoSync) : current.autoSync,
        syncEveryMinutes: body.syncEveryMinutes != null ? Number(body.syncEveryMinutes) : current.syncEveryMinutes,
        importExecutions: body.importExecutions != null ? Boolean(body.importExecutions) : current.importExecutions,
        readOnly: isBrokerManualOnly(broker) ? true : body.readOnly != null ? Boolean(body.readOnly) : current.readOnly,
        connected: true,
        lastError: null,
        lastSyncStatus: current.lastSyncStatus === "error" ? "idle" : current.lastSyncStatus,
        proofCheckedAt: new Date().toISOString(),
        notes: isBrokerManualOnly(broker) ? [manualOnlyBrokerReason(broker)] : undefined,
      },
      userId,
      current.source || "memory"
    );

    const saved = await saveBrokerConnection(userId, merged, "connect");
    const safe = sanitizeConnectionForClient(saved);
    return NextResponse.json(
      {
        ok: true,
        status: safe.autoSync ? "active" : "connected",
        ...safe,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "connect_failed" }, { status: 500 });
  }
}

