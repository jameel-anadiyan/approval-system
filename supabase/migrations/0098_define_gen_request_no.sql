-- ============================================================================
-- Migration 0098: Define public.gen_request_no()
-- 
-- Fixes: function public.gen_request_no() does not exist
-- When submitting a new draft request (where request_no is null),
-- submit_request calls public.gen_request_no() to generate the sequential
-- request number (e.g., REQ-2026-000562).
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

