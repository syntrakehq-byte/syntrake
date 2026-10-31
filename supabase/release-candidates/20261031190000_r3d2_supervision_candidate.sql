-- R3-D2 candidate only. Apply after R3-B, R3-C and R3-C3 in disposable PG17.
CREATE ROLE market_core_supervisor NOLOGIN NOBYPASSRLS;
CREATE TABLE market_core.worker_heartbeats (
  worker_id text PRIMARY KEY CHECK (worker_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  instance_id text NOT NULL CHECK (instance_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  last_seen_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE market_core.worker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.worker_heartbeats FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA market_core TO market_core_supervisor;
GRANT INSERT, UPDATE ON market_core.worker_heartbeats TO market_core_coordinator_owner;
GRANT SELECT ON market_core.worker_heartbeats, market_core.ingest_jobs, market_core.job_leases, market_core.credit_reservations TO market_core_supervisor;
CREATE POLICY supervisor_heartbeat_read ON market_core.worker_heartbeats FOR SELECT TO market_core_supervisor USING (true);
CREATE POLICY coordinator_heartbeat_write ON market_core.worker_heartbeats FOR ALL TO market_core_coordinator_owner USING (true) WITH CHECK (true);
CREATE POLICY supervisor_jobs_read ON market_core.ingest_jobs FOR SELECT TO market_core_supervisor USING (true);
CREATE POLICY supervisor_leases_read ON market_core.job_leases FOR SELECT TO market_core_supervisor USING (true);
CREATE POLICY supervisor_reservations_read ON market_core.credit_reservations FOR SELECT TO market_core_supervisor USING (true);

CREATE OR REPLACE FUNCTION market_core.record_worker_heartbeat(p_worker_id text, p_instance_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
BEGIN
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9_-]{1,64}$' OR p_instance_id IS NULL OR p_instance_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN RETURN false; END IF;
  INSERT INTO market_core.worker_heartbeats(worker_id,instance_id,last_seen_at,active)
  VALUES(p_worker_id,p_instance_id,clock_timestamp(),true)
  ON CONFLICT(worker_id) DO UPDATE SET instance_id=EXCLUDED.instance_id,last_seen_at=EXCLUDED.last_seen_at,active=true;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION market_core.record_worker_heartbeat(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.record_worker_heartbeat(text,text) TO market_core_ingest;

CREATE OR REPLACE FUNCTION market_core.supervisor_snapshot(p_stale_after interval)
RETURNS TABLE(worker_id text, instance_id text, worker_active boolean, lease_count bigint, pending_count bigint, fetching_count bigint, uncertain_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
  SELECT h.worker_id,h.instance_id,(h.last_seen_at > clock_timestamp()-p_stale_after AND h.active),
    (SELECT count(*) FROM market_core.job_leases l WHERE l.worker_id=h.worker_id),
    (SELECT count(*) FROM market_core.ingest_jobs j WHERE j.state IN ('PENDING','RETRY_WAIT')),
    (SELECT count(*) FROM market_core.ingest_jobs j WHERE j.state='FETCHING'),
    (SELECT count(*) FROM market_core.ingest_jobs j WHERE j.last_error='COST_UNCERTAIN')
  FROM market_core.worker_heartbeats h;
$$;
REVOKE ALL ON FUNCTION market_core.supervisor_snapshot(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.supervisor_snapshot(interval) TO market_core_supervisor;

CREATE OR REPLACE FUNCTION market_core.supervisor_recover_expired()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = market_core, pg_catalog AS $$
  SELECT market_core.recover_expired_ingest_leases_safe();
$$;
REVOKE ALL ON FUNCTION market_core.supervisor_recover_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.supervisor_recover_expired() TO market_core_supervisor;
ALTER FUNCTION market_core.record_worker_heartbeat(text,text) OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.supervisor_snapshot(interval) OWNER TO market_core_coordinator_owner;
ALTER FUNCTION market_core.supervisor_recover_expired() OWNER TO market_core_coordinator_owner;
