-- N3-C production writer boundary.
-- The application capability may call one validated entry point only.  It must
-- not be able to stage or seal arbitrary factual rows with direct SQL.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'news_factual_attestor') then
    create role news_factual_attestor nologin nocreatedb nocreaterole noinherit;
  end if;
end $$;

create table if not exists news_core.fact_pipeline_attestations (
  attestation_id text primary key,
  canonical_claim_id text not null,
  logical_fingerprint text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  issued_at timestamptz not null default clock_timestamp(),
  unique (canonical_claim_id, logical_fingerprint)
);

alter table news_core.fact_pipeline_attestations enable row level security;
alter table news_core.fact_pipeline_attestations force row level security;
revoke all on news_core.fact_pipeline_attestations from public,news_reader,news_service,news_factual_writer,news_factual_attestor;
grant usage on schema news_core to news_factual_attestor;

create or replace function news_core.issue_fact_attestation_v1(p_payload jsonb)
returns text language plpgsql volatile security definer set search_path=pg_catalog,news_core as $$
declare attestation_id text;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or nullif(p_payload->>'canonicalClaimId','') is null
     or nullif(p_payload->>'logicalFingerprint','') is null
     or nullif(p_payload->>'publicationRevisionId','') is null
     or jsonb_typeof(coalesce(p_payload->'evidence','[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'dependencies','[]'::jsonb)) <> 'array' then
    raise exception 'NEWS_FACT_ATTESTATION_INVALID' using errcode='22023';
  end if;
  attestation_id := md5(clock_timestamp()::text || random()::text || p_payload::text);
  insert into news_core.fact_pipeline_attestations(attestation_id,canonical_claim_id,logical_fingerprint,payload)
  values (attestation_id,p_payload->>'canonicalClaimId',p_payload->>'logicalFingerprint',p_payload)
  on conflict (canonical_claim_id,logical_fingerprint) do nothing
  returning fact_pipeline_attestations.attestation_id into attestation_id;
  if attestation_id is null then
    select a.attestation_id into attestation_id
      from news_core.fact_pipeline_attestations a
     where a.canonical_claim_id=p_payload->>'canonicalClaimId'
       and a.logical_fingerprint=p_payload->>'logicalFingerprint';
  end if;
  return attestation_id;
end
$$;
revoke all on function news_core.issue_fact_attestation_v1(jsonb) from public,news_reader,news_service,news_factual_writer;
grant execute on function news_core.issue_fact_attestation_v1(jsonb) to news_factual_attestor;

create or replace function news_core.persist_fact_revision_v1(p_input jsonb)
returns table(inserted boolean, fact_event_id text, fact_revision_id text, revision_no integer, logical_fingerprint text)
language plpgsql volatile security definer set search_path=pg_catalog,news_core as $$
declare
  p jsonb := p_input;
  attestation jsonb;
  event_id text;
  revision_id text;
  next_revision integer;
  existing record;
  publication record;
  dependency_max timestamptz;
  server_now timestamptz := clock_timestamp();
  evidence jsonb;
  dependency jsonb;
  relation jsonb;
  focal_publication record;
begin
  select a.payload into attestation
    from news_core.fact_pipeline_attestations a
   where a.attestation_id=p->>'attestationId';
  if not found then
    raise exception 'NEWS_FACT_ATTESTATION_REQUIRED' using errcode='42501';
  end if;
  if (p - 'attestationId' - 'seal') <> attestation then
    raise exception 'NEWS_FACT_ATTESTATION_MISMATCH' using errcode='22023';
  end if;
  p := attestation || jsonb_build_object('attestationId',p->>'attestationId','seal',false);
  if jsonb_typeof(p) <> 'object' then
    raise exception 'NEWS_FACT_WRITE_INPUT_INVALID' using errcode='22023';
  end if;
  if nullif(p->>'canonicalClaimId','') is null or nullif(p->>'logicalFingerprint','') is null then
    raise exception 'NEWS_FACT_WRITE_IDENTITY_REQUIRED' using errcode='22023';
  end if;
  if p->>'confirmationStatus' not in ('REPORTED','UNVERIFIED') then
    raise exception 'NEWS_FACT_CONFIRMATION_REQUIRES_ATTESTED_SERVER_RECEIPT' using errcode='42501';
  end if;
  if p->>'lifecycleStatus' not in ('ACTIVE','CORRECTED','RETRACTED')
     or p->>'polarity' not in ('AFFIRMATIVE','NEGATIVE','UNKNOWN') then
    raise exception 'NEWS_FACT_STATE_INVALID' using errcode='22023';
  end if;
  if p->>'lifecycleStatus'='CORRECTED'
     and (jsonb_typeof(p->'relation') <> 'object' or p->'relation'->>'relationType' <> 'CORRECTS') then
    raise exception 'NEWS_FACT_CORRECTION_RELATION_REQUIRED' using errcode='22023';
  end if;
  if p->>'lifecycleStatus'='RETRACTED'
     and (jsonb_typeof(p->'relation') <> 'object' or p->'relation'->>'relationType' <> 'RETRACTS') then
    raise exception 'NEWS_FACT_RETRACTION_RELATION_REQUIRED' using errcode='22023';
  end if;
  if (p->>'occurredAt') is not null and (p->>'scheduledFor') is not null then
    raise exception 'NEWS_FACT_TEMPORAL_FIELDS_CONFLICT' using errcode='22023';
  end if;

  select pr.source_document_ref, pr.as_known_at, pr.visibility_state
    into focal_publication
    from news_core.publication_revisions pr
   where pr.publication_revision_id=p->>'publicationRevisionId';
  if not found or focal_publication.visibility_state <> 'COMMITTED' or focal_publication.as_known_at is null then
    raise exception 'NEWS_FACT_PUBLICATION_REVISION_INVALID' using errcode='23503';
  end if;

  if jsonb_typeof(coalesce(p->'evidence','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p->'evidence','[]'::jsonb)) = 0
     or jsonb_typeof(coalesce(p->'dependencies','[]'::jsonb)) <> 'array' then
    raise exception 'NEWS_FACT_EVIDENCE_DEPENDENCIES_REQUIRED' using errcode='22023';
  end if;

  for evidence in select value from jsonb_array_elements(p->'evidence') loop
    if nullif(evidence->>'evidenceId','') is null
       or nullif(evidence->>'publicationRevisionId','') is null
       or nullif(evidence->>'sourceDocumentRef','') is null
       or nullif(evidence->>'asKnownAt','') is null then
      raise exception 'NEWS_FACT_EVIDENCE_INVALID' using errcode='22023';
    end if;
    select pr.source_document_ref, pr.as_known_at, pr.visibility_state
      into publication
      from news_core.publication_revisions pr
     where pr.publication_revision_id=evidence->>'publicationRevisionId';
    if not found or publication.visibility_state <> 'COMMITTED' then
      raise exception 'NEWS_FACT_EVIDENCE_REFERENCE_INVALID' using errcode='22023';
    end if;
    if publication.source_document_ref <> evidence->>'sourceDocumentRef' then
      raise exception 'NEWS_FACT_EVIDENCE_SOURCE_MISMATCH' using errcode='22023';
    end if;
    if (evidence->>'asKnownAt')::timestamptz < publication.as_known_at
       or (evidence->>'asKnownAt')::timestamptz > server_now then
      raise exception 'NEWS_FACT_EVIDENCE_TIME_INVALID' using errcode='22023';
    end if;
  end loop;

  if not exists (
    select 1 from jsonb_array_elements(p->'dependencies') d
     where d->>'dependencyType'='N2_PUBLICATION_REVISION'
       and d->>'dependencyRef'=p->>'publicationRevisionId'
  ) then
    raise exception 'NEWS_FACT_N2_DEPENDENCY_REQUIRED' using errcode='22023';
  end if;
  for dependency in select value from jsonb_array_elements(p->'dependencies') loop
    if nullif(dependency->>'dependencyRef','') is null
       or nullif(dependency->>'asKnownAt','') is null
       or (dependency->>'asKnownAt')::timestamptz > server_now then
      raise exception 'NEWS_FACT_FUTURE_DEPENDENCY' using errcode='22023';
    end if;
  end loop;
  select greatest(
    coalesce((select max((d->>'asKnownAt')::timestamptz) from jsonb_array_elements(p->'dependencies') d), '-infinity'::timestamptz),
    coalesce((select max((e->>'asKnownAt')::timestamptz) from jsonb_array_elements(p->'evidence') e), '-infinity'::timestamptz),
    focal_publication.as_known_at
  ) into dependency_max;

  insert into news_core.fact_events(fact_event_id,canonical_claim_id,taxonomy_version,category)
  values (p->>'canonicalClaimId',p->>'canonicalClaimId',p->>'taxonomyVersion',p->>'category')
  on conflict (canonical_claim_id) do nothing;
  select fe.fact_event_id into event_id from news_core.fact_events fe where fe.canonical_claim_id=p->>'canonicalClaimId';
  perform pg_advisory_xact_lock(hashtextextended(event_id, 20261112));

  select fr.fact_revision_id, fr.revision_no, fr.finalized_at into existing
    from news_core.fact_revisions fr
   where fr.fact_event_id=event_id and fr.logical_fingerprint=p->>'logicalFingerprint';
  if found then
    if existing.finalized_at is null and coalesce((p->>'seal')::boolean,false) then
      perform news_core.finalize_fact_revision(existing.fact_revision_id);
    end if;
    return query select false,event_id,existing.fact_revision_id,existing.revision_no,p->>'logicalFingerprint';
    return;
  end if;

  select coalesce(max(fr.revision_no),0)+1 into next_revision from news_core.fact_revisions fr where fr.fact_event_id=event_id;
  revision_id := event_id || ':revision:' || next_revision::text;
  insert into news_core.fact_revisions(
    fact_revision_id,fact_event_id,revision_no,logical_fingerprint,rule_set_version,claim_type,statement,
    subject_ref,object_ref,occurred_at,scheduled_for,confirmation_status,lifecycle_status,polarity,
    focal_claim_key,publication_revision_id,quality_flags,supersedes_revision_id
  ) values (
    revision_id,event_id,next_revision,p->>'logicalFingerprint',p->>'ruleSetVersion',p->>'claimType',p->>'statement',
    nullif(p->>'subjectRef',''),nullif(p->>'objectRef',''),nullif(p->>'occurredAt','')::timestamptz,
    nullif(p->>'scheduledFor','')::timestamptz,p->>'confirmationStatus',p->>'lifecycleStatus',p->>'polarity',
    p->>'focalClaimKey',p->>'publicationRevisionId',coalesce(p->'qualityFlags','[]'::jsonb),
    case when next_revision > 1 then event_id || ':revision:' || (next_revision-1)::text end
  );
  for evidence in select value from jsonb_array_elements(p->'evidence') loop
    insert into news_core.fact_revision_evidence(fact_revision_id,evidence_id,evidence_kind,claim_key,publication_revision_id,source_document_ref,content_locator,provenance_ref,evidence_as_known_at)
    values (revision_id,evidence->>'evidenceId',evidence->>'evidenceKind',evidence->>'claimKey',evidence->>'publicationRevisionId',evidence->>'sourceDocumentRef',evidence->>'contentLocator',evidence->>'provenanceRef',(evidence->>'asKnownAt')::timestamptz);
  end loop;
  for dependency in select value from jsonb_array_elements(p->'dependencies') loop
    insert into news_core.fact_revision_dependencies(fact_revision_id,dependency_type,dependency_ref,dependency_as_known_at)
    values (revision_id,dependency->>'dependencyType',dependency->>'dependencyRef',(dependency->>'asKnownAt')::timestamptz);
  end loop;
  insert into news_core.fact_revision_publications(fact_revision_id,publication_revision_id,relation_type,as_known_at)
  values (revision_id,p->>'publicationRevisionId','FOCAL',focal_publication.as_known_at);
  relation := p->'relation';
  if relation is not null and jsonb_typeof(relation)='object' then
    if not exists (select 1 from news_core.fact_revisions fr where fr.fact_revision_id=relation->>'relatedRevisionId' and fr.finalized_at is not null) then
      raise exception 'NEWS_FACT_RELATION_INVALID' using errcode='23503';
    end if;
    insert into news_core.fact_revision_relations(fact_revision_id,related_revision_id,relation_type,as_known_at)
    values (revision_id,relation->>'relatedRevisionId',relation->>'relationType',dependency_max);
  end if;
  if coalesce((p->>'seal')::boolean,false) then
    perform news_core.finalize_fact_revision(revision_id);
  end if;
  return query select true,event_id,revision_id,next_revision,p->>'logicalFingerprint';
end
$$;

create or replace function news_core.publish_fact_revision_v1(p_fact_revision_id text,p_attestation_id text)
returns table(assigned_as_known_at timestamptz, assigned_committed_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog,news_core as $$
declare attestation jsonb;
begin
  select a.payload into attestation from news_core.fact_pipeline_attestations a where a.attestation_id=p_attestation_id;
  if not found or not exists (
    select 1 from news_core.fact_revisions fr
    join news_core.fact_events fe using (fact_event_id)
    where fr.fact_revision_id=p_fact_revision_id and fr.finalized_at is null
      and fe.canonical_claim_id=attestation->>'canonicalClaimId'
      and fr.logical_fingerprint=attestation->>'logicalFingerprint'
      and fr.statement=attestation->>'statement'
      and fr.publication_revision_id=attestation->>'publicationRevisionId'
  ) then
    raise exception 'NEWS_FACT_REVISION_NOT_AUTHORIZED' using errcode='42501';
  end if;
  return query select * from news_core.finalize_fact_revision(p_fact_revision_id);
end
$$;

revoke all on news_core.fact_events,news_core.fact_revisions,news_core.fact_revision_evidence,
  news_core.fact_revision_dependencies,news_core.fact_revision_publications,news_core.fact_revision_relations
  from news_factual_writer;
revoke all on function news_core.finalize_fact_revision(text) from news_factual_writer;
revoke all on function news_core.persist_fact_revision_v1(jsonb),news_core.publish_fact_revision_v1(text,text) from public,news_reader,news_service;
grant execute on function news_core.persist_fact_revision_v1(jsonb),news_core.publish_fact_revision_v1(text,text) to news_factual_writer;
