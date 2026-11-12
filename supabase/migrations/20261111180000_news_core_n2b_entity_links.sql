create table if not exists news_core.entity_link_revisions (
  entity_link_revision_id text primary key,
  publication_revision_id text not null references news_core.publication_revisions(publication_revision_id),
  revision_no integer not null check (revision_no > 0),
  resolver_contract_version text not null check (resolver_contract_version = 'market-core-identity-v1'),
  resolver_version text not null,
  resolution_fingerprint text not null,
  target_scope text check (target_scope in ('ISSUER','INSTRUMENT','LISTING')),
  identity_status text not null check (identity_status in ('EXACT','AMBIGUOUS','UNRESOLVED','REVIEW_REQUIRED')),
  relation_type text check (relation_type in ('DIRECT','MENTION','SUBSIDIARY','INDIRECT_EXPOSURE')),
  issuer_id text,
  instrument_id text,
  listing_id text,
  reason text not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  pending_transaction_id bigint,
  ingested_at timestamptz,
  as_known_at timestamptz,
  supersedes_entity_link_revision_id text references news_core.entity_link_revisions(entity_link_revision_id),
  unique (publication_revision_id, resolver_version, resolution_fingerprint),
  check ((identity_status = 'EXACT' and
    ((target_scope = 'ISSUER' and issuer_id is not null and instrument_id is null and listing_id is null) or
     (target_scope = 'INSTRUMENT' and instrument_id is not null and listing_id is null) or
     (target_scope = 'LISTING' and listing_id is not null))) or
    (identity_status <> 'EXACT' and issuer_id is null and instrument_id is null and listing_id is null))
);

create unique index if not exists entity_link_revision_number_idx
  on news_core.entity_link_revisions(publication_revision_id, resolver_version, revision_no);
create index if not exists entity_link_revision_pit_idx
  on news_core.entity_link_revisions(publication_revision_id, visibility_state, as_known_at);

create table if not exists news_core.entity_link_candidates (
  candidate_id text primary key,
  entity_link_revision_id text not null references news_core.entity_link_revisions(entity_link_revision_id),
  candidate_ref text not null,
  target_scope text not null check (target_scope in ('ISSUER','INSTRUMENT','LISTING')),
  relation_type text not null check (relation_type in ('DIRECT','MENTION','SUBSIDIARY','INDIRECT_EXPOSURE')),
  issuer_id text,
  instrument_id text,
  listing_id text,
  candidate_payload jsonb not null,
  unique (entity_link_revision_id, candidate_ref)
);

create table if not exists news_core.entity_link_evidence (
  evidence_id text not null,
  entity_link_revision_id text not null references news_core.entity_link_revisions(entity_link_revision_id),
  candidate_id text not null references news_core.entity_link_candidates(candidate_id),
  evidence_kind text not null check (evidence_kind in ('OFFICIAL_REGISTRY','EXCHANGE_REFERENCE','PROVIDER_CATALOG','PUBLICATION_TEXT')),
  source_ref text not null,
  observed_at timestamptz not null,
  visibility_state text not null default 'PENDING' check (visibility_state in ('PENDING','COMMITTED')),
  visibility_frontier_id bigint references news_core.visibility_frontiers(frontier_id),
  pending_transaction_id bigint,
  ingested_at timestamptz,
  as_known_at timestamptz,
  primary key (evidence_id, entity_link_revision_id),
  unique (entity_link_revision_id, candidate_id, evidence_id)
);

create index if not exists entity_link_evidence_pit_idx
  on news_core.entity_link_evidence(entity_link_revision_id, visibility_state, as_known_at);

create or replace function news_core.reject_committed_entity_link_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, news_core as $$
begin
  if old.visibility_state = 'COMMITTED' then raise exception 'NEWS_ENTITY_LINK_IMMUTABLE'; end if;
  return new;
end $$;

drop trigger if exists entity_link_revision_append_only on news_core.entity_link_revisions;
create trigger entity_link_revision_append_only before update on news_core.entity_link_revisions
for each row execute function news_core.reject_committed_entity_link_mutation();
drop trigger if exists entity_link_evidence_append_only on news_core.entity_link_evidence;
create trigger entity_link_evidence_append_only before update on news_core.entity_link_evidence
for each row execute function news_core.reject_committed_entity_link_mutation();

revoke all on news_core.entity_link_revisions, news_core.entity_link_candidates, news_core.entity_link_evidence from public, news_reader;
grant select, insert, update on news_core.entity_link_revisions, news_core.entity_link_candidates, news_core.entity_link_evidence to news_service;

create or replace function news_core.seal_visibility_frontier(p_frontier_id bigint, p_published_at timestamptz)
returns timestamptz language sql volatile security definer set search_path = pg_catalog, news_core as $$
  update news_core.visibility_frontiers f set published_at=p_published_at
   where f.frontier_id=p_frontier_id and p_published_at > clock_timestamp()
     and (exists (select 1 from news_core.publications p where p.visibility_frontier_id=f.frontier_id and p.visibility_state='PENDING')
       or exists (select 1 from news_core.observations o where o.visibility_frontier_id=f.frontier_id and o.visibility_state='PENDING')
       or exists (select 1 from news_core.checkpoints c where c.visibility_frontier_id=f.frontier_id and c.visibility_state='PENDING')
       or exists (select 1 from news_core.publication_revisions r where r.visibility_frontier_id=f.frontier_id and r.visibility_state='PENDING')
       or exists (select 1 from news_core.publication_revision_provenance v where v.visibility_frontier_id=f.frontier_id and v.visibility_state='PENDING')
       or exists (select 1 from news_core.entity_link_revisions l where l.visibility_frontier_id=f.frontier_id and l.visibility_state='PENDING')
       or exists (select 1 from news_core.entity_link_evidence e where e.visibility_frontier_id=f.frontier_id and e.visibility_state='PENDING'))
  returning f.published_at
$$;
revoke all on function news_core.seal_visibility_frontier(bigint,timestamptz) from public;
grant execute on function news_core.seal_visibility_frontier(bigint,timestamptz) to news_service;

create or replace function news_core.read_entity_links_as_of(p_as_of timestamptz, p_publication_id text default null)
returns table(
  "entityLinkRevisionId" text, "publicationRevisionId" text, "revisionNo" integer,
  "targetScope" text, "identityStatus" text, "relationType" text,
  "issuerId" text, "instrumentId" text, "listingId" text,
  "resolverVersion" text, reason text, "asKnownAt" timestamptz
)
language sql stable security definer set search_path = pg_catalog, news_core as $$
  select l.entity_link_revision_id,l.publication_revision_id,l.revision_no,l.target_scope,l.identity_status,l.relation_type,
         l.issuer_id,l.instrument_id,l.listing_id,l.resolver_version,l.reason,l.as_known_at
    from news_core.entity_link_revisions l
    join news_core.publication_revisions r on r.publication_revision_id=l.publication_revision_id
    join news_core.publications p on p.publication_id=r.publication_id
    join news_core.visibility_frontiers f on f.frontier_id=l.visibility_frontier_id
   where l.visibility_state='COMMITTED' and r.visibility_state='COMMITTED' and p.visibility_state='COMMITTED'
     and l.as_known_at is not null and l.as_known_at <= p_as_of and f.published_at <= p_as_of
     and (p_publication_id is null or r.publication_id=p_publication_id)
   order by l.publication_revision_id,l.revision_no
$$;
revoke all on function news_core.read_entity_links_as_of(timestamptz,text) from public;
grant execute on function news_core.read_entity_links_as_of(timestamptz,text) to news_reader, news_service;
