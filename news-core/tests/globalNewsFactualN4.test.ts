import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicFactClassifierV1, excerptHashV1, type ClassificationInputV1 } from "../factualClassification";
import { globalItemsToNewsBatch } from "../globalNewsPersistence";
import { normalizeNewsTextV1 } from "../textNormalization";
import type { GlobalNewsRegistryEntry } from "../globalNewsRegistry";

const source = (id: string, sourceType: "RSS_2" | "ATOM" | "JSON_FEED_V1"): GlobalNewsRegistryEntry => ({
  registryVersion: "1.0", sourceId: id, publisherId: `${id}-publisher`, publisher: id, category: "CENTRAL_BANK", geoScope: ["EU"], sourceType,
  endpoint: `https://example.org/${id}.xml`, allowedArticleHosts: ["example.org"], rightsPolicyId: "metadata-only-v1",
  updatePolicy: { minIntervalSeconds: 60, maxItemsPerCycle: 20 }, storagePolicy: { content: "PERMITTED_TEXT", retentionDays: 30, presentation: "PUBLIC" }, status: "ACTIVE", checkpointScope: `${id}:global`,
});

function input(excerpt: string | null): ClassificationInputV1 {
  const url = "https://example.org/article/1";
  const revision = { publicationRevisionId: "global-rev-1", publicationId: "global-pub-1", revisionNo: 1, title: "Headline", form: "GLOBAL_RSS_2", sourceDocumentRef: url, contentFingerprint: excerpt ? excerptHashV1(excerpt) : null, publishedAt: null, ingestedAt: "2026-11-16T10:01:00.000Z", asKnownAt: "2026-11-16T10:02:00.000Z", qualityFlags: [], visibilityState: "COMMITTED" as const };
  const evidence = excerpt ? [{ evidenceId: "global-excerpt-1", publicationRevisionId: revision.publicationRevisionId, kind: "DOCUMENT_EXCERPT" as const, sourceDocumentRef: url, contentLocator: "publication:contentExcerpt", excerpt, excerptHash: excerptHashV1(excerpt), hashSemantics: "LOCAL_CONTENT_HASH_ONLY" as const, structuredField: null, structuredValue: null, structuredAuthority: null, observedAt: revision.asKnownAt, retrievedAt: revision.asKnownAt, asKnownAt: revision.asKnownAt, provenanceRef: "global-pub-1:provenance:1" }] : [{ evidenceId: "global-form", publicationRevisionId: revision.publicationRevisionId, kind: "STRUCTURED_FIELD" as const, sourceDocumentRef: url, contentLocator: "field:form", excerpt: null, excerptHash: null, hashSemantics: "LOCAL_CONTENT_HASH_ONLY" as const, structuredField: "form", structuredValue: revision.form, structuredAuthority: null, observedAt: revision.asKnownAt, retrievedAt: revision.asKnownAt, asKnownAt: revision.asKnownAt, provenanceRef: "global-pub-1:provenance:1" }];
  return { contractVersion: "news-fact-classification-v1", taxonomyVersion: "news-fact-taxonomy-v1", ruleSetVersion: "deterministic-rule-v1", publicationRevision: revision, evidence, proposedAt: "2026-11-16T10:03:00.000Z" };
}

test("normalization decodes entities without changing deterministic text semantics", () => {
  assert.equal(normalizeNewsTextV1("Rate&#160;decision&#8217;s &#038; outlook"), "Rate decision’s & outlook");
});

test("contextual central-bank, regulator and corporate excerpts use the existing N3-A engine", () => {
  const classifier = new DeterministicFactClassifierV1();
  assert.equal(classifier.classify(input("The European Central Bank raised the policy rate.")).proposals[0]?.category, "CENTRAL_BANK_DECISION");
  assert.equal(classifier.classify(input("The regulator approved the settlement.")).proposals[0]?.category, "LEGAL_REGULATORY");
  assert.equal(classifier.classify(input("The company announced a dividend.")).proposals[0]?.category, "DIVIDEND_ANNOUNCEMENT");
});

test("title-only and context-free excerpts are preserved as publications but produce no claim", () => {
  const result = new DeterministicFactClassifierV1().classify(input("This proposal was approved."));
  assert.equal(result.proposals.length, 0);
  assert.equal(new DeterministicFactClassifierV1().classify(input(null)).proposals.length, 0);
});

test("unknown publication dates remain null and collection time is not used as occurredAt", () => {
  const item = { sourceId: "ecb", providerKey: "rss" as const, externalId: "1", publicationId: "pub-1", originalUrl: "https://example.org/article/1", title: "Policy update", summary: "The European Central Bank raised the policy rate.", publishedAt: null, updatedAt: null, retrievedAt: "2026-11-16T10:00:00.000Z", publisher: "ECB", rightsPolicyId: "metadata-only-v1", contentFingerprint: "fingerprint", qualityFlags: ["SOURCE_PUBLICATION_DATE_UNKNOWN"] };
  const batch = globalItemsToNewsBatch(source("ecb", "RSS_2"), [item], "2026-11-16T10:01:00.000Z");
  assert.equal(batch.publications[0].publishedAt, null);
  assert.equal(batch.publications[0].contentExcerpt, item.summary);
  assert.equal(batch.publications[0].firstSeenAt, item.retrievedAt);
});

test("different sources retain independent publication identities and replay keys", () => {
  const a = globalItemsToNewsBatch(source("ecb", "RSS_2"), [{ sourceId: "ecb", providerKey: "rss", externalId: "same", publicationId: "ecb-pub", originalUrl: "https://example.org/ecb", title: "A", summary: null, publishedAt: null, updatedAt: null, retrievedAt: "2026-11-16T10:00:00.000Z", publisher: "ECB", rightsPolicyId: "metadata-only-v1", contentFingerprint: "a", qualityFlags: [] }]);
  const b = globalItemsToNewsBatch(source("fed", "ATOM"), [{ sourceId: "fed", providerKey: "atom", externalId: "same", publicationId: "fed-pub", originalUrl: "https://example.org/fed", title: "B", summary: null, publishedAt: null, updatedAt: null, retrievedAt: "2026-11-16T10:00:00.000Z", publisher: "Fed", rightsPolicyId: "metadata-only-v1", contentFingerprint: "b", qualityFlags: [] }]);
  assert.notEqual(a.publications[0].publicationId, b.publications[0].publicationId);
  assert.notEqual(a.checkpoint.sourceId, b.checkpoint.sourceId);
});
