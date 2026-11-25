import { adaptNewsForConsumerV1, type NewsConsumerKindV1 } from "./consumerContracts";
import type { GlobalNewsApiV1, GlobalNewsSearchInputV1 } from "./globalNewsApi";
import type { NewsEventsInput, NewsServiceAuthV1 } from "./n5Api";

export type AnalysisNewsInputV1 = Readonly<{
  asOf: string;
  publications: Omit<GlobalNewsSearchInputV1, "asOf">;
  events: Omit<NewsEventsInput, "asOf">;
}>;

/** Same point-in-time source for both engines; metadata and verified/reported
 * facts remain separate. No trade instruction, scoring, or account data.
 * This is a single page per stream: callers must follow each cursor until
 * exhausted before asserting that the requested evidence set is complete. */
export async function readNewsForAnalysisV1(
  api: Pick<GlobalNewsApiV1, "search" | "events">,
  auth: NewsServiceAuthV1,
  consumer: NewsConsumerKindV1,
  input: AnalysisNewsInputV1,
) {
  if (consumer !== "INVESTING" && consumer !== "TRADING") throw new Error("NEWS_CONSUMER_INVALID");
  const time = Date.parse(input.asOf);
  if (!Number.isFinite(time) || time > Date.now()) throw new Error("NEWS_ANALYSIS_CUTOFF_INVALID");
  const asOf = new Date(time).toISOString();
  const [publications, events] = await Promise.all([
    api.search(auth, { ...input.publications, asOf }),
    api.events(auth, { ...input.events, asOf }),
  ]);
  for (const envelope of [publications.news, events.news]) {
    if (Date.parse(envelope.asOf) !== time || Date.parse(envelope.servedAt) < time) {
      throw new Error("NEWS_ANALYSIS_TEMPORAL_MISMATCH");
    }
  }
  for (const row of publications.news.data) {
    if (!row.asKnownAt || !Number.isFinite(Date.parse(row.asKnownAt)) || Date.parse(row.asKnownAt) > time) {
      throw new Error("NEWS_ANALYSIS_PUBLICATION_LOOKAHEAD");
    }
  }
  for (const row of events.news.data) {
    if (!row || typeof row !== "object" || !("asKnownAt" in row) || typeof row.asKnownAt !== "string" ||
        !Number.isFinite(Date.parse(row.asKnownAt)) || Date.parse(row.asKnownAt) > time) {
      throw new Error("NEWS_ANALYSIS_EVENT_LOOKAHEAD");
    }
  }
  const status = publications.news.status === "UNAVAILABLE" && events.news.status === "UNAVAILABLE" ? "UNAVAILABLE" :
    publications.news.status !== "AVAILABLE" || events.news.status !== "AVAILABLE" ||
    publications.coverage !== "FULL" || events.coverage !== "FULL" ? "PARTIAL" : "AVAILABLE";
  return {
    asOf,
    status,
    paginationComplete: publications.news.nextCursor === null && events.news.nextCursor === null,
    publications: adaptNewsForConsumerV1(consumer, publications.news),
    events: adaptNewsForConsumerV1(consumer, events.news),
  } as const;
}
