-- News Core N3-C: append-only factual revisions and point-in-time reads.
-- This migration stores N3-A proposals and N3-B evaluations; it does not
-- change the N1/N2 publication or editorial models.

create table if not exists news_core.fact_events (
  fact_event_id text primary key,
  canonical_claim_id text not null unique,
  taxonomy_version text not null,
  category text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists news_core.fact_revisions (
  fact_revision_id text primary key,
  fact_event_id text not null references news_core.fact_events(fact_event_id),
  revision_no integer not null check (revision_no > 0),
  logical_fingerprint text not null,
  rule_set_version text not null,
  claim_type text not null,
  statement text not null,
  subject_ref text,
  object_ref text,
  occurred_at timestamptz,
  scheduled_for timestamptz,
  confirmation_status text not null check (confirmation_status in ('PRIMARY_CONFIRMED','CORROBORATED','REPORTED','UNVERIFIED','DISPUTED')),
  lifecycle_status text not null check (lifecycle_status in ('ACTIVE','CORRECTED','RETRACTED')),
  polarity text not null check (polarity in ('AFFIRMATIVE','NEGATIVE','UNKNOWN')),
  focal_claim_key text not null,
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  as_known_at timestamptz,
  committed_at timestamptz,
  finalized_at timestamptz,
  quality_flags jsonb not null default '[]'::jsonb,
  supersedes_revision_id text references news_core.fact_revisions(fact_revision_id),
  check (occurred_at is null or scheduled_for is null),
  check (jsonb_typeof(quality_flags) = 'array'),
  check (supersedes_revision_id is null or supersedes_revision_id <> fact_revision_id),
  unique (fact_event_id, revision_no),
  unique (fact_event_id, logical_fingerprint)
);

create table if not exists news_core.fact_revision_evidence (
  fact_revision_id text not null references news_core.fact_revisions(fact_revision_id),
  evidence_id text not null,
  evidence_kind text not null check (evidence_kind in ('N3A_PROPOSAL','N3B_EVIDENCE','N3B_PROOF')),
  claim_key text not null,
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  source_document_ref text not null,
  content_locator text not null,
  provenance_ref text not null,
  evidence_as_known_at timestamptz not null,
  primary key (fact_revision_id, evidence_id)
);

create table if not exists news_core.fact_revision_dependencies (
  fact_revision_id text not null references news_core.fact_revisions(fact_revision_id),
  dependency_type text not null check (dependency_type in ('N2_PUBLICATION_REVISION','N3A_PROPOSAL','N3B_EVALUATION','FACT_REVISION')),
  dependency_ref text not null,
  dependency_as_known_at timestamptz not null,
  primary key (fact_revision_id, dependency_type, dependency_ref)
);

create table if not exists news_core.fact_revision_publications (
  fact_revision_id text not null references news_core.fact_revisions(fact_revision_id),
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  relation_type text not null check (relation_type in ('FOCAL','CORROBORATING','CONTESTING')),
  as_known_at timestamptz not null,
  primary key (fact_revision_id, publication_revision_id, relation_type)
);

create table if not exists news_core.fact_revision_relations (
  fact_revision_id text not null references news_core.fact_revisions(fact_revision_id),
  related_revision_id text not null references news_core.fact_revisions(fact_revision_id),
  relation_type text not null check (relation_type in ('CORRECTS','CONTESTS','RETRACTS')),
  as_known_at timestamptz not null,
  primary key (fact_revision_id, related_revision_id, relation_type),
  check (fact_revision_id <> related_revision_id)
);

create index if not exists fact_revisions_pit_idx
  on news_core.fact_revisions(fact_event_id, as_known_at, committed_at, revision_no);
create index if not exists fact_revision_dependencies_pit_idx
  on news_core.fact_revision_dependencies(fact_revision_id, dependency_as_known_at);

create or replace function news_core.reject_fact_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,news_core as $$
begin
  if tg_op = 'UPDATE' and current_setting('news_core.fact_sealing', true) = 'on'
     and old.finalized_at is null and new.finalized_at is not null
     and new.fact_revision_id=old.fact_revision_id and new.fact_event_id=old.fact_event_id
     and new.revision_no=old.revision_no and new.logical_fingerprint=old.logical_fingerprint
     and new.rule_set_version=old.rule_set_version and new.claim_type=old.claim_type
     and new.statement=old.statement and new.confirmation_status=old.confirmation_status
     and new.lifecycle_status=old.lifecycle_status and new.polarity=old.polarity
     and new.focal_claim_key=old.focal_claim_key and new.publication_revision_id=old.publication_revision_id
     and new.subject_ref is not distinct from old.subject_ref and new.object_ref is not distinct from old.object_ref
     and new.occurred_at is not distinct from old.occurred_at and new.scheduled_for is not distinct from old.scheduled_for
     and new.quality_flags is not distinct from old.quality_flags and new.supersedes_revision_id is not distinct from old.supersedes_revision_id then
    return new;
  end if;
  raise exception 'NEWS_FACT_HISTORY_APPEND_ONLY' using errcode='55006';
end
$$;

create or replace function news_core.guard_fact_child_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,news_core as $$
declare finalized timestamptz;
begin
  select finalized_at into finalized from news_core.fact_revisions where fact_revision_id=new.fact_revision_id;
  if finalized is null and not found then raise exception 'NEWS_FACT_REVISION_NOT_FOUND' using errcode='23503'; end if;
  if finalized is not null then raise exception 'NEWS_FACT_REVISION_FINALIZED' using errcode='55006'; end if;
  return new;
end
$$;

create or replace function news_core.validate_fact_dependency_time()
returns trigger language plpgsql security definer set search_path=pg_catalog,news_core as $$
declare parent_known timestamptz;
begin
  select as_known_at into parent_known from news_core.fact_revisions where fact_revision_id=new.fact_revision_id;
  if not found then raise exception 'NEWS_FACT_REVISION_NOT_FOUND' using errcode='23503'; end if;
  -- The parent is open during the atomic write. Its server-assigned
  -- as_known_at is established by finalize_fact_revision after all children
  -- have been validated and inserted.
  return new;
end
$$;
drop trigger if exists fact_dependency_time_guard on news_core.fact_revision_dependencies;
create constraint trigger fact_dependency_time_guard after insert on news_core.fact_revision_dependencies
deferrable initially immediate for each row execute function news_core.validate_fact_dependency_time();

drop trigger if exists fact_events_immutable on news_core.fact_events;
create trigger fact_events_immutable before update or delete on news_core.fact_events for each row execute function news_core.reject_fact_mutation();
drop trigger if exists fact_revisions_immutable on news_core.fact_revisions;
create trigger fact_revisions_immutable before update or delete on news_core.fact_revisions for each row execute function news_core.reject_fact_mutation();
drop trigger if exists fact_revision_evidence_immutable on news_core.fact_revision_evidence;
create trigger fact_revision_evidence_immutable before update or delete on news_core.fact_revision_evidence for each row execute function news_core.reject_fact_mutation();
drop trigger if exists fact_revision_dependencies_immutable on news_core.fact_revision_dependencies;
create trigger fact_revision_dependencies_immutable before update or delete on news_core.fact_revision_dependencies for each row execute function news_core.reject_fact_mutation();
drop trigger if exists fact_revision_publications_immutable on news_core.fact_revision_publications;
create trigger fact_revision_publications_immutable before update or delete on news_core.fact_revision_publications for each row execute function news_core.reject_fact_mutation();
drop trigger if exists fact_revision_relations_immutable on news_core.fact_revision_relations;
create trigger fact_revision_relations_immutable before update or delete on news_core.fact_revision_relations for each row execute function news_core.reject_fact_mutation();
drop trigger if exists fact_revision_evidence_open_guard on news_core.fact_revision_evidence;
create trigger fact_revision_evidence_open_guard before insert on news_core.fact_revision_evidence for each row execute function news_core.guard_fact_child_insert();
drop trigger if exists fact_revision_dependencies_open_guard on news_core.fact_revision_dependencies;
create trigger fact_revision_dependencies_open_guard before insert on news_core.fact_revision_dependencies for each row execute function news_core.guard_fact_child_insert();
drop trigger if exists fact_revision_publications_open_guard on news_core.fact_revision_publications;
create trigger fact_revision_publications_open_guard before insert on news_core.fact_revision_publications for each row execute function news_core.guard_fact_child_insert();
drop trigger if exists fact_revision_relations_open_guard on news_core.fact_revision_relations;
create trigger fact_revision_relations_open_guard before insert on news_core.fact_revision_relations for each row execute function news_core.guard_fact_child_insert();

alter table news_core.fact_events enable row level security;
alter table news_core.fact_events force row level security;
alter table news_core.fact_revisions enable row level security;
alter table news_core.fact_revisions force row level security;
alter table news_core.fact_revision_evidence enable row level security;
alter table news_core.fact_revision_evidence force row level security;
alter table news_core.fact_revision_dependencies enable row level security;
alter table news_core.fact_revision_dependencies force row level security;
alter table news_core.fact_revision_publications enable row level security;
alter table news_core.fact_revision_publications force row level security;
alter table news_core.fact_revision_relations enable row level security;
alter table news_core.fact_revision_relations force row level security;

revoke all on news_core.fact_events,news_core.fact_revisions,news_core.fact_revision_evidence,news_core.fact_revision_dependencies,news_core.fact_revision_publications,news_core.fact_revision_relations from public,news_reader;
grant usage on schema news_core to news_service,news_reader;
grant select,insert on news_core.fact_events,news_core.fact_revisions,news_core.fact_revision_evidence,news_core.fact_revision_dependencies,news_core.fact_revision_publications,news_core.fact_revision_relations to news_service;

create policy fact_events_service on news_core.fact_events for all to news_service using (true) with check (true);
create policy fact_revisions_service on news_core.fact_revisions for all to news_service using (true) with check (true);
create policy fact_revision_evidence_service on news_core.fact_revision_evidence for all to news_service using (true) with check (true);
create policy fact_revision_dependencies_service on news_core.fact_revision_dependencies for all to news_service using (true) with check (true);
create policy fact_revision_publications_service on news_core.fact_revision_publications for all to news_service using (true) with check (true);
create policy fact_revision_relations_service on news_core.fact_revision_relations for all to news_service using (true) with check (true);

create or replace function news_core.finalize_fact_revision(p_fact_revision_id text)
returns table(as_known_at timestamptz, committed_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog,news_core as $$
declare dependency_max timestamptz;
declare server_now timestamptz;
begin
  perform set_config('news_core.fact_sealing','on',true);
  select clock_timestamp() into server_now;
  select greatest(
    coalesce((select max(dependency_as_known_at) from fact_revision_dependencies where fact_revision_id=p_fact_revision_id), '-infinity'::timestamptz),
    coalesce((select max(evidence_as_known_at) from fact_revision_evidence where fact_revision_id=p_fact_revision_id), '-infinity'::timestamptz),
    coalesce((select max(as_known_at) from fact_revision_publications where fact_revision_id=p_fact_revision_id), '-infinity'::timestamptz),
    coalesce((select max(as_known_at) from fact_revision_relations where fact_revision_id=p_fact_revision_id), '-infinity'::timestamptz)
  ) into dependency_max;
  if dependency_max > server_now then raise exception 'NEWS_FACT_FUTURE_DEPENDENCY' using errcode='22023'; end if;
  if not exists(select 1 from fact_revisions where fact_revision_id=p_fact_revision_id and finalized_at is null) then
    raise exception 'NEWS_FACT_REVISION_NOT_OPEN' using errcode='55006';
  end if;
  return query update fact_revisions as fr
    set as_known_at=greatest(server_now,coalesce(dependency_max, '-infinity'::timestamptz)),
        committed_at=clock_timestamp(), finalized_at=clock_timestamp()
    where fr.fact_revision_id=p_fact_revision_id and fr.finalized_at is null
    returning fr.as_known_at,fr.committed_at;
end
$$;
revoke all on function news_core.finalize_fact_revision(text) from public,news_reader;
grant execute on function news_core.finalize_fact_revision(text) to news_service;

create or replace function news_core.read_fact_revisions_as_of(p_as_of timestamptz)
returns table("factEventId" text,"factRevisionId" text,"revisionNo" integer,"canonicalClaimId" text,"category" text,"claimType" text,"statement" text,"occurredAt" timestamptz,"scheduledFor" timestamptz,"confirmationStatus" text,"lifecycleStatus" text,"polarity" text,"asKnownAt" timestamptz,"committedAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
  with visible as (
    select r.*,e.canonical_claim_id,e.category,
           row_number() over (partition by r.fact_event_id order by r.as_known_at desc,r.revision_no desc,r.committed_at desc) as n
      from news_core.fact_revisions r join news_core.fact_events e using (fact_event_id)
     where r.finalized_at is not null and r.as_known_at <= p_as_of and r.committed_at <= p_as_of
  )
  select fact_event_id,fact_revision_id,revision_no,canonical_claim_id,category,claim_type,statement,occurred_at,scheduled_for,confirmation_status,lifecycle_status,polarity,as_known_at,committed_at
    from visible where n=1 order by fact_event_id
$$;
revoke all on function news_core.read_fact_revisions_as_of(timestamptz) from public;
grant execute on function news_core.read_fact_revisions_as_of(timestamptz) to news_reader,news_service;
