-- ============================================================================
-- MANUAL MIGRATION 0098: Define public.gen_request_no()
-- 
-- Fixes error:
-- "function public.gen_request_no() does not exist (No function matches the
-- given name and argument types. You might need to add explicit type casts.)"
--
-- Instructions:
-- 1. Copy and paste the entire content of this file into the Supabase SQL Editor.
-- 2. Click "Run".
-- 3. In the app, click "Submit for Approval" on the draft request.
-- ============================================================================

create or replace function public.gen_request_no()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  select coalesce(value #>> '{}', 'REQ')
  into v_prefix
  from public.app_settings
  where key = 'request_prefix';

  if v_prefix is null or btrim(v_prefix) = '' then
    v_prefix := 'REQ';
  end if;

  return public.next_number(v_prefix);
end;
$$;

revoke execute on function public.gen_request_no() from public, anon;
grant execute on function public.gen_request_no() to authenticated;

comment on function public.gen_request_no() is
  'Generates the next sequential request number using the configured request_prefix (defaults to REQ)';

do $$
begin
  raise notice 'SUCCESS: public.gen_request_no() is now available.';
end $$;
