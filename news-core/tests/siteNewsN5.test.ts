import assert from "node:assert/strict";
import test from "node:test";
import { mapNewsN5ForSite } from "../siteNewsN5";
import type { NewsPublicationRevision } from "../contracts";

const record = (overrides: Partial<NewsPublicationRevision> = {}): NewsPublicationRevision => ({
  publicationRevisionId: "publication-a:revision:1",
  publicationId: "publication-a",
  revisionNo: 1,
  title: "Central bank publishes a statement",
  publishedAt: "2026-11-25T12:00:00.000Z",
  form: "GLOBAL_RSS_2",
  contentFingerprint: "fingerprint",
  contentExcerpt: "This text must never be shown",
  sourceDocumentRef: "https://www.ecb.europa.eu/press/something",
  qualityFlags: ["RIGHTS_METADATA_ONLY"],
  supersedesRevisionId: null,
  ingestedAt: "2026-11-25T12:10:00.000Z",
  asKnownAt: "2026-11-25T12:10:10.000Z",
  sourceId: "eu-ecb-press",
  rightsMode: "METADATA_ONLY",
  ...overrides,
});

test("site maps N5 PIT publications to safe metadata only", () => {
  const data = mapNewsN5ForSite([record()], ["eu-ecb-press"]);
  assert.equal(data.length, 1);
  assert.equal(data[0].sourceId, "eu-ecb-press");
  assert.equal(data[0].title, "Central bank publishes a statement");
  assert.equal(data[0].publishedAt, "2026-11-25T12:00:00.000Z");
  assert.equal(data[0].originalUrl, "https://www.ecb.europa.eu/press/something");
  assert.equal("contentExcerpt" in data[0], false);
  assert.equal(JSON.stringify(data).includes("This text must never be shown"), false);
  assert.deepEqual(data[0].qualityFlags, ["RIGHTS_METADATA_ONLY"]);
});
test("site N5 mapping ignores unapproved sources and unsafe destinations", () => {
  const data = mapNewsN5ForSite([
    record({sourceId: "unapproved"}),
    record({sourceDocumentRef: "javascript:alert(1)"}),
    record({sourceDocumentRef: "http://www.ecb.europa.eu/press"}),
    record({sourceDocumentRef: "https://localhost/admin"}),
    record({sourceDocumentRef: "https://127.0.0.1/admin"}),
    record({sourceDocumentRef: "https://a.example:8443/news"}),
    record({sourceDocumentRef: "https://user:pass@a.example/news"}),
    record({sourceDocumentRef: "https://www.ecb.europa.eu/press#frag"}),
    record({sourceDocumentRef: "https://www.ecb.europa.eu/press", publicationRevisionId: "safe"}),
  ], ["eu-ecb-press"]);
  assert.deepEqual(data.map(x => x.publicationRevisionId), ["safe"]);
});
