import assert from "node:assert/strict";
import test from "node:test";
import { selectGlobalRevisionAtKnownAtV1 } from "../factualPipeline";
import type { NewsPublicationRevision } from "../contracts";

const revision = (revisionNo: number, asKnownAt: string, contentExcerpt: string | null): NewsPublicationRevision => ({
  publicationRevisionId: `publication:revision:${revisionNo}`, publicationId: "publication", revisionNo, title: `Revision ${revisionNo}`, form: "GLOBAL_RSS_2", contentFingerprint: `fingerprint-${revisionNo}`, contentExcerpt, sourceDocumentRef: "https://example.org/article", publishedAt: null, qualityFlags: [], supersedesRevisionId: revisionNo > 1 ? `publication:revision:${revisionNo - 1}` : null, ingestedAt: asKnownAt, asKnownAt,
});

test("global factual extraction cannot select a revision after the publication PIT cutoff", () => {
  const knownAt = "2026-11-16T10:00:00.000Z";
  const later = revision(2, "2026-11-16T10:05:00.000Z", "The company reported an outage.");
  const selected = selectGlobalRevisionAtKnownAtV1([revision(1, knownAt, "The company announced a dividend."), later], knownAt);
  assert.equal(selected?.revisionNo, 1);
  assert.equal(selected?.contentExcerpt, "The company announced a dividend.");
  assert.notEqual(selected?.contentExcerpt, later.contentExcerpt);
});

test("missing content on the selected revision does not fall back to a later revision", () => {
  const cutoff = "2026-11-16T10:00:00.000Z";
  const selected = selectGlobalRevisionAtKnownAtV1([revision(1, cutoff, null), revision(2, "2026-11-16T10:01:00.000Z", "The company reported an outage.")], cutoff);
  assert.equal(selected?.revisionNo, 1);
  assert.equal(selected?.contentExcerpt, null);
});
