create schema if not exists investing;

create table investing.identity_accounts (
  user_id text primary key,
  created_at timestamptz not null default now()
);

create table investing.investment_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null references investing.identity_accounts(user_id),
  name text not null check (length(trim(name)) > 0),
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
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

create table investing.operation_idempotency_keys (
  user_id text not null,
  key text not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table investing.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  idempotency_user_id text not null,
  idempotency_key text not null,
  provenance jsonb not null,
  created_at timestamptz not null default now(),
  unique (idempotency_user_id, idempotency_key)
);

create table investing.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references investing.ledger_transactions(id),
  account_id uuid not null references investing.investment_accounts(id),
  direction text not null check (direction in ('debit', 'credit')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor numeric(38,0) not null check (amount_minor > 0),
  created_at timestamptz not null default now()
);

create index on investing.account_memberships (user_id);
create index on investing.ledger_entries (account_id, currency);

create or replace function investing.assert_transaction_balanced()
returns trigger
language plpgsql
security invoker
as $$
declare
  imbalance numeric;
begin
  select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)
    into imbalance
    from investing.ledger_entries
   where transaction_id = new.transaction_id
     and currency = new.currency;
  if imbalance <> 0 then
    raise exception 'ledger transaction % is not balanced for %', new.transaction_id, new.currency;
  end if;
  return new;
end;
$$;

create constraint trigger ledger_transaction_balanced
after insert on investing.ledger_entries
deferrable initially deferred
for each row execute function investing.assert_transaction_balanced();

revoke update, delete on investing.ledger_transactions, investing.ledger_entries from authenticated;

alter table investing.identity_accounts enable row level security;
alter table investing.investment_accounts enable row level security;
alter table investing.portfolios enable row level security;
alter table investing.account_memberships enable row level security;
alter table investing.operation_idempotency_keys enable row level security;
alter table investing.ledger_transactions enable row level security;
alter table investing.ledger_entries enable row level security;

create policy identity_self on investing.identity_accounts for select to authenticated using (user_id = (select auth.jwt()->>'sub'));
create policy account_member_select on investing.investment_accounts for select to authenticated using (exists (select 1 from investing.account_memberships m where m.investment_account_id = investment_accounts.id and m.user_id = (select auth.jwt()->>'sub')));
create policy membership_self_select on investing.account_memberships for select to authenticated using (user_id = (select auth.jwt()->>'sub'));
create policy portfolio_member_select on investing.portfolios for select to authenticated using (exists (select 1 from investing.account_memberships m where m.investment_account_id = portfolios.investment_account_id and m.user_id = (select auth.jwt()->>'sub')));
create policy ledger_member_select on investing.ledger_entries for select to authenticated using (exists (select 1 from investing.account_memberships m where m.investment_account_id = ledger_entries.account_id and m.user_id = (select auth.jwt()->>'sub')));

revoke all on schema investing from public, anon, authenticated;
grant usage on schema investing to authenticated;
grant select on all tables in schema investing to authenticated;
