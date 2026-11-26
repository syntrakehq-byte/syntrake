import { auth } from "@clerk/nextjs/server";

export type MarketActor = Readonly<{ userId: string; sessionId: string }>;

/**
 * Market Core verifies the calling account, not a hard-coded founder.
 * Market data responses carry no user portfolio or ledger state.
 * Account entitlements and quotas are separate consumer access policies.
 */
export function verifyMarketActor(session: Readonly<{
  userId: string | null | undefined;
  sessionId: string | null | undefined;
}>): MarketActor {
  if (!session.userId || !session.sessionId ||
      !/^user_[A-Za-z0-9_-]{8,128}$/.test(session.userId) ||
      session.sessionId.length > 256) {
    throw new Error("UNAUTHENTICATED");
  }
  return { userId: session.userId, sessionId: session.sessionId };
}

/** Each browser request needs a verified Clerk user and session. */
export async function requireMarketActor(): Promise<MarketActor> {
  return verifyMarketActor(await auth());
}
