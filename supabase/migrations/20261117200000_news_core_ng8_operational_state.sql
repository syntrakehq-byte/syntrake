-- N-G8: durable, source-scoped operational state. This is telemetry only;
-- factual publication state remains in the N1-N6 tables and PIT contracts.
create table if not exists news_core.global_operational_state (
  source_id text not null references news_core.sources(source_id),
  collection_scope_key text not null references news_core.collection_targets(collection_scope_key),
  coverage text not null check (coverage in ('KNOWN','UNKNOWN')),
  health text not null check (health in ('HEALTHY','EMPTY','STALE','UNAVAILABLE','ERROR')),
  cycles integer not null default 0 check (cycles >= 0),
  observed integer not null default 0 check (observed >= 0),
  inserted_publications integer not null default 0 check (inserted_publications >= 0),
  last_success_at timestamptz,
  last_observed_at timestamptz,
  last_published_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (source_id, collection_scope_key)
);

revoke all on news_core.global_operational_state from public;
grant select on news_core.global_operational_state to news_reader, news_service;
grant insert, update on news_core.global_operational_state to news_service;
