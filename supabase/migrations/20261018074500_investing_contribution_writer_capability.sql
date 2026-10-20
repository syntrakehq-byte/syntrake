-- R0-A candidate: strictly internal contribution-writer capability.
-- Forward-only; never modify already rehearsed Investing migrations.
-- DO NOT deploy without a separate explicitly authorized rehearsal gate.
--
-- NOLOGIN: never reachable as a Supabase Data API / Clerk browser role.
-- No service_role or postgres application credential is provisioned here.
-- This capability is granted only to a separately audited server-side
-- login role after runtime auth/session and connection management pass.
--
-- Custom settings are context, NOT cryptographic proof: an untrusted
-- connection holding this role could forge them. Only the trusted
-- server adapter may obtain this DB authority after Clerk auth().
create role investing_contribution_writer nologin noinherit nobypassrls;

grant usage on schema investing to investing_contribution_writer;

-- SELECT exists only for auth checks and exact ledger bookkeeping.
grant select on
  investing.investment_accounts,
  investing.account_memberships,
  investing.ledger_accounts,
  investing.operation_idempotency_keys,
  investing.ledger_transactions,
  investing.ledger_entries
to investing_contribution_writer;

grant insert on
  investing.operation_idempotency_keys,
  investing.ledger_transactions,
  investing.ledger_entries
to investing_contribution_writer;

-- Narrow mutable fields: idempotent result set once, draft -> posted.
grant update(result) on investing.operation_idempotency_keys
  to investing_contribution_writer;
grant update(status) on investing.ledger_transactions
  to investing_contribution_writer;
grant usage on sequence investing.ledger_entries_id_seq
  to investing_contribution_writer;

-- No authority to mutate accounts, owner/member records, subledgers,
-- or historical ledger entries. Authenticated/anon grants are unchanged.
-- Membership SELECT is deliberately nonrecursive: account SELECT then
-- verifies membership. No user-supplied account ID confers ownership.
create policy contribution_writer_membership_read
on investing.account_memberships for select
to investing_contribution_writer using (
  user_id = (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and role = 'owner'
);

create policy contribution_writer_account_read
on investing.investment_accounts for select
to investing_contribution_writer using (
  owner_user_id = (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (
    select 1 from investing.account_memberships m
    where m.investment_account_id = investment_accounts.id
      and m.user_id = investment_accounts.owner_user_id
      and m.role = 'owner'
  )
);

-- This direct lookup is relied upon by the immutable ledger-account
-- id/currency relationship and contributor transaction.
create policy contribution_writer_subledger_read
on investing.ledger_accounts for select
to investing_contribution_writer using (
  exists (select 1 from investing.investment_accounts a
          where a.id = ledger_accounts.investment_account_id)
);

create policy contribution_writer_idempotency_read
on investing.operation_idempotency_keys for select
to investing_contribution_writer using (
  user_id = (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = operation_idempotency_keys.investment_account_id)
);
create policy contribution_writer_idempotency_insert
on investing.operation_idempotency_keys for insert
to investing_contribution_writer with check (
  user_id = (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = operation_idempotency_keys.investment_account_id)
);
create policy contribution_writer_idempotency_update
on investing.operation_idempotency_keys for update
to investing_contribution_writer using (
  user_id = (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = operation_idempotency_keys.investment_account_id)
) with check (
  user_id = (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = operation_idempotency_keys.investment_account_id)
);

create policy contribution_writer_journal_read
on investing.ledger_transactions for select
to investing_contribution_writer using (
  idempotency_user_id =
    (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = ledger_transactions.investment_account_id)
);
create policy contribution_writer_journal_insert
on investing.ledger_transactions for insert
to investing_contribution_writer with check (
  idempotency_user_id =
    (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = ledger_transactions.investment_account_id)
);
create policy contribution_writer_journal_update
on investing.ledger_transactions for update
to investing_contribution_writer using (
  idempotency_user_id =
    (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = ledger_transactions.investment_account_id)
) with check (
  idempotency_user_id =
    (select nullif(current_setting('syntrake.actor_user_id', true), ''))
  and exists (select 1 from investing.investment_accounts a
              where a.id = ledger_transactions.investment_account_id)
);

create policy contribution_writer_entry_read
on investing.ledger_entries for select
to investing_contribution_writer using (
  exists (select 1 from investing.ledger_transactions t
          where t.id = ledger_entries.transaction_id
            and t.investment_account_id = ledger_entries.investment_account_id)
);
create policy contribution_writer_entry_insert
on investing.ledger_entries for insert
to investing_contribution_writer with check (
  exists (select 1 from investing.ledger_transactions t
          where t.id = ledger_entries.transaction_id
            and t.investment_account_id = ledger_entries.investment_account_id)
);
