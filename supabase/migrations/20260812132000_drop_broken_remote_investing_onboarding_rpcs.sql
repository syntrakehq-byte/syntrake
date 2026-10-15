-- These remote-only onboarding RPCs are not referenced by the application and
-- currently fail schema lint because their dependencies are absent. Drop all
-- overloads instead of keeping a broken financial onboarding surface online.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'complete_investing_onboarding_v1',
        'save_investing_onboarding_progress_v1'
      )
    order by p.oid
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn.signature);
    execute format('drop function if exists %s', fn.signature);
  end loop;
end
$$;
