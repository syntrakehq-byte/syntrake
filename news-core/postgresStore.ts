import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { NewsBatch, NewsPublication, NewsPublicationRevision, NewsRevisionProvenance } from "./contracts";
import { canonicalCandidate, validateEntityResolution, type MarketCoreResolutionV1 } from "./entityResolution";

export type NewsTarget = Readonly<{
  collectionScopeKey: string; sourceId: string; providerKey: string; entityKey: string;
  parameters: Record<string, unknown>; nextRunAt?: string;
}>;
export type ExecutionLease = Readonly<{
  executionId: string; collectionScopeKey: string; workerId: string; leaseSeconds: number;
}>;
export type ClaimedTarget = NewsTarget & Readonly<{ attempt: number; executionId: string }>;
export type FinishResult = Readonly<{ status: "FINISHED" | "STALE" }>;
export type IngestOptions = Readonly<{
  failurePoint?: "none" | "before-commit" | "delay-before-commit" | "delay-before-finalize-commit" | "after-commit-before-finalize";
  delayBeforeCommitMs?: number; lease?: ExecutionLease;
  onFinalizeFrontierCreated?: () => Promise<void>;
  onFinalizeSealedBeforeCommit?: (publishedAt: string) => Promise<void>;
}>;
export type NewsRevisionInput = Readonly<{
  revision: Omit<NewsPublicationRevision, "ingestedAt" | "asKnownAt">;
  provenance: Omit<NewsRevisionProvenance, "ingestedAt" | "asKnownAt">;
}>;
export type NewsRevisionIngestResult = Readonly<{ inserted: boolean; publicationRevisionId: string }>;

function watermarkKey(batch: NewsBatch): string | null {
  const cursor = batch.checkpoint.cursor;
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as { watermark?: unknown };
    return typeof parsed.watermark === "string" ? parsed.watermark : null;
  } catch { return null; }
}
function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.valueOf())) throw new Error("NEWS_COMMIT_TIMESTAMP_UNAVAILABLE");
  return date.toISOString();
}
function optionalIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}
function flags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("NEWS_REVISION_FLAGS_INVALID");
  return [...new Set(value)].sort();
}
function sameJsonFlags(left: unknown, right: unknown): boolean {
  return JSON.stringify(flags(left)) === JSON.stringify(flags(right));
}
function stableEntityFingerprint(result: MarketCoreResolutionV1): string {
  const candidates = [...result.candidates].sort((a, b) => a.candidateRef.localeCompare(b.candidateRef)).map(candidate => ({
    ...candidate,
    evidence: [...candidate.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
  }));
  return createHash("sha256").update(JSON.stringify({ ...result, candidates })).digest("hex");
}
function entityCandidateId(linkRevisionId: string, candidateRef: string): string {
  return `${linkRevisionId}:candidate:${createHash("sha256").update(candidateRef).digest("hex").slice(0, 32)}`;
}

export class PostgresNewsStore {
  constructor(private readonly pool: Pool) {}
  async close(): Promise<void> { await this.pool.end(); }

  private async finalizePending(
    txid: string,
    delayBeforeCommitMs = 0,
    onFrontierCreated?: () => Promise<void>,
    onSealedBeforeCommit?: (publishedAt: string) => Promise<void>,
    minimumPublishedAt?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const guard = await client.query<{ availability_at: Date | string }>(
        "select availability_at from news_core.begin_news_finalization_guard()",
      );
      const availabilityAt = iso(guard.rows[0].availability_at);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 20261111))", [txid]);
      const pending = await client.query<{ present: boolean }>(
        `select exists(select 1 from news_core.publications where pending_transaction_id=$1 and visibility_state='PENDING')
         or exists(select 1 from news_core.observations where pending_transaction_id=$1 and visibility_state='PENDING')
         or exists(select 1 from news_core.checkpoints where pending_transaction_id=$1 and visibility_state='PENDING')
         or exists(select 1 from news_core.publication_revisions where pending_transaction_id=$1 and visibility_state='PENDING')
         or exists(select 1 from news_core.publication_revision_provenance where pending_transaction_id=$1 and visibility_state='PENDING') as present`, [txid],
      );
      const entityTables = (await client.query<{ installed: boolean }>("select to_regclass('news_core.entity_link_revisions') is not null as installed")).rows[0].installed;
      if (entityTables) {
        const entityPending = await client.query<{ present: boolean }>(
          `select exists(select 1 from news_core.entity_link_revisions where pending_transaction_id=$1 and visibility_state='PENDING')
           or exists(select 1 from news_core.entity_link_evidence where pending_transaction_id=$1 and visibility_state='PENDING') as present`, [txid],
        );
        pending.rows[0].present = pending.rows[0].present || entityPending.rows[0].present;
      }
      if (!pending.rows[0].present) { await client.query("commit"); return; }
      const frontier = await client.query<{ frontier_id: string }>(
        "insert into news_core.visibility_frontiers default values returning frontier_id",
      );
      const frontierId = frontier.rows[0].frontier_id;
      await client.query(
        "update news_core.publications set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'",
        [txid, frontierId],
      );
      await client.query(
        "update news_core.observations set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'",
        [txid, frontierId],
      );
      await client.query(
        "update news_core.checkpoints set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'",
        [txid, frontierId],
      );
      await client.query(
        "update news_core.publication_revisions set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'",
        [txid, frontierId],
      );
      await client.query(
        "update news_core.publication_revision_provenance set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'",
        [txid, frontierId],
      );
      if (entityTables) {
        await client.query("update news_core.entity_link_revisions set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'", [txid, frontierId]);
        await client.query("update news_core.entity_link_evidence set visibility_frontier_id=$2 where pending_transaction_id=$1 and visibility_state='PENDING'", [txid, frontierId]);
      }
      if (onFrontierCreated) await onFrontierCreated();
      if (delayBeforeCommitMs > 0) await new Promise(resolve => setTimeout(resolve, delayBeforeCommitMs));
      const published = await client.query<{ published_at: Date | string }>(
        "select news_core.seal_visibility_frontier($1::bigint,$2::timestamptz) as published_at",
        [frontierId, minimumPublishedAt && Date.parse(minimumPublishedAt) > Date.parse(availabilityAt) ? minimumPublishedAt : availabilityAt],
      );
      const publishedAt = iso(published.rows[0].published_at);
      await client.query(
        `update news_core.publications set ingested_at=$1::timestamptz,as_known_at=$1::timestamptz,
         visibility_state='COMMITTED',pending_transaction_id=null
         where pending_transaction_id=$2 and visibility_state='PENDING'`, [publishedAt, txid],
      );
      await client.query(
        `update news_core.observations set visibility_state='COMMITTED',pending_transaction_id=null
         where pending_transaction_id=$1 and visibility_state='PENDING'`, [txid],
      );
      await client.query(
        `update news_core.checkpoints set visibility_state='COMMITTED',pending_transaction_id=null
         where pending_transaction_id=$1 and visibility_state='PENDING'`, [txid],
      );
      await client.query(
        `update news_core.publication_revisions set ingested_at=$1::timestamptz,as_known_at=$1::timestamptz,
         visibility_state='COMMITTED',pending_transaction_id=null
         where pending_transaction_id=$2 and visibility_state='PENDING'`, [publishedAt, txid],
      );
      await client.query(
        `update news_core.publication_revision_provenance set ingested_at=$1::timestamptz,as_known_at=$1::timestamptz,
         visibility_state='COMMITTED',pending_transaction_id=null
         where pending_transaction_id=$2 and visibility_state='PENDING'`, [publishedAt, txid],
      );
      if (entityTables) {
        await client.query(`update news_core.entity_link_revisions set ingested_at=$1::timestamptz,as_known_at=$1::timestamptz,visibility_state='COMMITTED',pending_transaction_id=null where pending_transaction_id=$2 and visibility_state='PENDING'`, [publishedAt, txid]);
        await client.query(`update news_core.entity_link_evidence set ingested_at=$1::timestamptz,as_known_at=$1::timestamptz,visibility_state='COMMITTED',pending_transaction_id=null where pending_transaction_id=$2 and visibility_state='PENDING'`, [publishedAt, txid]);
      }
      if (onSealedBeforeCommit) await onSealedBeforeCommit(publishedAt);
      await client.query("commit");
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  private async recoverPending(): Promise<void> {
    const pending = await this.pool.query<{ txid: string }>(
      `select distinct pending_transaction_id::text as txid from news_core.publications where visibility_state='PENDING' and pending_transaction_id is not null
       union select distinct pending_transaction_id::text from news_core.observations where visibility_state='PENDING' and pending_transaction_id is not null
       union select distinct pending_transaction_id::text from news_core.checkpoints where visibility_state='PENDING' and pending_transaction_id is not null
       union select distinct pending_transaction_id::text from news_core.publication_revisions where visibility_state='PENDING' and pending_transaction_id is not null
       union select distinct pending_transaction_id::text from news_core.publication_revision_provenance where visibility_state='PENDING' and pending_transaction_id is not null`,
    );
    const entityTables = (await this.pool.query<{ installed: boolean }>("select to_regclass('news_core.entity_link_revisions') is not null as installed")).rows[0].installed;
    const txids = new Set(pending.rows.map(row => row.txid));
    if (entityTables) {
      const entityPending = await this.pool.query<{ txid: string }>("select distinct pending_transaction_id::text as txid from news_core.entity_link_revisions where visibility_state='PENDING' and pending_transaction_id is not null union select distinct pending_transaction_id::text from news_core.entity_link_evidence where visibility_state='PENDING' and pending_transaction_id is not null");
      for (const row of entityPending.rows) txids.add(row.txid);
    }
    for (const txid of txids) await this.finalizePending(txid);
  }

  async ensureSource(sourceId: string, providerKey: string, sourceType = "SEC_EDGAR"): Promise<void> {
    await this.pool.query(
      `insert into news_core.sources(source_id,provider_key,source_type) values ($1,$2,$3)
       on conflict (source_id) do update set provider_key=excluded.provider_key`, [sourceId, providerKey, sourceType],
    );
  }
  async upsertTarget(target: NewsTarget): Promise<void> {
    await this.pool.query(
      `insert into news_core.collection_targets(collection_scope_key,source_id,provider_key,entity_key,parameters,next_run_at)
       values ($1,$2,$3,$4,$5,coalesce($6::timestamptz,clock_timestamp()))
       on conflict (collection_scope_key) do update set parameters=excluded.parameters,enabled=true,updated_at=clock_timestamp()`,
      [target.collectionScopeKey, target.sourceId, target.providerKey, target.entityKey, target.parameters, target.nextRunAt ?? null],
    );
  }
  async getCheckpoint(scope: string): Promise<{ cursor: string | null; updatedAt: string } | null> {
    await this.recoverPending();
    const result = await this.pool.query<{ cursor: string | null; updated_at: Date }>(
      `select cursor,updated_at from news_core.checkpoints where collection_scope_key=$1 and visibility_state='COMMITTED'`, [scope],
    );
    const row = result.rows[0]; return row ? { cursor: row.cursor, updatedAt: row.updated_at.toISOString() } : null;
  }

  private async assertLease(client: PoolClient, lease: ExecutionLease): Promise<void> {
    const result = await client.query(
      `update news_core.collection_targets t set lease_until=clock_timestamp()+($1::int * interval '1 second'),updated_at=clock_timestamp()
       from news_core.executions e
       where t.collection_scope_key=$2 and t.active_execution_id=e.execution_id and e.execution_id=$3 and e.worker_id=$4
         and e.state='RUNNING' and t.lease_owner=$4 and t.lease_until > clock_timestamp()
       returning t.collection_scope_key`, [lease.leaseSeconds, lease.collectionScopeKey, lease.executionId, lease.workerId],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error("NEWS_LEASE_LOST");
  }

  private async ingestInternal(batch: NewsBatch, options: IngestOptions, lease?: ExecutionLease): Promise<{ insertedPublications: number; insertedObservations: number }> {
    const client = await this.pool.connect(); let committed = false;
    try {
      await client.query("begin");
      if (lease) await this.assertLease(client, lease);
      const tx = await client.query<{ txid: string }>("select txid_current()::text as txid");
      const txid = tx.rows[0].txid;
      await client.query(
        `insert into news_core.sources(source_id,provider_key,source_type) values ($1,$2,'SEC_EDGAR') on conflict (source_id) do nothing`,
        [batch.checkpoint.sourceId, batch.observations[0]?.providerKey ?? "sec"],
      );
      let insertedPublications = 0;
      for (const publication of batch.publications) {
        const result = await client.query(
          `insert into news_core.publications
           (publication_id,source_id,origin_fingerprint,external_id,original_url,title,published_at,first_seen_at,ingested_at,as_known_at,form,visibility_state,pending_transaction_id)
           values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,null,null,$9,'PENDING',$10)
           on conflict (publication_id) do nothing`,
          [publication.publicationId, publication.sourceId, publication.originFingerprint, publication.externalId, publication.originalUrl, publication.title, publication.publishedAt, publication.firstSeenAt, publication.form, txid],
        );
        insertedPublications += result.rowCount ?? 0;
      }
      let insertedObservations = 0;
      for (const observation of batch.observations) {
        const result = await client.query(
          `insert into news_core.observations
           (observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key,visibility_state,pending_transaction_id)
           values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,'PENDING',$8)
           on conflict (provider_key,provider_observation_key) do nothing`,
          [observation.observationId, observation.providerKey, observation.providerObservationKey, observation.publicationId, observation.observedAt, observation.retrievedAt, observation.publisherKey, txid],
        );
        insertedObservations += result.rowCount ?? 0;
      }
      for (const publication of batch.publications) {
        await this.ensureInitialRevision(client, publication, batch.observations.find(observation => observation.publicationId === publication.publicationId), txid);
      }
      const key = watermarkKey(batch);
      await client.query(
        `insert into news_core.checkpoints(collection_scope_key,source_id,cursor,watermark_key,updated_at,visibility_state,pending_transaction_id)
         values ($1,$2,$3,$4,$5::timestamptz,'PENDING',$6)
         on conflict (collection_scope_key) do update set cursor=excluded.cursor,watermark_key=excluded.watermark_key,updated_at=excluded.updated_at,visibility_state='PENDING',pending_transaction_id=excluded.pending_transaction_id
         where excluded.watermark_key is not null and (news_core.checkpoints.watermark_key is null or excluded.watermark_key > news_core.checkpoints.watermark_key)`,
        [batch.checkpoint.collectionScopeKey, batch.checkpoint.sourceId, batch.checkpoint.cursor, key, batch.checkpoint.updatedAt, txid],
      );
      if (options.failurePoint === "delay-before-commit") await new Promise(resolve => setTimeout(resolve, options.delayBeforeCommitMs ?? 150));
      if (options.failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      if (lease) await this.assertLease(client, lease);
      await client.query("commit"); committed = true; client.release();
      if (options.failurePoint === "after-commit-before-finalize") throw new Error("INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE");
      await this.finalizePending(
        txid,
        options.failurePoint === "delay-before-finalize-commit" ? options.delayBeforeCommitMs ?? 150 : 0,
        options.onFinalizeFrontierCreated,
        options.onFinalizeSealedBeforeCommit,
      );
      return { insertedPublications, insertedObservations };
    } catch (error) {
      if (!committed) await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { if (!committed) client.release(); }
  }

  /** Executor writes must always use the lease-fenced API. */
  async ingest(batch: NewsBatch, options: IngestOptions & { lease: ExecutionLease }): Promise<{ insertedPublications: number; insertedObservations: number }> {
    await this.recoverPending(); return this.ingestInternal(batch, options, options.lease);
  }
  /** Bootstrap/recovery API for controlled administrative use, never used by the executor. */
  async ingestAdministrative(batch: NewsBatch, options: IngestOptions = {}): Promise<{ insertedPublications: number; insertedObservations: number }> {
    await this.recoverPending(); return this.ingestInternal(batch, options);
  }

  private async ensureInitialRevision(client: PoolClient, publication: NewsPublication, observation: NewsBatch["observations"][number] | undefined, txid: string): Promise<void> {
    const existing = await client.query("select publication_revision_id from news_core.publication_revisions where publication_id=$1 and revision_no=1", [publication.publicationId]);
    if (existing.rowCount === 1) return;
    const source = await client.query<{ provider_key: string }>("select provider_key from news_core.sources where source_id=$1", [publication.sourceId]);
    if (source.rowCount !== 1) throw new Error("NEWS_REVISION_SOURCE_NOT_FOUND");
    const retrievedAt = observation?.retrievedAt ?? publication.firstSeenAt;
    const qualityFlags = publication.publishedAt && Date.parse(publication.publishedAt) > Date.parse(retrievedAt) ? ["SOURCE_CLOCK_CONFLICT"] : [];
    const revisionId = `${publication.publicationId}:revision:1`;
    await client.query(
      `insert into news_core.publication_revisions
        (publication_revision_id,publication_id,revision_no,title,published_at,form,content_fingerprint,source_document_ref,quality_flags,pending_transaction_id)
       values ($1,$2,1,$3,$4::timestamptz,$5,null,$6,$7::jsonb,$8)
       on conflict (publication_revision_id) do nothing`,
      [revisionId, publication.publicationId, publication.title, publication.publishedAt, publication.form, publication.originalUrl, JSON.stringify(qualityFlags), txid],
    );
    await client.query(
      `insert into news_core.publication_revision_provenance
        (provenance_id,publication_revision_id,source_id,provider_key,provider_observation_key,original_url,source_document_ref,retrieved_at,quality_flags,pending_transaction_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::jsonb,$10)
       on conflict do nothing`,
      [`${publication.publicationId}:provenance:${observation?.observationId ?? "publication"}`, revisionId, publication.sourceId, observation?.providerKey ?? source.rows[0].provider_key, observation?.providerObservationKey ?? null, publication.originalUrl, publication.originalUrl, retrievedAt, JSON.stringify(qualityFlags), txid],
    );
  }

  /**
   * Store one immutable publication revision.  The publication itself must
   * already be committed by N1; this operation only appends a new revision
   * and its provenance in one transaction.
   */
  async ingestPublicationRevision(input: NewsRevisionInput, options: IngestOptions = {}): Promise<NewsRevisionIngestResult> {
    await this.recoverPending();
    const revision = {
      ...input.revision,
      qualityFlags: flags(input.revision.qualityFlags),
    };
    const provenance = {
      ...input.provenance,
      qualityFlags: flags(input.provenance.qualityFlags),
    };
    if (revision.publishedAt !== null && !Number.isFinite(Date.parse(revision.publishedAt))) throw new Error("INVALID_NEWS_REVISION");
    if (revision.publishedAt && Number.isFinite(Date.parse(provenance.retrievedAt)) && Date.parse(revision.publishedAt) > Date.parse(provenance.retrievedAt) && !revision.qualityFlags.includes("SOURCE_CLOCK_CONFLICT")) revision.qualityFlags = [...revision.qualityFlags, "SOURCE_CLOCK_CONFLICT"].sort();
    if (!revision.publicationRevisionId || !revision.publicationId || revision.revisionNo < 1 || !revision.title || !revision.form || !revision.sourceDocumentRef) throw new Error("INVALID_NEWS_REVISION");
    if (revision.revisionNo === 1 && revision.supersedesRevisionId !== null) throw new Error("NEWS_REVISION_DEPENDENCY_INVALID");
    if (revision.revisionNo > 1 && !revision.supersedesRevisionId) throw new Error("NEWS_REVISION_DEPENDENCY_INVALID");
    if (provenance.publicationRevisionId !== revision.publicationRevisionId || provenance.sourceDocumentRef !== revision.sourceDocumentRef || !provenance.sourceId || !provenance.providerKey || !provenance.retrievedAt || !Number.isFinite(Date.parse(provenance.retrievedAt))) throw new Error("INVALID_NEWS_REVISION_PROVENANCE");
    const client = await this.pool.connect(); let committed = false;
    try {
      await client.query("begin");
      const tx = await client.query<{ txid: string }>("select txid_current()::text as txid");
      const txid = tx.rows[0].txid;
      const publication = await client.query<{ source_id: string; visibility_state: string; as_known_at: Date | null }>(
        "select source_id,visibility_state,as_known_at from news_core.publications where publication_id=$1 for share", [revision.publicationId],
      );
      if (publication.rowCount !== 1 || publication.rows[0].visibility_state !== "COMMITTED" || !publication.rows[0].as_known_at) throw new Error("NEWS_REVISION_PARENT_NOT_COMMITTED");
      if (publication.rows[0].source_id !== provenance.sourceId) throw new Error("NEWS_REVISION_SOURCE_MISMATCH");
      if (revision.revisionNo > 1) {
        const prior = await client.query<{ publication_id: string; visibility_state: string; as_known_at: Date | null }>(
          "select publication_id,visibility_state,as_known_at from news_core.publication_revisions where publication_revision_id=$1 for share", [revision.supersedesRevisionId],
        );
        if (prior.rowCount !== 1 || prior.rows[0].publication_id !== revision.publicationId || prior.rows[0].visibility_state !== "COMMITTED" || !prior.rows[0].as_known_at) throw new Error("NEWS_REVISION_DEPENDENCY_INVALID");
      }
      const inserted = await client.query(
        `insert into news_core.publication_revisions
          (publication_revision_id,publication_id,revision_no,title,published_at,form,content_fingerprint,source_document_ref,quality_flags,supersedes_revision_id,pending_transaction_id)
         values ($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9::jsonb,$10,$11)
         on conflict (publication_id,revision_no) do nothing`,
        [revision.publicationRevisionId, revision.publicationId, revision.revisionNo, revision.title, revision.publishedAt, revision.form, revision.contentFingerprint, revision.sourceDocumentRef, JSON.stringify(revision.qualityFlags), revision.supersedesRevisionId, txid],
      );
      if ((inserted.rowCount ?? 0) === 0) {
        const existing = await client.query(
          "select publication_revision_id,publication_id,revision_no,title,published_at,form,content_fingerprint,source_document_ref,quality_flags,supersedes_revision_id from news_core.publication_revisions where publication_id=$1 and revision_no=$2", [revision.publicationId, revision.revisionNo],
        );
        const row = existing.rows[0];
        if (!row || row.publication_revision_id !== revision.publicationRevisionId || row.publication_id !== revision.publicationId || row.revision_no !== revision.revisionNo || row.title !== revision.title || optionalIso(row.published_at) !== optionalIso(revision.publishedAt) || row.form !== revision.form || row.content_fingerprint !== revision.contentFingerprint || row.source_document_ref !== revision.sourceDocumentRef || !sameJsonFlags(row.quality_flags, revision.qualityFlags) || row.supersedes_revision_id !== revision.supersedesRevisionId) throw new Error("NEWS_REVISION_CONFLICT");
        await this.assertRevisionProvenance(client, revision, provenance);
        await client.query("commit"); committed = true;
        client.release();
        return { inserted: false, publicationRevisionId: revision.publicationRevisionId };
      }
      await client.query(
        `insert into news_core.publication_revision_provenance
          (provenance_id,publication_revision_id,source_id,provider_key,provider_observation_key,original_url,source_document_ref,retrieved_at,quality_flags,pending_transaction_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::jsonb,$10)
         on conflict do nothing`,
        [provenance.provenanceId, provenance.publicationRevisionId, provenance.sourceId, provenance.providerKey, provenance.providerObservationKey, provenance.originalUrl, provenance.sourceDocumentRef, provenance.retrievedAt, JSON.stringify(provenance.qualityFlags), txid],
      );
      if (options.failurePoint === "delay-before-commit") await new Promise(resolve => setTimeout(resolve, options.delayBeforeCommitMs ?? 150));
      await this.assertRevisionProvenance(client, revision, provenance);
      if (options.failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      await client.query("commit"); committed = true; client.release();
      if (options.failurePoint === "after-commit-before-finalize") throw new Error("INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE");
      await this.finalizePending(txid, options.failurePoint === "delay-before-finalize-commit" ? options.delayBeforeCommitMs ?? 150 : 0, options.onFinalizeFrontierCreated, options.onFinalizeSealedBeforeCommit);
      return { inserted: true, publicationRevisionId: revision.publicationRevisionId };
    } catch (error) {
      if (!committed) await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { if (!committed) client.release(); }
  }

  async ingestEntityResolution(publicationRevisionId: string, result: MarketCoreResolutionV1, options: IngestOptions = {}): Promise<{ inserted: boolean; entityLinkRevisionId: string }> {
    await this.recoverPending();
    const fingerprint = stableEntityFingerprint(result);
    const client = await this.pool.connect(); let committed = false;
    try {
      await client.query("begin");
      const txid = (await client.query<{ txid: string }>("select txid_current()::text txid")).rows[0].txid;
      const parent = await client.query<{ publication_id: string; as_known_at: Date | string | null; visibility_state: string; title: string; source_document_ref: string; published_at: Date | string | null }>(
        "select r.publication_id,r.as_known_at,r.visibility_state,r.title,r.source_document_ref,r.published_at from news_core.publication_revisions r where r.publication_revision_id=$1 for share", [publicationRevisionId],
      );
      if (parent.rowCount !== 1 || parent.rows[0].visibility_state !== "COMMITTED" || !parent.rows[0].as_known_at) throw new Error("NEWS_ENTITY_PARENT_NOT_COMMITTED");
      validateEntityResolution({ publicationId: parent.rows[0].publication_id, publicationRevisionId, title: parent.rows[0].title, sourceDocumentRef: parent.rows[0].source_document_ref, publishedAt: parent.rows[0].published_at ? new Date(parent.rows[0].published_at).toISOString() : null }, result);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 20261112))", [`${publicationRevisionId}:${result.resolverVersion}`]);
      const existing = await client.query<{ entity_link_revision_id: string }>("select entity_link_revision_id from news_core.entity_link_revisions where publication_revision_id=$1 and resolver_version=$2 and resolution_fingerprint=$3", [publicationRevisionId, result.resolverVersion, fingerprint]);
      if (existing.rowCount === 1) { await client.query("commit"); committed = true; return { inserted: false, entityLinkRevisionId: existing.rows[0].entity_link_revision_id }; }
      const next = await client.query<{ revision_no: number }>("select coalesce(max(revision_no),0)+1 revision_no from news_core.entity_link_revisions where publication_revision_id=$1 and resolver_version=$2", [publicationRevisionId, result.resolverVersion]);
      const revisionNo = next.rows[0].revision_no;
      const entityLinkRevisionId = `${publicationRevisionId}:entity-link:${result.resolverVersion}:${revisionNo}`;
      const selected = canonicalCandidate(result);
      const relation = selected?.relationType ?? null;
      const targetScope = selected?.targetScope ?? null;
      await client.query(
        `insert into news_core.entity_link_revisions
          (entity_link_revision_id,publication_revision_id,revision_no,resolver_contract_version,resolver_version,resolution_fingerprint,target_scope,identity_status,relation_type,issuer_id,instrument_id,listing_id,reason,pending_transaction_id,supersedes_entity_link_revision_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(select entity_link_revision_id from news_core.entity_link_revisions where publication_revision_id=$2 and resolver_version=$5 and revision_no=$3-1))`,
        [entityLinkRevisionId, publicationRevisionId, revisionNo, result.contractVersion, result.resolverVersion, fingerprint, targetScope, result.status, relation, selected?.issuerId ?? null, selected?.instrumentId ?? null, selected?.listingId ?? null, result.reason, txid],
      );
      for (const candidate of result.candidates) {
        const candidateId = entityCandidateId(entityLinkRevisionId, candidate.candidateRef);
        await client.query(
          `insert into news_core.entity_link_candidates(candidate_id,entity_link_revision_id,candidate_ref,target_scope,relation_type,issuer_id,instrument_id,listing_id,candidate_payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [candidateId, entityLinkRevisionId, candidate.candidateRef, candidate.targetScope, candidate.relationType, candidate.issuerId, candidate.instrumentId, candidate.listingId, JSON.stringify(candidate)],
        );
        for (const evidence of candidate.evidence) {
          await client.query(
            `insert into news_core.entity_link_evidence(evidence_id,entity_link_revision_id,candidate_id,evidence_kind,source_ref,observed_at,pending_transaction_id)
             values ($1,$2,$3,$4,$5,$6::timestamptz,$7)`,
            [evidence.evidenceId, entityLinkRevisionId, candidateId, evidence.evidenceKind, evidence.sourceRef, evidence.observedAt, txid],
          );
        }
      }
      if (options.failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      await client.query("commit"); committed = true; client.release();
      if (options.failurePoint === "after-commit-before-finalize") throw new Error("INJECTED_FAILURE_AFTER_COMMIT_BEFORE_FINALIZE");
      await this.finalizePending(txid, 0, undefined, undefined, new Date(parent.rows[0].as_known_at as string | Date).toISOString());
      return { inserted: true, entityLinkRevisionId };
    } catch (error) { if (!committed) await client.query("rollback").catch(() => undefined); throw error; }
    finally { if (!committed) client.release(); }
  }

  private async assertRevisionProvenance(client: PoolClient, revision: NewsRevisionInput["revision"], provenance: NewsRevisionInput["provenance"]): Promise<void> {
    const rows = await client.query("select provenance_id,publication_revision_id,source_id,provider_key,provider_observation_key,original_url,source_document_ref,retrieved_at,quality_flags from news_core.publication_revision_provenance where publication_revision_id=$1 order by provenance_id", [revision.publicationRevisionId]);
    const row = rows.rows.find(candidate => candidate.provenance_id === provenance.provenanceId);
    if (rows.rowCount !== 1 || !row || row.publication_revision_id !== revision.publicationRevisionId || row.source_id !== provenance.sourceId || row.provider_key !== provenance.providerKey || row.provider_observation_key !== provenance.providerObservationKey || row.original_url !== provenance.originalUrl || row.source_document_ref !== provenance.sourceDocumentRef || optionalIso(row.retrieved_at) !== optionalIso(provenance.retrievedAt) || !sameJsonFlags(row.quality_flags, provenance.qualityFlags)) throw new Error("NEWS_REVISION_PROVENANCE_CONFLICT");
  }

  async readPublicationRevisionsAsOf(asOf: string, publicationId?: string): Promise<NewsPublicationRevision[]> {
    const result = await this.pool.query<NewsPublicationRevision>(
      "select * from news_core.read_publication_revisions_as_of($1::timestamptz,$2::text)", [asOf, publicationId ?? null],
    );
    return result.rows.map(row => ({
      ...row,
      publishedAt: optionalIso(row.publishedAt),
      ingestedAt: optionalIso(row.ingestedAt),
      asKnownAt: optionalIso(row.asKnownAt),
      qualityFlags: flags(row.qualityFlags),
    }));
  }

  async readEntityLinksAsOf(asOf: string, publicationId?: string): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      "select * from news_core.read_entity_links_as_of($1::timestamptz,$2::text)", [asOf, publicationId ?? null],
    );
    return result.rows.map(row => ({ ...row, asKnownAt: optionalIso(row.asKnownAt) }));
  }

  async readAsOf(asOf: string): Promise<NewsPublication[]> {
    const result = await this.pool.query<NewsPublication>(
      `select * from news_core.read_publications_as_of($1::timestamptz)`, [asOf],
    );
    return result.rows;
  }

  async claimNext(workerId: string, leaseSeconds = 60, collectionScopeKey?: string): Promise<ClaimedTarget | null> {
    await this.recoverPending(); const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update news_core.executions e set state='FAILED',finished_at=clock_timestamp(),error_code='LEASE_EXPIRED',error_message='worker lease expired'
         where e.state='RUNNING' and exists (select 1 from news_core.collection_targets t where t.active_execution_id=e.execution_id and t.lease_until < clock_timestamp())`,
      );
      const result = await client.query<NewsTarget & { parameters: Record<string, unknown>; attempt_count: number }>(
        `select collection_scope_key as "collectionScopeKey",source_id as "sourceId",provider_key as "providerKey",entity_key as "entityKey",parameters,attempt_count
         from news_core.collection_targets where enabled and ($1::text is null or collection_scope_key=$1) and next_run_at <= clock_timestamp() and (lease_until is null or lease_until < clock_timestamp())
         order by next_run_at,collection_scope_key for update skip locked limit 1`,
        [collectionScopeKey ?? null],
      );
      const row = result.rows[0]; if (!row) { await client.query("commit"); return null; }
      const updated = await client.query<{ attempt_count: number }>(
        `update news_core.collection_targets set lease_owner=$1,lease_until=clock_timestamp()+($2::int * interval '1 second'),active_execution_id=null,attempt_count=attempt_count+1,updated_at=clock_timestamp()
         where collection_scope_key=$3 returning attempt_count`, [workerId, leaseSeconds, row.collectionScopeKey],
      );
      const execution = await client.query<{ execution_id: string }>(
        `insert into news_core.executions(collection_scope_key,worker_id,state,attempt) values ($1,$2,'RUNNING',$3) returning execution_id`, [row.collectionScopeKey, workerId, updated.rows[0].attempt_count],
      );
      await client.query("update news_core.collection_targets set active_execution_id=$1 where collection_scope_key=$2", [execution.rows[0].execution_id, row.collectionScopeKey]);
      await client.query("commit");
      return { collectionScopeKey: row.collectionScopeKey, sourceId: row.sourceId, providerKey: row.providerKey, entityKey: row.entityKey, parameters: row.parameters, attempt: updated.rows[0].attempt_count, executionId: execution.rows[0].execution_id };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async heartbeat(lease: ExecutionLease): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const execution = await client.query(
        `update news_core.executions set heartbeat_at=clock_timestamp() where execution_id=$1 and collection_scope_key=$2 and worker_id=$3 and state='RUNNING' returning execution_id`, [lease.executionId, lease.collectionScopeKey, lease.workerId],
      );
      const target = await client.query(
        `update news_core.collection_targets set lease_until=clock_timestamp()+($1::int * interval '1 second'),updated_at=clock_timestamp()
         where collection_scope_key=$2 and active_execution_id=$3 and lease_owner=$4 and lease_until > clock_timestamp() returning collection_scope_key`, [lease.leaseSeconds, lease.collectionScopeKey, lease.executionId, lease.workerId],
      );
      if ((target.rowCount ?? 0) !== 1 || (execution.rowCount ?? 0) !== 1) { await client.query("rollback"); return false; }
      await client.query("commit"); return true;
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async finish(lease: ExecutionLease, success: boolean, error?: unknown, failurePoint: "none" | "after-execution-update" = "none"): Promise<FinishResult> {
    const message = error instanceof Error ? error.message.slice(0, 1000) : undefined; const client = await this.pool.connect();
    try {
      await client.query("begin");
      const valid = await client.query(
        `select 1 from news_core.executions e join news_core.collection_targets t on t.active_execution_id=e.execution_id
         where e.execution_id=$1 and e.collection_scope_key=$2 and e.worker_id=$3 and e.state='RUNNING' and t.lease_owner=$3 and t.collection_scope_key=$2 and t.lease_until > clock_timestamp() for update`, [lease.executionId, lease.collectionScopeKey, lease.workerId],
      );
      if ((valid.rowCount ?? 0) !== 1) { await client.query("rollback"); return { status: "STALE" }; }
      await client.query(
        `update news_core.executions set state=$1,finished_at=clock_timestamp(),heartbeat_at=clock_timestamp(),error_code=$2,error_message=$3
         where execution_id=$4 and collection_scope_key=$5 and worker_id=$6 and state='RUNNING'`, [success ? "SUCCEEDED" : "FAILED", success ? null : "NEWS_COLLECTION_FAILED", success ? null : message, lease.executionId, lease.collectionScopeKey, lease.workerId],
      );
      if (failurePoint === "after-execution-update") throw new Error("INJECTED_FAILURE_DURING_FINISH");
      const target = await client.query(
        `update news_core.collection_targets set lease_owner=null,lease_until=null,active_execution_id=null,
         next_run_at=clock_timestamp()+(case when $1 then interval '60 seconds' else least(interval '1 hour',interval '5 seconds' * greatest(consecutive_failures+1,1)) end),
         consecutive_failures=case when $1 then 0 else consecutive_failures+1 end,
         last_success_at=case when $1 then clock_timestamp() else last_success_at end,last_error_at=case when $1 then last_error_at else clock_timestamp() end,
         last_error=case when $1 then null else $2 end,updated_at=clock_timestamp()
         where collection_scope_key=$3 and active_execution_id=$4 and lease_owner=$5 and lease_until > clock_timestamp()`, [success, message ?? null, lease.collectionScopeKey, lease.executionId, lease.workerId],
      );
      if ((target.rowCount ?? 0) !== 1) throw new Error("NEWS_LEASE_LOST");
      await client.query("commit"); return { status: "FINISHED" };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
