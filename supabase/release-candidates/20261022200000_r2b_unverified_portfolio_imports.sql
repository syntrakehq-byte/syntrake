-- SYNTRAKE R2-B1 CANDIDATE ONLY. NOT APPLIED TO ANY REMOTE DATABASE.
-- Stacked on R2-A draft SHA 86adfc0461dd84e087b757f5bf5ab40023024886
-- This SQL deliberately persists declared coverage; missing rows never imply zero.
-- Requires existing Investing read-only foundation + canonical owner guard.
-- No browser/RPC access, NO writer LOGIN, no service_role authorization.
-- This is a forward candidate under release-candidates/, NOT migrations/.

-- Existing portfolio.account composite identity permits same-account parent FKs.
alter table investing.portfolios
  add constraint portfolios_id_investment_account_unique unique (id, investment_account_id);

-- Separate non-login capability. A future runtime role/secret must be
-- explicitly authorized and provisioned with SET ROLE, not deployed here.
create role investing_import_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

create table investing.portfolio_import_snapshots (
  id uuid primary key default gen_random_uuid(),
  investment_account_id uuid not null,
  portfolio_id uuid not null,
  actor_user_id text not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{15,127}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  import_schema_version text not null check (import_schema_version = 'R2_IMPORT_DRAFT_V1'),
  evidence_status text not null default 'UNVERIFIED' check (evidence_status = 'UNVERIFIED'),
  snapshot_status text not null default 'draft' check (snapshot_status in ('draft','finalized')),
  expected_cash_rows int not null check (expected_cash_rows between 0 and 100),
  expected_position_rows int not null check (expected_position_rows between 0 and 5000),
  expected_planned_rows int not null check (expected_planned_rows between 0 and 500),
  -- Both coverage flags are only the user's assertions, not broker truth.
  reported_cash_coverage text not null
    check (reported_cash_coverage in ('NOT_REPORTED','PARTIAL','ASSERTED_COMPLETE')),
  reported_position_coverage text not null
    check (reported_position_coverage in ('NOT_REPORTED','PARTIAL','ASSERTED_COMPLETE')),
  check (expected_cash_rows + expected_position_rows > 0),
  check (reported_cash_coverage = 'ASSERTED_COMPLETE'
    or (reported_cash_coverage = 'NOT_REPORTED' and expected_cash_rows = 0)
    or (reported_cash_coverage = 'PARTIAL' and expected_cash_rows > 0)),
  check (reported_position_coverage = 'ASSERTED_COMPLETE'
    or (reported_position_coverage = 'NOT_REPORTED' and expected_position_rows = 0)
    or (reported_position_coverage = 'PARTIAL' and expected_position_rows > 0)),
  declared_portfolio_name text not null check (length(btrim(declared_portfolio_name)) between 1 and 120),
  declared_base_currency char(3) not null references investing.supported_currencies(code),
  source_kind text not null check (source_kind in ('MANUAL_ENTRY','DOCUMENT_EXTRACTED')),
  source_reference text not null check (length(source_reference) between 8 and 128),
  source_as_of timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, investment_account_id, portfolio_id),
  unique (investment_account_id, actor_user_id, idempotency_key),
  unique (investment_account_id, portfolio_id, source_reference),
  foreign key (portfolio_id, investment_account_id)
    references investing.portfolios (id, investment_account_id),
  foreign key (investment_account_id, actor_user_id)
    references investing.account_memberships (investment_account_id, user_id)
);

create index portfolio_import_snapshots_portfolio_history_idx
 on investing.portfolio_import_snapshots (investment_account_id, portfolio_id, created_at, id);

create table investing.portfolio_import_cash (
  snapshot_id uuid not null,
  investment_account_id uuid not null,
  portfolio_id uuid not null,
  currency char(3) not null references investing.supported_currencies(code),
  reported_amount_minor numeric(38,0) not null check (reported_amount_minor >= 0),
  primary key (snapshot_id, currency),
  foreign key (snapshot_id, investment_account_id, portfolio_id)
    references investing.portfolio_import_snapshots(id, investment_account_id, portfolio_id)
);

create table investing.portfolio_import_positions (
  snapshot_id uuid not null,
  investment_account_id uuid not null,
  portfolio_id uuid not null,
  isin char(12) not null check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  mic char(4) not null check (mic ~ '^[A-Z0-9]{4}$'),
  quote_currency char(3) not null references investing.supported_currencies(code),
  quantity_atoms numeric(38,0) not null check (quantity_atoms > 0),
  reported_cost_currency char(3) references investing.supported_currencies(code),
  reported_cost_minor numeric(38,0) check (reported_cost_minor >= 0),
  primary key (snapshot_id, isin, mic, quote_currency),
  check ((reported_cost_currency is null) = (reported_cost_minor is null)),
  foreign key (snapshot_id, investment_account_id, portfolio_id)
    references investing.portfolio_import_snapshots(id, investment_account_id, portfolio_id)
);

create table investing.portfolio_import_planned_contributions (
  snapshot_id uuid not null,
  investment_account_id uuid not null,
  portfolio_id uuid not null,
  line_number int not null check (line_number >= 0),
  currency char(3) not null references investing.supported_currencies(code),
  planned_amount_minor numeric(38,0) not null check (planned_amount_minor > 0),
  due_date date not null,
  realized boolean not null default false check (realized = false),
  primary key (snapshot_id, line_number),
  foreign key (snapshot_id, investment_account_id, portfolio_id)
    references investing.portfolio_import_snapshots(id, investment_account_id, portfolio_id)
);

-- Corrections append a NEW snapshot. A draft may be finalized only once.
-- All children are INSERT-only while parent is draft, then permanently sealed.
create function investing.guard_portfolio_import_header()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, investing
as $guard$
begin
  if TG_OP = 'DELETE' then
    raise exception 'portfolio import is immutable' using errcode = '55000';
  end if;
  if old.snapshot_status <> 'draft' or new.snapshot_status <> 'finalized'
    or (to_jsonb(new)-'snapshot_status') is distinct from (to_jsonb(old)-'snapshot_status') then
    raise exception 'portfolio import may only finalize draft once' using errcode = '55000';
  end if;
  return new;
end
$guard$;

create function investing.guard_portfolio_import_child()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, investing
as $guard$
declare current_status text;
begin
  if TG_OP <> 'INSERT' then
    raise exception 'portfolio import child is immutable' using errcode = '55000';
  end if;
  select snapshot_status into current_status
    from investing.portfolio_import_snapshots
   where id=NEW.snapshot_id
     and investment_account_id=NEW.investment_account_id
     and portfolio_id=NEW.portfolio_id
   for update;
  if current_status is distinct from 'draft' then
    raise exception 'cannot append to finalized portfolio import' using errcode = '55000';
  end if;
  return new;
end
$guard$;

-- At COMMIT every import must be finalized and contain precisely the number
-- of declared records. No partial snapshot may survive a worker crash.
create function investing.assert_portfolio_import_complete()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, investing
as $check$
declare row_data investing.portfolio_import_snapshots%ROWTYPE;
begin
  select * into row_data from investing.portfolio_import_snapshots where id=NEW.id;
  if not found or row_data.snapshot_status <> 'finalized' then
    raise exception 'unfinalized portfolio import' using errcode='23514';
  end if;
  if (select count(*) from investing.portfolio_import_cash where snapshot_id=NEW.id) <> row_data.expected_cash_rows
  or (select count(*) from investing.portfolio_import_positions where snapshot_id=NEW.id) <> row_data.expected_position_rows
  or (select count(*) from investing.portfolio_import_planned_contributions where snapshot_id=NEW.id) <> row_data.expected_planned_rows then
    raise exception 'incomplete portfolio import' using errcode='23514';
  end if;
  return null;
end
$check$;

create trigger immutable_portfolio_import_snapshots
before update or delete on investing.portfolio_import_snapshots
for each row execute function investing.guard_portfolio_import_header();
create trigger immutable_portfolio_import_cash
before insert or update or delete on investing.portfolio_import_cash
for each row execute function investing.guard_portfolio_import_child();
create trigger immutable_portfolio_import_positions
before insert or update or delete on investing.portfolio_import_positions
for each row execute function investing.guard_portfolio_import_child();
create trigger immutable_portfolio_import_planned
before insert or update or delete on investing.portfolio_import_planned_contributions
for each row execute function investing.guard_portfolio_import_child();
create constraint trigger assert_portfolio_import_complete
after insert on investing.portfolio_import_snapshots
deferrable initially deferred
for each row execute function investing.assert_portfolio_import_complete();

-- Do NOT alter any existing R1 privileges, policies or ledger state.
-- Only the FOUR newly created tables receive explicit least-privilege grants.
revoke all on investing.portfolio_import_snapshots,
  investing.portfolio_import_cash,
  investing.portfolio_import_positions,
  investing.portfolio_import_planned_contributions
  from PUBLIC, anon, authenticated;

revoke execute on function investing.guard_portfolio_import_header()
  from PUBLIC, anon, authenticated;
revoke execute on function investing.guard_portfolio_import_child()
  from PUBLIC, anon, authenticated;
revoke execute on function investing.assert_portfolio_import_complete()
  from PUBLIC, anon, authenticated;

alter table investing.portfolio_import_snapshots enable row level security;
alter table investing.portfolio_import_snapshots force row level security;
alter table investing.portfolio_import_cash enable row level security;
alter table investing.portfolio_import_cash force row level security;
alter table investing.portfolio_import_positions enable row level security;
alter table investing.portfolio_import_positions force row level security;
alter table investing.portfolio_import_planned_contributions enable row level security;
alter table investing.portfolio_import_planned_contributions force row level security;

grant usage on schema investing to investing_import_writer;
grant select on investing.investment_accounts, investing.account_memberships,
  investing.portfolios to investing_import_writer;
grant select, insert on investing.portfolio_import_snapshots,
  investing.portfolio_import_cash,
  investing.portfolio_import_positions,
  investing.portfolio_import_planned_contributions to investing_import_writer;
grant update(snapshot_status) on investing.portfolio_import_snapshots to investing_import_writer;
-- Only one safe draft -> finalized UPDATE; no DELETE or UPDATE of data facts.
-- No ledger or financial account INSERT/UPDATE, and no exposed RPC.

-- Worker identity is set by a verified server-only session on the same
-- transaction/connection. The NOLOGIN role never authenticates directly.
create policy import_writer_own_membership on investing.account_memberships
for select to investing_import_writer
using (user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
  and role = 'owner');

create policy import_writer_own_account on investing.investment_accounts
for select to investing_import_writer
using (owner_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
  and exists (
    select 1 from investing.account_memberships m
    where m.investment_account_id = investment_accounts.id
      and m.user_id = investment_accounts.owner_user_id
      and m.role = 'owner'
  ));

create policy import_writer_own_portfolio on investing.portfolios
for select to investing_import_writer
using (exists (
  select 1 from investing.investment_accounts a
  where a.id = portfolios.investment_account_id
    and a.owner_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
));

create policy import_writer_snapshot_select on investing.portfolio_import_snapshots
for select to investing_import_writer
using (
  actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
  and exists (
    select 1 from investing.portfolios p
    where p.id = portfolio_import_snapshots.portfolio_id
      and p.investment_account_id = portfolio_import_snapshots.investment_account_id
  )
);

create policy import_writer_snapshot_insert on investing.portfolio_import_snapshots
for insert to investing_import_writer
with check (
  actor_user_id = nullif(current_setting('syntrake.actor_user_id', true),'')
  and evidence_status = 'UNVERIFIED'
  and exists (
    select 1 from investing.portfolios p
    where p.id = portfolio_import_snapshots.portfolio_id
      and p.investment_account_id = portfolio_import_snapshots.investment_account_id
  )
);

create policy import_writer_snapshot_finalize on investing.portfolio_import_snapshots
for update to investing_import_writer
using (
  actor_user_id = nullif(current_setting('syntrake.actor_user_id',true),'')
  and snapshot_status = 'draft'
)
with check (
  actor_user_id = nullif(current_setting('syntrake.actor_user_id',true),'')
  and snapshot_status = 'finalized'
);

create policy import_writer_cash_select on investing.portfolio_import_cash
for select to investing_import_writer
using (exists (
  select 1 from investing.portfolio_import_snapshots s
  where s.id = portfolio_import_cash.snapshot_id
    and s.investment_account_id = portfolio_import_cash.investment_account_id
    and s.portfolio_id = portfolio_import_cash.portfolio_id
));
create policy import_writer_cash_insert on investing.portfolio_import_cash
for insert to investing_import_writer
with check (exists (
  select 1 from investing.portfolio_import_snapshots s
  where s.id = portfolio_import_cash.snapshot_id
    and s.investment_account_id = portfolio_import_cash.investment_account_id
    and s.portfolio_id = portfolio_import_cash.portfolio_id
));

create policy import_writer_positions_select on investing.portfolio_import_positions
for select to investing_import_writer
using (exists (
  select 1 from investing.portfolio_import_snapshots s
  where s.id = portfolio_import_positions.snapshot_id
    and s.investment_account_id = portfolio_import_positions.investment_account_id
    and s.portfolio_id = portfolio_import_positions.portfolio_id
));
create policy import_writer_positions_insert on investing.portfolio_import_positions
for insert to investing_import_writer
with check (exists (
  select 1 from investing.portfolio_import_snapshots s
  where s.id = portfolio_import_positions.snapshot_id
    and s.investment_account_id = portfolio_import_positions.investment_account_id
    and s.portfolio_id = portfolio_import_positions.portfolio_id
));

create policy import_writer_planned_select on investing.portfolio_import_planned_contributions
for select to investing_import_writer
using (exists (
  select 1 from investing.portfolio_import_snapshots s
  where s.id = portfolio_import_planned_contributions.snapshot_id
    and s.investment_account_id = portfolio_import_planned_contributions.investment_account_id
    and s.portfolio_id = portfolio_import_planned_contributions.portfolio_id
));
create policy import_writer_planned_insert on investing.portfolio_import_planned_contributions
for insert to investing_import_writer
with check (exists (
  select 1 from investing.portfolio_import_snapshots s
  where s.id = portfolio_import_planned_contributions.snapshot_id
    and s.investment_account_id = portfolio_import_planned_contributions.investment_account_id
    and s.portfolio_id = portfolio_import_planned_contributions.portfolio_id
));
