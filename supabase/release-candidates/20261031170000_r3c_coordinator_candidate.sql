-- R3-C CANDIDATE ONLY. Requires the R3-B candidate schema in the same disposable PG17 database.
CREATE TABLE market_core.provider_budget_periods (
  budget_period_id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  max_estimated_credits numeric(20,6) NOT NULL CHECK (max_estimated_credits >= 0),
  reserved_credits numeric(20,6) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  consumed_credits numeric(20,6) NOT NULL DEFAULT 0 CHECK (consumed_credits >= 0),
  UNIQUE (provider_id, starts_at, ends_at),
  CHECK (reserved_credits + consumed_credits <= max_estimated_credits)
);
CREATE TABLE market_core.ingest_jobs (
  job_id uuid PRIMARY KEY,
  demand_key text NOT NULL UNIQUE CHECK (demand_key ~ '^[a-f0-9]{64}$'),
  listing_id uuid NOT NULL REFERENCES market_core.listings(listing_id),
  provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
  rights_policy_id uuid NOT NULL REFERENCES market_core.license_policies(rights_policy_id),
  budget_period_id uuid NOT NULL REFERENCES market_core.provider_budget_periods(budget_period_id),
  estimated_credits numeric(20,6) NOT NULL CHECK (estimated_credits > 0),
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('PENDING','LEASED','FETCHING','COMMITTED','RETRY_WAIT','DEAD_LETTER')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0 AND attempt <= 20),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  next_run_at timestamptz NOT NULL,
  last_error text
);
CREATE TABLE market_core.job_leases (
  job_id uuid PRIMARY KEY REFERENCES market_core.ingest_jobs(job_id),
  worker_id text NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 128),
  lease_token uuid NOT NULL UNIQUE,
  leased_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL CHECK (lease_until > leased_at),
  heartbeat_at timestamptz NOT NULL CHECK (heartbeat_at >= leased_at)
);
CREATE TABLE market_core.credit_reservations (
  reservation_id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES market_core.ingest_jobs(job_id),
  budget_period_id uuid NOT NULL REFERENCES market_core.provider_budget_periods(budget_period_id),
  estimated_credits numeric(20,6) NOT NULL CHECK (estimated_credits > 0),
  consumed_credits numeric(20,6) CHECK (consumed_credits IS NULL OR consumed_credits >= 0),
  state text NOT NULL CHECK (state IN ('RESERVED','CONSUMED','RELEASED','EXPIRED'))
);
CREATE TABLE market_core.ingestion_runs (
  run_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES market_core.ingest_jobs(job_id),
  idempotency_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('SUCCESS','RETRY','FAILED')),
  result_revision_id uuid REFERENCES market_core.market_observation_revisions(revision_id),
  error_code text,
  created_at timestamptz NOT NULL,
  UNIQUE (job_id, idempotency_key)
);
CREATE INDEX ingest_jobs_ready_idx ON market_core.ingest_jobs (state, next_run_at);
CREATE INDEX leases_expiry_idx ON market_core.job_leases (lease_until);

CREATE OR REPLACE FUNCTION market_core.recover_expired_ingest_leases(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE recovered integer;
BEGIN
  WITH expired AS (
    SELECT l.job_id, j.attempt, j.max_attempts
    FROM market_core.job_leases l
    JOIN market_core.ingest_jobs j USING (job_id)
    WHERE l.lease_until <= p_now
    FOR UPDATE OF l, j
  )
  UPDATE market_core.ingest_jobs j
  SET state = CASE WHEN expired.attempt >= expired.max_attempts THEN 'DEAD_LETTER' ELSE 'RETRY_WAIT' END,
      next_run_at = p_now,
      last_error = 'LEASE_EXPIRED'
  FROM expired
  WHERE j.job_id = expired.job_id;
  GET DIAGNOSTICS recovered = ROW_COUNT;
  DELETE FROM market_core.job_leases l WHERE l.lease_until <= p_now;
  RETURN recovered;
END $$;
REVOKE ALL ON FUNCTION market_core.recover_expired_ingest_leases(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.recover_expired_ingest_leases(timestamptz) TO market_core_ingest;

CREATE OR REPLACE FUNCTION market_core.claim_ingest_job(p_worker_id text, p_lease_token uuid, p_now timestamptz, p_lease_for interval)
RETURNS TABLE (job_id uuid, reservation_id uuid, demand_key text)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE j market_core.ingest_jobs%ROWTYPE; b market_core.provider_budget_periods%ROWTYPE; r uuid;
BEGIN
  SELECT * INTO j FROM market_core.ingest_jobs
  WHERE state IN ('PENDING','RETRY_WAIT') AND next_run_at <= p_now
  ORDER BY next_run_at, job_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO b FROM market_core.provider_budget_periods WHERE budget_period_id=j.budget_period_id FOR UPDATE;
  IF b.reserved_credits + b.consumed_credits + j.estimated_credits > b.max_estimated_credits THEN
    UPDATE market_core.ingest_jobs SET state='DEAD_LETTER', last_error='BUDGET_EXHAUSTED' WHERE market_core.ingest_jobs.job_id=j.job_id;
    RETURN;
  END IF;
  r := p_lease_token;
  UPDATE market_core.provider_budget_periods SET reserved_credits=reserved_credits+j.estimated_credits WHERE budget_period_id=b.budget_period_id;
  INSERT INTO market_core.credit_reservations VALUES (r,j.job_id,b.budget_period_id,j.estimated_credits,NULL,'RESERVED');
  UPDATE market_core.ingest_jobs SET state='LEASED', attempt=attempt+1 WHERE market_core.ingest_jobs.job_id=j.job_id;
  INSERT INTO market_core.job_leases VALUES (j.job_id,p_worker_id,p_lease_token,p_now,p_now+p_lease_for,p_now);
  RETURN QUERY SELECT j.job_id,r,j.demand_key;
END $$;
REVOKE ALL ON FUNCTION market_core.claim_ingest_job(text, uuid, timestamptz, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.claim_ingest_job(text, uuid, timestamptz, interval) TO market_core_ingest;
ALTER TABLE market_core.provider_budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.job_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.provider_budget_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.ingest_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.job_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.credit_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.ingestion_runs FORCE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON market_core.provider_budget_periods, market_core.ingest_jobs TO market_core_ingest;
GRANT INSERT, DELETE ON market_core.job_leases TO market_core_ingest;
GRANT INSERT ON market_core.credit_reservations, market_core.ingestion_runs TO market_core_ingest;
CREATE POLICY coordinator_budget ON market_core.provider_budget_periods FOR SELECT TO market_core_ingest USING (current_user = 'market_core_ingest');
CREATE POLICY coordinator_budget_update ON market_core.provider_budget_periods FOR UPDATE TO market_core_ingest USING (current_user = 'market_core_ingest') WITH CHECK (current_user = 'market_core_ingest');
CREATE POLICY coordinator_jobs ON market_core.ingest_jobs FOR SELECT TO market_core_ingest USING (current_user = 'market_core_ingest');
CREATE POLICY coordinator_jobs_update ON market_core.ingest_jobs FOR UPDATE TO market_core_ingest USING (current_user = 'market_core_ingest') WITH CHECK (current_user = 'market_core_ingest');
CREATE POLICY coordinator_leases ON market_core.job_leases FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
CREATE POLICY coordinator_reservations ON market_core.credit_reservations FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
CREATE POLICY coordinator_runs ON market_core.ingestion_runs FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
