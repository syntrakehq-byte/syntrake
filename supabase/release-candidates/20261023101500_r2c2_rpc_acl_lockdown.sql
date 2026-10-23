-- R2-C2 Preview corrective migration: close accidental PostgREST EXECUTE
-- ACL inherited from Supabase default privileges on SECURITY DEFINER RPC.
-- The function owner is the restricted NOLOGIN investing_initial_provisioner,
-- not the migration executor. Revoke while SET ROLE owner is active.
-- This is forward-only: do not rewrite already installed SQL/hash/registry.
GRANT investing_initial_provisioner TO postgres WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE investing_initial_provisioner;
REVOKE ALL ON FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
DO $lockdown$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
   REVOKE ALL ON FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
     FROM service_role;
 END IF;
END $lockdown$;
GRANT EXECUTE ON FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
  TO authenticated;
RESET ROLE;
REVOKE investing_initial_provisioner FROM postgres GRANTED BY postgres;

-- Execution capabilities are an ACL, not a substitute for the function's
-- JWT validation. The only intended caller role is authenticated.
DO $assert_acl$
DECLARE
 rpc_oid oid;
BEGIN
 SELECT p.oid INTO rpc_oid
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='investing' AND p.proname='provision_first_portfolio'
   AND p.proargtypes='2950 25 25 25'::oidvector;
 IF rpc_oid IS NULL OR
    has_function_privilege('anon',rpc_oid,'EXECUTE') OR
    NOT has_function_privilege('authenticated',rpc_oid,'EXECUTE')
 THEN
   RAISE EXCEPTION 'R2-C2 RPC ACL not locked down' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
   IF has_function_privilege('service_role',rpc_oid,'EXECUTE') THEN
     RAISE EXCEPTION 'service_role RPC execution not revoked' USING ERRCODE='42501';
   END IF;
 END IF;
 IF EXISTS(
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles role ON role.oid=m.roleid
    JOIN pg_roles grantee ON grantee.oid=m.member
    WHERE role.rolname='investing_initial_provisioner'
      AND grantee.rolname='postgres' AND m.set_option
 ) THEN
   RAISE EXCEPTION 'migration executor membership not restored' USING ERRCODE='42501';
 END IF;
END $assert_acl$;
