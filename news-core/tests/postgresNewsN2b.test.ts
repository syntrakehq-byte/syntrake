import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { PostgresNewsStore } from "../postgresStore";
import { validateEntityResolution, type MarketCoreResolutionV1 } from "../entityResolution";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const n1Migration = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const n2Migration = new URL("../../supabase/migrations/20261111170000_news_core_n2a_revisions.sql", import.meta.url);
const n2bMigration = new URL("../../supabase/migrations/20261111180000_news_core_n2b_entity_links.sql", import.meta.url);

test("News Core N2-B canonical bridge, conservative matches and PIT", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  const admin = new Client({ connectionString: DB_URL });
  const pool = new Pool({ connectionString: DB_URL, max: 8 });
  const store = new PostgresNewsStore(pool);
  const suffix = randomUUID().replaceAll("-", "");
  const publicationId = `n2b-publication-${suffix}`;
  const sourceId = `n2b-source-${suffix}`;
  const scope = `n2b-scope-${suffix}`;
  const revisionId = `${publicationId}:revision:1`;
  const futurePublicationId = `n2b-future-publication-${suffix}`;
  const futureRevisionId = `${futurePublicationId}:revision:1`;
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let futureFrontierId: string | null = null;
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(n1Migration, "utf8"));
    await admin.query("insert into news_core.sources(source_id,provider_key,source_type) values ($1,'n2b-fixture','SEC_EDGAR')", [sourceId]);
    const frontier = await admin.query<{ frontier_id: string; published_at: Date }>("insert into news_core.visibility_frontiers default values returning frontier_id,published_at");
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,'8-K','COMMITTED',$9)", [publicationId, sourceId, `origin-${publicationId}`, publicationId, "https://www.sec.gov/Archives/edgar/data/1/n2b.htm", "Issuer event", now, frontier.rows[0].published_at, frontier.rows[0].frontier_id]);
    await admin.query("insert into news_core.observations(observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,visibility_frontier_id) values ($1,'n2b-fixture',$2,$3,$4,$4,'n2b','COMMITTED',$5)", [`observation-${publicationId}`, `observation-${publicationId}`, publicationId, now, frontier.rows[0].frontier_id]);
    const futureFrontier = await admin.query<{ frontier_id: string }>("insert into news_core.visibility_frontiers(published_at) values ($1::timestamptz) returning frontier_id", [future]);
    futureFrontierId = futureFrontier.rows[0].frontier_id;
    await admin.query("insert into news_core.publications(publication_id,source_id,origin_fingerprint,external_id,original_url,title,first_seen_at,ingested_at,as_known_at,form,visibility_state,visibility_frontier_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,'8-K','COMMITTED',$9)", [futurePublicationId, sourceId, `origin-${futurePublicationId}`, futurePublicationId, "https://www.sec.gov/Archives/edgar/data/1/future.htm", "Future parent event", now, future, future, futureFrontierId]);
    await admin.query(await readFile(n2Migration, "utf8"));
    await admin.query(await readFile(n2bMigration, "utf8"));

    const exact: MarketCoreResolutionV1 = {
      contractVersion: "market-core-identity-v1", resolverVersion: "fixture-v1", status: "EXACT", selectedCandidateRef: "listing-xnas", reason: "CANONICAL_REGISTRY_MATCH",
      candidates: [{ candidateRef: "listing-xnas", targetScope: "LISTING", relationType: "DIRECT", issuerId: "issuer-acme", instrumentId: "instrument-acme", listingId: "listing-xnas", evidence: [{ evidenceId: "evidence-cik", evidenceKind: "OFFICIAL_REGISTRY", sourceRef: "sec:cik:0000000001", observedAt: now, verified: true }] }],
    };
    const exactOutcome = await store.ingestEntityResolution(revisionId, exact);
    assert.equal(exactOutcome.inserted, true);
    const afterExact = await store.readEntityLinksAsOf(new Date(Date.now() + 10_000).toISOString(), publicationId);
    assert.equal(afterExact.length, 1);
    assert.equal(afterExact[0].identityStatus, "EXACT");
    assert.equal(afterExact[0].issuerId, "issuer-acme");
    assert.equal(afterExact[0].instrumentId, "instrument-acme");
    assert.equal(afterExact[0].listingId, "listing-xnas");
    assert.ok(Date.parse(String(afterExact[0].asKnownAt)) >= frontier.rows[0].published_at.getTime());
    const beforeLink = new Date(Date.parse(String(afterExact[0].asKnownAt)) - 1).toISOString();
    assert.deepEqual(await store.readEntityLinksAsOf(beforeLink, publicationId), []);
    assert.deepEqual(await store.ingestEntityResolution(revisionId, exact), { inserted: false, entityLinkRevisionId: exactOutcome.entityLinkRevisionId });

    const ambiguous: MarketCoreResolutionV1 = {
      contractVersion: "market-core-identity-v1", resolverVersion: "fixture-v1", status: "AMBIGUOUS", selectedCandidateRef: null, reason: "TICKER_MULTI_VENUE",
      candidates: [
        { candidateRef: "listing-xnas", targetScope: "LISTING", relationType: "MENTION", issuerId: "issuer-acme", instrumentId: "instrument-acme", listingId: "listing-xnas", evidence: [{ evidenceId: "e-xnas", evidenceKind: "EXCHANGE_REFERENCE", sourceRef: "exchange:xnas", observedAt: now, verified: true }] },
        { candidateRef: "listing-xlse", targetScope: "LISTING", relationType: "MENTION", issuerId: "issuer-other", instrumentId: "instrument-other", listingId: "listing-xlse", evidence: [{ evidenceId: "e-xlse", evidenceKind: "EXCHANGE_REFERENCE", sourceRef: "exchange:xlse", observedAt: now, verified: true }] },
      ],
    };
    const ambiguousOutcome = await store.ingestEntityResolution(revisionId, ambiguous);
    assert.equal(ambiguousOutcome.inserted, true);
    const effectiveLinks = await store.readEntityLinksAsOf(new Date(Date.now() + 10_000).toISOString(), publicationId);
    assert.deepEqual(effectiveLinks.filter(row => row.resolverVersion === "fixture-v1").map(row => row.identityStatus), ["AMBIGUOUS"]);
    assert.equal(effectiveLinks.find(row => row.resolverVersion === "fixture-v1")?.listingId, null);
    const historyLinks = await store.readEntityLinkHistoryAsOf(new Date(Date.now() + 10_000).toISOString(), publicationId);
    assert.deepEqual(historyLinks.filter(row => row.resolverVersion === "fixture-v1").map(row => row.identityStatus), ["EXACT", "AMBIGUOUS"]);
    const beforeAmbiguous = new Date(Date.parse(String(historyLinks.find(row => row.identityStatus === "AMBIGUOUS" && row.resolverVersion === "fixture-v1")?.asKnownAt)) - 1).toISOString();
    assert.deepEqual((await store.readEntityLinksAsOf(beforeAmbiguous, publicationId)).map(row => row.identityStatus), ["EXACT"]);

    const candidateId = (await admin.query<{ candidate_id: string }>("select candidate_id from news_core.entity_link_candidates where entity_link_revision_id=$1 limit 1", [exactOutcome.entityLinkRevisionId])).rows[0].candidate_id;
    await admin.query("set role news_service");
    await assert.rejects(admin.query("update news_core.entity_link_candidates set listing_id='changed' where candidate_id=$1", [candidateId]), /permission denied|NEWS_ENTITY_CANDIDATE_IMMUTABLE/);
    await admin.query("reset role");

    const issuerOnly: MarketCoreResolutionV1 = {
      contractVersion: "market-core-identity-v1", resolverVersion: "fixture-issuer", status: "EXACT", selectedCandidateRef: "issuer-acme", reason: "ISSUER_ONLY_MATCH",
      candidates: [{ candidateRef: "issuer-acme", targetScope: "ISSUER", relationType: "MENTION", issuerId: "issuer-acme", instrumentId: null, listingId: null, evidence: [{ evidenceId: "e-issuer", evidenceKind: "OFFICIAL_REGISTRY", sourceRef: "sec:cik:0000000001", observedAt: now, verified: true }] }],
    };
    await store.ingestEntityResolution(revisionId, issuerOnly);
    const issuerLink = (await store.readEntityLinksAsOf(new Date(Date.now() + 10_000).toISOString(), publicationId)).find(row => row.resolverVersion === "fixture-issuer");
    assert.equal(issuerLink?.issuerId, "issuer-acme");
    assert.equal(issuerLink?.instrumentId, null, "issuer news does not imply a listing");

    const indirectEtf: MarketCoreResolutionV1 = {
      contractVersion: "market-core-identity-v1", resolverVersion: "fixture-etf", status: "EXACT", selectedCandidateRef: "etf-acme", reason: "ETF_HOLDING_EVIDENCE",
      candidates: [{ candidateRef: "etf-acme", targetScope: "INSTRUMENT", relationType: "INDIRECT_EXPOSURE", issuerId: "issuer-etf", instrumentId: "instrument-etf", listingId: null, evidence: [{ evidenceId: "e-etf", evidenceKind: "PROVIDER_CATALOG", sourceRef: "catalog:holdings:etf-acme", observedAt: now, verified: true }] }],
    };
    await store.ingestEntityResolution(revisionId, indirectEtf);
    const etfLink = (await store.readEntityLinksAsOf(new Date(Date.now() + 10_000).toISOString(), publicationId)).find(row => row.resolverVersion === "fixture-etf");
    assert.equal(etfLink?.relationType, "INDIRECT_EXPOSURE");
    assert.equal(etfLink?.identityStatus, "EXACT");

    const unresolved: MarketCoreResolutionV1 = { contractVersion: "market-core-identity-v1", resolverVersion: "fixture-v1", status: "UNRESOLVED", selectedCandidateRef: null, reason: "RESOLVER_UNAVAILABLE", candidates: [] };
    validateEntityResolution({ publicationId, publicationRevisionId: revisionId, title: "Issuer event", sourceDocumentRef: "https://www.sec.gov/Archives/edgar/data/1/n2b.htm", publishedAt: null }, unresolved);
    await assert.rejects(Promise.resolve().then(() => validateEntityResolution({ publicationId, publicationRevisionId: revisionId, title: "Issuer event", sourceDocumentRef: "https://www.sec.gov/Archives/edgar/data/1/n2b.htm", publishedAt: null }, { ...exact, selectedCandidateRef: null })), /NEWS_ENTITY_EXACT_SELECTION_INVALID/);
    await assert.rejects(store.ingestEntityResolution(revisionId, { ...exact, candidates: [{ ...exact.candidates[0], listingId: null }] }), /NEWS_ENTITY_SCOPE_INVALID/);
    await assert.rejects(store.ingestEntityResolution(revisionId, { ...exact, resolverVersion: "fixture-future", candidates: [{ ...exact.candidates[0], evidence: [{ ...exact.candidates[0].evidence[0], observedAt: "2099-01-01T00:00:00.000Z" }] }] }), /NEWS_ENTITY_EVIDENCE_INVALID/);
    await assert.rejects(store.ingestEntityResolution(revisionId, { ...exact, resolverVersion: "fixture-empty-id", candidates: [{ ...exact.candidates[0], instrumentId: "" }] }), /NEWS_ENTITY_SCOPE_INVALID/);

    const rollback = { ...exact, resolverVersion: "fixture-v2", reason: "ROLLBACK_PROBE" };
    await assert.rejects(store.ingestEntityResolution(revisionId, rollback, { failurePoint: "before-commit" }), /INJECTED_FAILURE_BEFORE_COMMIT/);
    assert.equal((await admin.query("select count(*)::int n from news_core.entity_link_revisions where resolver_version='fixture-v2' and publication_revision_id=$1", [revisionId])).rows[0].n, 0);

    const recovery = { ...exact, resolverVersion: "fixture-v3", reason: "RECOVERY_PROBE" };
    await assert.rejects(store.ingestEntityResolution(revisionId, recovery, { failurePoint: "after-commit-before-finalize" }), /INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE/);
    assert.equal((await admin.query("select count(*)::int n from news_core.entity_link_revisions where resolver_version='fixture-v3' and visibility_state='PENDING'", [])).rows[0].n, 1);
    await store.getCheckpoint(scope);
    assert.equal((await store.readEntityLinksAsOf(new Date(Date.now() + 10_000).toISOString(), publicationId)).filter(row => row.resolverVersion === "fixture-v3").length, 1);

    const futureRecovery = { ...exact, resolverVersion: "fixture-future-recovery", reason: "FUTURE_PARENT_RECOVERY" };
    await assert.rejects(store.ingestEntityResolution(futureRevisionId, futureRecovery, { failurePoint: "after-commit-before-finalize" }), /INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE/);
    await store.getCheckpoint(scope);
    const recoveredDependency = await admin.query<{ as_known_at: Date }>("select as_known_at from news_core.entity_link_revisions where entity_link_revision_id=$1", [`${futureRevisionId}:entity-link:fixture-future-recovery:1`]);
    assert.ok(recoveredDependency.rows[0].as_known_at.getTime() >= Date.parse(future), "recovery must retain the parent's future availability boundary");
    assert.deepEqual((await store.readEntityLinksAsOf(new Date(Date.now() + 10_000).toISOString(), futurePublicationId)).filter(row => row.resolverVersion === "fixture-future-recovery"), []);
    assert.equal((await store.readEntityLinksAsOf(new Date(Date.parse(future) + 10_000).toISOString(), futurePublicationId)).filter(row => row.resolverVersion === "fixture-future-recovery").length, 1);

    await admin.query("set role news_reader");
    await assert.rejects(admin.query("select * from news_core.entity_link_revisions"), /permission denied/);
    const readerLink = await admin.query("select * from news_core.read_entity_links_as_of($1::timestamptz,$2::text)", [new Date(Date.now() + 10_000).toISOString(), publicationId]);
    assert.ok(readerLink.rows.length >= 3);
    await admin.query("reset role");
  } finally {
    await admin.query("reset role").catch(() => undefined);
    await admin.query("delete from news_core.entity_link_evidence where entity_link_revision_id like $1 or entity_link_revision_id like $2", [`${publicationId}%`, `${futurePublicationId}%`]).catch(() => undefined);
    await admin.query("delete from news_core.entity_link_candidates where entity_link_revision_id like $1 or entity_link_revision_id like $2", [`${publicationId}%`, `${futurePublicationId}%`]).catch(() => undefined);
    await admin.query("delete from news_core.entity_link_revisions where publication_revision_id=$1 or publication_revision_id=$2", [revisionId, futureRevisionId]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id=$1", [revisionId]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revision_provenance where publication_revision_id=$1", [futureRevisionId]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revisions where publication_id=$1", [publicationId]).catch(() => undefined);
    await admin.query("delete from news_core.observations where publication_id=$1", [publicationId]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id=$1", [publicationId]).catch(() => undefined);
    await admin.query("delete from news_core.publication_revisions where publication_id=$1", [futurePublicationId]).catch(() => undefined);
    await admin.query("delete from news_core.publications where publication_id=$1", [futurePublicationId]).catch(() => undefined);
    if (futureFrontierId) await admin.query("delete from news_core.visibility_frontiers where frontier_id=$1", [futureFrontierId]).catch(() => undefined);
    await admin.query("delete from news_core.sources where source_id=$1", [sourceId]).catch(() => undefined);
    await Promise.all([store.close(), admin.end()]);
  }
});
