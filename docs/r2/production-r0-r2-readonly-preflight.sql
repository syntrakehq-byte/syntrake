-- SYNTRAKE — R0→R2 Production preflight — READ ONLY
-- Run on the operator-verified Production project only.
-- No DDL/DML, no migration-repair, no role elevation, no passwords.
-- This is discovery, NOT permission to run any R2 migration.

SELECT
  current_setting('server_version') AS server_version,
  current_database() AS database_name,
  (to_regclass('investing.investment_accounts') IS NOT NULL) AS r0_accounts_present,
  (to_regclass('investing.portfolios') IS NOT NULL) AS r0_portfolios_present,
  (to_regclass('investing.account_memberships') IS NOT NULL) AS r0_memberships_present,
  (to_regclass('investing.ledger_transactions') IS NOT NULL) AS r0_ledger_present,
  (to_regclass('investing.onboarding_intents') IS NOT NULL) AS r2_onboarding_present,
  (to_regclass('investing.portfolio_import_snapshots') IS NOT NULL) AS r2_import_present,
  (to_regclass('investing.initial_portfolio_receipts') IS NOT NULL) AS r2_first_portfolio_present,
  (to_regclass('investing.onboarding_revisions') IS NOT NULL) AS r2_revisions_present,
  (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL) AS migration_registry_present;

SELECT c.relname AS investing_table, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'investing' AND c.relkind = 'r'
ORDER BY c.relname;

SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit
FROM pg_roles
WHERE rolname LIKE 'investing_%'
ORDER BY rolname;

-- When and only when the registered history is independently checked:
-- SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
-- Do NOT execute supabase db push/reset or repair the registry from this plan.
