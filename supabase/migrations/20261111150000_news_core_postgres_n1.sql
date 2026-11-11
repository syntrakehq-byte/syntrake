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

create table if not exists news_core.sources (
  source_id text primary key,
  provider_key text not null,
  source_type text not null check (source_type in ('SEC_EDGAR')),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
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
  ingested_at timestamptz not null,
  as_known_at timestamptz not null,
  form text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (first_seen_at <= ingested_at and ingested_at <= as_known_at),
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
  unique (provider_key, provider_observation_key)
);

create table if not exists news_core.checkpoints (
  collection_scope_key text primary key,
  source_id text not null references news_core.sources(source_id),
  cursor text,
  watermark_key text,
  updated_at timestamptz not null,
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
  attempt_count integer not null default 0 check (attempt_count >= 0),
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

revoke all on schema news_core from public;
revoke all on all tables in schema news_core from public;
grant usage on schema news_core to news_service, news_reader;
grant select on news_core.sources, news_core.publications, news_core.observations, news_core.checkpoints to news_reader;
grant select, insert, update on news_core.sources to news_service;
grant select, insert on news_core.publications, news_core.observations to news_service;
grant select, insert, update on news_core.checkpoints, news_core.collection_targets, news_core.executions to news_service;
grant usage, select on all sequences in schema news_core to news_service;
