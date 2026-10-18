import { NextResponse } from "next/server";
import { loadOwnInvestingAccountsFromClerk } from "@/investing-core/server/loadOwnInvestingAccounts";
import { InvestingReadBlocked } from "@/investing-core/server/supabaseReadTransport";
import { isInvestingR0aClerkAbReadRehearsalEnabled } from "@/investing-core/server/rehearsalReadGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noCache = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

/**
 * Preview-only, zero-DML Clerk -> Supabase JWT -> RLS integration probe.
 * No request parameters, raw tokens or user IDs are accepted. Each account
 * summary is supplied by the existing read-only server adapter after Clerk
 * auth() and Supabase PostgREST's signature verification/RLS.
 *
 * Absent the explicit preview-only gate, this route returns 404.
 * This is diagnostic, never a financial writer or production endpoint.
 */
export async function GET(): Promise<NextResponse> {
  if (!isInvestingR0aClerkAbReadRehearsalEnabled(process.env)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: noCache });
  }

  try {
    const data = await loadOwnInvestingAccountsFromClerk();
    return NextResponse.json(
      { state: data.state, accounts: data.accounts },
      { status: 200, headers: noCache },
    );
  } catch (error: unknown) {
    if (error instanceof InvestingReadBlocked && error.code === "UNAUTHENTICATED") {
      return NextResponse.json(
        { error: "UNAUTHENTICATED" }, { status: 401, headers: noCache },
      );
    }
    // No propagation of credentials, JWTs, internal actor IDs, SQL details,
    // upstream errors or any third-party responses to the client.
    return NextResponse.json(
      { error: "READ_UNAVAILABLE" }, { status: 503, headers: noCache },
    );
  }
}
