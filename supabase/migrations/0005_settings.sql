-- 0005 — Default settings and realtime

insert into public.app_settings (key, value) values
  ('high_value_threshold', '10000'::jsonb),
  ('approval_prefix', '"APR"'::jsonb),
  ('request_prefix', '"REQ"'::jsonb)
on conflict (key) do nothing;

-- Live notifications (Realtime respects RLS: users only receive their own rows)
alter publication supabase_realtime add table public.notifications;
