-- N-G6: deterministic, PIT-safe global publication reads.  N5 remains the
-- public contract; this function is an additive implementation capability.
drop function if exists news_core.read_publication_revisions_filtered_as_of(timestamptz,text,text[],text[]);
create function news_core.read_publication_revisions_filtered_as_of(p_as_of timestamptz, p_query text default null, p_source_ids text[] default '{}', p_forms text[] default '{}')
returns table("publicationRevisionId" text,"publicationId" text,"revisionNo" integer,title text,"publishedAt" timestamptz,form text,"contentFingerprint" text,"contentExcerpt" text,"sourceDocumentRef" text,"qualityFlags" jsonb,"supersedesRevisionId" text,"ingestedAt" timestamptz,"asKnownAt" timestamptz,"sourceId" text,"rightsMode" text)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  with visible as materialized (
    select r.*,p.source_id,
      case when coalesce(s.storage_policy->>'content','METADATA_ONLY')='PERMITTED_TEXT' and coalesce(s.storage_policy->>'presentation','PUBLIC') <> 'NONE' then 'PERMITTED_TEXT' else 'METADATA_ONLY' end as rights_mode,
      row_number() over(partition by r.publication_id order by r.revision_no desc,r.as_known_at desc,r.ingested_at desc) as n
      from news_core.publication_revisions r join news_core.publications p using (publication_id) join news_core.sources s using (source_id) join news_core.visibility_frontiers f on f.frontier_id=r.visibility_frontier_id
     where r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED' and r.as_known_at<=p_as_of and f.published_at<=p_as_of
  )
  select publication_revision_id,publication_id,revision_no,title,published_at,form,content_fingerprint,
    case when rights_mode='PERMITTED_TEXT' then content_excerpt else null end,source_document_ref,quality_flags,supersedes_revision_id,ingested_at,as_known_at,source_id,rights_mode
    from visible where n=1 and (nullif(p_query,'') is null or title ilike '%'||p_query||'%' or source_document_ref ilike '%'||p_query||'%')
      and (coalesce(cardinality(p_source_ids),0)=0 or source_id=any(p_source_ids))
      and (coalesce(cardinality(p_forms),0)=0 or form=any(p_forms))
    order by publication_id,revision_no
$$;
revoke all on function news_core.read_publication_revisions_filtered_as_of(timestamptz,text,text[],text[]) from public;
grant execute on function news_core.read_publication_revisions_filtered_as_of(timestamptz,text,text[],text[]) to news_reader,news_service;

create or replace function news_core.read_global_publication_revisions_page_as_of(
  p_as_of timestamptz, p_query text default null, p_source_ids text[] default '{}',
  p_forms text[] default '{}', p_entity_ids text[] default '{}',
  p_instrument_ids text[] default '{}', p_offset integer default 0,
  p_limit integer default 101, p_sort text default 'STABLE'
)
returns table(
  "publicationRevisionId" text, "publicationId" text, "revisionNo" integer,
  title text, "publishedAt" timestamptz, form text, "contentFingerprint" text,
  "contentExcerpt" text, "sourceDocumentRef" text, "qualityFlags" jsonb,
  "supersedesRevisionId" text, "ingestedAt" timestamptz, "asKnownAt" timestamptz,
  "sourceId" text, "rightsMode" text
)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  with visible as materialized (
    select r.*, p.source_id,
      case when coalesce(s.storage_policy->>'content','METADATA_ONLY')='PERMITTED_TEXT'
             and coalesce(s.storage_policy->>'presentation','PUBLIC') <> 'NONE'
           then 'PERMITTED_TEXT' else 'METADATA_ONLY' end as rights_mode,
      row_number() over (partition by r.publication_id order by r.revision_no desc,r.as_known_at desc,r.ingested_at desc) as n
      from news_core.publication_revisions r
      join news_core.publications p using (publication_id)
      join news_core.sources s using (source_id)
      join news_core.visibility_frontiers f on f.frontier_id=r.visibility_frontier_id
      where r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED'
        and r.as_known_at <= p_as_of and f.published_at <= p_as_of
  ), latest as (
    select v.* from visible v
    where v.n=1
      and (nullif(p_query,'') is null or v.title ilike '%'||p_query||'%' or v.source_document_ref ilike '%'||p_query||'%')
      and (coalesce(cardinality(p_source_ids),0)=0 or v.source_id=any(p_source_ids))
      and (coalesce(cardinality(p_forms),0)=0 or v.form=any(p_forms))
      and (coalesce(cardinality(p_entity_ids),0)=0 or exists (
        select 1 from news_core.entity_link_revisions l
         where l.publication_revision_id=v.publication_revision_id and l.visibility_state='COMMITTED'
           and l.identity_status='EXACT' and l.as_known_at<=p_as_of
           and (l.issuer_id=any(p_entity_ids) or l.instrument_id=any(p_entity_ids) or l.listing_id=any(p_entity_ids))))
      and (coalesce(cardinality(p_instrument_ids),0)=0 or exists (
        select 1 from news_core.entity_link_revisions l
         where l.publication_revision_id=v.publication_revision_id and l.visibility_state='COMMITTED'
           and l.identity_status='EXACT' and l.as_known_at<=p_as_of
           and (l.instrument_id=any(p_instrument_ids) or l.listing_id=any(p_instrument_ids))))
  )
  select publication_revision_id,publication_id,revision_no,title,published_at,form,content_fingerprint,
    case when rights_mode='PERMITTED_TEXT' then content_excerpt else null end,
    source_document_ref,quality_flags,supersedes_revision_id,ingested_at,as_known_at,source_id,rights_mode
  from latest
  order by case when p_sort='RECENT' then coalesce(published_at,as_known_at) end desc nulls last,
           publication_id,revision_no
  offset greatest(p_offset,0) limit least(greatest(p_limit,1),101)
$$;

revoke all on function news_core.read_global_publication_revisions_page_as_of(timestamptz,text,text[],text[],text[],text[],integer,integer,text) from public;
grant execute on function news_core.read_global_publication_revisions_page_as_of(timestamptz,text,text[],text[],text[],text[],integer,integer,text) to news_reader,news_service;
