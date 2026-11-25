import assert from "node:assert/strict";
import test from "node:test";
import { readNewsForAnalysisV1 } from "../analysisNewsConsumer";
import type { GlobalNewsApiV1, GlobalNewsPublicationV1 } from "../globalNewsApi";
import type { NewsEnvelope, NewsServiceAuthV1 } from "../n5Api";

const asOf = "2026-11-15T10:00:00.000Z";
const auth: NewsServiceAuthV1 = { serviceId: "news_reader", credential: "test-credential" };
const publication: GlobalNewsPublicationV1 = {
  publicationRevisionId: "rev-1", publicationId: "pub-1", revisionNo: 1, title: "Reported headline",
  publishedAt: "2026-11-15T09:00:00.000Z", form: "GLOBAL_RSS_2", sourceDocumentRef: "https://example.com/news",
  contentExcerpt: null, rightsMode: "METADATA_ONLY", qualityFlags: [], ingestedAt: "2026-11-15T09:01:00.000Z",
  asKnownAt: "2026-11-15T09:02:00.000Z", supersedesRevisionId: null,
};
function envelope<T>(data: T[], extra: Partial<NewsEnvelope<T>> = {}): NewsEnvelope<T> {
  return { schemaVersion: "1.0", requestId: "test", status: "AVAILABLE", asOf, servedAt: asOf,
    data, sourceRefs: [], qualityFlags: [], nextCursor: null, ...extra };
}
function api(pub = envelope([publication]), facts = envelope<unknown>([])): Pick<GlobalNewsApiV1, "search" | "events"> {
  return {
    async search(_auth, input) { assert.equal(input?.asOf, asOf); return { contractVersion: "news-global-v1", news: pub, coverage: "FULL" }; },
    async events(_auth, input) { assert.equal(input?.asOf, asOf); return { contractVersion: "news-global-v1", news: facts, coverage: "FULL" }; },
  };
}
const input = { asOf, publications: {}, events: {} };

test("both engines get identical data under independent consumer identities; headlines are not facts", async () => {
  const a = await readNewsForAnalysisV1(api(), auth, "INVESTING", input);
  const b = await readNewsForAnalysisV1(api(), auth, "TRADING", input);
  assert.equal(a.publications.consumer, "INVESTING");
  assert.equal(b.publications.consumer, "TRADING");
  assert.deepEqual(a.publications.news, b.publications.news);
  assert.deepEqual(a.events.news.data, []);
  assert.equal(a.publications.news.data[0].rightsMode, "METADATA_ONLY");
});
test("future data and mismatched cutoffs are rejected", async () => {
  await assert.rejects(readNewsForAnalysisV1(api(envelope([{ ...publication, asKnownAt: "2026-11-15T10:01:00Z" }])), auth, "INVESTING", input), /PUBLICATION_LOOKAHEAD/);
  await assert.rejects(readNewsForAnalysisV1(api(envelope([publication]), envelope([{ asKnownAt: "2026-11-15T10:01:00Z" }])), auth, "TRADING", input), /EVENT_LOOKAHEAD/);
  await assert.rejects(readNewsForAnalysisV1(api(envelope([publication], { asOf: "2026-11-15T09:00:00Z" })), auth, "INVESTING", input), /TEMPORAL_MISMATCH/);
});
test("partial and incomplete results are not hidden", async () => {
  const result = await readNewsForAnalysisV1(api(envelope([publication], { nextCursor: "more" }), envelope([], { status: "UNAVAILABLE" })), auth, "TRADING", input);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.paginationComplete, false);
});
