import { auth } from "@clerk/nextjs/server";
import { actorSchema, type Actor } from "../contracts";

/**
 * Server-only identity boundary for a future authorized Investing API.
 * Do not deserialize this value from user JSON, cookies, or request headers.
 */
export async function requireVerifiedClerkActor(): Promise<Actor> {
  const session = await auth();
  if (!session.userId || !session.sessionId) throw new Error("UNAUTHENTICATED");
  return actorSchema.parse({ userId: session.userId, sessionId: session.sessionId });
}
