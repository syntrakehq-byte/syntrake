create or replace function public.read_investing_dashboard_compact_v1(
  p_user_id text,
  p_portfolio_id text default 'primary'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with selected_account as (
    select a.*
    from public.investing_accounts a
    where a.user_id = p_user_id
      and a.portfolio_id = p_portfolio_id
      and a.environment in ('paper', 'simulation')
      and a.status = 'active'
    order by case a.environment when 'paper' then 0 else 1 end, a.created_at asc
    limit 1
  )
  select jsonb_build_object(
    'settings', (
      select to_jsonb(s) from public.user_settings s
      where s.user_id = p_user_id limit 1
    ),
    'plan', (
      select to_jsonb(p) from public.plans p
      where p.user_id = p_user_id and p.mode = 'investing'
      order by p.created_at desc limit 1
    ),
    'account', (select to_jsonb(a) from selected_account a),
    'cycles', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from (
        select d.id, d.day_key, d.created_at, d.canonical_result
        from public.investing_daily_cycles d
        where d.user_id = p_user_id and d.portfolio_id = p_portfolio_id
        order by d.created_at desc limit 30
      ) c
    ), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (
        select e.id, e.operational_state, e.approval_status, e.execution_decision,
               e.version, e.decision_fingerprint, e.created_at
        from public.investing_execution_queue e
        where e.user_id = p_user_id and e.portfolio_id = p_portfolio_id
        order by e.created_at desc limit 20
      ) q
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at desc)
      from (
        select r.id, r.queue_id, r.symbol, r.side, r.status, r.quantity,
               r.cumulative_filled_quantity, r.created_at, r.updated_at
        from public.investing_orders r
        where r.user_id = p_user_id and r.portfolio_id = p_portfolio_id
          and r.environment = 'paper'
        order by r.created_at desc limit 20
      ) o
    ), '[]'::jsonb),
    'cash', coalesce((
      select jsonb_agg(to_jsonb(b))
      from (
        select b.currency, b.available_amount, b.settled_amount, b.reserved_amount, b.as_of
        from public.investing_cash_balances b
        where b.account_id = (select id from selected_account)
      ) b
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(to_jsonb(h))
      from (
        select h.symbol, h.quantity, h.reserved_quantity, h.cost_basis, h.currency, h.updated_at
        from public.investing_positions h
        where h.account_id = (select id from selected_account) and h.quantity > 0
      ) h
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.read_investing_dashboard_compact_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.read_investing_dashboard_compact_v1(text, text)
  to service_role;
