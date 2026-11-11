-- News Core N1. This migration is intentionally separate from Market Core.
-- Apply only to an explicitly provisioned News Core database/role.
create schema if not exists news_core;
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'news_service') then
    create role news_service nologin nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'news_reader') then
    create role news_reader nologin nocreatedb nocreaterole noinherit;
  end if;
end $$;

-- The worker cannot disable the server-side finalization guard.
revoke set on parameter transaction_timeout from public;
revoke set on parameter transaction_timeout from news_service;

create table if not exists news_core.sources (
  source_id text primary key,
  provider_key text not null,
  source_type text not null check (source_type in ('SEC_EDGAR')),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists news_core.visibility_frontiers (
  frontier_id bigint generated always as identity primary key,
  published_at timestamptz not null default clock_timestamp()
);

create table if not exists news_core.publications (
  publication_id text primary key,
  source_id text not null references news_core.sources(source_id),
  origin_fingerprint text not null,
  external_id text not null,
  original_url text not null,
  title text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null,
  ingested_at timestamptz,
  as_known_at timestamptz,
  form text not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  created_at timestamptz not null default clock_timestamp(),
  check (visibility_state = 'PENDING' or (ingested_at is not null and as_known_at is not null and first_seen_at <= ingested_at and ingested_at <= as_known_at)),
  unique (source_id, origin_fingerprint)
);

create table if not exists news_core.observations (
  observation_id text primary key,
  provider_key text not null,
  provider_observation_key text not null,
  publication_id text not null references news_core.publications(publication_id),
  observed_at timestamptz not null,
  retrieved_at timestamptz not null,
  publisher_key text not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  unique (provider_key, provider_observation_key)
);

create table if not exists news_core.checkpoints (
  collection_scope_key text primary key,
  source_id text not null references news_core.sources(source_id),
  cursor text,
  watermark_key text,
  updated_at timestamptz not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  check (watermark_key is null or length(watermark_key) > 0)
);

create table if not exists news_core.collection_targets (
  collection_scope_key text primary key,
  source_id text not null references news_core.sources(source_id),
  provider_key text not null,
  entity_key text not null,
  parameters jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  next_run_at timestamptz not null default clock_timestamp(),
  lease_owner text,
  lease_until timestamptz,
  active_execution_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists news_core.executions (
  execution_id uuid primary key default gen_random_uuid(),
  collection_scope_key text not null references news_core.collection_targets(collection_scope_key),
  worker_id text not null,
  state text not null check (state in ('RUNNING','SUCCEEDED','FAILED')),
  attempt integer not null check (attempt > 0),
  started_at timestamptz not null default clock_timestamp(),
  heartbeat_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  error_code text,
  error_message text
);

create index if not exists publications_pit_idx on news_core.publications (as_known_at, published_at);
create index if not exists observations_publication_idx on news_core.observations (publication_id);
create index if not exists targets_due_idx on news_core.collection_targets (next_run_at, lease_until) where enabled;
create unique index if not exists executions_one_running_idx on news_core.executions(collection_scope_key) where state = 'RUNNING';

-- The first version of this migration was published on the stacked branch
-- before the fencing/PIT correction. These ALTERs keep local re-application
-- safe while the migration remains the single versioned News Core contract.
alter table news_core.publications alter column ingested_at drop not null;
alter table news_core.publications alter column as_known_at drop not null;
alter table news_core.publications add column if not exists visibility_state text not null default 'COMMITTED';
alter table news_core.publications add column if not exists pending_transaction_id bigint;
alter table news_core.publications add column if not exists visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id);
alter table news_core.observations add column if not exists visibility_state text not null default 'COMMITTED';
alter table news_core.observations add column if not exists pending_transaction_id bigint;
alter table news_core.observations add column if not exists visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id);
alter table news_core.checkpoints add column if not exists visibility_state text not null default 'COMMITTED';
alter table news_core.checkpoints add column if not exists pending_transaction_id bigint;
alter table news_core.checkpoints add column if not exists visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id);
alter table news_core.collection_targets add column if not exists active_execution_id uuid;
alter table news_core.collection_targets add column if not exists consecutive_failures integer not null default 0;
alter table news_core.publications drop constraint if exists publications_pit_consistency;
alter table news_core.publications add constraint publications_pit_consistency check
  (visibility_state = 'PENDING' or (ingested_at is not null and as_known_at is not null and first_seen_at <= ingested_at and ingested_at <= as_known_at));

revoke all on schema news_core from public;
revoke all on all tables in schema news_core from public;
grant usage on schema news_core to news_service, news_reader;
revoke all on news_core.sources, news_core.visibility_frontiers, news_core.publications, news_core.observations, news_core.checkpoints, news_core.collection_targets, news_core.executions from news_reader;
grant select, insert, update on news_core.sources to news_service;
grant select, insert, update on news_core.publications, news_core.observations to news_service;
grant select, insert, update on news_core.checkpoints, news_core.collection_targets, news_core.executions to news_service;
grant select, insert on news_core.visibility_frontiers to news_service;
revoke update on news_core.visibility_frontiers from news_service;
revoke update (published_at) on news_core.visibility_frontiers from news_service;

create or replace function news_core.begin_news_finalization_guard()
returns table(transaction_started_at timestamptz, availability_at timestamptz)
language plpgsql volatile security definer
set search_path = pg_catalog, news_core
as $$
begin
  -- PostgreSQL 17 aborts this transaction if it spans more than 1 second.
  perform set_config('transaction_timeout', '1s', true);
  return query
    select transaction_timestamp(), transaction_timestamp() + interval '1.25 seconds';
end
$$;

create or replace function news_core.seal_visibility_frontier(p_frontier_id bigint, p_published_at timestamptz)
returns timestamptz
language sql volatile security definer
set search_path = pg_catalog, news_core
as $$
  update news_core.visibility_frontiers f
     set published_at=p_published_at
   where f.frontier_id=p_frontier_id
     and p_published_at > clock_timestamp()
     and (
       exists (select 1 from news_core.publications p where p.visibility_frontier_id=f.frontier_id and p.visibility_state='PENDING')
       or exists (select 1 from news_core.observations o where o.visibility_frontier_id=f.frontier_id and o.visibility_state='PENDING')
       or exists (select 1 from news_core.checkpoints c where c.visibility_frontier_id=f.frontier_id and c.visibility_state='PENDING')
     )
  returning f.published_at
$$;

revoke all on function news_core.begin_news_finalization_guard() from public;
revoke all on function news_core.seal_visibility_frontier(bigint,timestamptz) from public;
grant execute on function news_core.begin_news_finalization_guard() to news_service;
grant execute on function news_core.seal_visibility_frontier(bigint,timestamptz) to news_service;
grant usage, select on all sequences in schema news_core to news_service;

create or replace function news_core.read_publications_as_of(p_as_of timestamptz)
returns table(
  "publicationId" text, "sourceId" text, "originFingerprint" text, "externalId" text,
  "originalUrl" text, title text, "publishedAt" timestamptz, "firstSeenAt" timestamptz,
  "ingestedAt" timestamptz, "asKnownAt" timestamptz, form text
)
language sql stable security definer
set search_path = pg_catalog, news_core
as $$
  select p.publication_id,p.source_id,p.origin_fingerprint,p.external_id,p.original_url,p.title,p.published_at,
         p.first_seen_at,p.ingested_at,p.as_known_at,p.form
    from news_core.publications p
    join news_core.visibility_frontiers f on f.frontier_id=p.visibility_frontier_id
   where p.visibility_state='COMMITTED' and p.as_known_at is not null
     and p.as_known_at <= p_as_of and f.published_at <= p_as_of
   order by f.published_at,p.publication_id
$$;

create or replace function news_core.read_observations_as_of(p_as_of timestamptz)
returns table(
  "observationId" text, "providerKey" text, "providerObservationKey" text,
  "publicationId" text, "observedAt" timestamptz, "retrievedAt" timestamptz, "publisherKey" text
)
language sql stable security definer
set search_path = pg_catalog, news_core
as $$
  select o.observation_id,o.provider_key,o.provider_observation_key,o.publication_id,o.observed_at,o.retrieved_at,o.publisher_key
    from news_core.observations o
    join news_core.publications p on p.publication_id=o.publication_id
    join news_core.visibility_frontiers pf on pf.frontier_id=p.visibility_frontier_id
    join news_core.visibility_frontiers of on of.frontier_id=o.visibility_frontier_id
   where o.visibility_state='COMMITTED' and p.visibility_state='COMMITTED'
     and pf.published_at <= p_as_of and of.published_at <= p_as_of
   order by of.published_at,o.observation_id
$$;

revoke all on function news_core.read_publications_as_of(timestamptz) from public;
revoke all on function news_core.read_observations_as_of(timestamptz) from public;
grant execute on function news_core.read_publications_as_of(timestamptz) to news_reader, news_service;
grant execute on function news_core.read_observations_as_of(timestamptz) to news_reader, news_service;
