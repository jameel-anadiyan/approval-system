-- ============================================================================
-- 0077_whatsapp_admin_approval_bot.sql
--
-- Interactive WhatsApp "all" Approval Bot for Admin + Instant Web App Sync:
-- 1. Stores secret webhook credentials in `public.whatsapp_bot_config` (Admin-only)
--    with upstream pass-through support so existing WABA webhooks continue working.
-- 2. Tracks inbound message deduplication (`whatsapp_inbound_dedup`) and interactive
--    Admin approval sessions (`whatsapp_approval_sessions`) for "Approve All" and
--    "Selected Only" workflows.
-- 3. Provides ephemeral path-scoped storage grants (`whatsapp_storage_grants`) so
--    serverless webhook signing can read credentials/request files and upload stamped
--    PDF packets strictly during an active authorized signing run.
-- 4. Adds `public.requests` and `public.signed_files` to `supabase_realtime` so
--    approvals made in WhatsApp reflect live in open Web App tabs automatically.
-- ============================================================================

-- 1. Admin-only Bot Webhook Configuration (never readable by non-admin users)
create table if not exists public.whatsapp_bot_config (
  id int primary key default 1 check (id = 1),
  bot_secret text not null default (
    md5(random()::text || clock_timestamp()::text || txid_current()::text)
    || md5(clock_timestamp()::text || random()::text)
  ),
  verify_token text not null default 'swa_approval_verify_2026',
  forward_webhook_url text not null default 'https://whatsapp.swaloyalty.com/api/webhooks/whatsapp',
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_bot_config enable row level security;

insert into public.whatsapp_bot_config (id)
values (1)
on conflict (id) do nothing;

-- 2. Inbound WhatsApp Message Deduplication (prevents Meta webhook retry duplicates)
create table if not exists public.whatsapp_inbound_dedup (
  message_id text primary key,
  sender_phone text not null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_inbound_dedup_created_idx
  on public.whatsapp_inbound_dedup (created_at desc);

alter table public.whatsapp_inbound_dedup enable row level security;

-- 3. Interactive Admin Approval Queue Sessions ("all" -> Approve All / Selected Only)
create table if not exists public.whatsapp_approval_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  admin_phone text not null,
  status text not null default 'awaiting_mode'
    check (status in ('awaiting_mode', 'selecting', 'processing', 'completed', 'cancelled', 'superseded')),
  items jsonb not null default '[]'::jsonb,
  selected_serials int[] not null default '{}',
  app_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_approval_sessions_phone_idx
  on public.whatsapp_approval_sessions (admin_phone, updated_at desc);

alter table public.whatsapp_approval_sessions enable row level security;

-- 4. Ephemeral Path-Scoped Storage Grants (valid max 90s during active approval signing)
create table if not exists public.whatsapp_storage_grants (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  bucket_id text not null,
  path_match text not null,
  is_prefix boolean not null default false,
  allow_select boolean not null default true,
  allow_insert boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_storage_grants_lookup_idx
  on public.whatsapp_storage_grants (bucket_id, expires_at);

create index if not exists whatsapp_storage_grants_req_idx
  on public.whatsapp_storage_grants (request_id);

alter table public.whatsapp_storage_grants enable row level security;

-- Helper used by storage.objects RLS policies so whatsapp_storage_grants stays unreadable directly
create or replace function public._has_whatsapp_storage_grant(
  p_bucket_id text,
  p_name text,
  p_need_insert boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_storage_grants g
    where g.bucket_id = p_bucket_id
      and g.expires_at > now()
      and (case when p_need_insert then g.allow_insert else g.allow_select end)
      and (
        p_name = g.path_match
        or (g.is_prefix and p_name like g.path_match || '%')
      )
  );
$$;

grant execute on function public._has_whatsapp_storage_grant(text, text, boolean) to anon, authenticated, service_role;

drop policy if exists "whatsapp_bot_temp_select" on storage.objects;
create policy "whatsapp_bot_temp_select" on storage.objects
  for select to anon, authenticated
  using (public._has_whatsapp_storage_grant(bucket_id, name, false));

drop policy if exists "whatsapp_bot_temp_insert" on storage.objects;
create policy "whatsapp_bot_temp_insert" on storage.objects
  for insert to anon, authenticated
  with check (public._has_whatsapp_storage_grant(bucket_id, name, true));

drop policy if exists "whatsapp_bot_temp_update" on storage.objects;
create policy "whatsapp_bot_temp_update" on storage.objects
  for update to anon, authenticated
  using (public._has_whatsapp_storage_grant(bucket_id, name, true))
  with check (public._has_whatsapp_storage_grant(bucket_id, name, true));

drop policy if exists "whatsapp_bot_temp_delete" on storage.objects;
create policy "whatsapp_bot_temp_delete" on storage.objects
  for delete to anon, authenticated
  using (public._has_whatsapp_storage_grant(bucket_id, name, true));

-- 5. Enable Realtime on public.requests and public.signed_files so Web App updates live
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'requests'
  ) then
    alter publication supabase_realtime add table public.requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signed_files'
  ) then
    alter publication supabase_realtime add table public.signed_files;
  end if;
exception when others then
  null;
end $$;

-- 6. Phone normalization & Admin sender verification helpers
create or replace function public._norm_wa_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits = '' then
    return '';
  end if;
  if char_length(v_digits) = 10 then
    return '91' || v_digits;
  end if;
  if char_length(v_digits) = 11 and left(v_digits, 1) = '0' then
    return '91' || substr(v_digits, 2);
  end if;
  return v_digits;
end $$;

create or replace function public._wa_phones_match(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  va text := public._norm_wa_phone(p_a);
  vb text := public._norm_wa_phone(p_b);
begin
  if va = '' or vb = '' then
    return false;
  end if;
  if va = vb then
    return true;
  end if;
  if char_length(va) >= 10 and char_length(vb) >= 10 and right(va, 10) = right(vb, 10) then
    return true;
  end if;
  return false;
end $$;

-- Resolves the active Admin profile ID if and only if p_sender_phone belongs to an authorized Admin
create or replace function public._resolve_wa_admin(p_sender_phone text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg_admin_phone text;
  v_matched_profile_id uuid;
  v_cred_admin_id uuid;
  v_any_admin_id uuid;
  v_is_authorized boolean := false;
begin
  if public._norm_wa_phone(p_sender_phone) = '' then
    return null;
  end if;

  -- 1. Check active admin profile with matching whatsapp_number (prefer one with credentials)
  select p.id
    into v_matched_profile_id
    from public.profiles p
    left join public.approver_credentials c on c.user_id = p.id
   where p.role = 'admin'
     and p.is_active = true
     and public._wa_phones_match(p.whatsapp_number, p_sender_phone)
   order by (c.seal_path is not null and c.signature_path is not null) desc, p.created_at asc
   limit 1;

  if v_matched_profile_id is not null then
    v_is_authorized := true;
  end if;

  -- 2. Also check whatsapp_config.admin_phone_number in app_settings
  if not v_is_authorized then
    select coalesce(value ->> 'admin_phone_number', '+91 9846880713')
      into v_cfg_admin_phone
      from public.app_settings
     where key = 'whatsapp_config';

    if v_cfg_admin_phone is null then
      v_cfg_admin_phone := '+91 9846880713';
    end if;

    if public._wa_phones_match(v_cfg_admin_phone, p_sender_phone) then
      v_is_authorized := true;
    end if;
  end if;

  if not v_is_authorized then
    return null;
  end if;

  -- Prefer the matched profile if it has seal & signature uploaded
  if v_matched_profile_id is not null and exists (
    select 1 from public.approver_credentials c
    where c.user_id = v_matched_profile_id
      and c.seal_path is not null
      and c.signature_path is not null
  ) then
    return v_matched_profile_id;
  end if;

  -- Otherwise pick active Admin account that has seal & signature uploaded
  select p.id
    into v_cred_admin_id
    from public.profiles p
    join public.approver_credentials c on c.user_id = p.id
   where p.role = 'admin'
     and p.is_active = true
     and c.seal_path is not null
     and c.signature_path is not null
   order by p.created_at asc
   limit 1;

  if v_cred_admin_id is not null then
    return v_cred_admin_id;
  end if;

  if v_matched_profile_id is not null then
    return v_matched_profile_id;
  end if;

  select p.id
    into v_any_admin_id
    from public.profiles p
   where p.role = 'admin'
     and p.is_active = true
   order by p.created_at asc
   limit 1;

  return v_any_admin_id;
end $$;

revoke execute on function public._resolve_wa_admin(text) from public, anon, authenticated;

create or replace function public._assert_wa_bot_secret(p_bot_secret text)
returns public.whatsapp_bot_config
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.whatsapp_bot_config;
begin
  select * into v_cfg from public.whatsapp_bot_config where id = 1;
  if v_cfg.id is null or coalesce(btrim(p_bot_secret), '') = '' or p_bot_secret <> v_cfg.bot_secret then
    raise exception 'Unauthorized WhatsApp bot key';
  end if;
  return v_cfg;
end $$;

revoke execute on function public._assert_wa_bot_secret(text) from public, anon, authenticated;

-- 7. Admin Settings UI RPCs (read/update webhook configuration)
create or replace function public.get_whatsapp_webhook_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  v_cfg public.whatsapp_bot_config;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can view WhatsApp webhook settings';
  end if;

  insert into public.whatsapp_bot_config (id)
  values (1)
  on conflict (id) do nothing;

  select * into v_cfg from public.whatsapp_bot_config where id = 1;

  return jsonb_build_object(
    'bot_secret', v_cfg.bot_secret,
    'verify_token', v_cfg.verify_token,
    'forward_webhook_url', v_cfg.forward_webhook_url,
    'updated_at', v_cfg.updated_at
  );
end $$;

revoke execute on function public.get_whatsapp_webhook_settings() from public, anon;
grant execute on function public.get_whatsapp_webhook_settings() to authenticated;

create or replace function public.update_whatsapp_webhook_settings(
  p_forward_webhook_url text default null,
  p_verify_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  v_cfg public.whatsapp_bot_config;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can update WhatsApp webhook settings';
  end if;

  insert into public.whatsapp_bot_config (id)
  values (1)
  on conflict (id) do nothing;

  update public.whatsapp_bot_config
     set forward_webhook_url = coalesce(nullif(btrim(p_forward_webhook_url), ''), forward_webhook_url),
         verify_token = coalesce(nullif(btrim(p_verify_token), ''), verify_token),
         updated_at = now()
   where id = 1
   returning * into v_cfg;

  return jsonb_build_object(
    'bot_secret', v_cfg.bot_secret,
    'verify_token', v_cfg.verify_token,
    'forward_webhook_url', v_cfg.forward_webhook_url,
    'updated_at', v_cfg.updated_at
  );
end $$;

revoke execute on function public.update_whatsapp_webhook_settings(text, text) from public, anon;
grant execute on function public.update_whatsapp_webhook_settings(text, text) to authenticated;

-- 8. Webhook GET Verification Handshake RPC
create or replace function public.whatsapp_bot_verify_challenge(
  p_bot_secret text,
  p_verify_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.whatsapp_bot_config;
  v_key_ok boolean;
begin
  select * into v_cfg from public.whatsapp_bot_config where id = 1;
  if v_cfg.id is null then
    return jsonb_build_object('valid', false);
  end if;

  v_key_ok := (coalesce(btrim(p_bot_secret), '') = '' or p_bot_secret = v_cfg.bot_secret);

  return jsonb_build_object(
    'valid', (v_key_ok and coalesce(p_verify_token, '') = v_cfg.verify_token),
    'forward_webhook_url', v_cfg.forward_webhook_url
  );
end $$;

grant execute on function public.whatsapp_bot_verify_challenge(text, text) to anon, authenticated;

-- 9. Runtime Config Fetch for Authorized Webhook Invocation
create or replace function public.whatsapp_bot_get_runtime_config(p_bot_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bot public.whatsapp_bot_config;
  v_wa jsonb;
begin
  v_bot := public._assert_wa_bot_secret(p_bot_secret);

  select coalesce(value, '{}'::jsonb)
    into v_wa
    from public.app_settings
   where key = 'whatsapp_config';

  return coalesce(v_wa, '{}'::jsonb) || jsonb_build_object(
    'forward_webhook_url', v_bot.forward_webhook_url,
    'verify_token', v_bot.verify_token
  );
end $$;

grant execute on function public.whatsapp_bot_get_runtime_config(text) to anon, authenticated;

-- 10. Claim & Deduplicate Inbound Message + Identify Admin + Fetch Active Session
create or replace function public.whatsapp_bot_claim_inbound(
  p_bot_secret text,
  p_message_id text,
  p_sender_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bot public.whatsapp_bot_config;
  v_norm_phone text;
  v_admin_id uuid;
  v_admin_name text;
  v_inserted int := 0;
  v_session public.whatsapp_approval_sessions;
begin
  v_bot := public._assert_wa_bot_secret(p_bot_secret);
  v_norm_phone := public._norm_wa_phone(p_sender_phone);
  v_admin_id := public._resolve_wa_admin(v_norm_phone);

  if v_admin_id is null then
    return jsonb_build_object(
      'is_admin', false,
      'duplicate', false,
      'forward_webhook_url', v_bot.forward_webhook_url
    );
  end if;

  -- Prune old dedup entries (> 7 days)
  delete from public.whatsapp_inbound_dedup
   where created_at < now() - interval '7 days';

  if coalesce(btrim(p_message_id), '') <> '' then
    insert into public.whatsapp_inbound_dedup (message_id, sender_phone)
    values (btrim(p_message_id), v_norm_phone)
    on conflict (message_id) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return jsonb_build_object(
        'is_admin', true,
        'duplicate', true,
        'forward_webhook_url', v_bot.forward_webhook_url
      );
    end if;
  end if;

  select full_name into v_admin_name from public.profiles where id = v_admin_id;

  select *
    into v_session
    from public.whatsapp_approval_sessions
   where admin_phone = v_norm_phone
     and status in ('awaiting_mode', 'selecting')
     and updated_at > now() - interval '24 hours'
   order by created_at desc
   limit 1;

  return jsonb_build_object(
    'is_admin', true,
    'duplicate', false,
    'admin_id', v_admin_id,
    'admin_name', v_admin_name,
    'forward_webhook_url', v_bot.forward_webhook_url,
    'active_session', case
      when v_session.id is not null then jsonb_build_object(
        'id', v_session.id,
        'status', v_session.status,
        'items', v_session.items,
        'selected_serials', to_jsonb(v_session.selected_serials),
        'app_url', v_session.app_url
      )
      else null
    end
  );
end $$;

grant execute on function public.whatsapp_bot_claim_inbound(text, text, text) to anon, authenticated;

-- 11. Create Fresh Admin To-Approve Queue Session ("all" command)
create or replace function public.whatsapp_bot_create_session(
  p_bot_secret text,
  p_sender_phone text,
  p_app_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm_phone text;
  v_admin_id uuid;
  v_admin_name text;
  v_has_creds boolean := false;
  v_items jsonb;
  v_session_id uuid;
begin
  perform public._assert_wa_bot_secret(p_bot_secret);
  v_norm_phone := public._norm_wa_phone(p_sender_phone);
  v_admin_id := public._resolve_wa_admin(v_norm_phone);

  if v_admin_id is null then
    raise exception 'Sender is not an authorized Admin';
  end if;

  select full_name into v_admin_name from public.profiles where id = v_admin_id;

  select exists (
    select 1 from public.approver_credentials c
    where c.user_id = v_admin_id
      and c.seal_path is not null
      and c.signature_path is not null
  ) into v_has_creds;

  -- Mark previous open sessions for this admin phone as superseded
  update public.whatsapp_approval_sessions
     set status = 'superseded',
         updated_at = now()
   where admin_phone = v_norm_phone
     and status in ('awaiting_mode', 'selecting');

  -- Fetch Admin To-Approve requests in exact Web App oldest-first order
  with queue as (
    select
      row_number() over (
        order by coalesce(r.submitted_at, r.created_at) asc, r.created_at asc
      )::int as serial,
      r.id,
      r.request_no,
      r.title,
      r.amount,
      r.request_type::text as request_type,
      case
        when r.request_type = 'exhibition' then
          coalesce(nullif(btrim(r.details ->> 'conducting_shop_name'), ''), r.shop_name, 'Not Assigned')
        when r.request_type = 'stock_transfer' then
          coalesce(r.details ->> 'from_shop_name', r.shop_name, 'Shop') || ' -> ' || coalesce(r.details ->> 'to_shop_name', 'Shop')
        else
          coalesce(r.shop_name, '—')
      end as shop_label,
      coalesce(d.name, r.owner_head_name, '—') as department_name,
      r.requester_name,
      r.reviewed_by_name,
      r.notes,
      r.submitted_at,
      case
        when r.requester_id = v_admin_id then
          'Cannot approve your own request'
        when (r.request_type in ('asset', 'asset_below_20k')) and r.selected_quote_id is null then
          'Best quotation not selected yet'
        when exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.status = 'disagreed'
        ) then
          'Consulted department head disagreed'
        when exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.status = 'pending'
        ) then
          'Consultation pending response'
        else null
      end as blocked_reason
    from public.requests r
    left join public.departments d on d.id = r.department_id
    where r.status = 'pending_admin_approval'
       or (
         r.status = 'approving'
         and (r.approving_started_at is null or r.approving_started_at <= now() - interval '1 minute')
       )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'serial', q.serial,
        'id', q.id,
        'request_no', q.request_no,
        'title', q.title,
        'amount', q.amount,
        'request_type', q.request_type,
        'shop_name', q.shop_label,
        'department_name', q.department_name,
        'requester_name', q.requester_name,
        'reviewed_by_name', q.reviewed_by_name,
        'notes', q.notes,
        'submitted_at', q.submitted_at,
        'blocked_reason', q.blocked_reason
      )
      order by q.serial asc
    ),
    '[]'::jsonb
  )
  into v_items
  from queue q;

  if jsonb_array_length(v_items) > 0 then
    insert into public.whatsapp_approval_sessions (
      admin_id, admin_phone, status, items, selected_serials, app_url
    )
    values (
      v_admin_id, v_norm_phone, 'awaiting_mode', v_items, '{}', nullif(btrim(p_app_url), '')
    )
    returning id into v_session_id;
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'admin_id', v_admin_id,
    'admin_name', v_admin_name,
    'has_credentials', v_has_creds,
    'items', v_items
  );
end $$;

grant execute on function public.whatsapp_bot_create_session(text, text, text) to anon, authenticated;

-- 12. Fetch or Update Session Selection / Status
create or replace function public.whatsapp_bot_get_session(
  p_bot_secret text,
  p_sender_phone text,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_norm_phone text;
  v_admin_id uuid;
  v_session public.whatsapp_approval_sessions;
begin
  perform public._assert_wa_bot_secret(p_bot_secret);
  v_norm_phone := public._norm_wa_phone(p_sender_phone);
  v_admin_id := public._resolve_wa_admin(v_norm_phone);
  if v_admin_id is null then
    raise exception 'Sender is not an authorized Admin';
  end if;

  select *
    into v_session
    from public.whatsapp_approval_sessions
   where id = p_session_id
     and admin_phone = v_norm_phone;

  if v_session.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'admin_id', coalesce(v_session.admin_id, v_admin_id),
    'status', v_session.status,
    'items', v_session.items,
    'selected_serials', to_jsonb(v_session.selected_serials),
    'app_url', v_session.app_url,
    'updated_at', v_session.updated_at
  );
end $$;

grant execute on function public.whatsapp_bot_get_session(text, text, uuid) to anon, authenticated;

create or replace function public.whatsapp_bot_update_session(
  p_bot_secret text,
  p_sender_phone text,
  p_session_id uuid,
  p_status text default null,
  p_selected_serials int[] default null,
  p_toggle_serial int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm_phone text;
  v_admin_id uuid;
  v_session public.whatsapp_approval_sessions;
  v_max_serial int;
  v_next int[];
begin
  perform public._assert_wa_bot_secret(p_bot_secret);
  v_norm_phone := public._norm_wa_phone(p_sender_phone);
  v_admin_id := public._resolve_wa_admin(v_norm_phone);
  if v_admin_id is null then
    raise exception 'Sender is not an authorized Admin';
  end if;

  select *
    into v_session
    from public.whatsapp_approval_sessions
   where id = p_session_id
     and admin_phone = v_norm_phone
   for update;

  if v_session.id is null then
    return null;
  end if;

  v_max_serial := jsonb_array_length(v_session.items);
  v_next := coalesce(v_session.selected_serials, '{}');

  if p_selected_serials is not null then
    select coalesce(array_agg(distinct s order by s), '{}')
      into v_next
      from unnest(p_selected_serials) as s
     where s >= 1 and s <= v_max_serial;
  elsif p_toggle_serial is not null and p_toggle_serial >= 1 and p_toggle_serial <= v_max_serial then
    if p_toggle_serial = any(v_next) then
      select coalesce(array_agg(s order by s), '{}')
        into v_next
        from unnest(v_next) as s
       where s <> p_toggle_serial;
    else
      select coalesce(array_agg(distinct s order by s), '{}')
        into v_next
        from unnest(array_append(v_next, p_toggle_serial)) as s;
    end if;
  end if;

  update public.whatsapp_approval_sessions
     set status = coalesce(p_status, status),
         selected_serials = v_next,
         updated_at = now()
   where id = v_session.id
   returning * into v_session;

  return jsonb_build_object(
    'id', v_session.id,
    'admin_id', coalesce(v_session.admin_id, v_admin_id),
    'status', v_session.status,
    'items', v_session.items,
    'selected_serials', to_jsonb(v_session.selected_serials),
    'app_url', v_session.app_url,
    'updated_at', v_session.updated_at
  );
end $$;

grant execute on function public.whatsapp_bot_update_session(text, text, uuid, text, int[], int) to anon, authenticated;

-- 13. Begin, Finalize & Abort Approval via Authorized WhatsApp Bot
create or replace function public.whatsapp_bot_begin_approval(
  p_bot_secret text,
  p_sender_phone text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_begun jsonb;
  r public.requests;
  v_req_prof public.profiles;
  v_head_prof public.profiles;
  v_def_head_prof public.profiles;
  v_exp timestamptz := now() + interval '90 seconds';
begin
  perform public._assert_wa_bot_secret(p_bot_secret);
  v_admin_id := public._resolve_wa_admin(p_sender_phone);
  if v_admin_id is null then
    raise exception 'Sender is not an authorized Admin';
  end if;

  -- Clean up any expired temporary grants
  delete from public.whatsapp_storage_grants where expires_at <= now();

  -- Reserve approval number & transition request to 'approving' using core workflow RPC
  v_begun := public.begin_approval(p_request_id, v_admin_id);

  -- Issue 90-second path-scoped grants for seal, signature, request files & signed packet upload
  insert into public.whatsapp_storage_grants (
    request_id, bucket_id, path_match, is_prefix, allow_select, allow_insert, expires_at
  )
  values
    (p_request_id, 'credentials', v_begun ->> 'seal_path', false, true, false, v_exp),
    (p_request_id, 'credentials', v_begun ->> 'signature_path', false, true, false, v_exp),
    (p_request_id, 'request-files', p_request_id::text || '/', true, true, false, v_exp),
    (p_request_id, 'signed-documents', p_request_id::text || '/', true, true, true, v_exp);

  -- Resolve WhatsApp notification recipients (requester + head)
  select * into r from public.requests where id = p_request_id;
  if r.requester_id is not null then
    select * into v_req_prof from public.profiles where id = r.requester_id;
  end if;
  if r.owner_head_id is not null then
    select * into v_head_prof from public.profiles where id = r.owner_head_id;
  end if;
  if v_head_prof.whatsapp_number is null and v_req_prof.default_head_id is not null then
    select * into v_def_head_prof from public.profiles where id = v_req_prof.default_head_id;
  end if;

  return v_begun || jsonb_build_object(
    'approver_id', v_admin_id,
    'recipients', jsonb_build_object(
      'requester_name', coalesce(v_req_prof.full_name, r.requester_name),
      'requester_phone', v_req_prof.whatsapp_number,
      'head_name', coalesce(v_head_prof.full_name, v_def_head_prof.full_name, r.owner_head_name),
      'head_phone', coalesce(v_head_prof.whatsapp_number, v_def_head_prof.whatsapp_number)
    )
  );
end $$;

grant execute on function public.whatsapp_bot_begin_approval(text, text, uuid) to anon, authenticated;

create or replace function public.whatsapp_bot_finalize_approval(
  p_bot_secret text,
  p_sender_phone text,
  p_request_id uuid,
  p_approver_id uuid,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  r public.requests;
begin
  perform public._assert_wa_bot_secret(p_bot_secret);
  v_admin_id := public._resolve_wa_admin(p_sender_phone);
  if v_admin_id is null then
    raise exception 'Sender is not an authorized Admin';
  end if;

  perform public.finalize_approval(p_request_id, p_approver_id, p_files);

  -- Revoke temporary storage grants immediately
  delete from public.whatsapp_storage_grants where request_id = p_request_id;

  select * into r from public.requests where id = p_request_id;

  -- Also notify active Admin profile(s) so existing notifications Realtime channel triggers instant Web App refresh
  if r.id is not null then
    insert into public.notifications (user_id, request_id, title, body)
    select
      p.id,
      r.id,
      'Approved on WhatsApp · ' || coalesce(r.approval_no, 'Approved'),
      coalesce(r.request_no, 'Request') || ' — ' || coalesce(r.title, '')
    from public.profiles p
    where p.role = 'admin' and p.is_active = true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'approval_no', r.approval_no,
    'request_no', r.request_no
  );
end $$;

grant execute on function public.whatsapp_bot_finalize_approval(text, text, uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.whatsapp_bot_abort_approval(
  p_bot_secret text,
  p_sender_phone text,
  p_request_id uuid,
  p_approver_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
begin
  perform public._assert_wa_bot_secret(p_bot_secret);
  v_admin_id := public._resolve_wa_admin(p_sender_phone);
  if v_admin_id is null then
    raise exception 'Sender is not an authorized Admin';
  end if;

  perform public.abort_approval(p_request_id, p_approver_id, p_error);
  delete from public.whatsapp_storage_grants where request_id = p_request_id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.whatsapp_bot_abort_approval(text, text, uuid, uuid, text) to anon, authenticated;

-- 14. Delivery Audit Logger for WhatsApp Bot
create or replace function public.whatsapp_bot_log_delivery(
  p_bot_secret text,
  p_request_id uuid,
  p_recipient_phone text,
  p_recipient_name text,
  p_message_type text,
  p_status text,
  p_meta_message_id text default null,
  p_error_message text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._assert_wa_bot_secret(p_bot_secret);

  insert into public.whatsapp_logs (
    request_id,
    recipient_phone,
    recipient_name,
    message_type,
    status,
    meta_message_id,
    error_message,
    details
  )
  values (
    p_request_id,
    coalesce(p_recipient_phone, ''),
    p_recipient_name,
    coalesce(p_message_type, 'bot'),
    coalesce(p_status, 'sent'),
    p_meta_message_id,
    p_error_message,
    coalesce(p_details, '{}'::jsonb)
  );
end $$;

grant execute on function public.whatsapp_bot_log_delivery(text, uuid, text, text, text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
