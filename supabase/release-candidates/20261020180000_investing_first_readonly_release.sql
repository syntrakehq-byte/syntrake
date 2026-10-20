-- SYNTRAKE Investing READ-ONLY first production migration CANDIDATE.
-- NOT APPLIED; outside supabase/migrations to avoid historical timestamp drift.
-- Operator must independently authorize exact version, project ref, SHA and SQL.
-- Source: supabase/migrations/20261017160000_investing_core_foundation.sql; Git blob e572262de0c07a39132d7417febb0b551a7ddc64
-- Source: supabase/migrations/20261018070000_investing_owner_membership_guard.sql; Git blob 0773eb0713defa1d267e881880f869fceaa0dda0
-- Prod currently contains newer remote_schema migration 20261017191056.
-- DO NOT supabase db push historical files, insert fixtures, or enable writers.

-- BEGIN EXACT FOUNDATION SQL
-- R0-A candidate only. Never applied to a remote database by this PR.
-- Fresh schema, no existing financial state. Do not revise after production application.
create schema if not exists investing;

create table investing.supported_currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  minor_digits smallint not null check (minor_digits between 0 and 3)
);
insert into investing.supported_currencies(code, minor_digits) values
  ('EUR',2),('USD',2),('GBP',2),('CHF',2),('JPY',0),('KWD',3);

create table investing.identity_accounts (
  user_id text primary key check (length(user_id) > 0),
  created_at timestamptz not null default now()
);

create table investing.investment_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null references investing.identity_accounts(user_id),
  name text not null check (length(trim(name)) > 0),
  base_currency char(3) not null references investing.supported_currencies(code),
  created_at timestamptz not null default now()
);

create table investing.portfolios (
  id uuid primary key default gen_random_uuid(),
  investment_account_id uuid not null references investing.investment_accounts(id),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table investing.account_memberships (
  investment_account_id uuid not null references investing.investment_accounts(id),
  user_id text not null references investing.identity_accounts(user_id),
  role text not null check (role in ('owner', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (investment_account_id, user_id)
);

-- A portfolio investment account owns multiple internal bookkeeping accounts.
-- Money is posted between distinct ledger accounts within one investment account.
create table investing.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  investment_account_id uuid not null references investing.investment_accounts(id),
  code text not null check (code in ('cash', 'external_clearing', 'position_cost', 'income', 'expense', 'equity')),
  currency char(3) not null references investing.supported_currencies(code),
  created_at timestamptz not null default now(),
  unique (investment_account_id, id, currency),
  unique (investment_account_id, code, currency)
);

-- This row MUST be reserved in the same SQL transaction that writes/finalizes
-- its journal. It is not itself proof of an authorized contribution.
create table investing.operation_idempotency_keys (
  investment_account_id uuid not null references investing.investment_accounts(id),
  user_id text not null references investing.identity_accounts(user_id),
  key text not null check (length(key) between 16 and 128),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (investment_account_id, user_id, key)
);

create table investing.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  investment_account_id uuid not null references investing.investment_accounts(id),
  idempotency_user_id text not null,
  idempotency_key text not null,
  status text not null default 'draft' check (status in ('draft','posted')),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, investment_account_id),
  unique (investment_account_id, idempotency_user_id, idempotency_key),
  foreign key (investment_account_id, idempotency_user_id, idempotency_key)
    references investing.operation_idempotency_keys(investment_account_id,user_id,key)
);

-- A user-reported external reference identifies one declared movement per
-- account, even if a caller mistakenly retries with a different idempotency key.
create unique index ledger_user_reported_external_ref_uniq
on investing.ledger_transactions (investment_account_id, (provenance->>'externalReference'))
where provenance->>'kind' = 'USER_REPORTED';

create table investing.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null,
  investment_account_id uuid not null,
  ledger_account_id uuid not null,
  direction text not null check (direction in ('debit', 'credit')),
  currency char(3) not null,
  amount_minor numeric not null check (amount_minor > 0 and amount_minor = trunc(amount_minor) and amount_minor < power(10::numeric, 38)),
  created_at timestamptz not null default now(),
  foreign key (transaction_id, investment_account_id)
    references investing.ledger_transactions(id,investment_account_id),
  foreign key (investment_account_id, ledger_account_id, currency)
    references investing.ledger_accounts(investment_account_id,id,currency)
);

create index account_memberships_user_idx on investing.account_memberships(user_id);
create index ledger_transactions_account_idx on investing.ledger_transactions(investment_account_id,created_at);
create index ledger_entries_tx_idx on investing.ledger_entries(transaction_id);
create index ledger_entries_subaccount_idx on investing.ledger_entries(ledger_account_id,currency);

-- Subledger identity and currency must never be retroactively rewritten.
create function investing.prevent_subledger_mutation()
returns trigger language plpgsql security invoker set search_path = pg_catalog, investing
as $body$
begin
  raise exception 'bookkeeping account identity is immutable' using errcode = '55000';
end
$body$;
create trigger immutable_ledger_accounts
before update or delete on investing.ledger_accounts
for each row execute function investing.prevent_subledger_mutation();

-- Idempotency identity and request hash are immutable. A result can be filled
-- once, but cannot be silently replaced or reinterpreted as another request.
create function investing.protect_idempotency_key()
returns trigger language plpgsql security invoker set search_path = pg_catalog, investing
as $body$
begin
  if TG_OP = 'DELETE' then
    raise exception 'idempotency record is immutable' using errcode = '55000';
  end if;
  if new.investment_account_id is distinct from old.investment_account_id
     or new.user_id is distinct from old.user_id
     or new.key is distinct from old.key
     or new.request_hash is distinct from old.request_hash
     or new.created_at is distinct from old.created_at
     or old.result is not null or new.result is null then
    raise exception 'idempotency identity/hash is immutable' using errcode = '55000';
  end if;
  return new;
end
$body$;
create trigger protect_idempotency_record
before update or delete on investing.operation_idempotency_keys
for each row execute function investing.protect_idempotency_key();

-- A journal header must be draft at insert. After posting, only append-only
-- compensating journals can correct a movement, never mutation of the past.
create function investing.protect_ledger_transaction()
returns trigger language plpgsql security invoker set search_path = pg_catalog, investing
as $body$
begin
  if TG_OP = 'DELETE' then
    raise exception 'ledger transaction is immutable' using errcode = '55000';
  end if;
  if TG_OP = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'new ledger transaction must be draft' using errcode = '55000';
    end if;
    return new;
  end if;
  if old.status <> 'draft' or new.status <> 'posted'
     or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'ledger transaction can only finalize draft to posted' using errcode = '55000';
  end if;
  return new;
end
$body$;

create trigger protect_ledger_transactions
before insert or update or delete on investing.ledger_transactions
for each row execute function investing.protect_ledger_transaction();

create function investing.protect_ledger_entry()
returns trigger language plpgsql security invoker set search_path = pg_catalog, investing
as $body$
declare journal_status text;
begin
  if TG_OP <> 'INSERT' then
    raise exception 'ledger entries are immutable' using errcode = '55000';
  end if;
  select t.status into journal_status
    from investing.ledger_transactions t
   where t.id = new.transaction_id and t.investment_account_id = new.investment_account_id
   for update;
  if journal_status is distinct from 'draft' then
    raise exception 'entries can only be added to a draft journal' using errcode = '55000';
  end if;
  return new;
end
$body$;

create trigger protect_ledger_entries
before insert or update or delete on investing.ledger_entries
for each row execute function investing.protect_ledger_entry();

-- The deferred constraint runs at COMMIT, not before all entries were inserted.
-- Each currency must independently balance, with at least two distinct
-- bookkeeping accounts. An empty or still-draft journal cannot commit.
create function investing.assert_posted_journal()
returns trigger language plpgsql security invoker set search_path = pg_catalog, investing
as $body$
declare
  target_tx uuid;
  journal_status text;
  invalid_group_count bigint;
begin
  if TG_TABLE_NAME = 'ledger_transactions' then
    target_tx := new.id;
  else
    target_tx := new.transaction_id;
  end if;
  select t.status into journal_status from investing.ledger_transactions t where t.id = target_tx;
  if journal_status is distinct from 'posted' then
    raise exception 'journal % must be posted before commit', target_tx using errcode = '23514';
  end if;
  select count(*) into invalid_group_count from (
    select e.currency
      from investing.ledger_entries e
     where e.transaction_id = target_tx
     group by e.currency
    having count(*) < 2 or count(distinct e.ledger_account_id) < 2
        or sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end) <> 0
  ) invalid_groups;
  if invalid_group_count > 0
     or not exists (select 1 from investing.ledger_entries e where e.transaction_id = target_tx) then
    raise exception 'journal % is empty, single-account, or unbalanced', target_tx using errcode = '23514';
  end if;
  return new;
end
$body$;

create constraint trigger posted_journal_header
after insert on investing.ledger_transactions
deferrable initially deferred
for each row execute function investing.assert_posted_journal();

create constraint trigger posted_journal_entries
after insert on investing.ledger_entries
deferrable initially deferred
for each row execute function investing.assert_posted_journal();

-- Restricted to maintenance/audit authority. Not an authenticated user RPC.
create function investing.ledger_integrity_issues()
returns table(transaction_id uuid, issue text)
language sql stable security invoker set search_path = pg_catalog, investing
as $body$
  with per_tx as (
    select t.id, t.status,
           count(e.id) as entry_count,
           count(distinct e.ledger_account_id) as distinct_accounts
    from investing.ledger_transactions t
    left join investing.ledger_entries e on e.transaction_id = t.id
    group by t.id, t.status
  ),
  groups as (
    select e.transaction_id, e.currency,
           sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end) as delta,
           count(*) as entry_count,
           count(distinct e.ledger_account_id) as distinct_accounts
    from investing.ledger_entries e
    group by e.transaction_id,e.currency
  )
  select p.id, 'NOT_POSTED'::text from per_tx p where p.status <> 'posted'
  union all
  select p.id, 'TOO_FEW_ENTRIES'::text from per_tx p where p.entry_count < 2
  union all
  select g.transaction_id, 'INVALID_CURRENCY_GROUP'::text
    from groups g
   where g.delta <> 0 or g.entry_count < 2 or g.distinct_accounts < 2
$body$;

-- Financial tables are never writable directly by anon/authenticated.
revoke all on schema investing from public, anon, authenticated;
grant usage on schema investing to authenticated;
revoke all on all tables in schema investing from public, anon, authenticated;
grant select on investing.supported_currencies,
  investing.identity_accounts, investing.investment_accounts,
  investing.portfolios, investing.account_memberships,
  investing.ledger_accounts, investing.ledger_transactions,
  investing.ledger_entries to authenticated;
revoke execute on all functions in schema investing from public, anon, authenticated;

alter table investing.supported_currencies enable row level security;
alter table investing.identity_accounts enable row level security;
alter table investing.investment_accounts enable row level security;
alter table investing.portfolios enable row level security;
alter table investing.account_memberships enable row level security;
alter table investing.ledger_accounts enable row level security;
alter table investing.operation_idempotency_keys enable row level security;
alter table investing.ledger_transactions enable row level security;
alter table investing.ledger_entries enable row level security;

alter table investing.identity_accounts force row level security;
alter table investing.investment_accounts force row level security;
alter table investing.portfolios force row level security;
alter table investing.account_memberships force row level security;
alter table investing.ledger_accounts force row level security;
alter table investing.operation_idempotency_keys force row level security;
alter table investing.ledger_transactions force row level security;
alter table investing.ledger_entries force row level security;

create policy currency_read on investing.supported_currencies
for select to authenticated using (true);
create policy identity_self on investing.identity_accounts
for select to authenticated using (user_id = (select auth.jwt()->>'sub'));
create policy membership_self on investing.account_memberships
for select to authenticated using (user_id = (select auth.jwt()->>'sub'));
create policy account_member on investing.investment_accounts
for select to authenticated using (exists (
  select 1 from investing.account_memberships m
  where m.investment_account_id = investment_accounts.id
    and m.user_id = (select auth.jwt()->>'sub')
));
create policy portfolio_member on investing.portfolios
for select to authenticated using (exists (
  select 1 from investing.account_memberships m
  where m.investment_account_id = portfolios.investment_account_id
    and m.user_id = (select auth.jwt()->>'sub')
));
create policy subledger_member on investing.ledger_accounts
for select to authenticated using (exists (
  select 1 from investing.account_memberships m
  where m.investment_account_id = ledger_accounts.investment_account_id
    and m.user_id = (select auth.jwt()->>'sub')
));
create policy journal_member on investing.ledger_transactions
for select to authenticated using (exists (
  select 1 from investing.account_memberships m
  where m.investment_account_id = ledger_transactions.investment_account_id
    and m.user_id = (select auth.jwt()->>'sub')
));
create policy entry_member on investing.ledger_entries
for select to authenticated using (exists (
  select 1 from investing.account_memberships m
  where m.investment_account_id = ledger_entries.investment_account_id
    and m.user_id = (select auth.jwt()->>'sub')
));
-- END EXACT FOUNDATION SQL

-- BEGIN EXACT OWNER GUARD SQL
-- R0-A forward-only corrective candidate. NEVER retrofit the already rehearsed
-- 20261017160000 foundation migration. PG17 isolated CI must execute both.
--
-- An investment account's canonical owner MUST have exactly one matching
-- owner membership. Other users may hold viewer/operator memberships, never
-- an additional owner membership. Enforced at COMMIT to permit atomic
-- account + membership provisioning in one transaction.
--
-- This protects against accidental inconsistent privileged writes; it does
-- not authorize an operator and does not grant DML to browser roles.

create function investing.assert_canonical_owner_membership()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, investing
as $body$
declare
  target_account uuid;
  account_ids uuid[];
  canonical_owner text;
begin
  if TG_TABLE_NAME = 'investment_accounts' then
    account_ids := case when TG_OP = 'DELETE'
      then array[OLD.id] else array[NEW.id] end;
  elsif TG_OP = 'DELETE' then
    account_ids := array[OLD.investment_account_id];
  elsif TG_OP = 'UPDATE' then
    -- Reassigning a membership can orphan the OLD account even when the
    -- NEW account remains valid. Both sides must be checked at COMMIT.
    account_ids := array[OLD.investment_account_id, NEW.investment_account_id];
  else
    account_ids := array[NEW.investment_account_id];
  end if;

  foreach target_account in array account_ids loop
    -- Coordinate with the server-only contribution writer. Both use exactly
    -- the same transaction-scoped key before checking financial authority.
    -- This prevents an owner/membership COMMIT from overtaking a writer that
    -- has already established its verified-actor authorization, without
    -- granting UPDATE on the investment_accounts table to that writer.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('syntrake.investing.account:' || target_account::text, 20261018)
    );

    -- Serialize competing account ownership/membership transitions. This
    -- guard runs deferred so provisioning must be one atomic transaction.
    select a.owner_user_id into canonical_owner
      from investing.investment_accounts a
     where a.id = target_account
     for update;

    -- A deleted account has no surviving owner to validate. FK constraints
    -- independently protect references from orphaned memberships.
    if not found then
      continue;
    end if;

    if not exists (
      select 1 from investing.account_memberships m
      where m.investment_account_id = target_account
        and m.user_id = canonical_owner
        and m.role = 'owner'
    ) or exists (
      select 1 from investing.account_memberships m
      where m.investment_account_id = target_account
        and m.role = 'owner'
        and m.user_id <> canonical_owner
    ) then
      raise exception 'investment account canonical owner membership invariant violated'
        using errcode = '23514';
    end if;
  end loop;

  return null;
end
$body$;

-- Only DML privileges already granted to a future authorized server writer
-- can invoke these triggers. No auth/anon function execution is granted.
revoke execute on function investing.assert_canonical_owner_membership()
  from public, anon, authenticated;

create constraint trigger investing_account_owner_consistency
after insert or update on investing.investment_accounts
deferrable initially deferred
for each row execute function investing.assert_canonical_owner_membership();

create constraint trigger investing_membership_owner_consistency
after insert or update or delete on investing.account_memberships
deferrable initially deferred
for each row execute function investing.assert_canonical_owner_membership();
-- END EXACT OWNER GUARD SQL

-- First release permits ONLY account discovery. Other underlying financial
-- tables must not be read by authenticated browser/PostgREST callers before
-- separately reviewed portfolio/cash/ledger release contracts and RLS tests.
-- Keep account_memberships SELECT: account_member policy requires it.
REVOKE SELECT ON
  investing.identity_accounts,
  investing.portfolios,
  investing.ledger_accounts,
  investing.ledger_transactions,
  investing.ledger_entries
FROM authenticated;

-- No external financial writes, no service_role adapter, no user data.
-- Apply only after version reconciliation, signed Clerk/Supabase JWT/RLS
-- evidence, and explicit operator authorization on exact prod target.
