-- PREVIEW ONLY: dedicated runtime identity for R2-C2 Investing account setup.
-- Created NOLOGIN. Password/LOGIN enablement is an operational credential
-- action performed OUTSIDE Git and never stored in schema migration history.
-- Never apply this Preview login-role migration to Production.
create role investing_initial_preview_runtime
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
grant investing_initial_provisioner to investing_initial_preview_runtime
  with INHERIT FALSE, SET TRUE;
-- Runtime role has NO privileges inherited until SET LOCAL ROLE inside
-- the Clerk-bound transaction; there is no direct grant on financial tables.
