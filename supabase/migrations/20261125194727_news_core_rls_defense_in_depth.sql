-- Defense-in-depth for the private News Core schema.
-- Existing table grants remain the authority for reachability; these policies
-- only constrain rows for the already-segregated internal roles.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sources',
    'visibility_frontiers',
    'publications',
    'observations',
    'checkpoints',
    'collection_targets',
    'executions',
    'publication_revisions',
    'publication_revision_provenance',
    'entity_link_candidates',
    'entity_link_revisions',
    'entity_link_evidence',
    'editorial_group_revisions',
    'editorial_group_members',
    'editorial_group_evidence',
    'publication_event_link_revisions',
    'publication_event_link_members',
    'publication_event_link_evidence',
    'factual_pipeline_backlog',
    'global_news_consumer_cursors',
    'global_operational_state'
  ] loop
    execute format('alter table news_core.%I enable row level security', table_name);
    execute format(
      'create policy %I on news_core.%I for all to news_service using (true) with check (true)',
      table_name || '_news_service', table_name
    );
  end loop;
end
$$;

-- The read role is intentionally limited to operational health state at table
-- level. Consumer data is exposed only through the versioned SECURITY DEFINER
-- read functions whose EXECUTE grants are already explicit.
create policy global_operational_state_news_reader
  on news_core.global_operational_state
  for select to news_reader
  using (true);

-- The factual writer may inspect publication revisions while all factual
-- writes remain behind the existing writer-boundary functions.
create policy publication_revisions_factual_writer
  on news_core.publication_revisions
  for select to news_factual_writer
  using (true);

-- These tables are callable only through their existing SECURITY DEFINER
-- boundary functions. Policies make the intended role boundary explicit
-- without granting table privileges to those roles.
create policy fact_pipeline_attestations_attestor
  on news_core.fact_pipeline_attestations
  for all to news_factual_attestor
  using (true) with check (true);

create policy fact_pipeline_verifications_verifier
  on news_core.fact_pipeline_verifications
  for all to news_pipeline_verifier
  using (true) with check (true);
