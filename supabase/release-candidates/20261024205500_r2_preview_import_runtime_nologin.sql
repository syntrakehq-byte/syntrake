-- R2-G PREVIEW CANDIDATE ONLY — NEVER AUTO-APPLY, NEVER PRODUCTION.
-- Creates a dormant NOLOGIN capability placeholder, NOT a working connection.
-- Verified target BEFORE any approved future apply:
--   project ref zkqgpejlkgootkvkebhd, PG17, R2-B1 installed,
--   forward-only historical coverage migration applied and verified.
-- Explicit authorization, exact-SHA audit and migration-registry preflight
-- required. NOT the final R2/R0→R2 rehearsal. NO credentials in Git.
BEGIN;

DO $gate$
DECLARE
  writer record;
  ready_columns integer;
  rls_tables integer;
BEGIN
  SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb
  INTO writer FROM pg_roles WHERE rolname='investing_import_writer';
  IF NOT FOUND OR writer.rolcanlogin OR writer.rolbypassrls OR writer.rolsuper
     OR writer.rolcreaterole OR writer.rolcreatedb THEN
    RAISE EXCEPTION 'IMPORT_WRITER_CAPABILITY_DRIFT' USING errcode='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='investing_import_preview_runtime') THEN
    RAISE EXCEPTION 'IMPORT_RUNTIME_ROLE_EXISTS_RECONCILE_FIRST' USING errcode='55000';
  END IF;
  SELECT count(*) INTO ready_columns
  FROM pg_attribute
  WHERE attrelid=to_regclass('investing.portfolio_import_snapshots')
    AND attname IN ('reported_cash_coverage','reported_position_coverage')
    AND atttypid='text'::regtype AND NOT attisdropped;
  IF ready_columns<>2 THEN
    RAISE EXCEPTION 'PREVIEW_COVERAGE_UPGRADE_NOT_PROVEN' USING errcode='55000';
  END IF;
  SELECT count(*) INTO rls_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='investing'
    AND c.relname IN ('portfolio_import_snapshots','portfolio_import_cash',
      'portfolio_import_positions','portfolio_import_planned_contributions')
    AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;
  IF rls_tables<>4 THEN
    RAISE EXCEPTION 'PREVIEW_IMPORT_RLS_INCOMPLETE' USING errcode='55000';
  END IF;
  IF COALESCE(has_table_privilege('authenticated',
         'investing.portfolio_import_snapshots','INSERT'),true)
     OR NOT COALESCE(has_table_privilege('investing_import_writer',
         'investing.portfolio_import_snapshots','INSERT'),false)
     OR COALESCE(has_table_privilege('investing_import_writer',
         'investing.ledger_transactions','INSERT'),true) THEN
    RAISE EXCEPTION 'PREVIEW_IMPORT_WRITER_GRANTS_DRIFT' USING errcode='55000';
  END IF;
END
$gate$;

-- No LOGIN/password: no route can connect merely because this candidate ran.
CREATE ROLE investing_import_preview_runtime
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Explicit SET ROLE capability but no inherited import rights.
GRANT investing_import_writer TO investing_import_preview_runtime
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles grant_role ON grant_role.oid=m.roleid
    JOIN pg_roles target_role ON target_role.oid=m.member
    WHERE grant_role.rolname='investing_import_writer'
      AND target_role.rolname='investing_import_preview_runtime'
      AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles target_role ON target_role.oid=m.member
    WHERE target_role.rolname='investing_import_preview_runtime'
      AND m.roleid<>(SELECT oid FROM pg_roles WHERE rolname='investing_import_writer')
  ) OR EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='investing_import_preview_runtime'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'PREVIEW_IMPORT_RUNTIME_GRANT_MISMATCH' USING errcode='55000';
  END IF;
END
$verify$;
COMMIT;

-- FUTURE SEPARATE, AUTHORIZED, OUT-OF-BAND LOGIN/SECRET OPERATION (NOT SQL HERE):
-- A trusted operator may provision a password and enable LOGIN only after
-- independent approval and signed A/B actor + SSL connection design review.
-- Do not store password in SQL, GitHub, screenshots, or PR comments.
-- No service_role, no postgres runtime account, no broker access.
