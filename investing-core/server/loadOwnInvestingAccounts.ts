import { auth } from "@clerk/nextjs/server";
import {
  readOwnInvestingAccounts,
  type InvestingReadResult,
} from "./supabaseReadTransport";

/**
 * The sole entry for a future Investing read route.
 * The current R0-A candidate has NO HTTP route for financial state.
 *
 * Clerk auth() verifies the incoming server session. Never accept an Actor,
 * bearer token, account ID, or user ID from the request body to use here.
 */
export async function loadOwnInvestingAccountsFromClerk(): Promise<InvestingReadResult> {
  const session = await auth();
  return readOwnInvestingAccounts(
    {
      userId: session.userId,
      sessionId: session.sessionId,
      getToken: () => session.getToken(),
    },
    {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
  );
}
