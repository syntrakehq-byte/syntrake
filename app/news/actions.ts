"use server";

import { auth } from "@clerk/nextjs/server";
import { manualNewsRefreshAllowed, refreshPersistedSiteNews, type ManualNewsRefreshResult } from "@/news-core/siteNewsManualRefresh";

export async function requestManualNewsRefresh(): Promise<ManualNewsRefreshResult> {
  const session = await auth();
  if (!session.userId || !session.sessionId || !manualNewsRefreshAllowed(session.userId)) {
    return { status: "UNAVAILABLE", sources: [] };
  }
  return await refreshPersistedSiteNews(session.userId);
}
