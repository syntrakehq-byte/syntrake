-- BL3: durable hand-off from committed N2 publications to factual processing.
create table if not exists news_core.factual_pipeline_backlog (
  publication_id text primary key references news_core.publications(publication_id),
  publication_payload jsonb not null,
  state text not null default 'PENDING' check (state in ('PENDING','PROCESSING','DONE')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  last_error text,
  completed_status text check (completed_status is null or completed_status in ('PERSISTED','REFUSED')),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists factual_pipeline_backlog_due_idx
  on news_core.factual_pipeline_backlog (state, lease_until, created_at);
revoke all on news_core.factual_pipeline_backlog from public, news_reader;
grant select, insert, update on news_core.factual_pipeline_backlog to news_service;
