-- Functions created after the original pgcrypto qualification migration can
-- still contain unqualified digest(...) calls. The app uses restricted
-- search_path functions, so qualify those calls without widening search_path.
do $$
declare
  fn record;
  definition text;
  patched_count integer := 0;
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    if to_regprocedure('public.digest(bytea,text)') is null then
      raise exception 'investing_pgcrypto_digest_missing';
    end if;
    return;
  end if;

  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'investing\_%' escape '\'
      and (
        position('digest(' in p.prosrc) > 0
        or position('public.digest(' in p.prosrc) > 0
      )
    order by p.oid
  loop
    definition := pg_get_functiondef(fn.oid);
    definition := replace(definition, 'public.digest(', 'extensions.digest(');
    definition := regexp_replace(definition, '(^|[^A-Za-z0-9_\.])digest\(', '\1extensions.digest(', 'g');
    if definition <> pg_get_functiondef(fn.oid) then
      execute definition;
      patched_count := patched_count + 1;
    end if;
  end loop;

  if patched_count = 0 then
    raise notice 'no unqualified investing digest calls found';
  end if;
end
$$;
