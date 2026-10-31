-- Manual Script: Run in Supabase SQL Editor to add bank verification columns, grant update permissions, and install RPCs
-- Safe to re-run multiple times.

-- 1. Add bank account columns to requests table ---------------------------------
alter table public.requests
  add column if not exists disbursement_mode text default null,
  add column if not exists enter_bank_details_later boolean default false,
  add column if not exists bank_account_no text,
  add column if not exists bank_ifsc text,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_account_holder_name text,
  add column if not exists bank_verified boolean default false,
  add column if not exists bank_verification_message text;

-- Ensure default is null so existing / unselected requests stay "Not Decided Yet"
alter table public.requests alter column disbursement_mode drop default;
alter table public.requests alter column disbursement_mode set default null;

-- Add check constraint for disbursement_mode if not present
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'requests_disbursement_mode_check'
  ) then
    alter table public.requests
      add constraint requests_disbursement_mode_check
      check (disbursement_mode is null or disbursement_mode in ('cash', 'bank'));
  end if;
end $$;

-- 2. Grant table update privileges on bank columns to authenticated users -------
grant update (
  disbursement_mode,
  enter_bank_details_later,
  bank_account_no,
  bank_ifsc,
  bank_name,
  bank_branch,
  bank_account_holder_name,
  bank_verified,
  bank_verification_message,
  details,
  updated_at
) on public.requests to authenticated;

-- 3. RLS policy to allow authorized users to update bank details ----------------
drop policy if exists requests_update_bank_details on public.requests;
create policy requests_update_bank_details on public.requests for update to authenticated
  using (
    (select public.my_role()::text) in ('admin', 'head', 'clerk', 'regional_head', 'disbursement')
    or (requester_id = (select auth.uid()) and status in ('draft', 'returned'))
  )
  with check (
    (select public.my_role()::text) in ('admin', 'head', 'clerk', 'regional_head', 'disbursement')
    or (requester_id = (select auth.uid()) and status in ('draft', 'returned'))
  );

-- 4. Function to update request bank details via RPC (Security Definer) ---------
drop function if exists public.update_request_bank_details(uuid, text, boolean, text, text, text, text, text, boolean, text);

create or replace function public.update_request_bank_details(
  p_request_id uuid,
  p_disbursement_mode text default null,
  p_enter_bank_details_later boolean default false,
  p_bank_account_no text default null,
  p_bank_ifsc text default null,
  p_bank_name text default null,
  p_bank_branch text default null,
  p_bank_account_holder_name text default null,
  p_bank_verified boolean default false,
  p_bank_verification_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_req public.requests%rowtype;
  v_is_first_payment_released boolean := false;
  v_can_edit boolean := false;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  -- Check if first payment has already been released
  v_is_first_payment_released := (
    coalesce(v_req.paid_amount, 0) > 0 or
    v_req.status = 'paid' or
    exists (
      select 1 from public.disbursement_entries
      where request_id = p_request_id and coalesce(paid_amount, 0) > 0
    ) or
    exists (
      select 1 from public.request_payments
      where request_id = p_request_id
    )
  );

  if v_is_first_payment_released then
    return jsonb_build_object(
      'success', false,
      'error', 'Bank details cannot be modified after the first payment has been released.'
    );
  end if;

  select role into v_role from public.profiles where id = v_user_id;

  -- Verify authorized roles: regional_head, clerk, head, admin, any disbursement user
  if v_role in ('admin', 'head', 'clerk', 'regional_head', 'disbursement') then
    v_can_edit := true;
  elsif v_req.requester_id = v_user_id and v_req.status in ('draft', 'returned') then
    v_can_edit := true;
  end if;

  if not v_can_edit then
    return jsonb_build_object(
      'success', false,
      'error', 'You do not have permission to edit bank details for this request.'
    );
  end if;

  -- Update columns and sync into details jsonb
  update public.requests
  set
    disbursement_mode = p_disbursement_mode,
    enter_bank_details_later = coalesce(p_enter_bank_details_later, false),
    bank_account_no = p_bank_account_no,
    bank_ifsc = p_bank_ifsc,
    bank_name = p_bank_name,
    bank_branch = p_bank_branch,
    bank_account_holder_name = p_bank_account_holder_name,
    bank_verified = coalesce(p_bank_verified, false),
    bank_verification_message = p_bank_verification_message,
    details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
      'disbursement_mode', p_disbursement_mode,
      'enter_bank_details_later', coalesce(p_enter_bank_details_later, false),
      'bank_account_no', p_bank_account_no,
      'bank_ifsc', p_bank_ifsc,
      'bank_name', p_bank_name,
      'bank_branch', p_bank_branch,
      'bank_account_holder_name', p_bank_account_holder_name,
      'bank_verified', coalesce(p_bank_verified, false),
      'bank_verification_message', p_bank_verification_message
    ),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function public.update_request_bank_details(uuid, text, boolean, text, text, text, text, text, boolean, text) from public;
grant execute on function public.update_request_bank_details(uuid, text, boolean, text, text, text, text, text, boolean, text) to authenticated, anon;

-- 5. Update create_typed_draft to preserve bank fields on request creation/submit -
create or replace function public.create_typed_draft(
  p_type public.request_type,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb,
  p_target_head_id uuid default null::uuid
)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  v jsonb;
  v_id uuid;
  v_title text;
  v_shop text;
  v_shop_id uuid;
  v_amount numeric;
  v_target_head public.profiles;
  v_dept_id uuid;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_region_id uuid;
  v_region_name text;
  v_is_waitlist boolean;
  v_clean_details jsonb;
  v_bank_details jsonb;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types) or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  -- The shop choice travels inside p_details; never store it in the typed details.
  v_clean_details := coalesce(p_details, '{}'::jsonb) - 'shop_id' - 'shop_name';

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, v_clean_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  if p_type = 'asset_below_20k' and v_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing rules:
  -- For exhibition requests: STRICTLY to Main Head only, NO choosing.
  if p_type = 'exhibition' then
    if me.default_head_id is not null then
      select * into v_target_head from public.profiles
      where id = me.default_head_id and role = 'head' and is_active;
    end if;
    if v_target_head.id is null and me.department_id is not null then
      select * into v_target_head from public.profiles
      where department_id = me.department_id and role = 'head' and is_active limit 1;
    end if;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  elsif p_target_head_id is not null then
    select * into v_target_head from public.profiles
    where id = p_target_head_id and role = 'head' and is_active;
    if v_target_head.id is null then raise exception 'The selected Head is not active or not found'; end if;
    v_dept_id := v_target_head.department_id;
    v_owner_head_id := v_target_head.id;
    v_owner_head_name := v_target_head.full_name;
  elsif me.default_head_id is not null then
    select * into v_target_head from public.profiles
    where id = me.default_head_id and role = 'head' and is_active;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  -- Shop assignment
  if p_type in ('general', 'non_cash') then
    v_shop_id := public._resolve_request_shop(me, p_details);
  else
    v_shop_id := me.shop_id;
  end if;
  if v_shop_id is not null then
    select name into v_shop from public.shops where id = v_shop_id;
  end if;

  if p_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_region_id := null;
  v_region_name := null;
  v_is_waitlist := false;
  if p_type = 'exhibition' then
    v_region_id := coalesce(
      me.region_id,
      (select p.region_id from public.profiles p where p.id = me.regional_head_id),
      case when p_details ? 'region_id' and p_details->>'region_id' ~ '^[0-9a-fA-F-]{36}$'
           then (p_details->>'region_id')::uuid else null end
    );
    if v_region_id is not null then
      select name into v_region_name from public.regions where id = v_region_id;
    end if;
    v_is_waitlist := coalesce((p_details->>'is_waitlist')::boolean, false);
  end if;

  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', nullif(coalesce(p_details, '{}'::jsonb)->>'disbursement_mode', ''),
    'enter_bank_details_later', coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false),
    'bank_account_no', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', ''),
    'bank_ifsc', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', ''),
    'bank_name', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', ''),
    'bank_branch', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', ''),
    'bank_account_holder_name', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', ''),
    'bank_verified', coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false),
    'bank_verification_message', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '')
  ));

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist,
    disbursement_mode, enter_bank_details_later, bank_account_no, bank_ifsc,
    bank_name, bank_branch, bank_account_holder_name, bank_verified, bank_verification_message
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, v_shop_id, v_shop,
    (case when p_type = 'non_cash' then v_clean_details else v->'details' end) || v_bank_details,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist,
    nullif(coalesce(p_details, '{}'::jsonb)->>'disbursement_mode', ''),
    coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', ''),
    coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '')
  )
  returning id into v_id;

  return v_id;
end $function$;

revoke execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) from public, anon;
grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- 6. Update update_typed_draft to preserve/update bank fields on draft edits -----
create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
  v_shop_id uuid;
  v_shop_name text;
  v_clean_details jsonb;
  v_bank_details jsonb;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;

  v_clean_details := case when p_details is null then null else p_details - 'shop_id' - 'shop_name' end;

  if r.request_type <> 'non_cash' then
    v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(v_clean_details, r.details));
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;

  if r.request_type in ('general', 'non_cash') and p_details is not null and p_details ? 'shop_id' then
    v_shop_id := public._resolve_request_shop(me, p_details);
    select name into v_shop_name from public.shops where id = v_shop_id;
  elsif r.request_type in ('general', 'non_cash') and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  -- Build bank details to preserve / update
  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', case when p_details ? 'disbursement_mode' then nullif(p_details->>'disbursement_mode', '') else r.disbursement_mode end,
    'enter_bank_details_later', case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
    'bank_account_no', case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
    'bank_ifsc', case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
    'bank_name', case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
    'bank_branch', case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
    'bank_account_holder_name', case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
    'bank_verified', case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
    'bank_verification_message', case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end
  ));

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = (case when r.request_type = 'non_cash' then coalesce(v_clean_details, r.details) else v->'details' end) || v_bank_details,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    disbursement_mode = case when p_details ? 'disbursement_mode' then nullif(p_details->>'disbursement_mode', '') else r.disbursement_mode end,
    enter_bank_details_later = case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
    bank_account_no = case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
    bank_ifsc = case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
    bank_name = case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
    bank_branch = case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
    bank_account_holder_name = case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
    bank_verified = case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
    bank_verification_message = case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end,
    updated_at = now()
  where id = r.id;

  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

revoke execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) from public, anon;
grant execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) to authenticated;

-- 8. Add hold & unhold functionality for Treasury Gatekeeper Entry Approvals --
alter table public.disbursement_entries drop constraint if exists disbursement_entries_status_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_status_check
  check (status in ('pending', 'pending_approval', 'approved', 'rejected', 'paid', 'cancelled', 'on_hold'));

alter table public.disbursement_entries
  add column if not exists held_by uuid references public.profiles(id) on delete set null,
  add column if not exists held_by_name text,
  add column if not exists held_at timestamptz,
  add column if not exists hold_reason text check (hold_reason is null or char_length(hold_reason) <= 1000);

grant update (status, held_by, held_by_name, held_at, hold_reason, updated_at) on public.disbursement_entries to authenticated;

create or replace function public.hold_disbursement_entry(
  p_entry_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_reason text := nullif(btrim(p_reason), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can hold disbursement entries';
  end if;

  if v_reason is null then
    raise exception 'Please specify a reason for placing this entry on hold';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending_approval' and e.status <> 'pending' then
    raise exception 'This entry is not waiting for approver review (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'on_hold',
    held_at = now(),
    held_by = me.id,
    held_by_name = me.full_name,
    hold_reason = v_reason,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_held', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00')
      || ') placed ON HOLD by ' || me.full_name || ': ' || v_reason,
    true
  );

  return jsonb_build_object('success', true, 'entry_no', e.entry_no);
end $$;

revoke execute on function public.hold_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.hold_disbursement_entry(uuid, text) to authenticated;

create or replace function public.unhold_disbursement_entry(
  p_entry_id uuid,
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_notes text := nullif(btrim(p_notes), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can unhold disbursement entries';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'on_hold' then
    raise exception 'This entry is not on hold (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'pending_approval',
    held_at = null,
    held_by = null,
    held_by_name = null,
    hold_reason = null,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_unheld', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00')
      || ') taken OFF HOLD and returned to Pending by ' || me.full_name || coalesce(' - Note: ' || v_notes, ''),
    true
  );

  return jsonb_build_object('success', true, 'entry_no', e.entry_no);
end $$;

revoke execute on function public.unhold_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.unhold_disbursement_entry(uuid, text) to authenticated;

-- 9. Reload schema cache in PostgREST -------------------------------------------
notify pgrst, 'reload schema';

