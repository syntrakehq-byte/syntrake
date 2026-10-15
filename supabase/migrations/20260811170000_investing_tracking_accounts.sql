-- Manual tracking accounts are non-executing Investing accounts used to model
-- real-world holdings without routing orders through the Paper lifecycle.

create or replace function public.investing_import_opening_position_v1(
  p_actor_user_id text,
  p_account_id uuid,
  p_symbol text,
  p_quantity numeric,
  p_total_cost numeric,
  p_currency text,
  p_acquired_at timestamptz,
  p_idempotency_key text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account public.investing_accounts%rowtype;
  v_existing public.investing_opening_position_imports%rowtype;
  v_position public.investing_positions%rowtype;
  v_import_id uuid;
  v_tx_id uuid;
  v_symbol text := upper(btrim(coalesce(p_symbol, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_acquired_at timestamptz := p_acquired_at;
  v_hash text;
  v_equity_account text;
begin
  if coalesce(btrim(p_actor_user_id), '') = '' then
    raise exception 'investing_actor_required';
  end if;
  if v_symbol !~ '^[A-Z0-9._-]{1,24}$' then
    raise exception 'investing_symbol_invalid';
  end if;
  if p_quantity is null or round(p_quantity, 12) <= 0 then
    raise exception 'investing_quantity_invalid';
  end if;
  if p_total_cost is null or round(p_total_cost, 8) <= 0 then
    raise exception 'investing_total_cost_invalid';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'investing_currency_invalid';
  end if;
  if v_acquired_at is null or v_acquired_at > now() + interval '1 minute' then
    raise exception 'investing_acquired_at_invalid';
  end if;
  if coalesce(length(btrim(p_idempotency_key)), 0) < 8 then
    raise exception 'investing_idempotency_key_invalid';
  end if;
  if coalesce(length(btrim(p_correlation_id)), 0) < 8 then
    raise exception 'investing_invalid_correlation_id';
  end if;

  select * into v_account
  from public.investing_accounts
  where id = p_account_id
    and user_id = p_actor_user_id
    and environment in ('paper', 'simulation')
    and status = 'active'
  for update;
  if not found then
    raise exception 'investing_account_not_found_or_forbidden';
  end if;
  if v_account.base_currency <> v_currency then
    raise exception 'investing_currency_mismatch';
  end if;

  v_equity_account := case
    when v_account.environment = 'simulation' then 'manual_tracking_equity'
    else 'paper_funding_equity'
  end;

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'account_id', p_account_id,
    'environment', v_account.environment,
    'symbol', v_symbol,
    'quantity', round(p_quantity, 12),
    'total_cost', round(p_total_cost, 8),
    'currency', v_currency,
    'acquired_at', v_acquired_at
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext('investing-opening-position:' || p_account_id::text || ':' || p_idempotency_key));

  select * into v_existing
  from public.investing_opening_position_imports
  where account_id = p_account_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception 'investing_idempotency_payload_mismatch';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'import_id', v_existing.id,
      'account_id', v_existing.account_id,
      'environment', v_account.environment,
      'symbol', v_existing.symbol,
      'quantity', v_existing.quantity,
      'total_cost', v_existing.total_cost,
      'currency', v_existing.currency
    );
  end if;

  select * into v_position
  from public.investing_positions
  where account_id = p_account_id
    and symbol = v_symbol
  for update;
  if found and v_position.currency <> v_currency then
    raise exception 'investing_position_currency_mismatch';
  end if;

  insert into public.investing_opening_position_imports(
    user_id, portfolio_id, account_id, symbol, quantity, total_cost, currency,
    acquired_at, idempotency_key, correlation_id, payload_hash
  ) values (
    p_actor_user_id, v_account.portfolio_id, p_account_id, v_symbol,
    round(p_quantity, 12), round(p_total_cost, 8), v_currency, v_acquired_at,
    p_idempotency_key, p_correlation_id, v_hash
  ) returning id into v_import_id;

  insert into public.investing_positions(account_id, symbol, quantity, cost_basis, currency, opened_at)
  values (p_account_id, v_symbol, round(p_quantity, 12), round(p_total_cost, 8), v_currency, v_acquired_at)
  on conflict(account_id, symbol) do update set
    quantity = public.investing_positions.quantity + excluded.quantity,
    cost_basis = public.investing_positions.cost_basis + excluded.cost_basis,
    opened_at = least(public.investing_positions.opened_at, excluded.opened_at),
    version = public.investing_positions.version + 1,
    updated_at = now();

  insert into public.investing_ledger_transactions(
    account_id, correlation_id, source_type, source_id, currency, payload_hash,
    idempotency_key, actor
  ) values (
    p_account_id, p_correlation_id, 'opening_position_import', v_import_id::text,
    v_currency, v_hash, 'opening-position:' || p_idempotency_key, p_actor_user_id
  ) returning id into v_tx_id;

  insert into public.investing_ledger_entries(transaction_id, account_id, account_code, side, amount, currency) values
    (v_tx_id, p_account_id, 'investment_asset', 'debit', round(p_total_cost, 8), v_currency),
    (v_tx_id, p_account_id, v_equity_account, 'credit', round(p_total_cost, 8), v_currency);

  insert into public.investing_execution_events(
    user_id, portfolio_id, account_id, event_type, severity, environment,
    correlation_id, engine_version, payload
  ) values (
    p_actor_user_id, v_account.portfolio_id, p_account_id,
    case when v_account.environment = 'simulation' then 'manual_opening_position_imported' else 'paper_opening_position_imported' end,
    'info', v_account.environment, p_correlation_id, 'investing_v2',
    jsonb_build_object(
      'import_id', v_import_id,
      'symbol', v_symbol,
      'quantity', round(p_quantity, 12),
      'total_cost', round(p_total_cost, 8),
      'currency', v_currency
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'import_id', v_import_id,
    'account_id', p_account_id,
    'environment', v_account.environment,
    'symbol', v_symbol,
    'quantity', round(p_quantity, 12),
    'total_cost', round(p_total_cost, 8),
    'currency', v_currency
  );
end;
$$;

revoke all on function public.investing_import_opening_position_v1(text, uuid, text, numeric, numeric, text, timestamptz, text, text)
from public, anon, authenticated;
grant execute on function public.investing_import_opening_position_v1(text, uuid, text, numeric, numeric, text, timestamptz, text, text)
to service_role;
