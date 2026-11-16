-- N-G4: retain only content actually obtained and permitted by a source.
-- Nullable fields preserve SEC and metadata-only publications.
alter table news_core.publications add column if not exists content_excerpt text;
alter table news_core.publication_revisions add column if not exists content_excerpt text;

drop function if exists news_core.read_publication_revisions_as_of(timestamptz,text);
create function news_core.read_publication_revisions_as_of(p_as_of timestamptz, p_publication_id text default null)
returns table(
  "publicationRevisionId" text, "publicationId" text, "revisionNo" integer,
  title text, "publishedAt" timestamptz, form text, "contentFingerprint" text,
  "contentExcerpt" text, "sourceDocumentRef" text, "qualityFlags" jsonb, "supersedesRevisionId" text,
  "ingestedAt" timestamptz, "asKnownAt" timestamptz
)
language sql stable security definer
set search_path = pg_catalog, news_core
as $$
  select r.publication_revision_id,r.publication_id,r.revision_no,r.title,r.published_at,r.form,
         r.content_fingerprint,r.content_excerpt,r.source_document_ref,r.quality_flags,r.supersedes_revision_id,
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
