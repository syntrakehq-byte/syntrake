\set ON_ERROR_STOP on
\set account_a '00000000-0000-4000-8000-0000000000a1'
\set portfolio_a '00000000-0000-4000-8000-0000000000a2'
\set account_b '00000000-0000-4000-8000-0000000000b1'
\set portfolio_b '00000000-0000-4000-8000-0000000000b2'
\set actor_a 'pg6_actor_a'
\set actor_b 'pg6_actor_b'
\set payload '{"capitalDeclared":"0.00","currency":"EUR"}'
\set payload2 '{"capitalDeclared":"0.00","currency":"EUR","correction":true}'
\set payload3 '{"capitalDeclared":"0.00","currency":"EUR","abandon":true}'
\set payload4 '{"capitalDeclared":"0.00","currency":"EUR","rollback":true}'
BEGIN;
SET LOCAL ROLE bl2proof_runtime;
SET LOCAL bl2proof.actor_user_id = :'actor_a';
SELECT bl2proof.create_draft(:'account_a'::uuid,'rev-pg6-1',:'actor_a','pg6-idempotency-001',:'payload'::jsonb,bl2proof.canonical_sha256(:'payload'::jsonb));
SELECT bl2proof.apply_revision(:'account_a'::uuid,:'portfolio_a'::uuid,'rev-pg6-1',:'actor_a',0,false);
SELECT bl2proof.create_draft(:'account_a'::uuid,'rev-pg6-1-replay',:'actor_a','pg6-idempotency-001',:'payload'::jsonb,bl2proof.canonical_sha256(:'payload'::jsonb));
SELECT bl2proof.create_draft(:'account_a'::uuid,'rev-pg6-2',:'actor_a','pg6-idempotency-002',:'payload2'::jsonb,bl2proof.canonical_sha256(:'payload2'::jsonb));
SELECT bl2proof.apply_revision(:'account_a'::uuid,:'portfolio_a'::uuid,'rev-pg6-2',:'actor_a',1,false);
SELECT bl2proof.create_draft(:'account_a'::uuid,'rev-pg6-3',:'actor_a','pg6-idempotency-003',:'payload3'::jsonb,bl2proof.canonical_sha256(:'payload3'::jsonb));
SELECT bl2proof.abandon_revision(:'account_a'::uuid,'rev-pg6-3',:'actor_a');
SELECT bl2proof.abandon_revision(:'account_a'::uuid,'rev-pg6-3',:'actor_a');
DO $$ BEGIN
  BEGIN
    PERFORM bl2proof.create_draft('00000000-0000-4000-8000-0000000000b1'::uuid,'rev-pg6-cross','pg6_actor_a','pg6-idempotency-cross','{"capitalDeclared":"0.00","currency":"EUR"}'::jsonb,bl2proof.canonical_sha256('{"capitalDeclared":"0.00","currency":"EUR"}'::jsonb));
    RAISE EXCEPTION 'cross-account operation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'ACCOUNT_NOT_OWNED' THEN RAISE; END IF;
  END;
END $$;
SELECT bl2proof.create_draft(:'account_a'::uuid,'rev-pg6-4',:'actor_a','pg6-idempotency-004',:'payload4'::jsonb,bl2proof.canonical_sha256(:'payload4'::jsonb));
DO $$ BEGIN
  BEGIN
    PERFORM bl2proof.apply_revision('00000000-0000-4000-8000-0000000000a1'::uuid,'00000000-0000-4000-8000-0000000000a2'::uuid,'rev-pg6-4','pg6_actor_a',0,false);
    RAISE EXCEPTION 'stale version unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'STALE_VERSION' THEN RAISE; END IF;
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM bl2proof.apply_revision('00000000-0000-4000-8000-0000000000a1'::uuid,'00000000-0000-4000-8000-0000000000a2'::uuid,'rev-pg6-4','pg6_actor_a',2,true);
    RAISE EXCEPTION 'injected rollback unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'INJECTED_FAILURE' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE s text; v bigint; e bigint; tx bigint; en bigint; b boolean;
BEGIN
  SELECT status INTO s FROM bl2proof.revisions WHERE account_id='00000000-0000-4000-8000-0000000000a1'::uuid AND revision_id='rev-pg6-1';
  IF s <> 'SUPERSEDED' THEN RAISE EXCEPTION 'first revision status assertion failed'; END IF;
  SELECT version,current_revision_id INTO v,s FROM bl2proof.projection WHERE portfolio_id='00000000-0000-4000-8000-0000000000a2'::uuid;
  IF v <> 2 OR s <> 'rev-pg6-2' THEN RAISE EXCEPTION 'projection assertion failed'; END IF;
  SELECT count(*) INTO e FROM bl2proof.events WHERE account_id='00000000-0000-4000-8000-0000000000a1'::uuid;
  IF e <> 4 THEN RAISE EXCEPTION 'event count assertion failed: %',e; END IF;
  SELECT count(*) > 0 INTO b FROM bl2proof.revisions WHERE account_id='00000000-0000-4000-8000-0000000000a1'::uuid AND revision_id='rev-pg6-4' AND status='PENDING';
  IF NOT b THEN RAISE EXCEPTION 'rollback did not preserve pending draft'; END IF;
  SELECT count(*) INTO tx FROM investing.ledger_transactions WHERE investment_account_id='00000000-0000-4000-8000-0000000000a1'::uuid;
  IF tx <> 0 THEN RAISE EXCEPTION 'ledger transactions changed'; END IF;
  SELECT count(*) INTO en FROM investing.ledger_entries WHERE investment_account_id='00000000-0000-4000-8000-0000000000a1'::uuid;
  IF en <> 0 THEN RAISE EXCEPTION 'ledger entries changed'; END IF;
  SELECT has_table_privilege('bl2proof_runtime','bl2proof.revisions','INSERT') INTO b;
  IF b THEN RAISE EXCEPTION 'runtime has direct INSERT'; END IF;
  SELECT has_table_privilege('bl2proof_runtime','bl2proof.revisions','UPDATE') INTO b;
  IF b THEN RAISE EXCEPTION 'runtime has direct UPDATE'; END IF;
END $$;
ROLLBACK;
