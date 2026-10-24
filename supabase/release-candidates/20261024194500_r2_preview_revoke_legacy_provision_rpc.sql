-- R2-C2 historical Preview API hardening. PROPOSAL ONLY / NOT APPLIED.
-- Target only manually validated Supabase branch ref: zkqgpejlkgootkvkebhd.
-- NEVER apply in Production or generic migration push; manually verify that
-- the replacement authenticated private first-account route is operational.
-- User/owner approval of this exact SHA and a rollback plan are required.
--
-- Reason: historical investing.provision_first_portfolio(...) is SECURITY
-- DEFINER and callable through PostgREST by authenticated. Legacy Preview
-- must not have a second externally available provisioning authority after
-- R2-C4 private authority cutover. This REVOKE is a capability change, not
-- a financial mutation or a data delete. It will disable the old route.
--
-- Observed live definition SHA256 (pg_get_functiondef converted to UTF8):
-- 563ca89cf9cde2b75530de84d9ef60655f842e83ad78dc784ca34747651889b7
-- Fail closed if ANYTHING material about the exact function has changed.
begin;
do $gate$
declare
  fn regprocedure;
  actual_hash text;
  actual_owner text;
  has_exec boolean;
  insecure_public boolean;
begin
  fn := to_regprocedure('investing.provision_first_portfolio(uuid,text,text,text)');
  if fn is null then
    raise exception 'PREVIEW_RPC_MISSING_OR_ALREADY_REVOKED: reconcile first'
      using errcode='55000';
  end if;
  select encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
         owner.rolname, has_function_privilege('authenticated',p.oid,'EXECUTE'),
         exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
           where x.grantee=0 and x.privilege_type='EXECUTE')
    into actual_hash,actual_owner,has_exec,insecure_public
  from pg_proc p join pg_roles owner on owner.oid=p.proowner
  where p.oid=fn::oid and p.prosecdef=true and
    p.proconfig @> array['search_path=pg_catalog, investing']::text[];
  if actual_hash is distinct from
      '563ca89cf9cde2b75530de84d9ef60655f842e83ad78dc784ca34747651889b7'
    or actual_owner is distinct from 'investing_initial_provisioner'
    or has_exec is distinct from true
    or insecure_public is distinct from false then
    raise exception 'PREVIEW_RPC_DEFINITION_ACL_DRIFT: BLOCKED' using errcode='55000';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid=to_regclass('investing.portfolio_import_snapshots')
       and attname='reported_cash_coverage' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
     where attrelid=to_regclass('investing.portfolio_import_snapshots')
       and attname='reported_position_coverage' and not attisdropped
  ) then
    raise exception 'PREVIEW_COVERAGE_MIGRATION_NOT_APPLIED: BLOCKED' using errcode='55000';
  end if;
end;
$gate$ language plpgsql;

revoke execute on function investing.provision_first_portfolio(uuid,text,text,text)
from authenticated;

do $verify$
begin
  if has_function_privilege('authenticated',
       'investing.provision_first_portfolio(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'PREVIEW_RPC_AUTHENTICATED_STILL_EXECUTABLE' using errcode='55000';
  end if;
end;
$verify$ language plpgsql;
commit;
