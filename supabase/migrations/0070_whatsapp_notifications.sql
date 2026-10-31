-- 0070 — WhatsApp Cloud API Notifications for Approved Documents
-- Configures WhatsApp Cloud API credentials, staff/head whatsapp numbers,
-- and logging for automatic dispatch of approved document packets.

-- 1. Add whatsapp_number column to public.profiles
alter table public.profiles add column if not exists whatsapp_number text;

-- Allow authenticated users to update whatsapp_number on profiles through RLS
grant update (full_name, username, designation, whatsapp_number, updated_at) on public.profiles to authenticated;

-- 2. Drop existing update_user_details function first to avoid PostgreSQL 42P13 default conflict
drop function if exists public.update_user_details(uuid, text, text, text);
drop function if exists public.update_user_details(uuid, text, text, text, text);

-- 3. Enhanced update_user_details RPC with whatsapp_number support
create or replace function public.update_user_details(
  p_user_id uuid,
  p_full_name text,
  p_username text,
  p_designation text default null,
  p_whatsapp_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_fullname text;
  v_username text;
  v_designation text;
  v_whatsapp text;
  v_res public.profiles;
begin
  select * into v_caller from public.profiles where id = auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if v_target is null then
    raise exception 'User not found';
  end if;

  -- Admin can edit any user
  -- Head can edit clerks, regional heads, employees in own department
  -- Users can edit their own profile
  if v_caller.role = 'admin' then
    null;
  elsif v_caller.role = 'head' and v_target.department_id = v_caller.department_id and v_target.role in ('clerk', 'employee', 'regional_head') then
    null;
  elsif v_caller.id = p_user_id then
    null;
  else
    raise exception 'Permission denied: cannot edit this user';
  end if;

  v_fullname := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_fullname is null then raise exception 'Full name is required'; end if;
  if char_length(v_fullname) > 100 then raise exception 'Full name cannot exceed 100 characters'; end if;

  v_username := lower(btrim(coalesce(p_username, '')));
  if v_username is null or not (v_username ~ '^[a-z0-9._-]{3,30}$') then
    raise exception 'Username must be 3-30 characters with lowercase letters, numbers, dot, dash, or underscore';
  end if;

  if exists (select 1 from public.profiles where username = v_username and id <> p_user_id) then
    raise exception 'That username is already taken';
  end if;

  v_designation := nullif(btrim(coalesce(p_designation, '')), '');
  if v_designation is not null and char_length(v_designation) > 100 then
    raise exception 'Designation cannot exceed 100 characters';
  end if;

  v_whatsapp := nullif(btrim(coalesce(p_whatsapp_number, '')), '');

  update public.profiles
  set full_name = v_fullname,
      username = v_username,
      designation = v_designation,
      whatsapp_number = v_whatsapp,
      updated_at = now()
  where id = p_user_id
  returning * into v_res;

  -- Sync with auth.users metadata
  begin
    update auth.users
    set email = v_username || '@users.approvalapp.in',
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
          'username', v_username,
          'full_name', v_fullname,
          'whatsapp_number', v_whatsapp
        )
    where id = p_user_id;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'success', true,
    'id', v_res.id,
    'full_name', v_res.full_name,
    'username', v_res.username,
    'designation', v_res.designation,
    'whatsapp_number', v_res.whatsapp_number
  );
end $$;

revoke execute on function public.update_user_details(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_user_details(uuid, text, text, text, text) to authenticated;

-- 4. Default WhatsApp Cloud API configuration in app_settings
insert into public.app_settings (key, value)
values (
  'whatsapp_config',
  jsonb_build_object(
    'enabled', true,
    'access_token', 'EAAzRU40ZBcyoBS1Uyk7UgqBlRIvb407NufgvmPdZBmZCjGsZAiDBervAm9MGZAhkVyou64W2lDt64ZByltVjcRVwvdkndcEPsUZAi0DvoISgKKbRUEZCQZABpLslfpvcrM1fE19UXaVyZCEhaz2ebIZAvuWGpvQG2KZBJNfrksm5vRN44PCuRpco8riA6NnSan6uUgZDZD',
    'phone_number_id', '1391767714024374',
    'waba_id', '1792622932047989',
    'app_id', '3607856502698794',
    'business_id', '2416963001964565',
    'display_phone_number', '+91 80893 04002',
    'notify_requester', true,
    'notify_head', true,
    'admin_phone_number', '+91 9846880713'
  )
)
on conflict (key) do update
set value = excluded.value;

-- 5. WhatsApp notification delivery log table
create table if not exists public.whatsapp_logs (
  id bigint generated always as identity primary key,
  request_id uuid references public.requests(id) on delete set null,
  recipient_phone text not null,
  recipient_name text,
  message_type text not null default 'document',
  status text not null default 'sent',
  meta_message_id text,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_logs_request_idx on public.whatsapp_logs(request_id);
create index if not exists whatsapp_logs_created_idx on public.whatsapp_logs(created_at desc);

alter table public.whatsapp_logs enable row level security;

drop policy if exists "whatsapp_logs view policy" on public.whatsapp_logs;
create policy "whatsapp_logs view policy" on public.whatsapp_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'head')
    )
  );

grant select on public.whatsapp_logs to authenticated;
