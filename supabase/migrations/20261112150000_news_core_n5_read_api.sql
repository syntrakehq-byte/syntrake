-- N5 read-only contract. No direct table privileges are added.
create or replace function news_core.read_fact_history_as_of(p_as_of timestamptz, p_fact_event_id text)
returns table("factEventId" text,"factRevisionId" text,"revisionNo" integer,"canonicalClaimId" text,"category" text,"claimType" text,"statement" text,"occurredAt" timestamptz,"scheduledFor" timestamptz,"confirmationStatus" text,"lifecycleStatus" text,"polarity" text,"asKnownAt" timestamptz,"committedAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  select r.fact_event_id,r.fact_revision_id,r.revision_no,e.canonical_claim_id,e.category,r.claim_type,r.statement,r.occurred_at,r.scheduled_for,r.confirmation_status,r.lifecycle_status,r.polarity,r.as_known_at,r.committed_at
    from news_core.fact_revisions r join news_core.fact_events e using (fact_event_id)
   where r.fact_event_id=p_fact_event_id and r.finalized_at is not null
     and r.as_known_at <= p_as_of and pg_xact_commit_timestamp(r.xmin) <= p_as_of
   order by r.revision_no
$$;

create or replace function news_core.read_fact_evidence_as_of(p_as_of timestamptz, p_fact_revision_id text)
returns table("factRevisionId" text,"evidenceId" text,"evidenceKind" text,"claimKey" text,"publicationRevisionId" text,"sourceDocumentRef" text,"contentLocator" text,"provenanceRef" text,"asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  select e.fact_revision_id,e.evidence_id,e.evidence_kind,e.claim_key,e.publication_revision_id,e.source_document_ref,e.content_locator,e.provenance_ref,e.evidence_as_known_at
    from news_core.fact_revision_evidence e join news_core.fact_revisions r using (fact_revision_id)
   where e.fact_revision_id=p_fact_revision_id and r.finalized_at is not null
     and r.as_known_at <= p_as_of and pg_xact_commit_timestamp(r.xmin) <= p_as_of
     and e.evidence_as_known_at <= p_as_of
   order by e.evidence_id
$$;

revoke all on function news_core.read_fact_history_as_of(timestamptz,text) from public;
revoke all on function news_core.read_fact_evidence_as_of(timestamptz,text) from public;
grant execute on function news_core.read_fact_history_as_of(timestamptz,text) to news_reader,news_service;
grant execute on function news_core.read_fact_evidence_as_of(timestamptz,text) to news_reader,news_service;

create or replace function news_core.read_publication_revisions_filtered_as_of(p_as_of timestamptz, p_query text default null, p_source_ids text[] default '{}', p_forms text[] default '{}')
returns table("publicationRevisionId" text, "publicationId" text, "revisionNo" integer, title text, "publishedAt" timestamptz, form text, "contentFingerprint" text, "sourceDocumentRef" text, "qualityFlags" jsonb, "supersedesRevisionId" text, "ingestedAt" timestamptz, "asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  with visible as materialized (
    select r.*,row_number() over(partition by r.publication_id order by r.revision_no desc,r.as_known_at desc,r.ingested_at desc) as n
      from news_core.publication_revisions r join news_core.publications p using (publication_id) join news_core.visibility_frontiers f on f.frontier_id=r.visibility_frontier_id
     where r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED' and r.as_known_at <= p_as_of and f.published_at <= p_as_of
  )
  select r.publication_revision_id,r.publication_id,r.revision_no,r.title,r.published_at,r.form,r.content_fingerprint,r.source_document_ref,r.quality_flags,r.supersedes_revision_id,r.ingested_at,r.as_known_at
    from visible r join news_core.publications p using (publication_id)
   where r.n=1
     and (nullif(p_query,'') is null or r.title ilike '%' || p_query || '%' or r.source_document_ref ilike '%' || p_query || '%')
     and (coalesce(cardinality(p_source_ids),0)=0 or p.source_id = any(p_source_ids))
     and (coalesce(cardinality(p_forms),0)=0 or r.form = any(p_forms))
   order by r.publication_id,r.revision_no
$$;

create or replace function news_core.read_fact_revisions_filtered_as_of(p_as_of timestamptz, p_targets text[] default '{}', p_event_types text[] default '{}', p_from timestamptz default null, p_to timestamptz default null)
returns table("factEventId" text,"factRevisionId" text,"revisionNo" integer,"canonicalClaimId" text,"category" text,"claimType" text,"statement" text,"occurredAt" timestamptz,"scheduledFor" timestamptz,"confirmationStatus" text,"lifecycleStatus" text,"polarity" text,"asKnownAt" timestamptz,"committedAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  with candidates as (select r.*,r.xmin as row_xmin,e.canonical_claim_id,e.category
    from news_core.fact_revisions r join news_core.fact_events e using (fact_event_id)
   where r.finalized_at is not null and r.as_known_at <= p_as_of and pg_xact_commit_timestamp(r.xmin) <= p_as_of),
  visible as materialized (select candidates.*,row_number() over(partition by fact_event_id order by revision_no desc,as_known_at desc,pg_xact_commit_timestamp(row_xmin) desc) n from candidates)
  select fact_event_id,fact_revision_id,revision_no,canonical_claim_id,category,claim_type,statement,occurred_at,scheduled_for,confirmation_status,lifecycle_status,polarity,as_known_at,committed_at
    from visible where n=1
     and (coalesce(cardinality(p_targets),0)=0 or fact_event_id = any(p_targets) or canonical_claim_id = any(p_targets) or category = any(p_targets))
     and (coalesce(cardinality(p_event_types),0)=0 or claim_type = any(p_event_types))
     and (p_from is null or coalesce(occurred_at,scheduled_for,committed_at) >= p_from)
     and (p_to is null or coalesce(occurred_at,scheduled_for,committed_at) <= p_to)
   order by fact_event_id
$$;

create or replace function news_core.read_fact_history_filtered_as_of(p_as_of timestamptz, p_targets text[] default '{}', p_from timestamptz default null, p_to timestamptz default null)
returns table("factEventId" text,"factRevisionId" text,"revisionNo" integer,"canonicalClaimId" text,"category" text,"claimType" text,"statement" text,"occurredAt" timestamptz,"scheduledFor" timestamptz,"confirmationStatus" text,"lifecycleStatus" text,"polarity" text,"asKnownAt" timestamptz,"committedAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  select r.fact_event_id,r.fact_revision_id,r.revision_no,e.canonical_claim_id,e.category,r.claim_type,r.statement,r.occurred_at,r.scheduled_for,r.confirmation_status,r.lifecycle_status,r.polarity,r.as_known_at,r.committed_at
    from news_core.fact_revisions r join news_core.fact_events e using (fact_event_id)
   where r.finalized_at is not null and r.as_known_at <= p_as_of and pg_xact_commit_timestamp(r.xmin) <= p_as_of
     and (coalesce(cardinality(p_targets),0)=0 or r.fact_event_id = any(p_targets) or e.canonical_claim_id = any(p_targets) or e.category = any(p_targets))
     and (p_from is null or coalesce(r.occurred_at,r.scheduled_for,r.committed_at) >= p_from)
     and (p_to is null or coalesce(r.occurred_at,r.scheduled_for,r.committed_at) <= p_to)
   order by r.fact_event_id,r.revision_no
$$;

revoke all on function news_core.read_publication_revisions_filtered_as_of(timestamptz,text,text[],text[]) from public;
revoke all on function news_core.read_fact_revisions_filtered_as_of(timestamptz,text[],text[],timestamptz,timestamptz) from public;
revoke all on function news_core.read_fact_history_filtered_as_of(timestamptz,text[],timestamptz,timestamptz) from public;
grant execute on function news_core.read_publication_revisions_filtered_as_of(timestamptz,text,text[],text[]) to news_reader,news_service;
grant execute on function news_core.read_fact_revisions_filtered_as_of(timestamptz,text[],text[],timestamptz,timestamptz) to news_reader,news_service;
grant execute on function news_core.read_fact_history_filtered_as_of(timestamptz,text[],timestamptz,timestamptz) to news_reader,news_service;
