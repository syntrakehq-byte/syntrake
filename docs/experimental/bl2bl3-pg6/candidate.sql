-- BL2/BL3 PG6 experimental candidate. Local-only; not a migration.
BEGIN;

CREATE SCHEMA IF NOT EXISTS bl2proof;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bl2proof_owner') THEN
    CREATE ROLE bl2proof_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bl2proof_runtime') THEN
    CREATE ROLE bl2proof_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE bl2proof.revisions (
  account_id uuid NOT NULL REFERENCES investing.investment_accounts(id),
  revision_id text NOT NULL,
  actor_user_id text NOT NULL REFERENCES investing.identity_accounts(user_id),
  idempotency_key text NOT NULL,
  input_payload jsonb NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  supersedes text,
  status text NOT NULL CHECK (status IN ('PENDING','APPLIED','SUPERSEDED','ABANDONED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, revision_id),
  UNIQUE (account_id, actor_user_id, idempotency_key),
  FOREIGN KEY (account_id, supersedes) REFERENCES bl2proof.revisions(account_id, revision_id),
  CHECK (supersedes IS NULL OR supersedes <> revision_id)
);

CREATE TABLE bl2proof.bindings (
  account_id uuid NOT NULL,
  revision_id text NOT NULL,
  portfolio_id uuid NOT NULL,
  PRIMARY KEY (account_id, revision_id),
  FOREIGN KEY (account_id, revision_id) REFERENCES bl2proof.revisions(account_id, revision_id),
  FOREIGN KEY (portfolio_id, account_id) REFERENCES investing.portfolios(id, investment_account_id),
  UNIQUE (portfolio_id, account_id, revision_id)
);

CREATE TABLE bl2proof.projection (
  portfolio_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  current_revision_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  FOREIGN KEY (portfolio_id, account_id, current_revision_id)
    REFERENCES bl2proof.bindings(portfolio_id, account_id, revision_id)
);

CREATE TABLE bl2proof.events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  revision_id text NOT NULL,
  actor_user_id text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, revision_id) REFERENCES bl2proof.revisions(account_id, revision_id),
  UNIQUE (account_id, revision_id, from_status, to_status)
);

ALTER TABLE bl2proof.revisions OWNER TO bl2proof_owner;
ALTER TABLE bl2proof.bindings OWNER TO bl2proof_owner;
ALTER TABLE bl2proof.projection OWNER TO bl2proof_owner;
ALTER TABLE bl2proof.events OWNER TO bl2proof_owner;
ALTER TABLE bl2proof.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.projection FORCE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl2proof.events FORCE ROW LEVEL SECURITY;

CREATE POLICY revisions_owner ON bl2proof.revisions TO bl2proof_owner, bl2proof_runtime
  USING (actor_user_id = current_setting('bl2proof.actor_user_id', true));
CREATE POLICY bindings_owner ON bl2proof.bindings TO bl2proof_owner, bl2proof_runtime
  USING (EXISTS (SELECT 1 FROM bl2proof.revisions r WHERE r.account_id=bindings.account_id AND r.revision_id=bindings.revision_id AND r.actor_user_id=current_setting('bl2proof.actor_user_id', true)));
CREATE POLICY projection_owner ON bl2proof.projection TO bl2proof_owner, bl2proof_runtime
  USING (EXISTS (SELECT 1 FROM investing.investment_accounts a WHERE a.id=projection.account_id AND a.owner_user_id=current_setting('bl2proof.actor_user_id', true)));
CREATE POLICY events_owner ON bl2proof.events TO bl2proof_owner, bl2proof_runtime
  USING (actor_user_id = current_setting('bl2proof.actor_user_id', true));

CREATE OR REPLACE FUNCTION bl2proof.canonical_sha256(p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp AS $$ SELECT encode(public.digest(p_payload::text, 'sha256'), 'hex') $$;

CREATE OR REPLACE FUNCTION bl2proof.event_on_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, bl2proof, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO bl2proof.events(account_id,revision_id,actor_user_id,from_status,to_status)
    VALUES (NEW.account_id,NEW.revision_id,NEW.actor_user_id,OLD.status,NEW.status);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER revisions_transition_event
AFTER UPDATE OF status ON bl2proof.revisions
FOR EACH ROW EXECUTE FUNCTION bl2proof.event_on_transition();

CREATE OR REPLACE FUNCTION bl2proof.create_draft(
  p_account uuid, p_revision text, p_actor text, p_key text, p_payload jsonb, p_hash text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, bl2proof, investing, pg_temp AS $$
DECLARE existing bl2proof.revisions%ROWTYPE; computed text; current_revision text; portfolio_id uuid;
BEGIN
  IF p_actor IS DISTINCT FROM current_setting('bl2proof.actor_user_id', true) THEN RAISE EXCEPTION 'ACTOR_MISMATCH'; END IF;
  computed := bl2proof.canonical_sha256(p_payload);
  IF p_hash IS DISTINCT FROM computed THEN RAISE EXCEPTION 'PAYLOAD_HASH_MISMATCH'; END IF;
  PERFORM 1 FROM investing.investment_accounts a WHERE a.id=p_account AND a.owner_user_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_OWNED'; END IF;
  SELECT p.id, pr.current_revision_id INTO portfolio_id,current_revision
  FROM investing.portfolios p LEFT JOIN bl2proof.projection pr ON pr.portfolio_id=p.id
  WHERE p.investment_account_id=p_account FOR UPDATE OF p;
  IF FOUND AND EXISTS (SELECT 1 FROM investing.portfolios WHERE investment_account_id=p_account AND id<>portfolio_id)
    THEN RAISE EXCEPTION 'PORTFOLIO_SELECTION_REQUIRED'; END IF;
  SELECT r.* INTO existing FROM bl2proof.revisions r
    WHERE r.account_id=p_account AND r.actor_user_id=p_actor AND r.idempotency_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF existing.input_sha256 <> computed OR existing.input_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN existing.revision_id;
  END IF;
  INSERT INTO bl2proof.revisions(account_id,revision_id,actor_user_id,idempotency_key,input_payload,input_sha256,supersedes,status)
  VALUES(p_account,p_revision,p_actor,p_key,p_payload,computed,current_revision,'PENDING');
  RETURN p_revision;
END $$;

CREATE OR REPLACE FUNCTION bl2proof.apply_revision(
  p_account uuid,p_portfolio uuid,p_revision text,p_actor text,p_expected_version bigint,p_fail boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, bl2proof, investing, pg_temp AS $$
DECLARE old_revision text; actual_version bigint; old_status text; selected_revision bl2proof.revisions%ROWTYPE;
BEGIN
  IF p_actor IS DISTINCT FROM current_setting('bl2proof.actor_user_id', true) THEN RAISE EXCEPTION 'ACTOR_MISMATCH'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bl2:'||p_portfolio::text,20261025));
  PERFORM 1 FROM investing.portfolios p JOIN investing.investment_accounts a ON a.id=p.investment_account_id
   WHERE p.id=p_portfolio AND p.investment_account_id=p_account AND a.owner_user_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'PORTFOLIO_NOT_AUTHORIZED'; END IF;
  SELECT current_revision_id,version INTO old_revision,actual_version FROM bl2proof.projection WHERE portfolio_id=p_portfolio FOR UPDATE;
  actual_version := COALESCE(actual_version,0);
  IF actual_version <> p_expected_version THEN RAISE EXCEPTION 'STALE_VERSION'; END IF;
  SELECT r.* INTO selected_revision FROM bl2proof.revisions r
   WHERE r.account_id=p_account AND r.revision_id=p_revision AND r.actor_user_id=p_actor AND r.status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_NOT_PENDING'; END IF;
  IF selected_revision.supersedes IS DISTINCT FROM old_revision THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
  INSERT INTO bl2proof.bindings(account_id,revision_id,portfolio_id) VALUES(p_account,p_revision,p_portfolio);
  UPDATE bl2proof.revisions SET status='APPLIED',status_changed_at=clock_timestamp()
   WHERE account_id=p_account AND revision_id=p_revision AND status='PENDING';
  IF old_revision IS NULL THEN
    INSERT INTO bl2proof.projection VALUES(p_portfolio,p_account,p_revision,1);
  ELSE
    SELECT status INTO old_status FROM bl2proof.revisions WHERE account_id=p_account AND revision_id=old_revision FOR UPDATE;
    IF old_status <> 'APPLIED' THEN RAISE EXCEPTION 'CURRENT_NOT_APPLIED'; END IF;
    UPDATE bl2proof.revisions SET status='SUPERSEDED',status_changed_at=clock_timestamp()
      WHERE account_id=p_account AND revision_id=old_revision;
    UPDATE bl2proof.projection SET current_revision_id=p_revision,version=version+1 WHERE portfolio_id=p_portfolio;
  END IF;
  IF p_fail THEN RAISE EXCEPTION 'INJECTED_FAILURE'; END IF;
END $$;

CREATE OR REPLACE FUNCTION bl2proof.abandon_revision(p_account uuid,p_revision text,p_actor text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, bl2proof, investing, pg_temp AS $$
DECLARE current_status text;
BEGIN
  IF p_actor IS DISTINCT FROM current_setting('bl2proof.actor_user_id', true) THEN RAISE EXCEPTION 'ACTOR_MISMATCH'; END IF;
  SELECT r.status INTO current_status FROM bl2proof.revisions r JOIN investing.investment_accounts a ON a.id=r.account_id
   WHERE r.account_id=p_account AND r.revision_id=p_revision AND r.actor_user_id=p_actor AND a.owner_user_id=p_actor FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF current_status='ABANDONED' THEN RETURN 'ABANDONED'; END IF;
  IF current_status <> 'PENDING' THEN RAISE EXCEPTION 'INVALID_ABANDON_TRANSITION'; END IF;
  UPDATE bl2proof.revisions SET status='ABANDONED',status_changed_at=clock_timestamp()
    WHERE account_id=p_account AND revision_id=p_revision AND status='PENDING';
  RETURN 'ABANDONED';
END $$;

CREATE OR REPLACE FUNCTION bl2proof.assert_current_revision_applied()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, bl2proof, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='projection' AND NEW.current_revision_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM bl2proof.revisions r WHERE r.account_id=NEW.account_id AND r.revision_id=NEW.current_revision_id AND r.status='APPLIED')
  THEN RAISE EXCEPTION 'CURRENT_REVISION_NOT_APPLIED'; END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER projection_current_revision_check
AFTER INSERT OR UPDATE ON bl2proof.projection DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bl2proof.assert_current_revision_applied();

REVOKE ALL ON SCHEMA bl2proof FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA bl2proof FROM PUBLIC, anon, authenticated, bl2proof_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bl2proof FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA bl2proof TO bl2proof_runtime;
GRANT EXECUTE ON FUNCTION bl2proof.create_draft(uuid,text,text,text,jsonb,text), bl2proof.apply_revision(uuid,uuid,text,text,bigint,boolean), bl2proof.abandon_revision(uuid,text,text) TO bl2proof_runtime;

COMMIT;
