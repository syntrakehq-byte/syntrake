import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";

/** Only the verified production Clerk owner can query personal market data. */
export async function requirePersonalMarketActor() {
  const actor = await requireVerifiedClerkActor();
  const owner = process.env.SYNTRAKE_MARKET_OWNER_USER_ID;
  if (!owner || actor.userId !== owner) throw new Error("MARKET_OWNER_ONLY");
  return actor;
}
