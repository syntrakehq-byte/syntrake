import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { NewsConsumptionApiV1 } from "../n5Api";
import { PostgresFactualStore } from "../factualPersistence";
import { PostgresNewsStore } from "../postgresStore";
import { runNewsExecutorOnce } from "../autonomousExecutor";
import { NewsFactualPipelineV1 } from "../factualPipeline";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const ROLE_PASSWORD = "bl3-operational-test-password";
const roleUrl = (base: string, role: string): string => { const url = new URL(base); url.username = role; url.password = ROLE_PASSWORD; return url.toString(); };

test("BL3 operational executor runs SEC through N3 and N5 with positive and conservative outcomes", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  assert.ok(DB_URL);
  const admin = new Client({ connectionString: DB_URL });
  const newsPool = new Pool({ connectionString: DB_URL, max: 4 });
  const readerPool = new Pool({ connectionString: DB_URL, max: 2 });
  const news = new PostgresNewsStore(newsPool);
  const readerFactual = new PostgresFactualStore(readerPool, "news_service");
  const suffix = randomUUID().replaceAll("-", "");
  const verifierRole = `bl3_verifier_${suffix.slice(0, 12)}`;
  const attestorRole = `bl3_attestor_${suffix.slice(0, 12)}`;
  const writerRole = `bl3_writer_${suffix.slice(0, 12)}`;
  const verifierPool = new Pool({ connectionString: roleUrl(DB_URL, verifierRole), max: 2 });
  const attestorPool = new Pool({ connectionString: roleUrl(DB_URL, attestorRole), max: 2 });
  const writerPool = new Pool({ connectionString: roleUrl(DB_URL, writerRole), max: 2 });
  const pipeline = new NewsFactualPipelineV1({ news, verifierPool, attestorPool, writerPool, userAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE BL3 operational CI/1.0 security@syntrake.com", maxDocuments: 20 });
  try {
    await admin.connect();
    assert.match((await admin.query<{ version: string }>("select current_setting('server_version') version")).rows[0].version, /^17\./);
    for (const file of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql", "20261112120000_news_core_n3c_factual_persistence.sql", "20261112170000_news_core_n3c_factual_writer_boundary.sql", "20261112150000_news_core_n5_read_api.sql", "20261113100000_news_core_bl3_factual_backlog.sql", "20261113110000_news_core_bl3_backlog_fencing.sql"]) await admin.query(await readFile(migration(file), "utf8"));
    await admin.query(`create role ${verifierRole} login inherit password '${ROLE_PASSWORD}' nocreatedb nocreaterole`);
    await admin.query(`create role ${attestorRole} login inherit password '${ROLE_PASSWORD}' nocreatedb nocreaterole`);
    await admin.query(`create role ${writerRole} login inherit password '${ROLE_PASSWORD}' nocreatedb nocreaterole`);
    await admin.query(`grant news_pipeline_verifier to ${verifierRole}`);
    await admin.query(`grant news_factual_attestor to ${attestorRole}`);
    await admin.query(`grant news_factual_writer to ${writerRole}`);
    const scope = `bl3-operational-sec-${suffix}`;
    await news.ensureSource("sec-edgar", "sec");
    await news.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: "0000320193", parameters: { forms: ["10-K", "10-Q", "8-K", "20-F", "6-K"], overlapDays: 7 } });
    const atomicScope = `bl3-atomic-${suffix}`;
    const atomicPublicationId = `bl3-atomic-publication-${suffix}`;
    const atomicNow = new Date().toISOString();
    await assert.rejects(news.ingestAdministrative({
      publications: [{ publicationId: atomicPublicationId, sourceId: "sec-edgar", originFingerprint: `bl3-atomic-origin-${suffix}`, externalId: `bl3-atomic-external-${suffix}`, originalUrl: "https://www.sec.gov/Archives/edgar/data/320193/bl3-atomic.htm", title: "BL3 atomic handoff", publishedAt: atomicNow, firstSeenAt: atomicNow, ingestedAt: null, asKnownAt: null, form: "8-K" }],
      observations: [{ observationId: `bl3-atomic-observation-${suffix}`, providerKey: "sec", providerObservationKey: `bl3-atomic-observation-${suffix}`, publicationId: atomicPublicationId, observedAt: atomicNow, retrievedAt: atomicNow, publisherKey: "sec-edgar" }],
      checkpoint: { sourceId: "sec-edgar", collectionScopeKey: atomicScope, cursor: "bl3-atomic-cursor", updatedAt: atomicNow },
    }, { failurePoint: "after-commit-before-finalize" }), /INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE/);
    await news.getCheckpoint(atomicScope);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.factual_pipeline_backlog where publication_id=$1", [atomicPublicationId])).rows[0].n), 1, "recovery must find the factual handoff without a second SEC download");
    await admin.query("delete from news_core.factual_pipeline_backlog where publication_id=$1", [atomicPublicationId]);
    assert.equal(await news.reconcileFactualBacklog(), 1, "backfill must restore a committed publication missing from the factual queue");
    const first = await runNewsExecutorOnce({ store: news, factualPipeline: pipeline, workerId: `bl3-operational-${suffix}`, secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE BL3 operational CI/1.0 security@syntrake.com", collectionScopeKey: scope, fetchTimeoutMs: 120_000 });
    assert.equal(first.claimed, true);
    assert.ok(first.factualOutcomes.some(outcome => outcome.status === "PERSISTED"), "operational executor must persist one supported SEC document");
    assert.ok(first.factualOutcomes.some(outcome => outcome.status === "REFUSED"), "operational executor must record a separate conservative refusal");
    const persisted = first.factualOutcomes.find(outcome => outcome.status === "PERSISTED");
    const refused = first.factualOutcomes.find(outcome => outcome.status === "REFUSED");
    const queued = Number((await admin.query("select count(*)::int n from news_core.factual_pipeline_backlog where state <> 'DONE' or completed_status is not null")).rows[0].n);
    assert.ok(queued > 20, "the durable factual backlog must retain a batch larger than the N1 document limit");
    const preparedFairness = await admin.query<{ publication_id: string }>(`with chosen as (
      select publication_id from news_core.factual_pipeline_backlog order by created_at, publication_id limit 22
    ) update news_core.factual_pipeline_backlog b
       set state='PENDING', completed_status=null, completed_at=null, claim_owner=null, claim_token=null,
           lease_until=null, next_attempt_at=clock_timestamp()
      from chosen c where b.publication_id=c.publication_id
      returning b.publication_id`);
    assert.equal(preparedFairness.rowCount, 22);
    const fenceA = await news.claimFactualBacklog(1, `bl3-fence-a-${suffix}`, 1);
    assert.equal(fenceA.length, 1);
    await admin.query("update news_core.factual_pipeline_backlog set lease_until=clock_timestamp()-interval '1 second' where publication_id=$1", [fenceA[0].publication.publicationId]);
    const fenceB = await news.claimFactualBacklog(1, `bl3-fence-b-${suffix}`, 60);
    assert.equal(fenceB[0].publication.publicationId, fenceA[0].publication.publicationId);
    assert.equal(await news.finishFactualBacklog(fenceA[0].publication.publicationId, `bl3-fence-a-${suffix}`, fenceA[0].claimToken, "REFUSED"), "STALE");
    assert.equal((await admin.query("select claim_owner from news_core.factual_pipeline_backlog where publication_id=$1", [fenceA[0].publication.publicationId])).rows[0].claim_owner, `bl3-fence-b-${suffix}`);
    assert.equal(await news.finishFactualBacklog(fenceB[0].publication.publicationId, `bl3-fence-b-${suffix}`, fenceB[0].claimToken, "REFUSED"), "FINISHED");
    const longClaim = (await news.claimFactualBacklog(1, `bl3-long-${suffix}`, 1))[0];
    assert.ok(longClaim);
    await new Promise(resolve => setTimeout(resolve, 1_200));
    assert.equal(await news.renewFactualBacklogClaim(longClaim.publication.publicationId, `bl3-long-${suffix}`, longClaim.claimToken, 2), true);
    assert.equal(await news.finishFactualBacklog(longClaim.publication.publicationId, `bl3-long-${suffix}`, longClaim.claimToken, "REFUSED"), "FINISHED");
    const failedClaims = await news.claimFactualBacklog(20, `bl3-fairness-a-${suffix}`, 60);
    assert.equal(failedClaims.length, 20);
    for (const claim of failedClaims) assert.equal(await news.retryFactualBacklog(claim.publication.publicationId, `bl3-fairness-a-${suffix}`, claim.claimToken, new Error("INJECTED_RETRYABLE")), "REQUEUED");
    const fairTail = await news.claimFactualBacklog(1, `bl3-fairness-b-${suffix}`, 60);
    assert.equal(fairTail.length, 1, "backoff must leave a tail task claimable");
    assert.ok(!failedClaims.some(claim => claim.publication.publicationId === fairTail[0].publication.publicationId));
    await news.retryFactualBacklog(fairTail[0].publication.publicationId, `bl3-fairness-b-${suffix}`, fairTail[0].claimToken, new Error("INJECTED_RETRYABLE"));
    assert.ok(persisted?.factEventId && persisted.documentSha256);
    await assert.rejects(attestorPool.query("select news_core.issue_fact_attestation_v1($1::jsonb)", [JSON.stringify({ canonicalClaimId: persisted.factEventId, logicalFingerprint: "forged", publicationRevisionId: "forged", evidence: [], dependencies: [], verificationId: "forged" })]), /NEWS_FACT_PIPELINE_ATTESTATION_UNVERIFIED/);
    await assert.rejects(writerPool.query("select news_core.issue_fact_attestation_v1('{}'::jsonb)"), /permission denied/);
    const api = new NewsConsumptionApiV1({ news, factual: readerFactual }, "0123456789abcdef", "bl3-operational-credential");
    const asOf = (await admin.query<{ cutoff: string }>("select clock_timestamp()::timestamptz::text cutoff")).rows[0].cutoff;
    const events = await api.getNewsEvents({ serviceId: "news_reader", credential: "bl3-operational-credential" }, { targets: [persisted.factEventId], asOf });
    assert.equal(events.status, "AVAILABLE"); assert.equal(events.data.length, 1); assert.equal(events.data[0].confirmationStatus, "REPORTED");
    const evidence = await api.getEventEvidence({ serviceId: "news_reader", credential: "bl3-operational-credential" }, { eventId: persisted.factEventId, asOf });
    assert.ok(evidence.data.length > 0); assert.ok(evidence.sourceRefs.some(ref => ref.startsWith("https://www.sec.gov/Archives/edgar/data/")));
    assert.ok(refused?.canonicalClaimId, "refusal must expose the canonical claim identity used by N5");
    const refusedEvents = await api.getNewsEvents({ serviceId: "news_reader", credential: "bl3-operational-credential" }, { targets: [refused!.canonicalClaimId!], asOf });
    assert.equal(refusedEvents.data.length, 0, "conservative refusal must not create an N5 fact");
    const before = await api.getNewsEvents({ serviceId: "news_reader", credential: "bl3-operational-credential" }, { targets: [persisted.factEventId], asOf: new Date(Date.parse(asOf) - 60_000).toISOString() });
    assert.equal(before.data.length, 0, "historical cutoff before factual availability must remain empty");
    await new Promise(resolve => setTimeout(resolve, 2_500));
    let tailPersisted = false;
    for (let cycle = 0; cycle < 8 && !tailPersisted; cycle += 1) {
      await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_until=null where collection_scope_key=$1", [scope]);
      const tail = await runNewsExecutorOnce({ store: news, factualPipeline: pipeline, workerId: `bl3-operational-tail-${suffix}-${cycle}`, secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE BL3 operational CI/1.0 security@syntrake.com", collectionScopeKey: scope, fetchTimeoutMs: 120_000 });
      assert.equal(tail.claimed, true);
      tailPersisted = tail.factualOutcomes.some(outcome => outcome.status === "PERSISTED");
    }
    const persistedAfterPosition20 = Number((await admin.query(`with ordered as (
      select completed_status, row_number() over (order by created_at, publication_id) position
        from news_core.factual_pipeline_backlog
    ) select count(*)::int n from ordered where position > 20 and completed_status='PERSISTED'`)).rows[0].n);
    assert.ok(persistedAfterPosition20 > 0, "a supported publication after position 20 must be processed by later factual cycles");
    await admin.query("update news_core.collection_targets set next_run_at=clock_timestamp(), lease_until=null where collection_scope_key=$1", [scope]);
    const replay = await runNewsExecutorOnce({ store: news, factualPipeline: pipeline, workerId: `bl3-operational-replay-${suffix}`, secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE BL3 operational CI/1.0 security@syntrake.com", collectionScopeKey: scope, fetchTimeoutMs: 120_000 });
    assert.equal(replay.claimed, true);
    const eventCount = Number((await admin.query("select count(*)::int n from news_core.fact_events where fact_event_id=$1", [persisted.factEventId])).rows[0].n);
    assert.equal(eventCount, 1, "operational replay must remain idempotent");
  } finally {
    await pipeline.close(); await Promise.all([news.close(), readerFactual.close(), admin.end()]);
    const cleanup = new Client({ connectionString: DB_URL });
    await cleanup.connect().catch(() => undefined);
    await cleanup.query(`drop role if exists ${verifierRole}`).catch(() => undefined);
    await cleanup.query(`drop role if exists ${attestorRole}`).catch(() => undefined);
    await cleanup.query(`drop role if exists ${writerRole}`).catch(() => undefined);
    await cleanup.end().catch(() => undefined);
  }
});
