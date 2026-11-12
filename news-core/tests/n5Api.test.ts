import assert from "node:assert/strict";
import test from "node:test";
import { NewsConsumptionApiV1 } from "../n5Api";

const publication = { publicationRevisionId: "p:r:1", publicationId: "p", revisionNo: 1, title: "Official filing", publishedAt: null, form: "8-K", contentFingerprint: "c", sourceDocumentRef: "https://www.sec.gov/Archives/edgar/data/1/x.htm", qualityFlags: [], supersedesRevisionId: null, ingestedAt: "2026-01-01T00:00:00.000Z", asKnownAt: "2026-01-01T00:00:00.000Z" };
const fact = { factEventId: "event-1", factRevisionId: "event-1:revision:1", revisionNo: 1, canonicalClaimId: "claim-1", category: "LEGAL_REGULATORY", claimType: "EVENT_OCCURRENCE", statement: "The company was fined.", occurredAt: null, scheduledFor: null, confirmationStatus: "REPORTED", lifecycleStatus: "ACTIVE", polarity: "AFFIRMATIVE", asKnownAt: "2026-01-01T00:00:00.000Z", committedAt: "2026-01-01T00:00:00.000Z" };
const source = { readPublicationRevisionsAsOf: async () => [publication], readAsOf: async () => [fact], readHistoryAsOf: async () => [fact], readEvidenceAsOf: async () => [{ factRevisionId: fact.factRevisionId, evidenceId: "e1", evidenceKind: "N3A_PROPOSAL", claimKey: "claim-key", publicationRevisionId: publication.publicationRevisionId, sourceDocumentRef: publication.sourceDocumentRef, contentLocator: "body:p1", provenanceRef: "prov-1", asKnownAt: fact.asKnownAt }] };
const auth = { serviceId: "news_reader" as const, credential: "test-credential" };

test("N5 envelope, PIT cutoff and signed cursor are deterministic", async () => {
  const api = new NewsConsumptionApiV1(source, "0123456789abcdef", "test-credential");
  const first = await api.getNewsEvents(auth, { asOf: "2026-01-02T00:00:00.000Z", limit: 1 });
  assert.equal(first.status, "AVAILABLE"); assert.equal(first.data.length, 1); assert.equal(first.nextCursor, null);
  const evidence = await api.getEventEvidence(auth, fact.factRevisionId, { asOf: "2026-01-02T00:00:00.000Z" });
  assert.equal(evidence.data[0].sourceDocumentRef, publication.sourceDocumentRef);
  await assert.rejects(api.getNewsEvents(auth, { asOf: "2999-01-01T00:00:00.000Z" }), /FUTURE_CUTOFF/);
  await assert.rejects(api.getNewsEvents({ ...auth, credential: "wrong" }, {}), /SERVICE_AUTH/);
  const pagedSource = { ...source, readAsOf: async () => [fact, { ...fact, factRevisionId: "event-2:revision:1", factEventId: "event-2" }] };
  const paged = new NewsConsumptionApiV1(pagedSource, "0123456789abcdef", "test-credential");
  const page = await paged.getNewsEvents(auth, { asOf: "2026-01-02T00:00:00.000Z", limit: 1 }); assert.ok(page.nextCursor);
  const next = await paged.getNewsEvents(auth, { cursor: page.nextCursor, limit: 1 }); assert.equal(next.data[0].factEventId, "event-2");
  await assert.rejects(paged.getNewsEvents(auth, { cursor: `${page.nextCursor!.slice(0, -1)}x`, limit: 1 }), /CURSOR_INVALID/);
});

test("N5 rejects empty and invalid limits without external side effects", async () => {
  const api = new NewsConsumptionApiV1({ ...source, readAsOf: async () => [] }, "0123456789abcdef", "test-credential");
  assert.equal((await api.getNewsEvents(auth, { asOf: "2026-01-02T00:00:00.000Z" })).status, "EMPTY");
  await assert.rejects(api.getNewsEvents(auth, { limit: 101 }), /LIMIT_INVALID/);
  assert.equal(api.observability.snapshot().metrics.errors, 0);
});
