alter table public.user_settings
  add column if not exists investing_ui_state jsonb;
