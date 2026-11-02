-- ==============================================================================
-- 0078_fix_returned_request_resubmit_and_disbursement.sql
--
-- FIX: "when admin return for correction, when resubmitting by adding
--       disbursement details when saving and resubmit it shows 'not found'"
--
-- Root Cause:
-- 1. `submit_request(uuid, uuid)` checked:
--      `if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;`
--    When Admin returns a request for correction, Department Heads, Clerks,
--    Regional Heads, and Admins are authorized in the UI to update disbursement
--    details and resubmit the request. Because `me.id <> r.requester_id`,
--    PostgreSQL immediately threw 'Not found'.
-- 2. `set_request_target_head` and `set_request_category` checked `r.requester_id <> me.id`
--    and threw 'Not found' when saving returned requests.
-- 3. `set_quote` checked `r.requester_id <> me.id` and threw 'Not found'.
-- 4. `update_typed_draft` had overly narrow permission checks for returned requests
--    which failed for Regional Heads covering shops and associated Department Heads.
-- 5. `assign_disbursement_entry_user` had overly narrow clerk department checks.
--
-- Solution:
-- - Update `submit_request` to allow authorized roles (requester, Admin, associated
--   Department Head, associated Clerk, associated Regional Head) to resubmit
--   returned requests, routing them back into the workflow accurately (e.g. Head
--   resubmission goes directly back to Admin for Route A approval).
-- - Update `update_typed_draft`, `set_request_target_head`, `set_request_category`,
--   `set_quote`, and `assign_disbursement_entry_user` to permit authorized roles
--   on returned requests without throwing 'Not found'.
-- ==============================================================================

-- 1. Update set_request_target_head
create or replace function public.set_request_target_head(p_request_id uuid, p_head_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  h public.profiles;
  v_can_set boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'Cannot change Head after submission'; end if;

  if r.status = 'draft' then
    if r.requester_id <> me.id then raise exception 'Only the requester can change Head on a draft'; end if;
  elsif r.status = 'returned' then
    v_can_set := (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role in ('head', 'clerk') and (
            r.department_id = me.department_id
            or r.owner_head_id = me.id
            or r.reviewed_by = me.id
            or r.routed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
            or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
         ))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
    );
    if not v_can_set then raise exception 'You do not have permission to change Head on this request'; end if;
  end if;

  select * into h from public.profiles where id = p_head_id and role = 'head' and is_active;
  if h.id is null then raise exception 'Invalid or inactive Head'; end if;
  if r.request_type::text = 'petty_cash' and not h.is_petty_cash_dealer and me.id <> h.id then
    raise exception 'Selected Department Head is not enabled as a Petty Cash Dealer';
  end if;

  update public.requests
  set owner_head_id = h.id,
      owner_head_name = h.full_name,
      department_id = h.department_id,
      category_id = case
        when r.request_type::text = 'petty_cash' then null
        when exists (select 1 from public.work_categories where id = r.category_id and department_id = h.department_id and is_active) then r.category_id
        else null
      end,
      category_name = case
        when r.request_type::text = 'petty_cash' then null
        when exists (select 1 from public.work_categories where id = r.category_id and department_id = h.department_id and is_active) then r.category_name
        else null
      end,
      updated_at = now()
  where id = r.id;
end $$;

revoke execute on function public.set_request_target_head(uuid, uuid) from public, anon;
grant execute on function public.set_request_target_head(uuid, uuid) to authenticated;

-- 2. Update set_request_category
create or replace function public.set_request_category(p_request_id uuid, p_category_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  c public.work_categories;
  v_can_set boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request can no longer be edited'; end if;

  if r.status = 'draft' then
    if r.requester_id <> me.id then raise exception 'Only the requester can change category on a draft'; end if;
  elsif r.status = 'returned' then
    v_can_set := (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role in ('head', 'clerk') and (
            r.department_id = me.department_id
            or r.owner_head_id = me.id
            or r.reviewed_by = me.id
            or r.routed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
            or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
         ))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
    );
    if not v_can_set then raise exception 'You do not have permission to change category on this request'; end if;
  end if;

  if p_category_id is not null then
    select * into c from public.work_categories
     where id = p_category_id and department_id = r.department_id and is_active;
    if c.id is null then raise exception 'Work category not found'; end if;
  end if;
  update public.requests set category_id = c.id, category_name = c.name, updated_at = now() where id = r.id;
end $$;

revoke execute on function public.set_request_category(uuid, uuid) from public, anon;
grant execute on function public.set_request_category(uuid, uuid) to authenticated;

-- 3. Update set_quote
create or replace function public.set_quote(
  p_file_id uuid,
  p_vendor text,
  p_amount numeric,
  p_preferred boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  f public.request_files;
  r public.requests;
  v_can_edit boolean := false;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'File not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.status = 'draft' then
    if r.requester_id <> me.id then raise exception 'Only the requester can edit quotations on a draft'; end if;
  elsif r.status = 'returned' then
    v_can_edit := (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role in ('head', 'clerk') and (
            r.department_id = me.department_id
            or r.owner_head_id = me.id
            or r.reviewed_by = me.id
            or r.routed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
            or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
         ))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
    );
    if not v_can_edit then raise exception 'You do not have permission to edit quotations on this request'; end if;
  else
    raise exception 'This request can no longer be edited';
  end if;

  if r.request_type <> 'asset' and r.request_type <> 'asset_below_20k' then
    raise exception 'Quotations are only for asset buying requests';
  end if;
  if f.kind <> 'document' then
    raise exception 'Only document attachments can be quotations';
  end if;
  if nullif(btrim(coalesce(p_vendor, '')), '') is null then
    raise exception 'Enter the vendor name for each quotation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount for each quotation';
  end if;
  if r.request_type = 'asset_below_20k' and p_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  if coalesce(p_preferred, false) then
    update public.request_files set quote_preferred = false where request_id = r.id and id <> f.id;
  end if;
  update public.request_files set
    quote_vendor = left(btrim(p_vendor), 150),
    quote_amount = round(p_amount, 2),
    quote_preferred = coalesce(p_preferred, false),
    quote_status = 'pending'
  where id = f.id;
  perform public._sync_asset_amount(r.id);
end $$;

revoke execute on function public.set_quote(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.set_quote(uuid, text, numeric, boolean) to authenticated;

-- 4. Update update_typed_draft
create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
  v_shop_id uuid;
  v_shop_name text;
  v_clean_details jsonb;
  v_bank_details jsonb;
  v_can_edit boolean := false;
  v_disb_mode text;
  target_entry_user public.profiles;
  v_entry_user_id uuid;
  v_entry_user_name text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.requester_id = me.id and r.status in ('draft', 'returned') then
    v_can_edit := true;
  elsif r.status = 'returned' and (
    me.role = 'admin'
    or (me.role in ('head', 'clerk') and (
          r.department_id = me.department_id
          or r.owner_head_id = me.id
          or r.reviewed_by = me.id
          or r.routed_by = me.id
          or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
          or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
       ))
    or (me.role = 'regional_head' and (
          r.regional_head_id = me.id
          or r.department_id = me.department_id
          or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
          or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
       ))
  ) then
    v_can_edit := true;
  end if;

  if not v_can_edit then
    raise exception 'You do not have permission to edit this request';
  end if;

  v_clean_details := case when p_details is null then null else p_details - 'shop_id' - 'shop_name' end;

  if r.request_type <> 'non_cash' then
    v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(v_clean_details, r.details));
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type::text = 'petty_cash' then
    v_title := 'Petty Cash: ' || left(coalesce(nullif(btrim(coalesce(p_notes, r.notes, '')), ''), 'Expense'), 60);
  end if;
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;

  if (r.request_type in ('general', 'non_cash') or r.request_type::text = 'petty_cash') and p_details is not null and p_details ? 'shop_id' then
    v_shop_id := public._resolve_request_shop(me, p_details);
    select name into v_shop_name from public.shops where id = v_shop_id;
  elsif r.request_type = 'exhibition' and p_details is not null and (p_details ? 'conducting_shop_id' or p_details ? 'shop_id') then
    if me.role in ('admin', 'head', 'clerk') or me.id <> r.requester_id then
      if coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        v_shop_id := (coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))::uuid;
      end if;
    else
      v_shop_id := public._resolve_request_shop(
        me,
        jsonb_build_object('shop_id', coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))
      );
    end if;
    select name into v_shop_name from public.shops where id = v_shop_id;
    if v_shop_id is not null and v_shop_name is not null then
      v := jsonb_set(
        v,
        '{details}',
        coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
          'conducting_shop_id', v_shop_id::text,
          'conducting_shop_name', v_shop_name
        )
      );
    end if;
  elsif (r.request_type in ('general', 'non_cash') or r.request_type::text = 'petty_cash') and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_disb_mode := case
    when p_details is not null and (p_details ? 'disbursement_mode') then nullif(p_details->>'disbursement_mode', '')
    else r.disbursement_mode
  end;
  if r.request_type::text = 'petty_cash' and v_disb_mode is null then
    v_disb_mode := 'cash';
  end if;

  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', v_disb_mode,
    'enter_bank_details_later', case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
    'bank_account_no', case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
    'bank_ifsc', case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
    'bank_name', case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
    'bank_branch', case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
    'bank_account_holder_name', case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
    'bank_verified', case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
    'bank_verification_message', case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end
  ));

  -- Support updating assigned_entry_user_id directly if passed in details
  v_entry_user_id := r.assigned_entry_user_id;
  v_entry_user_name := r.assigned_entry_user_name;
  if p_details is not null and p_details ? 'assigned_entry_user_id' then
    if (p_details->>'assigned_entry_user_id') ~ '^[0-9a-fA-F-]{36}$' then
      select * into target_entry_user
      from public.profiles
      where id = (p_details->>'assigned_entry_user_id')::uuid and is_active;
      if target_entry_user.id is not null and target_entry_user.role = 'disbursement' and target_entry_user.disbursement_type = 'entry_only' then
        v_entry_user_id := target_entry_user.id;
        v_entry_user_name := target_entry_user.full_name;
      end if;
    elsif p_details->>'assigned_entry_user_id' is null or p_details->>'assigned_entry_user_id' = '' then
      v_entry_user_id := null;
      v_entry_user_name := null;
    end if;
  end if;

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = (case when r.request_type = 'non_cash' then coalesce(v_clean_details, r.details) else v->'details' end) || v_bank_details,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    disbursement_mode = v_disb_mode,
    enter_bank_details_later = case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
    bank_account_no = case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
    bank_ifsc = case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
    bank_name = case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
    bank_branch = case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
    bank_account_holder_name = case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
    bank_verified = case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
    bank_verification_message = case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end,
    assigned_entry_user_id = v_entry_user_id,
    assigned_entry_user_name = v_entry_user_name,
    updated_at = now()
  where id = r.id;

  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

revoke execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) from public, anon;
grant execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) to authenticated;

-- 5. Update assign_disbursement_entry_user
create or replace function public.assign_disbursement_entry_user(
  p_request_id uuid,
  p_entry_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  target_user public.profiles;
  entry_count int;
  is_requester_draft boolean;
  v_can_assign boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  is_requester_draft := (r.requester_id = me.id and r.status in ('draft', 'returned'));

  if is_requester_draft or me.role = 'admin' then
    v_can_assign := true;
  elsif me.role in ('head', 'clerk') and (
    r.department_id = me.department_id
    or r.owner_head_id = me.id
    or r.reviewed_by = me.id
    or r.routed_by = me.id
    or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
    or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
  ) then
    v_can_assign := true;
  elsif me.role = 'regional_head' and (
    r.regional_head_id = me.id
    or r.department_id = me.department_id
    or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
    or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
  ) then
    v_can_assign := true;
  end if;

  if not v_can_assign then
    raise exception 'Permission denied: Only the requester, Regional Head, Department Head, Clerk, or Admin can assign the disbursement entry account';
  end if;

  if r.status in ('cancelled', 'rejected', 'withdrawn') then
    raise exception 'Cannot assign entry account on a % request', r.status;
  end if;

  if r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Disbursement entry accounts cannot be assigned to non-payment requests';
  end if;

  select count(*) into entry_count
    from public.disbursement_entries
   where request_id = r.id and status <> 'cancelled';

  if entry_count > 0 then
    raise exception 'Selection locked: A disbursement entry has already been created for this request. Entry account cannot be changed.';
  end if;

  select * into target_user from public.profiles where id = p_entry_user_id and is_active;
  if target_user.id is null then
    raise exception 'Target disbursement user not found or inactive';
  end if;
  if target_user.role <> 'disbursement'
     or target_user.disbursement_type is distinct from 'entry_only'
     or (lower(coalesce(target_user.designation, '')) ~ '(approv|check|verif|review|audit)')
     or (lower(coalesce(target_user.username, '')) ~ '(approv|check|verif|review|audit)')
     or (lower(coalesce(target_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
    raise exception 'Assigned user must be an active Disbursement Entry Only account (Entry Checking / Approver accounts cannot be assigned)';
  end if;

  update public.requests
     set assigned_entry_user_id = target_user.id,
         assigned_entry_user_name = target_user.full_name,
         assigned_entry_at = now(),
         assigned_entry_by = me.id,
         updated_at = now()
   where id = r.id;

  if r.status <> 'draft' then
    perform public._log_action(
      r.id, me, 'assigned_entry_account', r.status, r.status,
      'Assigned Disbursement Entry account to ' || target_user.full_name,
      true
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'request_id', r.id,
    'assigned_entry_user_id', target_user.id,
    'assigned_entry_user_name', target_user.full_name
  );
end $$;

revoke execute on function public.assign_disbursement_entry_user(uuid, uuid) from public, anon;
grant execute on function public.assign_disbursement_entry_user(uuid, uuid) to authenticated;

-- 6. Update submit_request to support resubmitting returned requests by authorized roles
create or replace function public.submit_request(p_request_id uuid, p_entry_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  pc_head public.profiles;
  v_no text;
  n int;
  v_rh_count int;
  v_next public.request_status;
  v_cat_ok boolean;
  target_entry_user public.profiles;
  v_can_submit boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request cannot be submitted (current status: %)', r.status; end if;

  if r.status = 'draft' then
    if r.requester_id <> me.id then
      raise exception 'Only the requester can submit a draft request';
    end if;
  elsif r.status = 'returned' then
    v_can_submit := (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role = 'head' and (
            r.department_id = me.department_id
            or r.owner_head_id = me.id
            or r.reviewed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
            or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
         ))
      or (me.role = 'clerk' and (
            r.department_id = me.department_id
            or r.routed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
    );
    if not v_can_submit then
      raise exception 'You do not have permission to resubmit this request';
    end if;
  end if;

  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  if r.request_type <> 'non_cash' and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_entry_user_id is not null then
    select * into target_entry_user from public.profiles where id = p_entry_user_id and is_active;
    if target_entry_user.id is null then
      raise exception 'Target disbursement entry account not found or inactive';
    end if;
    if target_entry_user.role <> 'disbursement'
       or target_entry_user.disbursement_type is distinct from 'entry_only'
       or (lower(coalesce(target_entry_user.designation, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.username, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
      raise exception 'Selected user must be an active Disbursement Entry Only account';
    end if;

    update public.requests set
      assigned_entry_user_id = target_entry_user.id,
      assigned_entry_user_name = target_entry_user.full_name,
      assigned_entry_at = now(),
      assigned_entry_by = me.id
    where id = r.id;

    r.assigned_entry_user_id := target_entry_user.id;
    r.assigned_entry_user_name := target_entry_user.full_name;
  end if;

  -- Petty Cash validation & clerk-skipping routing
  if r.request_type::text = 'petty_cash' then
    if r.amount > 1000 then
      raise exception 'Petty Cash amount cannot exceed ₹1,000';
    end if;
    if nullif(btrim(coalesce(r.notes, '')), '') is null then
      raise exception 'Note is mandatory for Petty Cash requests';
    end if;
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account for this Petty Cash request';
    end if;

    if me.role = 'head' and (r.owner_head_id is null or r.owner_head_id = me.id) then
      pc_head := null;
    else
      if r.owner_head_id is null then
        raise exception 'Please select a Petty Cash Dealing Head';
      end if;
      select * into pc_head
      from public.profiles
      where id = r.owner_head_id and role = 'head' and is_active;

      if pc_head.id is null or not pc_head.is_petty_cash_dealer then
        raise exception 'Selected Department Head is not an active Petty Cash Dealer';
      end if;
    end if;

    -- Resolve Regional Head if Employee
    if me.role = 'employee' then
      if me.regional_head_id is not null then
        select p.* into rh from public.profiles p
         where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active;
      end if;

      if rh.id is null and me.shop_id is not null then
        select count(*) into v_rh_count from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active
           and s.shop_id = me.shop_id;
        if v_rh_count = 1 then
          select p.* into rh from public.profiles p
            join public.regional_head_shops s on s.regional_head_id = p.id
           where p.role = 'regional_head' and p.is_active
             and s.shop_id = me.shop_id;
        elsif v_rh_count > 1 then
          raise exception 'Your Regional Head is not assigned yet. Ask your Head to assign one before submitting';
        end if;
      end if;
    end if;

    v_no := coalesce(r.request_no, public.next_number(
      coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

    if me.role = 'employee' and rh.id is not null then
      update public.requests set
        status = 'pending_regional_review',
        request_no = v_no,
        owner_head_id = pc_head.id,
        owner_head_name = pc_head.full_name,
        department_id = pc_head.department_id,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = null,
        routed_by = null,
        routed_at = null,
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_regional_review',
        'Petty Cash submitted to Regional Head (Target Head: ' || pc_head.full_name || ')', true);
      perform public.notify_next_actor(r.id, 'pending_regional_review');
      return;

    elsif pc_head.id is not null then
      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
        owner_head_id = pc_head.id,
        owner_head_name = pc_head.full_name,
        department_id = pc_head.department_id,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = 'B'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_head_approval',
        'Petty Cash routed directly to ' || pc_head.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_head_approval');
      return;

    else
      -- Own Head Petty Cash -> Admin
      update public.requests set
        status = 'pending_admin_approval',
        request_no = v_no,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = 'A'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = me.id,
        reviewed_by_name = me.full_name,
        reviewed_at = now(),
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_admin_approval',
        'Department Head Petty Cash routed directly to Admin for approval', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
  end if;

  -- Non-Petty-Cash standard validation & routing
  if me.role in ('head', 'clerk') and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account before submitting this request';
    end if;
  end if;

  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role not in ('head', 'clerk') and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  if r.request_type = 'asset' then
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 2 then raise exception 'Attach at least 2 bills or quotations, each with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  if r.request_type = 'asset_below_20k' then
    if r.amount > 20000 then raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k'; end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

  if me.role in ('head', 'admin') then
    update public.requests set
      status = 'pending_admin_approval',
      request_no = v_no,
      route = 'A'::public.approval_route,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, 'pending_admin_approval',
      case when r.status = 'returned' then 'Request resubmitted to Admin for approval'
           else 'Department Head request routed directly to Admin for approval' end,
      true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');

  elsif me.role = 'clerk' then
    if r.request_type = 'exhibition' or r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = (case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end),
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Clerk resubmitted request to Department Head for review and approval'
           else 'Clerk request routed directly to Department Head for review and approval' end,
      true);
    perform public.notify_next_actor(r.id, v_next);

  elsif me.role = 'regional_head' then
    if r.request_type = 'exhibition' or r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = (case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end),
      regional_head_id = me.id,
      regional_head_name = me.full_name,
      regional_forwarded_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      'Regional Head resubmitted request to Department Head', true);
    perform public.notify_next_actor(r.id, v_next);

  else
    -- Employee
    if me.regional_head_id is not null then
      select p.* into rh from public.profiles p
       where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active;
    end if;

    if rh.id is null and me.shop_id is not null then
      select count(*) into v_rh_count from public.profiles p
        join public.regional_head_shops s on s.regional_head_id = p.id
       where p.role = 'regional_head' and p.is_active
         and s.shop_id = me.shop_id;
      if v_rh_count = 1 then
        select p.* into rh from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active
           and s.shop_id = me.shop_id;
      elsif v_rh_count > 1 then
        raise exception 'Your Regional Head is not assigned yet. Ask your Head to assign one before submitting';
      end if;
    end if;
    v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = null,
      routed_by = null,
      routed_at = null,
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = rh.id,
      regional_head_name = rh.full_name,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Request resubmitted after correction' else null end,
      true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
