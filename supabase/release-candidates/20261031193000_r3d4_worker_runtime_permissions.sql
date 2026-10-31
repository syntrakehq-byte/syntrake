-- R3-D4 candidate only. Minimum runtime reads for the offline ingest worker.
-- Apply after R3-B, R3-C, R3-C3 and R3-D2 in disposable PostgreSQL 17.
-- No financial DML is granted here; reservations, balances and ACK remain RPC-only.
GRANT USAGE ON SCHEMA market_core TO market_core_ingest;

CREATE OR REPLACE FUNCTION market_core.claim_ingest_job_safe(p_worker_id text, p_lease_token uuid)
RETURNS TABLE(job_id uuid, reservation_id uuid, demand_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
BEGIN
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9_-]{1,64}$' OR p_lease_token IS NULL
    THEN RAISE EXCEPTION 'INVALID_WORKER_IDENTITY'; END IF;
  IF session_user NOT IN ('postgres','market_core_coordinator_owner')
     AND NOT EXISTS (SELECT 1 FROM market_core.worker_identity_bindings
                     WHERE login_role = session_user AND worker_id = p_worker_id) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM market_core.claim_ingest_job(
    p_worker_id,p_lease_token,clock_timestamp(),interval '5 minutes');
END $$;

CREATE TABLE market_core.worker_identity_bindings (
  login_role name PRIMARY KEY,
  worker_id text NOT NULL UNIQUE
);
ALTER TABLE market_core.worker_identity_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.worker_identity_bindings FORCE ROW LEVEL SECURITY;
GRANT SELECT ON market_core.worker_identity_bindings TO market_core_ingest;
CREATE POLICY worker_identity_self_read ON market_core.worker_identity_bindings
  FOR SELECT TO PUBLIC USING (login_role = current_user);
GRANT SELECT (job_id, worker_id, lease_until) ON market_core.job_leases TO market_core_ingest;
CREATE POLICY worker_identity_lease_read ON market_core.job_leases
  FOR SELECT TO PUBLIC USING (EXISTS (
    SELECT 1 FROM market_core.worker_identity_bindings b
    WHERE b.login_role = current_user AND b.worker_id = job_leases.worker_id
  ));

-- LOGIN identities inherit the runtime group but remain current_user.  The
-- coordinator policy is intentionally exact for SET ROLE; this additional
-- read policy is the least privilege bridge for the disposable LOGIN worker.
DROP POLICY IF EXISTS ingest_runtime_jobs_read ON market_core.ingest_jobs;
CREATE POLICY ingest_runtime_jobs_read ON market_core.ingest_jobs
  FOR SELECT TO market_core_ingest
  USING (EXISTS (SELECT 1 FROM market_core.job_leases l
    WHERE l.job_id = ingest_jobs.job_id AND l.lease_until > clock_timestamp()));

GRANT SELECT (provider_id, provider_key)
  ON market_core.providers TO market_core_ingest;
GRANT SELECT (listing_id, valid_from, valid_to)
  ON market_core.listings TO market_core_ingest;
GRANT SELECT (rights_policy_id, cache_allowed, retention_until)
  ON market_core.license_policies TO market_core_ingest;
GRANT SELECT (observation_id, listing_id, provider_id, interval, market_date, adjustment, rights_policy_id)
  ON market_core.market_observations TO market_core_ingest;
GRANT SELECT (revision_id, observation_id, source_revision)
  ON market_core.market_observation_revisions TO market_core_ingest;
GRANT INSERT ON market_core.market_observations, market_core.market_observation_revisions
  TO market_core_ingest;

CREATE POLICY ingest_runtime_provider_read ON market_core.providers
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE j.provider_id = providers.provider_id
      AND l.lease_until > clock_timestamp()
  ));

CREATE POLICY ingest_runtime_listing_read ON market_core.listings
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE j.listing_id = listings.listing_id
      AND l.lease_until > clock_timestamp()
  ));

CREATE POLICY ingest_runtime_rights_read ON market_core.license_policies
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE j.rights_policy_id = license_policies.rights_policy_id
      AND l.lease_until > clock_timestamp()
  ));

CREATE POLICY ingest_runtime_observation_read ON market_core.market_observations
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE j.listing_id = market_observations.listing_id
      AND j.provider_id = market_observations.provider_id
      AND l.lease_until > clock_timestamp()
  ));

CREATE POLICY ingest_runtime_revision_read ON market_core.market_observation_revisions
  FOR SELECT TO market_core_ingest
  USING (EXISTS (
    SELECT 1
    FROM market_core.market_observations o
    JOIN market_core.ingest_jobs j
      ON j.listing_id = o.listing_id AND j.provider_id = o.provider_id
    JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE o.observation_id = market_observation_revisions.observation_id
      AND l.lease_until > clock_timestamp()
  ));

CREATE POLICY ingest_runtime_observation_write ON market_core.market_observations
  FOR INSERT TO market_core_ingest
  WITH CHECK (EXISTS (
    SELECT 1 FROM market_core.ingest_jobs j JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE j.listing_id = market_observations.listing_id
      AND j.provider_id = market_observations.provider_id
      AND j.rights_policy_id = market_observations.rights_policy_id
      AND l.lease_until > clock_timestamp()
  ));

CREATE POLICY ingest_runtime_revision_write ON market_core.market_observation_revisions
  FOR INSERT TO market_core_ingest
  WITH CHECK (EXISTS (
    SELECT 1
    FROM market_core.market_observations o
    JOIN market_core.ingest_jobs j
      ON j.listing_id = o.listing_id AND j.provider_id = o.provider_id
     AND j.rights_policy_id = o.rights_policy_id
    JOIN market_core.job_leases l ON l.job_id=j.job_id
    WHERE o.observation_id = market_observation_revisions.observation_id
      AND l.lease_until > clock_timestamp()
  ));
