-- R0-A TEMPORARY PREVIEW-ONLY FINANCIAL FIXTURE.
-- NOT a migration. NEVER add this file to supabase/migrations or run in production.
-- Target must be INDEPENDENTLY verified by the operator as
-- db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres.
-- This file DOES NOT verify the connection host; it is a separate mandatory gate.
--
-- Two controlled Clerk preview fixture accounts only (A and C). No cash amount,
-- ledger transaction, contribution or broker-confirmed movement is created.
-- One-shot: reruns or drift BLOCK, rather than silently modifying financial state.
begin isolation level serializable;
set local lock_timeout = '1500ms';
set local statement_timeout = '5000ms';

do $r0a_fixture$
declare
  owner_a text;
  owner_c text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('syntrake.r0a.subledgers.preview.20261018', 20261018)
  );

  if (select count(*) from supabase_migrations.schema_migrations
      where version::text in ('20261017191352','20261018074500','20261018112500')) <> 3 then
    raise exception 'R0A_PREVIEW_MIGRATION_BASELINE_BLOCKED';
  end if;

  if (select count(*) from investing.investment_accounts) <> 4
    or (select count(*) from investing.account_memberships) <> 4
    or (select count(*) from investing.ledger_accounts) <> 0
    or (select count(*) from investing.operation_idempotency_keys) <> 0
    or (select count(*) from investing.ledger_transactions) <> 0
    or (select count(*) from investing.ledger_entries) <> 0
    or (select count(*) from investing.ledger_integrity_issues()) <> 0
  then
    raise exception 'R0A_PREVIEW_FINANCIAL_BASELINE_BLOCKED';
  end if;

  select a.owner_user_id into owner_a
    from investing.investment_accounts a
   where a.id = 'f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid
     and a.name = 'R0-A Clerk A - PREVIEW TEST 2026-10-18' and a.base_currency = 'EUR';
  select a.owner_user_id into owner_c
    from investing.investment_accounts a
   where a.id = '676ae244-9ead-449c-861d-2f34a81285e3'::uuid
     and a.name = 'R0-A Clerk C - PREVIEW TEST 2026-10-18' and a.base_currency = 'EUR';

  if owner_a is null or owner_c is null or owner_a = owner_c
    or (select count(*) from investing.account_memberships m
        where (m.investment_account_id='f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid
               and m.user_id=owner_a and m.role='owner')
           or (m.investment_account_id='676ae244-9ead-449c-861d-2f34a81285e3'::uuid
               and m.user_id=owner_c and m.role='owner')) <> 2
    or exists (
      select 1 from investing.account_memberships m
      where m.investment_account_id in (
        'f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid,
        '676ae244-9ead-449c-861d-2f34a81285e3'::uuid
      ) and not (
        (m.investment_account_id='f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid
           and m.user_id=owner_a and m.role='owner')
        or
        (m.investment_account_id='676ae244-9ead-449c-861d-2f34a81285e3'::uuid
           and m.user_id=owner_c and m.role='owner')
      )
    )
  then
    raise exception 'R0A_PREVIEW_OWNER_MEMBERSHIP_BLOCKED';
  end if;
end
$r0a_fixture$;

insert into investing.ledger_accounts(investment_account_id,code,currency)
values
 ('f886c954-0a0f-419c-890a-b77ecb0c36cf','cash','EUR'),
 ('f886c954-0a0f-419c-890a-b77ecb0c36cf','external_clearing','EUR'),
 ('676ae244-9ead-449c-861d-2f34a81285e3','cash','EUR'),
 ('676ae244-9ead-449c-861d-2f34a81285e3','external_clearing','EUR');

do $verify$
begin
  if (select count(*) from investing.ledger_accounts
       where investment_account_id in (
         'f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid,
         '676ae244-9ead-449c-861d-2f34a81285e3'::uuid
       ) and currency='EUR'
         and code in ('cash','external_clearing')) <> 4
  then
    raise exception 'R0A_PREVIEW_SUBLEDGER_POSTCONDITION_FAILED';
  end if;
end
$verify$;

commit;
