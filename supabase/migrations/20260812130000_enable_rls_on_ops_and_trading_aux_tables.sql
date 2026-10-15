alter table if exists public.marketing_content_items enable row level security;
alter table if exists public.marketing_leads enable row level security;
alter table if exists public.trading_followed_positions enable row level security;
alter table if exists public.feature_usage_events enable row level security;
alter table if exists public.paper_trade_user_locks enable row level security;
alter table if exists public.paper_trade_runs enable row level security;

-- These tables are primarily accessed through trusted server routes using the
-- service role. Authenticated policies are kept owner-scoped for any future
-- direct Supabase client reads, while anon receives no policy.

drop policy if exists marketing_content_items_select_own on public.marketing_content_items;
create policy marketing_content_items_select_own
  on public.marketing_content_items for select to authenticated
  using (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_content_items_insert_own on public.marketing_content_items;
create policy marketing_content_items_insert_own
  on public.marketing_content_items for insert to authenticated
  with check (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_content_items_update_own on public.marketing_content_items;
create policy marketing_content_items_update_own
  on public.marketing_content_items for update to authenticated
  using (owner_user_id = (auth.jwt() ->> 'sub'))
  with check (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_content_items_delete_own on public.marketing_content_items;
create policy marketing_content_items_delete_own
  on public.marketing_content_items for delete to authenticated
  using (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_leads_select_own on public.marketing_leads;
create policy marketing_leads_select_own
  on public.marketing_leads for select to authenticated
  using (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_leads_insert_own on public.marketing_leads;
create policy marketing_leads_insert_own
  on public.marketing_leads for insert to authenticated
  with check (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_leads_update_own on public.marketing_leads;
create policy marketing_leads_update_own
  on public.marketing_leads for update to authenticated
  using (owner_user_id = (auth.jwt() ->> 'sub'))
  with check (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists marketing_leads_delete_own on public.marketing_leads;
create policy marketing_leads_delete_own
  on public.marketing_leads for delete to authenticated
  using (owner_user_id = (auth.jwt() ->> 'sub'));

drop policy if exists trading_followed_positions_select_own on public.trading_followed_positions;
create policy trading_followed_positions_select_own
  on public.trading_followed_positions for select to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists trading_followed_positions_insert_own on public.trading_followed_positions;
create policy trading_followed_positions_insert_own
  on public.trading_followed_positions for insert to authenticated
  with check (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists trading_followed_positions_update_own on public.trading_followed_positions;
create policy trading_followed_positions_update_own
  on public.trading_followed_positions for update to authenticated
  using (user_id = (auth.jwt() ->> 'sub'))
  with check (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists trading_followed_positions_delete_own on public.trading_followed_positions;
create policy trading_followed_positions_delete_own
  on public.trading_followed_positions for delete to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists feature_usage_events_select_own on public.feature_usage_events;
create policy feature_usage_events_select_own
  on public.feature_usage_events for select to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists feature_usage_events_insert_own on public.feature_usage_events;
create policy feature_usage_events_insert_own
  on public.feature_usage_events for insert to authenticated
  with check (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists paper_trade_user_locks_select_own on public.paper_trade_user_locks;
create policy paper_trade_user_locks_select_own
  on public.paper_trade_user_locks for select to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists paper_trade_runs_select_own on public.paper_trade_runs;
create policy paper_trade_runs_select_own
  on public.paper_trade_runs for select to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists paper_trade_runs_insert_own on public.paper_trade_runs;
create policy paper_trade_runs_insert_own
  on public.paper_trade_runs for insert to authenticated
  with check (user_id = (auth.jwt() ->> 'sub'));
