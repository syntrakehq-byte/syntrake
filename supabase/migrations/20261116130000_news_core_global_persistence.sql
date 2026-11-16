-- N-G3 candidate migration: generalize existing News N1 storage for registered global sources.
-- Local/isolated validation only. No remote migration is performed by this change.

alter table news_core.sources drop constraint if exists sources_source_type_check;
alter table news_core.sources add column if not exists publisher_id text;
alter table news_core.sources add column if not exists category text;
alter table news_core.sources add column if not exists geo_scope jsonb not null default '[]'::jsonb;
alter table news_core.sources add column if not exists endpoint text;
alter table news_core.sources add column if not exists rights_policy_id text;
alter table news_core.sources add column if not exists storage_policy jsonb not null default '{}'::jsonb;
alter table news_core.sources add column if not exists retention_days integer;
alter table news_core.sources add column if not exists source_status text not null default 'ACTIVE';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='sources_status_check' and conrelid='news_core.sources'::regclass) then
    alter table news_core.sources add constraint sources_status_check check (source_status in ('ACTIVE','DEGRADED','DISABLED','UNAVAILABLE'));
  end if;
end $$;

create index if not exists global_sources_status_idx on news_core.sources(source_status, source_type);
create index if not exists global_publications_source_pit_idx on news_core.publications(source_id, as_known_at, published_at);

comment on table news_core.sources is 'N1 SEC and N-G3 registered sources. Source metadata is additive; SEC rows remain valid.';
