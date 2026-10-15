import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { logConversionEvent } from "@/lib/signalcore/conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanVisitorId(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-:.]+/g, "_")
    .slice(0, 96);
}

export async function POST(req: Request) {
  try {
    const { userId: authedUserId } = await auth();

    const body = (await req.json().catch(() => ({}))) as {
      event?: string;
      mode?: string;
      source?: string;
      visitorId?: string;
      details?: Record<string, unknown>;
    };

    const event = String(body?.event || "").trim();
    if (!event) return NextResponse.json({ ok: false, error: "missing_event" }, { status: 400 });
    const visitorId = cleanVisitorId(body?.visitorId);
    const userId =
      authedUserId ||
      (event === "paywall_open" && visitorId ? `anon:${visitorId}` : "");
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const result = await logConversionEvent({
      userId,
      event,
      mode: body?.mode || "investing",
      source: body?.source || "client",
      details: body?.details || {},
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason || "conversion_event_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "conversion_event_failed", message: e?.message || "Unknown" },
      { status: 500 }
    );
  }
}

