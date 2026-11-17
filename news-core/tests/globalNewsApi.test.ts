import assert from "node:assert/strict";
import test from "node:test";
import { GlobalNewsApiV1 } from "../globalNewsApi";
import { NewsConsumptionApiV1 } from "../n5Api";

const revision = {
  publicationRevisionId: "pub:r1", publicationId: "pub", revisionNo: 1,
  title: "Central bank statement", publishedAt: "2026-11-17T10:00:00.000Z", form: "RSS",
  contentFingerprint: "hash", contentExcerpt: "secret body", sourceDocumentRef: "https://example.test/a",
  qualityFlags: [], supersedesRevisionId: null, ingestedAt: "2026-11-17T10:01:00.000Z", asKnownAt: "2026-11-17T10:01:00.000Z",
};
const auth = { serviceId: "news_reader" as const, credential: "global-test-credential" };
const source = {
  readPublicationRevisionsFilteredAsOf: async () => [revision],
  readFilteredAsOf: async () => [],
  readHistoryFilteredAsOf: async () => [],
  readEvidenceAsOf: async () => [],
};

test("N-G6 exposes a versioned PIT publication contract and never leaks metadata-only text", async () => {
  const api = new GlobalNewsApiV1(new NewsConsumptionApiV1(source, "0123456789abcdef", auth.credential));
  const result = await api.search(auth, { asOf: "2026-11-17T11:00:00.000Z", query: "bank" });
  assert.equal(result.contractVersion, "news-global-v1");
  assert.equal(result.news.data[0].rightsMode, "METADATA_ONLY");
  assert.equal(result.news.data[0].contentExcerpt, null);
  assert.equal(result.news.asOf, "2026-11-17T11:00:00.000Z");
});

test("N-G6 only presents text with an explicit persisted rights flag", async () => {
  const permitted = { ...revision, qualityFlags: ["RIGHTS_PERMITTED_TEXT"] };
  const permittedSource = { ...source, readPublicationRevisionsFilteredAsOf: async () => [permitted] };
  const api = new GlobalNewsApiV1(new NewsConsumptionApiV1(permittedSource, "0123456789abcdef", auth.credential));
  const result = await api.search(auth, { asOf: "2026-11-17T11:00:00.000Z" });
  assert.equal(result.news.data[0].rightsMode, "PERMITTED_TEXT");
  assert.equal(result.news.data[0].contentExcerpt, "secret body");
});

test("N-G6 does not invent entity links and rejects unproven filters", async () => {
  const api = new GlobalNewsApiV1(new NewsConsumptionApiV1(source, "0123456789abcdef", auth.credential));
  await assert.rejects(api.search(auth, { asOf: "2026-11-17T11:00:00.000Z", filters: { categories: ["MACRO"] } }), /FILTER_NOT_PROVEN/);
  await assert.rejects(api.search(auth, { asOf: "2026-11-17T11:00:00.000Z", filters: { entityIds: ["issuer-1"] } }), /ENTITY_FILTER_NOT_AVAILABLE/);
});

