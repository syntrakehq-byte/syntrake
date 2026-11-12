-- N5 read-only contract. No direct table privileges are added.
create or replace function news_core.read_fact_history_as_of(p_as_of timestamptz, p_fact_event_id text)
returns table("factEventId" text,"factRevisionId" text,"revisionNo" integer,"canonicalClaimId" text,"category" text,"claimType" text,"statement" text,"occurredAt" timestamptz,"scheduledFor" timestamptz,"confirmationStatus" text,"lifecycleStatus" text,"polarity" text,"asKnownAt" timestamptz,"committedAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  select r.fact_event_id,r.fact_revision_id,r.revision_no,e.canonical_claim_id,e.category,r.claim_type,r.statement,r.occurred_at,r.scheduled_for,r.confirmation_status,r.lifecycle_status,r.polarity,r.as_known_at,r.committed_at
    from news_core.fact_revisions r join news_core.fact_events e using (fact_event_id)
   where r.fact_event_id=p_fact_event_id and r.finalized_at is not null
     and r.as_known_at <= p_as_of and r.committed_at <= p_as_of
   order by r.revision_no
$$;

create or replace function news_core.read_fact_evidence_as_of(p_as_of timestamptz, p_fact_revision_id text)
returns table("factRevisionId" text,"evidenceId" text,"evidenceKind" text,"claimKey" text,"publicationRevisionId" text,"sourceDocumentRef" text,"contentLocator" text,"provenanceRef" text,"asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  select e.fact_revision_id,e.evidence_id,e.evidence_kind,e.claim_key,e.publication_revision_id,e.source_document_ref,e.content_locator,e.provenance_ref,e.evidence_as_known_at
    from news_core.fact_revision_evidence e join news_core.fact_revisions r using (fact_revision_id)
   where e.fact_revision_id=p_fact_revision_id and r.finalized_at is not null
     and r.as_known_at <= p_as_of and r.committed_at <= p_as_of
     and e.evidence_as_known_at <= p_as_of
   order by e.evidence_id
$$;

revoke all on function news_core.read_fact_history_as_of(timestamptz,text) from public;
revoke all on function news_core.read_fact_evidence_as_of(timestamptz,text) from public;
grant execute on function news_core.read_fact_history_as_of(timestamptz,text) to news_reader,news_service;
grant execute on function news_core.read_fact_evidence_as_of(timestamptz,text) to news_reader,news_service;
