-- BL2/BL3 canonical candidate. Documentation/review artifact; not a migration.
-- R2-C2 remains the only creator of investing.portfolios.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='investing_bl2bl3_runtime') THEN
    CREATE ROLE investing_bl2bl3_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='investing_bl2bl3_owner') THEN
    CREATE ROLE investing_bl2bl3_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE investing.onboarding_revisions (
  account_id uuid NOT NULL REFERENCES investing.investment_accounts(id),
  revision_id text NOT NULL,
  actor_user_id text NOT NULL REFERENCES investing.identity_accounts(user_id),
  idempotency_key text NOT NULL,
  input_payload jsonb NOT NULL,
  declared_capital jsonb NOT NULL,
  verified_capital jsonb,
  verification_status text NOT NULL CHECK (verification_status IN ('UNVERIFIED','VERIFIED_AUTHORIZED_SOURCE')),
  supersedes_revision_id text,
  status text NOT NULL CHECK (status IN ('PENDING','APPLIED','SUPERSEDED','ABANDONED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_changed_by text NOT NULL REFERENCES investing.identity_accounts(user_id),
  PRIMARY KEY (account_id, revision_id),
  UNIQUE (account_id, actor_user_id, idempotency_key),
  FOREIGN KEY (account_id, supersedes_revision_id)
    REFERENCES investing.onboarding_revisions(account_id, revision_id),
  CHECK (supersedes_revision_id IS NULL OR supersedes_revision_id <> revision_id),
  CHECK ((verification_status = 'UNVERIFIED' AND verified_capital IS NULL)
      OR (verification_status = 'VERIFIED_AUTHORIZED_SOURCE' AND verified_capital IS NOT NULL))
);

CREATE TABLE investing.onboarding_revision_portfolios (
  account_id uuid NOT NULL,
  revision_id text NOT NULL,
  portfolio_id uuid NOT NULL,
  PRIMARY KEY (account_id, revision_id),
  FOREIGN KEY (account_id, revision_id)
    REFERENCES investing.onboarding_revisions(account_id, revision_id),
  FOREIGN KEY (portfolio_id, account_id)
    REFERENCES investing.portfolios(id, investment_account_id),
  UNIQUE (portfolio_id, account_id, revision_id)
);

CREATE TABLE investing.onboarding_projections (
  portfolio_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  current_revision_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  FOREIGN KEY (portfolio_id, account_id, current_revision_id)
    REFERENCES investing.onboarding_revision_portfolios(portfolio_id, account_id, revision_id)
);

CREATE TABLE investing.onboarding_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  revision_id text NOT NULL,
  actor_user_id text NOT NULL REFERENCES investing.identity_accounts(user_id),
  from_status text,
  to_status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, revision_id)
    REFERENCES investing.onboarding_revisions(account_id, revision_id),
  UNIQUE (account_id, revision_id, from_status, to_status)
);

CREATE OR REPLACE FUNCTION investing.guard_onboarding_revision_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, investing, pg_temp AS $$
BEGIN
  IF NEW.status <> 'PENDING' OR NEW.actor_user_id IS DISTINCT FROM nullif(current_setting('syntrake.actor_user_id', true),'')
    OR NEW.status_changed_by IS DISTINCT FROM NEW.actor_user_id
    OR NEW.verification_status <> 'UNVERIFIED' OR NEW.verified_capital IS NOT NULL THEN
    RAISE EXCEPTION 'invalid onboarding revision insert' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER onboarding_revision_insert_guard
BEFORE INSERT ON investing.onboarding_revisions
FOR EACH ROW EXECUTE FUNCTION investing.guard_onboarding_revision_insert();

ALTER TABLE investing.onboarding_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_revision_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_revision_portfolios FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_projections FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.onboarding_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON investing.onboarding_revisions, investing.onboarding_revision_portfolios,
  investing.onboarding_projections, investing.onboarding_events FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA investing TO investing_bl2bl3_runtime;
GRANT USAGE ON SCHEMA investing TO investing_bl2bl3_owner;
GRANT SELECT ON investing.identity_accounts, investing.investment_accounts,
  investing.account_memberships, investing.portfolios, investing.initial_portfolio_receipts
  TO investing_bl2bl3_runtime, investing_bl2bl3_owner;
GRANT SELECT, INSERT ON investing.onboarding_revisions TO investing_bl2bl3_runtime;
GRANT SELECT, UPDATE ON investing.onboarding_revisions TO investing_bl2bl3_owner;
GRANT SELECT, INSERT ON investing.onboarding_revision_portfolios TO investing_bl2bl3_runtime;
GRANT SELECT, INSERT, UPDATE ON investing.onboarding_projections TO investing_bl2bl3_runtime;
GRANT SELECT, INSERT, UPDATE ON investing.onboarding_revision_portfolios, investing.onboarding_projections TO investing_bl2bl3_owner;
GRANT SELECT ON investing.onboarding_events TO investing_bl2bl3_runtime;
GRANT SELECT, INSERT ON investing.onboarding_events TO investing_bl2bl3_owner;
REVOKE UPDATE, DELETE ON investing.onboarding_revisions FROM investing_bl2bl3_runtime;
REVOKE INSERT, UPDATE, DELETE ON investing.onboarding_events FROM investing_bl2bl3_runtime;

CREATE POLICY bl2bl3_account_read ON investing.investment_accounts
  FOR SELECT TO investing_bl2bl3_runtime
  USING (owner_user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_membership_read ON investing.account_memberships
  FOR SELECT TO investing_bl2bl3_runtime
  USING (user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_portfolio_read ON investing.portfolios
  FOR SELECT TO investing_bl2bl3_runtime
  USING (EXISTS (SELECT 1 FROM investing.investment_accounts a
    WHERE a.id=portfolios.investment_account_id
      AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_receipt_read ON investing.initial_portfolio_receipts
  FOR SELECT TO investing_bl2bl3_runtime
  USING (user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_owner_account_read ON investing.investment_accounts
  FOR SELECT TO investing_bl2bl3_owner
  USING (owner_user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_owner_membership_read ON investing.account_memberships
  FOR SELECT TO investing_bl2bl3_owner
  USING (user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_owner_portfolio_read ON investing.portfolios
  FOR SELECT TO investing_bl2bl3_owner
  USING (EXISTS (SELECT 1 FROM investing.investment_accounts a WHERE a.id=portfolios.investment_account_id AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_owner_receipt_read ON investing.initial_portfolio_receipts
  FOR SELECT TO investing_bl2bl3_owner
  USING (user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_revision_access ON investing.onboarding_revisions
  FOR ALL TO investing_bl2bl3_runtime
  USING (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
    AND EXISTS (SELECT 1 FROM investing.investment_accounts a
      JOIN investing.account_memberships m ON m.investment_account_id=a.id
        AND m.user_id=a.owner_user_id AND m.role='owner'
      WHERE a.id=onboarding_revisions.account_id
        AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')))
  WITH CHECK (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
    AND verification_status='UNVERIFIED' AND verified_capital IS NULL
    AND EXISTS (SELECT 1 FROM investing.investment_accounts a
      JOIN investing.account_memberships m ON m.investment_account_id=a.id
        AND m.user_id=a.owner_user_id AND m.role='owner'
      WHERE a.id=onboarding_revisions.account_id
        AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_binding_access ON investing.onboarding_revision_portfolios
  FOR ALL TO investing_bl2bl3_runtime
  USING (EXISTS (SELECT 1 FROM investing.onboarding_revisions r
    WHERE r.account_id=onboarding_revision_portfolios.account_id AND r.revision_id=onboarding_revision_portfolios.revision_id
      AND r.actor_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')))
  WITH CHECK (EXISTS (SELECT 1 FROM investing.onboarding_revisions r
    WHERE r.account_id=onboarding_revision_portfolios.account_id AND r.revision_id=onboarding_revision_portfolios.revision_id
      AND r.actor_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_projection_access ON investing.onboarding_projections
  FOR ALL TO investing_bl2bl3_runtime
  USING (EXISTS (SELECT 1 FROM investing.portfolios p JOIN investing.investment_accounts a ON a.id=p.investment_account_id
    WHERE p.id=onboarding_projections.portfolio_id AND p.investment_account_id=onboarding_projections.account_id
      AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')))
  WITH CHECK (EXISTS (SELECT 1 FROM investing.portfolios p JOIN investing.investment_accounts a ON a.id=p.investment_account_id
    WHERE p.id=onboarding_projections.portfolio_id AND p.investment_account_id=onboarding_projections.account_id
      AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_event_access ON investing.onboarding_events
  FOR ALL TO investing_bl2bl3_runtime
  USING (EXISTS (SELECT 1 FROM investing.investment_accounts a
    JOIN investing.account_memberships m ON m.investment_account_id=a.id
      AND m.user_id=a.owner_user_id AND m.role='owner'
    WHERE a.id=onboarding_events.account_id
      AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')))
  WITH CHECK (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
    AND EXISTS (SELECT 1 FROM investing.investment_accounts a
      JOIN investing.account_memberships m ON m.investment_account_id=a.id
        AND m.user_id=a.owner_user_id AND m.role='owner'
      WHERE a.id=onboarding_events.account_id
        AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_owner_revision_access ON investing.onboarding_revisions
  FOR ALL TO investing_bl2bl3_owner
  USING (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),''))
  WITH CHECK (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),''));
CREATE POLICY bl2bl3_owner_binding_access ON investing.onboarding_revision_portfolios
  FOR ALL TO investing_bl2bl3_owner
  USING (EXISTS (SELECT 1 FROM investing.onboarding_revisions r WHERE r.account_id=onboarding_revision_portfolios.account_id AND r.revision_id=onboarding_revision_portfolios.revision_id AND r.actor_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')))
  WITH CHECK (EXISTS (SELECT 1 FROM investing.onboarding_revisions r WHERE r.account_id=onboarding_revision_portfolios.account_id AND r.revision_id=onboarding_revision_portfolios.revision_id AND r.actor_user_id=nullif(current_setting('syntrake.actor_user_id', true),'')));
CREATE POLICY bl2bl3_owner_projection_access ON investing.onboarding_projections
  FOR ALL TO investing_bl2bl3_owner
  USING (EXISTS (SELECT 1 FROM investing.portfolios p WHERE p.id=onboarding_projections.portfolio_id AND p.investment_account_id=onboarding_projections.account_id))
  WITH CHECK (EXISTS (SELECT 1 FROM investing.portfolios p WHERE p.id=onboarding_projections.portfolio_id AND p.investment_account_id=onboarding_projections.account_id));
CREATE POLICY bl2bl3_owner_event_access ON investing.onboarding_events
  FOR ALL TO investing_bl2bl3_owner
  USING (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),''))
  WITH CHECK (actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),''));

CREATE OR REPLACE FUNCTION investing.transition_onboarding_revision(
  p_account_id uuid, p_revision_id text, p_actor_user_id text,
  p_expected_status text, p_next_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, investing, pg_temp
AS $$
DECLARE current_status text;
BEGIN
  IF p_actor_user_id IS DISTINCT FROM nullif(current_setting('syntrake.actor_user_id', true),'') THEN
    RAISE EXCEPTION 'ACTOR_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM investing.investment_accounts a
    JOIN investing.account_memberships m ON m.investment_account_id=a.id
      AND m.user_id=a.owner_user_id AND m.role='owner'
    WHERE a.id=p_account_id AND a.owner_user_id=p_actor_user_id
  ) THEN RAISE EXCEPTION 'ACCOUNT_NOT_OWNED' USING ERRCODE='42501'; END IF;
  IF NOT ((p_expected_status='PENDING' AND p_next_status IN ('APPLIED','ABANDONED'))
       OR (p_expected_status='APPLIED' AND p_next_status='SUPERSEDED')) THEN
    RAISE EXCEPTION 'INVALID_REVISION_TRANSITION' USING ERRCODE='P0001';
  END IF;
  SELECT status INTO current_status
    FROM investing.onboarding_revisions
   WHERE account_id=p_account_id AND revision_id=p_revision_id
     AND actor_user_id=p_actor_user_id FOR UPDATE;
  IF NOT FOUND OR current_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'INVALID_REVISION_TRANSITION' USING ERRCODE='P0001';
  END IF;
  UPDATE investing.onboarding_revisions
     SET status=p_next_status, status_changed_at=clock_timestamp(), status_changed_by=p_actor_user_id
   WHERE account_id=p_account_id AND revision_id=p_revision_id;
  INSERT INTO investing.onboarding_events(account_id,revision_id,actor_user_id,from_status,to_status)
  VALUES (p_account_id,p_revision_id,p_actor_user_id,p_expected_status,p_next_status);
END $$;
ALTER FUNCTION investing.transition_onboarding_revision(uuid,text,text,text,text) OWNER TO investing_bl2bl3_owner;
REVOKE ALL ON FUNCTION investing.transition_onboarding_revision(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION investing.transition_onboarding_revision(uuid,text,text,text,text) TO investing_bl2bl3_runtime;
CREATE OR REPLACE FUNCTION investing.update_onboarding_projection(
  p_account_id uuid, p_portfolio_id uuid, p_revision_id text,
  p_expected_version bigint, p_expected_revision_id text, p_next_version bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, investing, pg_temp
AS $$
DECLARE changed integer;
BEGIN
  IF (p_expected_version=0 AND (p_expected_revision_id IS NOT NULL OR p_next_version <> 1))
     OR (p_expected_version>0 AND (p_expected_revision_id IS NULL OR p_next_version <> p_expected_version+1)) THEN
    RAISE EXCEPTION 'INVALID_PROJECTION_VERSION' USING ERRCODE='P0001';
  END IF;
  IF p_revision_id IS NOT DISTINCT FROM p_expected_revision_id THEN
    RAISE EXCEPTION 'REVISION_ALREADY_CURRENT' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM investing.investment_accounts a
    JOIN investing.account_memberships m ON m.investment_account_id=a.id
      AND m.user_id=a.owner_user_id AND m.role='owner'
    JOIN investing.portfolios p ON p.investment_account_id=a.id AND p.id=p_portfolio_id
    WHERE a.id=p_account_id AND a.owner_user_id=nullif(current_setting('syntrake.actor_user_id',true),'')
  ) THEN RAISE EXCEPTION 'PORTFOLIO_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM investing.onboarding_revisions r WHERE r.account_id=p_account_id AND r.revision_id=p_revision_id AND r.status='APPLIED')
    THEN RAISE EXCEPTION 'REVISION_NOT_APPLIED' USING ERRCODE='P0001'; END IF;
  INSERT INTO investing.onboarding_revision_portfolios(account_id,revision_id,portfolio_id)
  VALUES (p_account_id,p_revision_id,p_portfolio_id) ON CONFLICT DO NOTHING;
  IF p_expected_version=0 AND p_expected_revision_id IS NULL THEN
    INSERT INTO investing.onboarding_projections(portfolio_id,account_id,current_revision_id,version)
    VALUES (p_portfolio_id,p_account_id,p_revision_id,p_next_version)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed=1;
  END IF;
  UPDATE investing.onboarding_projections
     SET current_revision_id=p_revision_id, version=p_next_version
   WHERE portfolio_id=p_portfolio_id AND account_id=p_account_id
     AND version=p_expected_version
     AND current_revision_id IS NOT DISTINCT FROM p_expected_revision_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed=1;
END $$;
ALTER FUNCTION investing.update_onboarding_projection(uuid,uuid,text,bigint,text,bigint) OWNER TO investing_bl2bl3_owner;
REVOKE ALL ON FUNCTION investing.update_onboarding_projection(uuid,uuid,text,bigint,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION investing.update_onboarding_projection(uuid,uuid,text,bigint,text,bigint) TO investing_bl2bl3_runtime;
REVOKE UPDATE ON investing.onboarding_projections FROM investing_bl2bl3_runtime;
REVOKE INSERT ON investing.onboarding_revision_portfolios, investing.onboarding_projections FROM investing_bl2bl3_runtime;
ALTER FUNCTION investing.guard_onboarding_revision_insert() OWNER TO investing_bl2bl3_owner;
REVOKE ALL ON FUNCTION investing.guard_onboarding_revision_insert() FROM PUBLIC, anon, authenticated, investing_bl2bl3_runtime;

CREATE OR REPLACE FUNCTION investing.reject_onboarding_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, investing, pg_temp AS $$
BEGIN RAISE EXCEPTION 'onboarding events are append-only' USING ERRCODE='55000'; END $$;
ALTER FUNCTION investing.reject_onboarding_event_mutation() OWNER TO investing_bl2bl3_owner;
REVOKE ALL ON FUNCTION investing.reject_onboarding_event_mutation() FROM PUBLIC, anon, authenticated, investing_bl2bl3_runtime;
CREATE TRIGGER onboarding_events_append_only
BEFORE UPDATE OR DELETE ON investing.onboarding_events
FOR EACH ROW EXECUTE FUNCTION investing.reject_onboarding_event_mutation();

CREATE OR REPLACE FUNCTION investing.validate_onboarding_projection_commit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, investing, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM investing.onboarding_projections p
      LEFT JOIN investing.onboarding_revisions r
        ON r.account_id=p.account_id AND r.revision_id=p.current_revision_id
      WHERE p.portfolio_id=NEW.portfolio_id
       AND (r.revision_id IS NULL OR r.status <> 'APPLIED')
  ) THEN
    RAISE EXCEPTION 'PROJECTION_REVISION_NOT_APPLIED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION investing.validate_onboarding_projection_commit() OWNER TO investing_bl2bl3_owner;
REVOKE ALL ON FUNCTION investing.validate_onboarding_projection_commit() FROM PUBLIC, anon, authenticated, investing_bl2bl3_runtime;
CREATE CONSTRAINT TRIGGER onboarding_projection_commit_guard
AFTER INSERT OR UPDATE ON investing.onboarding_projections
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION investing.validate_onboarding_projection_commit();

CREATE OR REPLACE FUNCTION investing.validate_onboarding_revision_commit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, investing, pg_temp AS $$
DECLARE
  target_account uuid;
  applied_count integer;
  projection_count integer;
  applied_revision text;
  projected_revision text;
BEGIN
  target_account := CASE WHEN TG_OP='DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  SELECT count(*)::integer, min(revision_id)
    INTO applied_count, applied_revision
    FROM investing.onboarding_revisions
   WHERE account_id=target_account AND status='APPLIED';
  SELECT count(*)::integer, min(current_revision_id)
    INTO projection_count, projected_revision
    FROM investing.onboarding_projections
   WHERE account_id=target_account;
  IF NOT ((applied_count=0 AND projection_count=0)
      OR (applied_count=1 AND projection_count=1
          AND applied_revision IS NOT DISTINCT FROM projected_revision)) THEN
    RAISE EXCEPTION 'INVALID_ONBOARDING_APPLIED_PROJECTION_STATE' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION investing.validate_onboarding_revision_commit() OWNER TO investing_bl2bl3_owner;
REVOKE ALL ON FUNCTION investing.validate_onboarding_revision_commit() FROM PUBLIC, anon, authenticated, investing_bl2bl3_runtime;
CREATE CONSTRAINT TRIGGER onboarding_revision_commit_guard
AFTER INSERT OR UPDATE OR DELETE ON investing.onboarding_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION investing.validate_onboarding_revision_commit();

-- The private server role is provisioned separately and receives no ledger grants.
-- Clerk identity is established by the server connection, not by the browser.
COMMIT;
