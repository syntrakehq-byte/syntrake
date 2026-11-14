-- BL3 close-out: durable claim ownership and bounded retry fairness.
alter table news_core.factual_pipeline_backlog
  add column if not exists claim_owner text,
  add column if not exists claim_token uuid,
  add column if not exists next_attempt_at timestamptz not null default clock_timestamp();
create index if not exists factual_pipeline_backlog_fair_idx
  on news_core.factual_pipeline_backlog (next_attempt_at, created_at, publication_id)
  where state <> 'DONE';
revoke all on news_core.factual_pipeline_backlog from public, news_reader;
grant select, insert, update on news_core.factual_pipeline_backlog to news_service;
