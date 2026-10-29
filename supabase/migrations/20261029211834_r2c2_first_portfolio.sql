-- R2-C2 candidate: Investing-only, first financial account and empty portfolio.
-- Strictly no SECURITY DEFINER RPC or public writer. The historical PR #23
-- exposed a privileged RPC; that approach is excluded from this candidate.
-- Private restricted NOLOGIN role; no remote SQL, login credentials or grants to browser.
-- NO Production/Preview DDL until exact candidate SHA/PG17 gate approved.
-- No brokerage order, cash, portfolio value, contribution or ledger transaction.
-- R2-A/R2-B1/R2-C predecessor migrations required.
create role investing_initial_provisioner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

create table investing.initial_portfolio_receipts (
  user_id text primary key references investing.identity_accounts(user_id),
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  account_id uuid not null unique references investing.investment_accounts(id),
  portfolio_id uuid not null unique,
  state text not null default 'STRUCTURE_CREATED_UNFUNDED'
    check (state = 'STRUCTURE_CREATED_UNFUNDED'),
  created_at timestamptz not null default now(),
  foreign key (portfolio_id,account_id)
    references investing.portfolios(id,investment_account_id)
);

alter table investing.initial_portfolio_receipts enable row level security;
alter table investing.initial_portfolio_receipts force row level security;
revoke all on investing.initial_portfolio_receipts from PUBLIC,anon,authenticated;

create function investing.reject_initial_receipt_mutation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,investing
as $guard$
begin
  raise exception 'first portfolio provisioning receipt is immutable'
    using errcode='55000';
end
$guard$;
create trigger immutable_initial_portfolio_receipt
before update or delete on investing.initial_portfolio_receipts
for each row execute function investing.reject_initial_receipt_mutation();
revoke execute on function investing.reject_initial_receipt_mutation()
from PUBLIC,anon,authenticated;

grant usage on schema investing to investing_initial_provisioner;
grant select on investing.supported_currencies to investing_initial_provisioner;
grant select,insert on investing.identity_accounts,
  investing.investment_accounts,
  investing.portfolios,
  investing.account_memberships,
  investing.ledger_accounts,
  investing.initial_portfolio_receipts
  to investing_initial_provisioner;
grant select on investing.onboarding_intents to investing_initial_provisioner;
-- The existing currency SELECT policy is for authenticated only; without
-- this new-role policy a perfectly valid EUR lookup appears absent under RLS.
create policy provisioner_currency_read on investing.supported_currencies
for select to investing_initial_provisioner using (true);

-- The existing owner/membership COMMIT trigger SELECT ... FOR UPDATE
-- needs UPDATE privilege, even though provisioning NEVER updates accounts.
-- NO LOGIN is provisioned and browser roles retain no financial INSERT.
-- FOR UPDATE inside R0 owner-consistency trigger needs an UPDATE capability,
-- but granting table-wide UPDATE would allow mutation of names/base currency.
-- Limit to canonical owner column and enforce old/new owner equality via RLS.
grant update(owner_user_id) on investing.investment_accounts to investing_initial_provisioner;

create policy provisioner_identity_select on investing.identity_accounts
for select to investing_initial_provisioner
using (user_id = nullif(current_setting('syntrake.actor_user_id',true),''));
create policy provisioner_identity_insert on investing.identity_accounts
for insert to investing_initial_provisioner
with check (user_id = nullif(current_setting('syntrake.actor_user_id',true),''));

create policy provisioner_account_select on investing.investment_accounts
for select to investing_initial_provisioner
using (owner_user_id = nullif(current_setting('syntrake.actor_user_id',true),''));
create policy provisioner_account_insert on investing.investment_accounts
for insert to investing_initial_provisioner
with check (owner_user_id = nullif(current_setting('syntrake.actor_user_id',true),''));
create policy provisioner_account_update on investing.investment_accounts
for update to investing_initial_provisioner
using (owner_user_id = nullif(current_setting('syntrake.actor_user_id',true),''))
with check (owner_user_id = nullif(current_setting('syntrake.actor_user_id',true),''));

create policy provisioner_membership_select on investing.account_memberships
for select to investing_initial_provisioner
using (
  user_id = nullif(current_setting('syntrake.actor_user_id',true),'')
  and role='owner'
);
create policy provisioner_membership_insert on investing.account_memberships
for insert to investing_initial_provisioner
with check (
 user_id = nullif(current_setting('syntrake.actor_user_id',true),'')
 and role='owner'
 and exists (
  select 1 from investing.investment_accounts a
  where a.id=investment_account_id and a.owner_user_id=user_id
 )
);

create policy provisioner_portfolio_select on investing.portfolios
for select to investing_initial_provisioner
using (exists (
 select 1 from investing.investment_accounts a
 where a.id=portfolios.investment_account_id
   and a.owner_user_id=nullif(current_setting('syntrake.actor_user_id',true),'')
));
create policy provisioner_portfolio_insert on investing.portfolios
for insert to investing_initial_provisioner
with check (exists (
 select 1 from investing.investment_accounts a
 where a.id=portfolios.investment_account_id
   and a.owner_user_id=nullif(current_setting('syntrake.actor_user_id',true),'')
));

create policy provisioner_subledger_select on investing.ledger_accounts
for select to investing_initial_provisioner
using (exists (
 select 1 from investing.investment_accounts a
 where a.id=ledger_accounts.investment_account_id
 and a.owner_user_id=nullif(current_setting('syntrake.actor_user_id',true),'')
));
create policy provisioner_subledger_insert on investing.ledger_accounts
for insert to investing_initial_provisioner
with check (exists (
 select 1 from investing.investment_accounts a
 where a.id=ledger_accounts.investment_account_id
 and a.owner_user_id=nullif(current_setting('syntrake.actor_user_id',true),'')
));

create policy provisioner_intent_select on investing.onboarding_intents
for select to investing_initial_provisioner
using (
 actor_user_id = nullif(current_setting('syntrake.actor_user_id',true),'')
 and evidence='USER_REPORTED' and financial_state='NOT_PROVISIONED'
);

create policy provisioner_receipt_select on investing.initial_portfolio_receipts
for select to investing_initial_provisioner
using (user_id = nullif(current_setting('syntrake.actor_user_id',true),''));
create policy provisioner_receipt_insert on investing.initial_portfolio_receipts
for insert to investing_initial_provisioner
with check (user_id = nullif(current_setting('syntrake.actor_user_id',true),''));

-- Existing Investing and Trading financial grants to authenticated/anon are
-- NOT widened. No password/LOGIN, RPC, SECURITY DEFINER, DML on Production.
