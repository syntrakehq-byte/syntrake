-- SYNTRAKE R2-C: INVESTING-only onboarding declarations, Preview candidate.
-- No new financial account, cash, ledger, order or broker execution.
-- Never apply to Production without a separate exact-SHA release gate.
create table investing.onboarding_intents (
  id uuid primary key default gen_random_uuid(),
  actor_user_id text not null check (actor_user_id ~ '^user_[A-Za-z0-9_-]{5,120}$'),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9-]{36}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  pathway text not null check (pathway in ('HAS_PORTFOLIO','NEEDS_PORTFOLIO')),
  import_source text check (import_source in ('MANUAL_ENTRY','DOCUMENT_EXTRACTED','BROKER_CONNECT_LATER')),
  objective text check (objective in ('RETIREMENT','WEALTH_GROWTH','LARGE_PURCHASE','OTHER')),
  horizon_years int check (horizon_years between 1 and 60),
  loss_capacity text check (loss_capacity in ('LOW','MEDIUM','HIGH')),
  evidence text not null default 'USER_REPORTED' check (evidence='USER_REPORTED'),
  financial_state text not null default 'NOT_PROVISIONED' check (financial_state='NOT_PROVISIONED'),
  created_at timestamptz not null default now(),
  unique (actor_user_id,idempotency_key),
  check (
    (pathway='HAS_PORTFOLIO' and import_source is not null and objective is null and horizon_years is null and loss_capacity is null)
    or (pathway='NEEDS_PORTFOLIO' and import_source is null and objective is not null and horizon_years is not null and loss_capacity is not null)
  )
);

-- Historical choices are append-only; starting the other path appends a new
-- user-declared event, never rewrites the original onboarding statement.
create function investing.reject_onboarding_intent_mutation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,investing
as $guard$
begin
 raise exception 'onboarding intent history is immutable' using errcode='55000';
end
$guard$;
create trigger immutable_investing_onboarding_intent
before update or delete on investing.onboarding_intents
for each row execute function investing.reject_onboarding_intent_mutation();

alter table investing.onboarding_intents enable row level security;
alter table investing.onboarding_intents force row level security;

revoke all on investing.onboarding_intents from PUBLIC,anon,authenticated;
grant select,insert on investing.onboarding_intents to authenticated;

revoke execute on function investing.reject_onboarding_intent_mutation()
from PUBLIC,anon,authenticated;

create policy onboarding_intent_read_self on investing.onboarding_intents
for select to authenticated
using (
 actor_user_id = (select auth.jwt()->>'sub')
 and nullif((select auth.jwt()->>'sub'),'') is not null
);

create policy onboarding_intent_insert_self on investing.onboarding_intents
for insert to authenticated
with check (
 actor_user_id = (select auth.jwt()->>'sub')
 and nullif((select auth.jwt()->>'sub'),'') is not null
 and evidence='USER_REPORTED' and financial_state='NOT_PROVISIONED'
);

create index onboarding_intent_latest_by_actor
on investing.onboarding_intents(actor_user_id,created_at desc,id desc);
