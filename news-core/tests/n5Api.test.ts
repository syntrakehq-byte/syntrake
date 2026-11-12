import assert from "node:assert/strict";
import test from "node:test";
import { NewsConsumptionApiV1 } from "../n5Api";
import { NewsObservabilityV1 } from "../observability";

const publication = { publicationRevisionId: "p:r:1", publicationId: "p", revisionNo: 1, title: "Official filing", publishedAt: null, form: "8-K", contentFingerprint: "c", sourceDocumentRef: "https://www.sec.gov/Archives/edgar/data/1/x.htm", qualityFlags: [], supersedesRevisionId: null, ingestedAt: "2026-01-01T00:00:00.000Z", asKnownAt: "2026-01-01T00:00:00.000Z" };
const fact = { factEventId: "event-1", factRevisionId: "event-1:revision:1", revisionNo: 1, canonicalClaimId: "claim-1", category: "LEGAL_REGULATORY", claimType: "EVENT_OCCURRENCE", statement: "The company was fined.", occurredAt: null, scheduledFor: null, confirmationStatus: "REPORTED", lifecycleStatus: "ACTIVE", polarity: "AFFIRMATIVE", asKnownAt: "2026-01-01T00:00:00.000Z", committedAt: "2026-01-01T00:00:00.000Z" };
const evidence = { factRevisionId: fact.factRevisionId, evidenceId: "e1", evidenceKind: "N3A_PROPOSAL", claimKey: "claim-key", publicationRevisionId: publication.publicationRevisionId, sourceDocumentRef: publication.sourceDocumentRef, contentLocator: "body:p1", provenanceRef: "prov-1", asKnownAt: fact.asKnownAt };
const source = { readPublicationRevisionsFilteredAsOf: async (_asOf: string, query: string | null) => query === "missing" ? [] : [publication], readFilteredAsOf: async (_asOf: string, targets: readonly string[]) => targets.length && !targets.includes(fact.factEventId) ? [] : [fact], readHistoryFilteredAsOf: async () => [fact], readEvidenceAsOf: async (_asOf: string, id: string) => id === fact.factRevisionId ? [evidence] : [] };
const auth = { serviceId: "news_reader" as const, credential: "test-credential" };

test("N5 canonical envelope, filters, PIT and exact signed cursor", async () => {
  const api = new NewsConsumptionApiV1(source, "0123456789abcdef", "test-credential");
  const first = await api.getNewsEvents(auth, { requestId: "req-1", asOf: "2026-01-02T00:00:00.000Z", targets: ["event-1"], eventTypes: ["EVENT_OCCURRENCE"], limit: 1 });
  assert.equal(first.schemaVersion, "1.0"); assert.equal(first.requestId, "req-1"); assert.equal(first.status, "AVAILABLE"); assert.equal(first.data.length, 1);
  const evidenceEnvelope = await api.getEventEvidence(auth, { eventId: fact.factEventId, asOf: "2026-01-02T00:00:00.000Z" }); assert.equal(evidenceEnvelope.data[0].sourceDocumentRef, publication.sourceDocumentRef);
  const discovered = await api.discoverNews(auth, { query: "missing", asOf: "2026-01-02T00:00:00.000Z" }); assert.equal(discovered.status, "AVAILABLE"); assert.deepEqual(discovered.data, []);
  await assert.rejects(api.getNewsEvents(auth, { asOf: "2999-01-01T00:00:00.000Z" }), /FUTURE_CUTOFF/);
  const pagedSource = { ...source, readFilteredAsOf: async () => [fact, { ...fact, factRevisionId: "event-2:revision:1", factEventId: "event-2" }] };
  const paged = new NewsConsumptionApiV1(pagedSource, "0123456789abcdef", "test-credential"); const page = await paged.getNewsEvents(auth, { asOf: "2026-01-02T00:00:00.000Z", limit: 1 }); assert.ok(page.nextCursor);
  const next = await paged.getNewsEvents(auth, { cursor: page.nextCursor, limit: 1 }); assert.equal(next.data[0].factEventId, "event-2");
  await assert.rejects(paged.getNewsEvents(auth, { cursor: `${page.nextCursor}.junk`, limit: 1 }), /CURSOR_INVALID/);
  await assert.rejects(paged.getNewsEvents(auth, { cursor: `${page.nextCursor}..junk`, limit: 1 }), /CURSOR_INVALID/);
});

test("N5 observability stores only stable allowlisted codes", () => {
  const metrics = new NewsObservabilityV1(); metrics.recordError(new Error("Authorization: Bearer actual-secret postgres://user:password@host/db?access_token=query-secret body=external")); const snapshot = JSON.stringify(metrics.snapshot());
  assert.equal(metrics.snapshot().lastErrorCode, "NEWS_OPERATION_FAILED"); assert.equal(snapshot.includes("actual-secret"), false); assert.equal(snapshot.includes("postgres://"), false); assert.equal(snapshot.includes("query-secret"), false); assert.equal(snapshot.includes("external"), false);
});
