-- R3-C3 CANDIDATE ONLY: apply after R3-B and R3-C to disposable PG17.
-- Preserve upstream evidence; no remote migration, network provider or Production worker.
-- Important: real provider cost reconciliation remains a manual, fail-closed gate.
--
-- SECURITY: move coordinator SECURITY DEFINER functions away from the test
-- superuser into an isolated NOLOGIN/NOBYPASSRLS function owner. The ingest
-- role receives only fixed-clock RPCs; the legacy time-parameter RPCs remain
-- available to privileged fixture setup, never to the ingest role.
CREATE ROLE market_core_coordinator_owner NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA market_core TO market_core_coordinator_owner;
GRANT SELECT ON market_core.providers, market_core.license_policies,
  market_core.market_observations, market_core.market_observation_revisions
  TO market_core_coordinator_owner;
GRANT SELECT, UPDATE ON market_core.provider_budget_periods, market_core.ingest_jobs
  TO market_core_coordinator_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_core.job_leases,
  market_core.credit_reservations, market_core.ingestion_runs
  TO market_core_coordinator_owner;

CREATE POLICY coordinator_owner_provider ON market_core.providers
  FOR SELECT TO market_core_coordinator_owner USING (true);
CREATE POLICY coordinator_owner_rights ON market_core.license_policies
  FOR SELECT TO market_core_coordinator_owner USING (true);
CREATE POLICY coordinator_owner_observations ON market_core.market_observations
  FOR SELECT TO market_core_coordinator_owner USING (true);
CREATE POLICY coordinator_owner_revisions ON market_core.market_observation_revisions
  FOR SELECT TO market_core_coordinator_owner USING (true);
CREATE POLICY coordinator_owner_budget ON market_core.provider_budget_periods
  FOR ALL TO market_core_coordinator_owner USING (true) WITH CHECK (true);
CREATE POLICY coordinator_owner_jobs ON market_core.ingest_jobs
  FOR ALL TO market_core_coordinator_owner USING (true) WITH CHECK (true);
CREATE POLICY coordinator_owner_leases ON market_core.job_leases
  FOR ALL TO market_core_coordinator_owner USING (true) WITH CHECK (true);
CREATE POLICY coordinator_owner_reservations ON market_core.credit_reservations
  FOR ALL TO market_core_coordinator_owner USING (true) WITH CHECK (true);
CREATE POLICY coordinator_owner_runs ON market_core.ingestion_runs
  FOR ALL TO market_core_coordinator_owner USING (true) WITH CHECK (true);

-- A lease expiry during FETCHING cannot prove that the provider charged zero.
-- Keep the entire reservation and fail closed; NO automatic provider replay.
-- Before FETCHING, an expired lease may retry with the SAME reservation.
-- At max attempts while still pre-fetch, release the reservation exactly once.
CREATE OR REPLACE FUNCTION market_core.recover_expired_ingest_leases(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
DECLARE
  x record;
  released record;
  recovered integer := 0;
BEGIN
  FOR x IN
    SELECT l.job_id, j.state, j.attempt, j.max_attempts
      FROM market_core.job_leases l
      JOIN market_core.ingest_jobs j ON j.job_id = l.job_id
     WHERE l.lease_until <= p_now
     ORDER BY l.lease_until, l.job_id
     FOR UPDATE OF l, j SKIP LOCKED
  LOOP
    IF x.state = 'FETCHING' THEN
      UPDATE market_core.ingest_jobs SET state='DEAD_LETTER',
        last_error='COST_UNCERTAIN', next_run_at=p_now WHERE job_id=x.job_id;
    ELSIF x.attempt >= x.max_attempts THEN
      UPDATE market_core.ingest_jobs SET state='DEAD_LETTER',
        last_error='MAX_ATTEMPTS_PRE_FETCH', next_run_at=p_now WHERE job_id=x.job_id;
      -- Only pre-fetch reservations are provably safe to release.
      UPDATE market_core.credit_reservations
         SET state='RELEASED'
       WHERE job_id=x.job_id AND state='RESERVED'
       RETURNING budget_period_id, estimated_credits INTO released;
      IF FOUND THEN
        UPDATE market_core.provider_budget_periods
           SET reserved_credits=reserved_credits-released.estimated_credits
         WHERE budget_period_id=released.budget_period_id;
      END IF;
    ELSE
      UPDATE market_core.ingest_jobs SET state='RETRY_WAIT',
        last_error='LEASE_EXPIRED', next_run_at=p_now WHERE job_id=x.job_id;
    END IF;
    DELETE FROM market_core.job_leases WHERE job_id=x.job_id;
    recovered := recovered+1;
  END LOOP;
  RETURN recovered;
END $$;

-- Capability/rights can disappear while a PRE-FETCH job is waiting to retry.
-- The previous candidate terminally rejected it but stranded its reservation.
-- Release it atomically here. FETCHING is intentionally ineligible for claim.
CREATE OR REPLACE FUNCTION market_core.claim_ingest_job(
  p_worker_id text, p_lease_token uuid, p_now timestamptz, p_lease_for interval)
RETURNS TABLE(job_id uuid, reservation_id uuid, demand_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $
DECLARE
  j market_core.ingest_jobs%ROWTYPE;
  b market_core.provider_budget_periods%ROWTYPE;
  released record;
  r uuid;
BEGIN
  IF p_lease_for <= interval '0 seconds' OR p_lease_for > interval '5 minutes'
     OR p_lease_token IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'INVALID_LEASE_ARGUMENTS';
  END IF;
  SELECT * INTO j FROM market_core.ingest_jobs
   WHERE state IN ('PENDING','RETRY_WAIT') AND next_run_at <= p_now
   ORDER BY next_run_at, job_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM market_core.providers p
     WHERE p.provider_id=j.provider_id AND p.status='ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM market_core.license_policies lp
     WHERE lp.rights_policy_id=j.rights_policy_id AND lp.cache_allowed
       AND (lp.retention_until IS NULL OR lp.retention_until > p_now))
     OR NOT EXISTS (SELECT 1 FROM market_core.provider_budget_periods bp
     WHERE bp.budget_period_id=j.budget_period_id AND bp.provider_id=j.provider_id
       AND p_now >= bp.starts_at AND p_now < bp.ends_at) THEN
    UPDATE market_core.ingest_jobs SET state='DEAD_LETTER',
      last_error='CAPABILITY_DENIED' WHERE market_core.ingest_jobs.job_id=j.job_id;
    UPDATE market_core.credit_reservations SET state='RELEASED'
      WHERE market_core.credit_reservations.job_id=j.job_id AND state='RESERVED'
      RETURNING budget_period_id, estimated_credits INTO released;
    IF FOUND THEN
      UPDATE market_core.provider_budget_periods
         SET reserved_credits=reserved_credits-released.estimated_credits
       WHERE budget_period_id=released.budget_period_id;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO b FROM market_core.provider_budget_periods
    WHERE budget_period_id=j.budget_period_id FOR UPDATE;
  SELECT cr.reservation_id INTO r FROM market_core.credit_reservations cr
    WHERE cr.job_id=j.job_id AND cr.state='RESERVED' FOR UPDATE;
  IF r IS NULL THEN
    IF b.reserved_credits+b.consumed_credits+j.estimated_credits > b.max_estimated_credits THEN
      UPDATE market_core.ingest_jobs SET state='DEAD_LETTER',
        last_error='BUDGET_EXHAUSTED' WHERE market_core.ingest_jobs.job_id=j.job_id;
      RETURN;
    END IF;
    r:=p_lease_token;
    INSERT INTO market_core.credit_reservations
      VALUES(r,j.job_id,b.budget_period_id,j.estimated_credits,NULL,'RESERVED');
    UPDATE market_core.provider_budget_periods
      SET reserved_credits=reserved_credits+j.estimated_credits
      WHERE budget_period_id=b.budget_period_id;
  END IF;
  UPDATE market_core.ingest_jobs SET state='LEASED',attempt=attempt+1
    WHERE market_core.ingest_jobs.job_id=j.job_id;
  INSERT INTO market_core.job_leases VALUES
    (j.job_id,p_worker_id,p_lease_token,p_now,p_now+p_lease_for,p_now);
  RETURN QUERY SELECT j.job_id,r,j.demand_key;
END $;

-- One-way durable transition BEFORE invoking any potentially billable provider.
CREATE FUNCTION market_core.start_ingest_fetch(p_job_id uuid, p_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
DECLARE active_job uuid;
BEGIN
  SELECT j.job_id INTO active_job
    FROM market_core.job_leases l
    JOIN market_core.ingest_jobs j ON j.job_id=l.job_id
   WHERE l.job_id=p_job_id AND l.lease_token=p_lease_token
     AND l.lease_until > clock_timestamp() AND j.state='LEASED'
   FOR UPDATE OF l, j;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE market_core.ingest_jobs SET state='FETCHING' WHERE job_id=active_job;
  RETURN FOUND;
END $$;

-- A successful ACK must have the current fenced lease, FETCHING state,
-- matching revision identity and RESERVED credits. Conflicting run keys are
-- failures, NEVER success. One transaction owns insert, reservation and budget.
CREATE OR REPLACE FUNCTION market_core.complete_ingest_job(
  p_job_id uuid, p_lease_token uuid, p_run_id uuid, p_provider_run_key text,
  p_revision_id uuid, p_consumed numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
DECLARE
  lease_row market_core.job_leases%ROWTYPE;
  job_row market_core.ingest_jobs%ROWTYPE;
  reservation_row market_core.credit_reservations%ROWTYPE;
BEGIN
  IF p_run_id IS NULL OR p_revision_id IS NULL OR p_consumed IS NULL
     OR p_consumed < 0 OR p_consumed::text IN ('NaN','Infinity','-Infinity')
     OR p_provider_run_key IS NULL OR p_provider_run_key !~ '^[A-Za-z0-9_-]{1,80}$' THEN
    RETURN false;
  END IF;
  SELECT * INTO lease_row
    FROM market_core.job_leases
   WHERE job_id=p_job_id AND lease_token=p_lease_token
     AND lease_until > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO job_row FROM market_core.ingest_jobs
   WHERE job_id=p_job_id AND state='FETCHING' FOR UPDATE;
  IF NOT FOUND OR p_consumed > job_row.estimated_credits THEN RETURN false; END IF;
  SELECT * INTO reservation_row FROM market_core.credit_reservations
   WHERE job_id=p_job_id AND state='RESERVED' FOR UPDATE;
  IF NOT FOUND OR reservation_row.estimated_credits <> job_row.estimated_credits
     OR reservation_row.budget_period_id <> job_row.budget_period_id THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM market_core.market_observation_revisions r
    JOIN market_core.market_observations o USING (observation_id)
    WHERE r.revision_id=p_revision_id AND o.listing_id=job_row.listing_id
      AND o.provider_id=job_row.provider_id
      AND o.rights_policy_id=job_row.rights_policy_id
  ) THEN RETURN false; END IF;
  INSERT INTO market_core.ingestion_runs
    (run_id,job_id,idempotency_key,provider_run_key,state,result_revision_id,error_code,created_at)
  VALUES(p_run_id,p_job_id,job_row.idempotency_key,p_provider_run_key,
    'SUCCESS',p_revision_id,NULL,clock_timestamp())
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE market_core.credit_reservations
    SET state='CONSUMED', consumed_credits=p_consumed
    WHERE job_id=p_job_id AND state='RESERVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'R3C3_RESERVATION_RACE'; END IF;
  UPDATE market_core.provider_budget_periods
    SET reserved_credits=reserved_credits-reservation_row.estimated_credits,
        consumed_credits=consumed_credits+p_consumed
    WHERE budget_period_id=reservation_row.budget_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'R3C3_MISSING_BUDGET'; END IF;
  UPDATE market_core.ingest_jobs SET state='COMMITTED' WHERE job_id=p_job_id;
  DELETE FROM market_core.job_leases WHERE job_id=p_job_id;
  RETURN true;
END $$;

-- Workers cannot supply a "current" timestamp or arbitrary lease duration.
-- Original signatures are retained for owner-only historical test fixtures.
CREATE FUNCTION market_core.claim_ingest_job_safe(p_worker_id text, p_lease_token uuid)
RETURNS TABLE(job_id uuid, reservation_id uuid, demand_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
BEGIN
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9_-]{1,64}$'
     OR p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_WORKER_IDENTITY'; END IF;
  RETURN QUERY SELECT * FROM market_core.claim_ingest_job(
    p_worker_id,p_lease_token,clock_timestamp(),interval '5 minutes');
END $$;

CREATE FUNCTION market_core.recover_expired_ingest_leases_safe()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
  SELECT market_core.recover_expired_ingest_leases(clock_timestamp());
$$;

REVOKE ALL ON FUNCTION market_core.claim_ingest_job(text,uuid,timestamptz,interval)
  FROM PUBLIC, market_core_ingest;
REVOKE ALL ON FUNCTION market_core.recover_expired_ingest_leases(timestamptz)
  FROM PUBLIC, market_core_ingest;
REVOKE ALL ON FUNCTION market_core.complete_ingest_job(uuid,uuid,uuid,text,uuid,numeric)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION market_core.start_ingest_fetch(uuid,uuid),
  market_core.claim_ingest_job_safe(text,uuid),
  market_core.recover_expired_ingest_leases_safe() FROM PUBLIC;

ALTER FUNCTION market_core.claim_ingest_job(text,uuid,timestamptz,interval)
  OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.recover_expired_ingest_leases(timestamptz)
  OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.complete_ingest_job(uuid,uuid,uuid,text,uuid,numeric)
  OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.start_ingest_fetch(uuid,uuid)
  OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.claim_ingest_job_safe(text,uuid)
  OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.recover_expired_ingest_leases_safe()
  OWNER TO market_core_coordinator_owner;

GRANT EXECUTE ON FUNCTION market_core.start_ingest_fetch(uuid,uuid),
  market_core.claim_ingest_job_safe(text,uuid),
  market_core.recover_expired_ingest_leases_safe(),
  market_core.complete_ingest_job(uuid,uuid,uuid,text,uuid,numeric)
  TO market_core_ingest;
