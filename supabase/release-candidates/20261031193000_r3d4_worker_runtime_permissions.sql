-- R3-D4 candidate only. Minimum runtime reads for the offline ingest worker.
-- Apply after R3-B, R3-C, R3-C3 and R3-D2 in disposable PostgreSQL 17.
-- No financial DML is granted here; reservations, balances and ACK remain RPC-only.
GRANT USAGE ON SCHEMA market_core TO market_core_ingest;

-- LOGIN identities inherit the runtime group but remain current_user.  The
-- coordinator policy is intentionally exact for SET ROLE; this additional
-- read policy is the least privilege bridge for the disposable LOGIN worker.
CREATE POLICY ingest_runtime_jobs_read ON market_core.ingest_jobs
  FOR SELECT TO market_core_ingest
  USING (pg_has_role(current_user, 'market_core_ingest', 'member'));

GRANT SELECT (provider_id, provider_key)
  ON market_core.providers TO market_core_ingest;
GRANT SELECT (listing_id, valid_from, valid_to)
  ON market_core.listings TO market_core_ingest;
GRANT SELECT (rights_policy_id, cache_allowed, retention_until)
  ON market_core.license_policies TO market_core_ingest;
GRANT SELECT (observation_id, listing_id, provider_id, interval, market_date, rights_policy_id)
  ON market_core.market_observations TO market_core_ingest;
GRANT SELECT (revision_id, observation_id, source_revision)
  ON market_core.market_observation_revisions TO market_core_ingest;

CREATE POLICY ingest_runtime_provider_read ON market_core.providers
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j
    WHERE j.provider_id = providers.provider_id
      AND j.state IN ('LEASED','FETCHING')
  ));

CREATE POLICY ingest_runtime_listing_read ON market_core.listings
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j
    WHERE j.listing_id = listings.listing_id
      AND j.state IN ('LEASED','FETCHING')
  ));

CREATE POLICY ingest_runtime_rights_read ON market_core.license_policies
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j
    WHERE j.rights_policy_id = license_policies.rights_policy_id
      AND j.state IN ('LEASED','FETCHING')
  ));

CREATE POLICY ingest_runtime_observation_read ON market_core.market_observations
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j
    WHERE j.listing_id = market_observations.listing_id
      AND j.provider_id = market_observations.provider_id
      AND j.state IN ('LEASED','FETCHING')
  ));

CREATE POLICY ingest_runtime_revision_read ON market_core.market_observation_revisions
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1
    FROM market_core.market_observations o
    JOIN market_core.ingest_jobs j
      ON j.listing_id = o.listing_id AND j.provider_id = o.provider_id
    WHERE o.observation_id = market_observation_revisions.observation_id
      AND j.state IN ('LEASED','FETCHING')
  ));
