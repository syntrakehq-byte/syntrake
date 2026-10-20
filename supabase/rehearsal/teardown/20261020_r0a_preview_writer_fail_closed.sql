-- SYNTRAKE R0-A: final shutdown of the isolated PREVIEW writer LOGIN.
-- AUTHORITATIVE TARGET: Supabase PREVIEW branch project zkqgpejlkgootkvkebhd ONLY.
-- NEVER add this file to supabase/migrations/ or apply it to production.
-- Enforced with state sentinels + role checks; SQL cannot by itself attest
-- the Supabase project ref. Operator MUST target the exact PREVIEW project.
-- Retains immutable, append-only journal proof. Makes all formerly armed
-- immutable Vercel Preview deployments unable to acquire the writer role.
-- Re-enable requires a separate reviewed explicit operator authorization.
begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '5000ms';
do $r0a$
declare
  a uuid := 'f886c954-0a0f-419c-890a-b77ecb0c36cf';
  c uuid := '676ae244-9ead-449c-861d-2f34a81285e3';
  tx_a uuid := '71229df7-8d5f-440c-a84e-4a851e3110ec';
  tx_c uuid := 'a5297571-e930-4a57-93fc-4cac68dd534d';
begin
  if current_user <> 'postgres'
    or (select count(*) from investing.investment_accounts
        where (id=a and name='R0-A Clerk A - PREVIEW TEST 2026-10-18')
           or (id=c and name='R0-A Clerk C - PREVIEW TEST 2026-10-18')) <> 2
    or (select count(*) from investing.ledger_transactions) <> 2
    or (select count(*) from investing.ledger_entries) <> 4
    or (select count(*) from investing.operation_idempotency_keys) <> 2
    or (select count(*) from investing.ledger_integrity_issues()) <> 0
    or (select count(*) from investing.ledger_transactions
        where (id=tx_a and investment_account_id=a and status='posted')
           or (id=tx_c and investment_account_id=c and status='posted')) <> 2
    or (select count(*) from investing.operation_idempotency_keys
        where (investment_account_id=a and result->>'transactionId'=tx_a::text)
           or (investment_account_id=c and result->>'transactionId'=tx_c::text)) <> 2
    or not exists(select 1 from pg_roles
                  where rolname='investing_writer_runtime' and rolcanlogin)
    or not pg_has_role('investing_writer_runtime',
                       'investing_contribution_writer','SET')
  then
    raise exception 'R0A_PREVIEW_TEARDOWN_BLOCKED: target/role/evidence mismatch'
      using errcode='P0001';
  end if;
end
$r0a$;

-- Block new server-side logins, and remove the NOLOGIN DML capability even
-- if existing pooler sessions remain alive. A transaction that already
-- acquired SET LOCAL ROLE cannot be retroactively undone; it is bounded by
-- statement_timeout and idle_in_transaction_session_timeout in the writer.
alter role investing_writer_runtime nologin;
revoke investing_contribution_writer from investing_writer_runtime;
commit;

-- Required independent acceptance after commit (read-only):
-- select rolcanlogin from pg_roles where rolname='investing_writer_runtime'; --> false
-- select pg_has_role('investing_writer_runtime',
--                    'investing_contribution_writer','SET'); --> false
-- select count(*) from investing.ledger_transactions; --> 2
-- select count(*) from investing.ledger_entries; --> 4
-- select count(*) from investing.operation_idempotency_keys; --> 2
-- select count(*) from investing.ledger_integrity_issues(); --> 0
