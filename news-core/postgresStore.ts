import type { Pool } from "pg";
import type { NewsBatch, NewsPublication, NewsProviderObservation } from "./contracts";

export type NewsTarget = Readonly<{
  collectionScopeKey: string; sourceId: string; providerKey: string; entityKey: string;
  parameters: Record<string, unknown>; nextRunAt?: string;
}>;

export type ClaimedTarget = NewsTarget & Readonly<{ attempt: number }>;

function watermarkKey(batch: NewsBatch): string | null {
  const cursor = batch.checkpoint.cursor;
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as { watermark?: unknown };
    return typeof parsed.watermark === "string" ? parsed.watermark : null;
  } catch { return null; }
}

export class PostgresNewsStore {
  constructor(private readonly pool: Pool) {}

  async close(): Promise<void> { await this.pool.end(); }

  async ensureSource(sourceId: string, providerKey: string, sourceType = "SEC_EDGAR"): Promise<void> {
    await this.pool.query(
      `insert into news_core.sources(source_id,provider_key,source_type)
       values ($1,$2,$3) on conflict (source_id) do update set provider_key=excluded.provider_key`,
      [sourceId, providerKey, sourceType],
    );
  }

  async upsertTarget(target: NewsTarget): Promise<void> {
    await this.pool.query(
      `insert into news_core.collection_targets(collection_scope_key,source_id,provider_key,entity_key,parameters,next_run_at)
       values ($1,$2,$3,$4,$5,coalesce($6::timestamptz,clock_timestamp()))
       on conflict (collection_scope_key) do update set parameters=excluded.parameters, enabled=true, updated_at=clock_timestamp()`,
      [target.collectionScopeKey, target.sourceId, target.providerKey, target.entityKey, target.parameters, target.nextRunAt ?? null],
    );
  }

  async getCheckpoint(scope: string): Promise<{ cursor: string | null; updatedAt: string } | null> {
    const result = await this.pool.query<{ cursor: string | null; updated_at: Date }>(
      "select cursor,updated_at from news_core.checkpoints where collection_scope_key=$1", [scope],
    );
    const row = result.rows[0];
    return row ? { cursor: row.cursor, updatedAt: row.updated_at.toISOString() } : null;
  }

  async ingest(batch: NewsBatch, failurePoint: "none" | "before-commit" = "none"): Promise<{ insertedPublications: number; insertedObservations: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into news_core.sources(source_id,provider_key,source_type) values ($1,$2,'SEC_EDGAR') on conflict (source_id) do nothing",
        [batch.checkpoint.sourceId, batch.observations[0]?.providerKey ?? "sec"],
      );
      let insertedPublications = 0;
      for (const publication of batch.publications) {
        const result = await client.query(
          `insert into news_core.publications
           (publication_id,source_id,origin_fingerprint,external_id,original_url,title,published_at,first_seen_at,ingested_at,as_known_at,form)
           values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,clock_timestamp(),clock_timestamp(),$9)
           on conflict (publication_id) do nothing`,
          [publication.publicationId, publication.sourceId, publication.originFingerprint, publication.externalId,
            publication.originalUrl, publication.title, publication.publishedAt, publication.firstSeenAt, publication.form],
        );
        insertedPublications += result.rowCount ?? 0;
      }
      let insertedObservations = 0;
      for (const observation of batch.observations) {
        const result = await client.query(
          `insert into news_core.observations
           (observation_id,provider_key,provider_observation_key,publication_id,observed_at,retrieved_at,publisher_key)
           values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7) on conflict (provider_key,provider_observation_key) do nothing`,
          [observation.observationId, observation.providerKey, observation.providerObservationKey, observation.publicationId,
            observation.observedAt, observation.retrievedAt, observation.publisherKey],
        );
        insertedObservations += result.rowCount ?? 0;
      }
      const key = watermarkKey(batch);
      await client.query(
        `insert into news_core.checkpoints(collection_scope_key,source_id,cursor,watermark_key,updated_at)
         values ($1,$2,$3,$4,$5::timestamptz)
         on conflict (collection_scope_key) do update set cursor=excluded.cursor,watermark_key=excluded.watermark_key,updated_at=excluded.updated_at
         where excluded.watermark_key is not null and
           (news_core.checkpoints.watermark_key is null or excluded.watermark_key > news_core.checkpoints.watermark_key)`,
        [batch.checkpoint.collectionScopeKey, batch.checkpoint.sourceId, batch.checkpoint.cursor, key, batch.checkpoint.updatedAt],
      );
      if (failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      await client.query("commit");
      return { insertedPublications, insertedObservations };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async readAsOf(asOf: string): Promise<NewsPublication[]> {
    const result = await this.pool.query<NewsPublication>(
      `select publication_id as "publicationId",source_id as "sourceId",origin_fingerprint as "originFingerprint",
       external_id as "externalId",original_url as "originalUrl",title,published_at as "publishedAt",
       first_seen_at as "firstSeenAt",ingested_at as "ingestedAt",as_known_at as "asKnownAt",form
       from news_core.publications where as_known_at <= $1::timestamptz order by as_known_at,publication_id`, [asOf],
    );
    return result.rows;
  }

  async claimNext(workerId: string, leaseSeconds = 60): Promise<ClaimedTarget | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update news_core.executions e set state='FAILED',finished_at=clock_timestamp(),error_code='LEASE_EXPIRED',error_message='worker lease expired'
         where e.state='RUNNING' and exists (select 1 from news_core.collection_targets t
         where t.collection_scope_key=e.collection_scope_key and t.lease_until < clock_timestamp())`,
      );
      const result = await client.query<NewsTarget & { parameters: Record<string, unknown>; attempt_count: number }>(
        `select collection_scope_key as "collectionScopeKey",source_id as "sourceId",provider_key as "providerKey",
         entity_key as "entityKey",parameters,attempt_count from news_core.collection_targets
         where enabled and next_run_at <= clock_timestamp() and (lease_until is null or lease_until < clock_timestamp())
         order by next_run_at,collection_scope_key for update skip locked limit 1`,
      );
      const row = result.rows[0]; if (!row) { await client.query("commit"); return null; }
      const updated = await client.query<{ attempt_count: number }>(
        `update news_core.collection_targets set lease_owner=$1,lease_until=clock_timestamp()+($2::int * interval '1 second'),
         attempt_count=attempt_count+1,updated_at=clock_timestamp() where collection_scope_key=$3 returning attempt_count`,
        [workerId, leaseSeconds, row.collectionScopeKey],
      );
      await client.query(
        `insert into news_core.executions(collection_scope_key,worker_id,state,attempt) values ($1,$2,'RUNNING',$3)`,
        [row.collectionScopeKey, workerId, updated.rows[0].attempt_count],
      );
      await client.query("commit");
      return { collectionScopeKey: row.collectionScopeKey, sourceId: row.sourceId, providerKey: row.providerKey, entityKey: row.entityKey, parameters: row.parameters, attempt: updated.rows[0].attempt_count };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async heartbeat(scope: string, workerId: string, leaseSeconds = 60): Promise<boolean> {
    const result = await this.pool.query(
      `update news_core.collection_targets set lease_until=clock_timestamp()+($1::int * interval '1 second'),updated_at=clock_timestamp()
       where collection_scope_key=$2 and lease_owner=$3 and lease_until >= clock_timestamp()`, [leaseSeconds, scope, workerId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async finish(scope: string, workerId: string, success: boolean, error?: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 1000) : undefined;
    await this.pool.query(
      `update news_core.executions set state=$1,finished_at=clock_timestamp(),heartbeat_at=clock_timestamp(),error_code=$2,error_message=$3
       where execution_id=(select execution_id from news_core.executions where collection_scope_key=$4 and worker_id=$5 and state='RUNNING' order by started_at desc limit 1)`,
      [success ? "SUCCEEDED" : "FAILED", success ? null : "NEWS_COLLECTION_FAILED", success ? null : message, scope, workerId],
    );
    await this.pool.query(
      `update news_core.collection_targets set lease_owner=null,lease_until=null,next_run_at=clock_timestamp()+
       (case when $1 then interval '60 seconds' else least(interval '1 hour', interval '5 seconds' * greatest(attempt_count,1)) end),
       last_success_at=case when $1 then clock_timestamp() else last_success_at end,
       last_error_at=case when $1 then last_error_at else clock_timestamp() end,
       last_error=case when $1 then null else $2 end,updated_at=clock_timestamp() where collection_scope_key=$3 and lease_owner=$4`,
      [success, message ?? null, scope, workerId],
    );
  }
}
