import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { inspectRehearsalJwtClaims } from "@/investing-core/server/rehearsalJwtIndicators";
import { isInvestingR0aClerkAbReadRehearsalEnabled } from "@/investing-core/server/rehearsalReadGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary read-only Preview diagnostics. These boolean indicators are
 * NOT a trusted authorization decision. Real signature, issuer and RLS
 * checks remain exclusively at the Supabase/PostgREST boundary.
 */
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export async function GET(): Promise<NextResponse> {
  if (!isInvestingR0aClerkAbReadRehearsalEnabled(process.env)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers });
  }

  try {
    const session = await auth();
    if (!session.userId || !session.sessionId) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
    }
    const token = await session.getToken();
    if (!token) {
      return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 503, headers });
    }
    const indicators = inspectRehearsalJwtClaims(token);
    return NextResponse.json(indicators, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "DIAGNOSTIC_UNAVAILABLE" }, { status: 503, headers });
  }
}
