create table if not exists news_core.global_news_consumer_cursors (
  consumer_id text primary key check (length(consumer_id) between 1 and 128),
  cursor text,
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on news_core.global_news_consumer_cursors from public,news_reader;
grant select,insert,update on news_core.global_news_consumer_cursors to news_service;
