-- G3-G / Market Core: a short-lived, provider-neutral shared cache.
-- This stores no portfolio/ledger data. Every write requires an approved,
-- unexpired rights policy with cache_allowed=true.
-- Applied to the isolated Preview project first; production release is separate.
CREATE SCHEMA IF NOT EXISTS market_core;

CREATE TABLE IF NOT EXISTS market_core.shared_market_cache (
    cache_key varchar(64) PRIMARY KEY
      CHECK (cache_key ~ '^[0-9a-f]{64}$'),
    cache_kind text NOT NULL CHECK (cache_kind IN ('DAILY_QUOTE','DAILY_HISTORY')),
    rights_policy_id uuid NOT NULL REFERENCES market_core.license_policies(rights_policy_id),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
    cached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    retention_until timestamptz NOT NULL,
    CONSTRAINT market_cache_short_ttl
      CHECK (expires_at > cached_at AND expires_at <= cached_at + INTERVAL '5 minutes'),
    CONSTRAINT market_cache_retention
      CHECK (expires_at <= retention_until)
);

CREATE INDEX IF NOT EXISTS idx_market_shared_cache_expiry
 ON market_core.shared_market_cache(expires_at);

-- A dedicated NOLOGIN cache role cannot mutate canonical observations.
DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='market_core_cache') THEN
    CREATE ROLE market_core_cache NOLOGIN NOBYPASSRLS;
  END IF;
END;
$;
GRANT USAGE ON SCHEMA market_core TO market_core_cache;
GRANT SELECT (rights_policy_id,cache_allowed,retention_until)
 ON market_core.license_policies TO market_core_cache;
DROP POLICY IF EXISTS market_core_cache_rights_lookup ON market_core.license_policies;
CREATE POLICY market_core_cache_rights_lookup ON market_core.license_policies
 FOR SELECT TO market_core_cache
 USING (CURRENT_USER='market_core_cache'::name);

-- Only the existing private Preview ingest LOGIN may assume this role.
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='syntrake_g3_preview_ingest') THEN
    GRANT market_core_cache TO syntrake_g3_preview_ingest;
  END IF;
END;
$;
REVOKE ALL ON market_core.shared_market_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT ON market_core.shared_market_cache TO market_core_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON market_core.shared_market_cache TO market_core_cache;

ALTER TABLE market_core.shared_market_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.shared_market_cache FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_shared_cache_reader ON market_core.shared_market_cache;
CREATE POLICY market_shared_cache_reader ON market_core.shared_market_cache
 FOR SELECT TO market_core_reader
 USING (expires_at > clock_timestamp() AND retention_until > clock_timestamp());

DROP POLICY IF EXISTS market_shared_cache_ingest_read ON market_core.shared_market_cache;
CREATE POLICY market_shared_cache_ingest_read ON market_core.shared_market_cache
 FOR SELECT TO market_core_cache
 USING (true);

DROP POLICY IF EXISTS market_shared_cache_ingest_insert ON market_core.shared_market_cache;
CREATE POLICY market_shared_cache_ingest_insert ON market_core.shared_market_cache
 FOR INSERT TO market_core_cache
 WITH CHECK (
   expires_at > clock_timestamp() AND
   retention_until >= expires_at AND
   EXISTS(
     SELECT 1 FROM market_core.license_policies lp
     WHERE lp.rights_policy_id=shared_market_cache.rights_policy_id
       AND lp.cache_allowed IS TRUE
       AND lp.retention_until IS NOT NULL
       AND lp.retention_until >= expires_at
   )
 );

DROP POLICY IF EXISTS market_shared_cache_ingest_update ON market_core.shared_market_cache;
CREATE POLICY market_shared_cache_ingest_update ON market_core.shared_market_cache
 FOR UPDATE TO market_core_cache
 USING (true)
 WITH CHECK (
   expires_at > clock_timestamp() AND
   retention_until >= expires_at AND
   EXISTS(
     SELECT 1 FROM market_core.license_policies lp
     WHERE lp.rights_policy_id=shared_market_cache.rights_policy_id
       AND lp.cache_allowed IS TRUE
       AND lp.retention_until IS NOT NULL
       AND lp.retention_until >= expires_at
   )
 );

DROP POLICY IF EXISTS market_shared_cache_ingest_delete ON market_core.shared_market_cache;
CREATE POLICY market_shared_cache_ingest_delete ON market_core.shared_market_cache
 FOR DELETE TO market_core_cache USING (true);

COMMENT ON TABLE market_core.shared_market_cache IS
 'Short-lived Market Core cache; approved policy and physical expiry purge are mandatory for use.';
