-- Run after canonical R2-C2 baseline, provisioner, and candidate.sql.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE bl2proof_runtime;
SET LOCAL bl2proof.actor_user_id = :'actor';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM investing.investment_accounts WHERE id = :'account'::uuid) THEN
    RAISE EXCEPTION 'missing provisioned account';
  END IF;
END $$;

SELECT bl2proof.create_draft(:'account'::uuid, :'revision1', :'actor', :'key1', :'payload'::jsonb, bl2proof.canonical_sha256(:'payload'::jsonb));
SELECT bl2proof.apply_revision(:'account'::uuid, :'portfolio'::uuid, :'revision1', :'actor', 0, false);
SELECT bl2proof.create_draft(:'account'::uuid, :'revision2', :'actor', :'key2', :'payload2'::jsonb, bl2proof.canonical_sha256(:'payload2'::jsonb));
SELECT bl2proof.apply_revision(:'account'::uuid, :'portfolio'::uuid, :'revision2', :'actor', 1, false);

DO $$ DECLARE s text; v bigint; n bigint;
BEGIN
  SELECT r.status INTO s FROM bl2proof.revisions r WHERE r.account_id=:'account'::uuid AND r.revision_id=:'revision1';
  IF s <> 'SUPERSEDED' THEN RAISE EXCEPTION 'first revision not superseded'; END IF;
  SELECT version INTO v FROM bl2proof.projection WHERE portfolio_id=:'portfolio'::uuid;
  IF v <> 2 THEN RAISE EXCEPTION 'unexpected projection version %', v; END IF;
  SELECT count(*) INTO n FROM investing.ledger_transactions WHERE investment_account_id=:'account'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'ledger was modified'; END IF;
END $$;

ROLLBACK;
