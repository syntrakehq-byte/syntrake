-- R0-A REHEARSAL-ONLY / PREPARED, NOT APPLIED.
--
-- Intentionally OUTSIDE supabase/migrations: a standard main/production
-- supabase db push MUST NOT discover or apply this runtime LOGIN.
-- Scope: branch investing-r0a-rehearsal (zkqgpejlkgootkvkebhd) ONLY.
-- Apply only after a separate authorization, target-ref verification,
-- migration-history reconciliation, SQL diff review, and isolated rehearsal.
--
-- Prerequisite: 20261018074500_investing_contribution_writer_capability.sql
-- has already created the NOLOGIN, NOBYPASSRLS capability role.
-- No password is created or stored here. PASSWORD NULL prevents password
-- authentication but does NOT independently prohibit non-password auth;
-- the deployment environment's authentication rules must also be audited.
-- No grants to anon, authenticated, or service_role; no financial DML.
--
-- This SQL is a forward-only candidate, not a production deployment.
CREATE ROLE investing_writer_runtime
  LOGIN
  NOINHERIT
  NOBYPASSRLS
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  CONNECTION LIMIT 2
  PASSWORD NULL;

-- Explicit options: the LOGIN must SET LOCAL ROLE inside a transaction;
-- it must never inherit the capability's financial privileges by default.
GRANT investing_contribution_writer
  TO investing_writer_runtime
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
