import type { NextRequest } from "next/server";
import { handleR1AccountsRead } from "@/investing-core/server/accountsReadHttp";
import { loadOwnInvestingAccountsFromClerk } from "@/investing-core/server/loadOwnInvestingAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * R1 read-only account discovery. No body, no URL filters, no client-supplied
 * identity and no persistence writes. Server Clerk auth() is the sole actor
 * source; Supabase validates the JWT and enforces owner/membership RLS.
 *
 * Remains HTTP 404 until an independently authorized environment is wired
 * to an exact Supabase project with the Investing schema + RLS provisioned.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handleR1AccountsRead(
    request.url,
    process.env,
    loadOwnInvestingAccountsFromClerk,
  );
}
