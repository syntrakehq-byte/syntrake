DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOINHERIT; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
