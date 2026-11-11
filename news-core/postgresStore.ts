import type { Pool, PoolClient } from "pg";
import type { NewsBatch, NewsPublication } from "./contracts";

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
}>;

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

export class PostgresNewsStore {
  constructor(private readonly pool: Pool) {}
  async close(): Promise<void> { await this.pool.end(); }

  private async finalizePending(txid: string, delayBeforeCommitMs = 0, onFrontierCreated?: () => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 20261111))", [txid]);
      const pending = await client.query<{ present: boolean }>(
        `select exists(select 1 from news_core.publications where pending_transaction_id=$1 and visibility_state='PENDING')
         or exists(select 1 from news_core.observations where pending_transaction_id=$1 and visibility_state='PENDING')
         or exists(select 1 from news_core.checkpoints where pending_transaction_id=$1 and visibility_state='PENDING') as present`, [txid],
      );
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
      if (onFrontierCreated) await onFrontierCreated();
      if (delayBeforeCommitMs > 0) await new Promise(resolve => setTimeout(resolve, delayBeforeCommitMs));
      const published = await client.query<{ published_at: Date | string }>(
        "select news_core.seal_visibility_frontier($1::bigint) as published_at",
        [frontierId],
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
      await client.query("commit");
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  private async recoverPending(): Promise<void> {
    const pending = await this.pool.query<{ txid: string }>(
      `select distinct pending_transaction_id::text as txid from news_core.publications where visibility_state='PENDING' and pending_transaction_id is not null
       union select distinct pending_transaction_id::text from news_core.observations where visibility_state='PENDING' and pending_transaction_id is not null
       union select distinct pending_transaction_id::text from news_core.checkpoints where visibility_state='PENDING' and pending_transaction_id is not null`,
    );
    for (const row of pending.rows) await this.finalizePending(row.txid);
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
