-- News Core N2-C: conservative editorial equivalence and structural relations.
-- This migration never asserts factual event confirmation and never mutates N1/N2-A/N2-B history.

create table if not exists news_core.editorial_group_revisions (
  editorial_group_revision_id text primary key,
  group_id text not null check (group_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  revision_no integer not null check (revision_no > 0),
  resolver_contract_version text not null check (resolver_contract_version='news-editorial-relations-v1'),
  resolver_version text not null,
  resolution_fingerprint text not null,
  operation text not null check (operation in ('ACTIVE','SEPARATED')),
  match_status text not null check (match_status in ('EXACT','AMBIGUOUS','UNRESOLVED','REVIEW_REQUIRED')),
  relation_type text not null check (relation_type in ('SAME_ORIGIN','REPUBLICATION','TRANSLATION','POSSIBLE_DUPLICATE')),
  reason text not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  ingested_at timestamptz,
  as_known_at timestamptz,
  supersedes_editorial_group_revision_id text references news_core.editorial_group_revisions(editorial_group_revision_id),
  unique (group_id,resolver_version,resolution_fingerprint),
  unique (group_id,resolver_version,revision_no),
  check (operation <> 'SEPARATED' or match_status <> 'EXACT')
);

create table if not exists news_core.editorial_group_members (
  editorial_group_revision_id text not null references news_core.editorial_group_revisions(editorial_group_revision_id),
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  primary key (editorial_group_revision_id,publication_revision_id)
);

create table if not exists news_core.editorial_group_evidence (
  editorial_group_revision_id text not null references news_core.editorial_group_revisions(editorial_group_revision_id),
  evidence_id text not null,
  evidence_kind text not null check (evidence_kind in ('OFFICIAL_SOURCE','PROVIDER_SOURCE','SYNDICATION_METADATA','PUBLICATION_TEXT')),
  source_ref text not null,
  observed_at timestamptz not null,
  verified boolean not null,
  primary key (editorial_group_revision_id,evidence_id)
);

create table if not exists news_core.publication_event_link_revisions (
  publication_event_link_revision_id text primary key,
  structural_event_id text not null check (structural_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  revision_no integer not null check (revision_no > 0),
  resolver_contract_version text not null check (resolver_contract_version='news-structural-event-links-v1'),
  resolver_version text not null,
  resolution_fingerprint text not null,
  operation text not null check (operation in ('ACTIVE','SEPARATED')),
  match_status text not null check (match_status in ('EXACT','AMBIGUOUS','UNRESOLVED','REVIEW_REQUIRED')),
  relation_type text not null check (relation_type in ('RELATED','SAME_STRUCTURAL_ORIGIN','POSSIBLE_RELATION')),
  reason text not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  pending_transaction_id bigint,
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  ingested_at timestamptz,
  as_known_at timestamptz,
  supersedes_publication_event_link_revision_id text references news_core.publication_event_link_revisions(publication_event_link_revision_id),
  unique (structural_event_id,resolver_version,resolution_fingerprint),
  unique (structural_event_id,resolver_version,revision_no),
  check (operation <> 'SEPARATED' or match_status <> 'EXACT')
);

create table if not exists news_core.publication_event_link_members (
  publication_event_link_revision_id text not null references news_core.publication_event_link_revisions(publication_event_link_revision_id),
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  primary key (publication_event_link_revision_id,publication_revision_id)
);

create table if not exists news_core.publication_event_link_evidence (
  publication_event_link_revision_id text not null references news_core.publication_event_link_revisions(publication_event_link_revision_id),
  evidence_id text not null,
  evidence_kind text not null check (evidence_kind in ('OFFICIAL_SOURCE','PROVIDER_SOURCE','SYNDICATION_METADATA','PUBLICATION_TEXT')),
  source_ref text not null,
  observed_at timestamptz not null,
  verified boolean not null,
  primary key (publication_event_link_revision_id,evidence_id)
);

create index if not exists editorial_group_members_publication_idx on news_core.editorial_group_members(publication_revision_id);
create index if not exists editorial_group_pit_idx on news_core.editorial_group_revisions(group_id,resolver_version,visibility_state,as_known_at,revision_no);
create index if not exists event_link_members_publication_idx on news_core.publication_event_link_members(publication_revision_id);
create index if not exists event_link_pit_idx on news_core.publication_event_link_revisions(structural_event_id,resolver_version,visibility_state,as_known_at,revision_no);

create or replace function news_core.reject_committed_editorial_relation_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,news_core as $$
begin
  if old.visibility_state='COMMITTED' then raise exception 'NEWS_EDITORIAL_RELATION_IMMUTABLE'; end if;
  return new;
end $$;

drop trigger if exists editorial_group_revision_append_only on news_core.editorial_group_revisions;
create trigger editorial_group_revision_append_only before update on news_core.editorial_group_revisions
for each row execute function news_core.reject_committed_editorial_relation_mutation();
drop trigger if exists publication_event_link_revision_append_only on news_core.publication_event_link_revisions;
create trigger publication_event_link_revision_append_only before update on news_core.publication_event_link_revisions
for each row execute function news_core.reject_committed_editorial_relation_mutation();

revoke all on news_core.editorial_group_revisions,news_core.editorial_group_members,news_core.editorial_group_evidence,news_core.publication_event_link_revisions,news_core.publication_event_link_members,news_core.publication_event_link_evidence from public,news_reader;
grant select,insert,update on news_core.editorial_group_revisions,news_core.editorial_group_evidence,news_core.publication_event_link_revisions,news_core.publication_event_link_evidence to news_service;
grant select,insert on news_core.editorial_group_members,news_core.publication_event_link_members to news_service;
revoke update,delete on news_core.editorial_group_members,news_core.editorial_group_evidence,news_core.publication_event_link_members,news_core.publication_event_link_evidence from news_service;

create or replace function news_core.seal_visibility_frontier(p_frontier_id bigint,p_published_at timestamptz)
returns timestamptz language sql volatile security definer set search_path=pg_catalog,news_core as $$
  update news_core.visibility_frontiers f set published_at=p_published_at
   where f.frontier_id=p_frontier_id and p_published_at>clock_timestamp()
     and (exists(select 1 from news_core.publications p where p.visibility_frontier_id=f.frontier_id and p.visibility_state='PENDING')
       or exists(select 1 from news_core.observations o where o.visibility_frontier_id=f.frontier_id and o.visibility_state='PENDING')
       or exists(select 1 from news_core.checkpoints c where c.visibility_frontier_id=f.frontier_id and c.visibility_state='PENDING')
       or exists(select 1 from news_core.publication_revisions r where r.visibility_frontier_id=f.frontier_id and r.visibility_state='PENDING')
       or exists(select 1 from news_core.publication_revision_provenance v where v.visibility_frontier_id=f.frontier_id and v.visibility_state='PENDING')
       or exists(select 1 from news_core.entity_link_revisions l where l.visibility_frontier_id=f.frontier_id and l.visibility_state='PENDING')
       or exists(select 1 from news_core.entity_link_evidence e where e.visibility_frontier_id=f.frontier_id and e.visibility_state='PENDING')
       or exists(select 1 from news_core.editorial_group_revisions g where g.visibility_frontier_id=f.frontier_id and g.visibility_state='PENDING')
       or exists(select 1 from news_core.publication_event_link_revisions l where l.visibility_frontier_id=f.frontier_id and l.visibility_state='PENDING'))
  returning f.published_at
$$;
revoke all on function news_core.seal_visibility_frontier(bigint,timestamptz) from public;
grant execute on function news_core.seal_visibility_frontier(bigint,timestamptz) to news_service;

create or replace function news_core.read_editorial_group_history_as_of(p_as_of timestamptz,p_publication_revision_id text default null)
returns table("editorialGroupRevisionId" text,"groupId" text,"revisionNo" integer,"resolverVersion" text,"operation" text,"matchStatus" text,"relationType" text,reason text,"publicationRevisionId" text,"asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
 select g.editorial_group_revision_id,g.group_id,g.revision_no,g.resolver_version,g.operation,g.match_status,g.relation_type,g.reason,m.publication_revision_id,g.as_known_at
 from news_core.editorial_group_revisions g
 join news_core.editorial_group_members m on m.editorial_group_revision_id=g.editorial_group_revision_id
 join news_core.publication_revisions r on r.publication_revision_id=m.publication_revision_id
 join news_core.publications p on p.publication_id=r.publication_id
 join news_core.visibility_frontiers gf on gf.frontier_id=g.visibility_frontier_id
 join news_core.visibility_frontiers rf on rf.frontier_id=r.visibility_frontier_id
 join news_core.visibility_frontiers pf on pf.frontier_id=p.visibility_frontier_id
 where g.visibility_state='COMMITTED' and r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED'
   and g.as_known_at is not null and g.as_known_at<=p_as_of and r.as_known_at is not null and r.as_known_at<=p_as_of and p.as_known_at is not null and p.as_known_at<=p_as_of
   and gf.published_at<=p_as_of and rf.published_at<=p_as_of and pf.published_at<=p_as_of
   and not exists(select 1 from news_core.editorial_group_evidence e where e.editorial_group_revision_id=g.editorial_group_revision_id and e.observed_at>p_as_of)
   and (p_publication_revision_id is null or m.publication_revision_id=p_publication_revision_id)
 order by g.group_id,g.resolver_version,g.revision_no,m.publication_revision_id
$$;

create or replace function news_core.read_editorial_groups_as_of(p_as_of timestamptz,p_publication_revision_id text default null)
returns table("editorialGroupRevisionId" text,"groupId" text,"revisionNo" integer,"resolverVersion" text,"operation" text,"matchStatus" text,"relationType" text,reason text,"publicationRevisionId" text,"asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
 with history as (select * from news_core.read_editorial_group_history_as_of(p_as_of,null)),
 latest as (select distinct on ("groupId","resolverVersion") "editorialGroupRevisionId" from history order by "groupId","resolverVersion","revisionNo" desc)
 select h.* from history h join latest l on l."editorialGroupRevisionId"=h."editorialGroupRevisionId"
  where h.operation='ACTIVE'
    and (p_publication_revision_id is null or h."publicationRevisionId"=p_publication_revision_id)
$$;

create or replace function news_core.read_structural_event_link_history_as_of(p_as_of timestamptz,p_publication_revision_id text default null)
returns table("publicationEventLinkRevisionId" text,"structuralEventId" text,"revisionNo" integer,"resolverVersion" text,"operation" text,"matchStatus" text,"relationType" text,reason text,"publicationRevisionId" text,"asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
 select l.publication_event_link_revision_id,l.structural_event_id,l.revision_no,l.resolver_version,l.operation,l.match_status,l.relation_type,l.reason,m.publication_revision_id,l.as_known_at
 from news_core.publication_event_link_revisions l
 join news_core.publication_event_link_members m on m.publication_event_link_revision_id=l.publication_event_link_revision_id
 join news_core.publication_revisions r on r.publication_revision_id=m.publication_revision_id
 join news_core.publications p on p.publication_id=r.publication_id
 join news_core.visibility_frontiers lf on lf.frontier_id=l.visibility_frontier_id
 join news_core.visibility_frontiers rf on rf.frontier_id=r.visibility_frontier_id
 join news_core.visibility_frontiers pf on pf.frontier_id=p.visibility_frontier_id
 where l.visibility_state='COMMITTED' and r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED'
   and l.as_known_at is not null and l.as_known_at<=p_as_of and r.as_known_at is not null and r.as_known_at<=p_as_of and p.as_known_at is not null and p.as_known_at<=p_as_of
   and lf.published_at<=p_as_of and rf.published_at<=p_as_of and pf.published_at<=p_as_of
   and not exists(select 1 from news_core.publication_event_link_evidence e where e.publication_event_link_revision_id=l.publication_event_link_revision_id and e.observed_at>p_as_of)
   and (p_publication_revision_id is null or m.publication_revision_id=p_publication_revision_id)
 order by l.structural_event_id,l.resolver_version,l.revision_no,m.publication_revision_id
$$;

create or replace function news_core.read_structural_event_links_as_of(p_as_of timestamptz,p_publication_revision_id text default null)
returns table("publicationEventLinkRevisionId" text,"structuralEventId" text,"revisionNo" integer,"resolverVersion" text,"operation" text,"matchStatus" text,"relationType" text,reason text,"publicationRevisionId" text,"asKnownAt" timestamptz)
language sql stable security definer set search_path=pg_catalog,news_core as $$
 with history as (select * from news_core.read_structural_event_link_history_as_of(p_as_of,null)),
 latest as (select distinct on ("structuralEventId","resolverVersion") "publicationEventLinkRevisionId" from history order by "structuralEventId","resolverVersion","revisionNo" desc)
 select h.* from history h join latest l on l."publicationEventLinkRevisionId"=h."publicationEventLinkRevisionId"
  where h.operation='ACTIVE'
    and (p_publication_revision_id is null or h."publicationRevisionId"=p_publication_revision_id)
$$;

revoke all on function news_core.read_editorial_group_history_as_of(timestamptz,text),news_core.read_editorial_groups_as_of(timestamptz,text),news_core.read_structural_event_link_history_as_of(timestamptz,text),news_core.read_structural_event_links_as_of(timestamptz,text) from public;
grant execute on function news_core.read_editorial_group_history_as_of(timestamptz,text),news_core.read_editorial_groups_as_of(timestamptz,text),news_core.read_structural_event_link_history_as_of(timestamptz,text),news_core.read_structural_event_links_as_of(timestamptz,text) to news_reader,news_service;
