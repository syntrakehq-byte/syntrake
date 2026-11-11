-- News Core N2-A: immutable publication revisions and revision provenance.
-- This migration is local/candidate-only and does not alter Market Core.

create table if not exists news_core.publication_revisions (
  publication_revision_id text primary key,
  publication_id text not null references news_core.publications(publication_id),
  revision_no integer not null check (revision_no > 0),
  title text not null,
  published_at timestamptz,
  form text not null,
  content_fingerprint text,
  source_document_ref text not null,
  quality_flags jsonb not null default '[]'::jsonb,
  supersedes_revision_id text references news_core.publication_revisions(publication_revision_id),
  ingested_at timestamptz,
  as_known_at timestamptz,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  created_at timestamptz not null default clock_timestamp(),
  check (supersedes_revision_id is null or supersedes_revision_id <> publication_revision_id),
  check ((revision_no = 1 and supersedes_revision_id is null) or (revision_no > 1 and supersedes_revision_id is not null)),
  check (jsonb_typeof(quality_flags) = 'array'),
  check (visibility_state = 'PENDING' or (ingested_at is not null and as_known_at is not null and ingested_at <= as_known_at)) ,
  unique (publication_id, revision_no)
);

create table if not exists news_core.publication_revision_provenance (
  provenance_id text primary key,
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  source_id text not null references news_core.sources(source_id),
  provider_key text not null,
  provider_observation_key text,
  original_url text,
  source_document_ref text not null,
  retrieved_at timestamptz not null,
  quality_flags jsonb not null default '[]'::jsonb,
  ingested_at timestamptz,
  as_known_at timestamptz,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  check (jsonb_typeof(quality_flags) = 'array'),
  check (visibility_state = 'PENDING' or (ingested_at is not null and as_known_at is not null and ingested_at <= as_known_at))
);

create unique index if not exists publication_revision_provenance_key_idx
  on news_core.publication_revision_provenance(publication_revision_id, provider_key, coalesce(provider_observation_key, ''));
create index if not exists publication_revisions_pit_idx
  on news_core.publication_revisions(publication_id, as_known_at, revision_no);

create or replace function news_core.reject_committed_revision_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.visibility_state = 'COMMITTED' then
    raise exception 'NEWS_REVISION_IMMUTABLE';
  end if;
  if new.publication_revision_id is distinct from old.publication_revision_id
     or new.publication_id is distinct from old.publication_id
     or new.revision_no is distinct from old.revision_no
     or new.title is distinct from old.title
     or new.published_at is distinct from old.published_at
     or new.form is distinct from old.form
     or new.content_fingerprint is distinct from old.content_fingerprint
     or new.source_document_ref is distinct from old.source_document_ref
     or new.quality_flags is distinct from old.quality_flags
     or new.supersedes_revision_id is distinct from old.supersedes_revision_id then
    raise exception 'NEWS_REVISION_APPEND_ONLY';
  end if;
  return new;
end
$$;

create or replace function news_core.reject_committed_provenance_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.visibility_state = 'COMMITTED' then
    raise exception 'NEWS_REVISION_PROVENANCE_IMMUTABLE';
  end if;
  if new.provenance_id is distinct from old.provenance_id
     or new.publication_revision_id is distinct from old.publication_revision_id
     or new.source_id is distinct from old.source_id
     or new.provider_key is distinct from old.provider_key
     or new.provider_observation_key is distinct from old.provider_observation_key
     or new.original_url is distinct from old.original_url
     or new.source_document_ref is distinct from old.source_document_ref
     or new.retrieved_at is distinct from old.retrieved_at
     or new.quality_flags is distinct from old.quality_flags then
    raise exception 'NEWS_REVISION_PROVENANCE_APPEND_ONLY';
  end if;
  return new;
end
$$;

drop trigger if exists publication_revisions_append_only on news_core.publication_revisions;
create trigger publication_revisions_append_only before update on news_core.publication_revisions
for each row execute function news_core.reject_committed_revision_mutation();
drop trigger if exists publication_revision_provenance_append_only on news_core.publication_revision_provenance;
create trigger publication_revision_provenance_append_only before update on news_core.publication_revision_provenance
for each row execute function news_core.reject_committed_provenance_mutation();

-- Compatibility for N1 rows: create only a truthful revision-1 record from
-- timestamps already persisted by N1. No historical timestamp is invented.
insert into news_core.publication_revisions
  (publication_revision_id, publication_id, revision_no, title, published_at, form,
   source_document_ref, ingested_at, as_known_at, visibility_state, visibility_frontier_id)
select p.publication_id || ':revision:1', p.publication_id, 1, p.title, p.published_at, p.form,
       p.original_url, p.ingested_at, p.as_known_at, p.visibility_state, p.visibility_frontier_id
  from news_core.publications p
 where p.visibility_state='COMMITTED'
on conflict (publication_revision_id) do nothing;

insert into news_core.publication_revision_provenance
  (provenance_id, publication_revision_id, source_id, provider_key, provider_observation_key,
   original_url, source_document_ref, retrieved_at, ingested_at, as_known_at,
   visibility_state, visibility_frontier_id)
select p.publication_id || ':provenance:' || coalesce(o.observation_id, 'publication'),
       p.publication_id || ':revision:1', p.source_id, coalesce(o.provider_key, s.provider_key),
       o.provider_observation_key, p.original_url, p.original_url,
       coalesce(o.retrieved_at, p.ingested_at), p.ingested_at, p.as_known_at,
       p.visibility_state, p.visibility_frontier_id
  from news_core.publications p
  join news_core.sources s on s.source_id=p.source_id
  left join news_core.observations o on o.publication_id=p.publication_id
 where p.visibility_state='COMMITTED'
   and coalesce(o.retrieved_at, p.ingested_at) is not null
on conflict (provenance_id) do nothing;

revoke all on news_core.publication_revisions, news_core.publication_revision_provenance from public, news_reader;
grant select, insert, update on news_core.publication_revisions, news_core.publication_revision_provenance to news_service;

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
       or exists (select 1 from news_core.publication_revisions r where r.visibility_frontier_id=f.frontier_id and r.visibility_state='PENDING')
       or exists (select 1 from news_core.publication_revision_provenance v where v.visibility_frontier_id=f.frontier_id and v.visibility_state='PENDING')
     )
  returning f.published_at
$$;

revoke all on function news_core.seal_visibility_frontier(bigint,timestamptz) from public;
grant execute on function news_core.seal_visibility_frontier(bigint,timestamptz) to news_service;

create or replace function news_core.read_publication_revisions_as_of(p_as_of timestamptz, p_publication_id text default null)
returns table(
  "publicationRevisionId" text, "publicationId" text, "revisionNo" integer,
  title text, "publishedAt" timestamptz, form text, "contentFingerprint" text,
  "sourceDocumentRef" text, "qualityFlags" jsonb, "supersedesRevisionId" text,
  "ingestedAt" timestamptz, "asKnownAt" timestamptz
)
language sql stable security definer
set search_path = pg_catalog, news_core
as $$
  select r.publication_revision_id,r.publication_id,r.revision_no,r.title,r.published_at,r.form,
         r.content_fingerprint,r.source_document_ref,r.quality_flags,r.supersedes_revision_id,
         r.ingested_at,r.as_known_at
    from news_core.publication_revisions r
    join news_core.publications p on p.publication_id=r.publication_id
    join news_core.visibility_frontiers f on f.frontier_id=r.visibility_frontier_id
   where r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED'
     and r.as_known_at is not null and r.as_known_at <= p_as_of and f.published_at <= p_as_of
     and (p_publication_id is null or r.publication_id=p_publication_id)
   order by r.publication_id,r.revision_no
$$;

revoke all on function news_core.read_publication_revisions_as_of(timestamptz,text) from public;
grant execute on function news_core.read_publication_revisions_as_of(timestamptz,text) to news_reader, news_service;
