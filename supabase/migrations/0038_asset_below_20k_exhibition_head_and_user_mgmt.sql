-- 0038_asset_below_20k_exhibition_head_and_user_mgmt.sql
-- 1. Asset buying below 20k: maximum amount 20,000 INR, minimum 1 bill or quotation mandatory.
-- 2. Asset buying: updated from 3 to 2 bills or quotations mandatory.
-- 3. Exhibition request: routed strictly to requester's main head (no head choosing).
-- 4. User delete: allow Admin and Head to delete user only if no requests are associated.
-- 5. User edit: allow updating full name, username, and designation.

-- 1. Enable asset_below_20k in existing profiles and set column default
update public.profiles
set allowed_types = array_append(allowed_types, 'asset_below_20k'::public.request_type)
where allowed_types is not null
  and not ('asset_below_20k'::public.request_type = any(allowed_types));

alter table public.profiles
  alter column allowed_types set default array[
    'general'::public.request_type,
    'discount'::public.request_type,
    'exhibition'::public.request_type,
    'asset'::public.request_type,
    'asset_below_20k'::public.request_type,
    'non_cash'::public.request_type
  ];

-- 2. Update _build_details
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
begin
  if p_type = 'general' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, false);
    v_base := public._num(d, 'base_amount');
    v_gen_gst := public._num(d, 'gst_amount');
    v_gen_rate := public._num(d, 'gst_rate');
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'base_amount', coalesce(v_base, round(p_amount, 2)),
        'has_gst', v_has_gst,
        'gst_rate', case when v_has_gst then coalesce(v_gen_rate, 18) else 0 end,
        'gst_amount', case when v_has_gst then coalesce(v_gen_gst, round(p_amount - coalesce(v_base, p_amount), 2)) else 0 end,
        'total_amount', round(p_amount, 2)
      ))
    );

  elsif p_type = 'discount' then
    v_before := public._num(d, 'before_amount');
    v_after := public._num(d, 'after_amount');
    if v_before is null or v_before <= 0 then raise exception 'Enter the amount before discount'; end if;
    if v_after is null or v_after < 0 then raise exception 'Enter the amount after discount'; end if;
    if v_after >= v_before then raise exception 'After-discount amount must be less than the amount before discount'; end if;
    return jsonb_build_object(
      'amount', v_before - v_after,
      'details', jsonb_build_object(
        'before_amount', v_before, 'after_amount', v_after,
        'discount_amount', v_before - v_after,
        'discount_pct', round((v_before - v_after) / v_before * 100, 2),
        'customer_name', public._txt(d, 'customer_name', 100),
        'reference', public._txt(d, 'reference', 100)));

  elsif p_type = 'asset' or p_type = 'asset_below_20k' then
    if public._txt(d, 'asset_name') is null then raise exception 'Asset name is required'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the quotation amounts'; end if;
    if p_type = 'asset_below_20k' and p_amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'asset_name', public._txt(d, 'asset_name', 200),
        'quantity', public._txt(d, 'quantity', 50),
        'specification', public._txt(d, 'specification', 1000),
        'purpose', public._txt(d, 'purpose', 1000))));

  else -- exhibition
    if public._txt(d, 'event_name') is null then raise exception 'Event name is required'; end if;
    if public._txt(d, 'venue') is null then raise exception 'Venue is required'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, true);
    v_gst_pct := coalesce(public._num(d, 'gst_pct'), 18);
    v_gst := case when v_has_gst then round(v_excl * (v_gst_pct / 100), 2) else 0 end;
    v_total := v_excl + v_gst;
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'event_name', public._txt(d, 'event_name', 150),
        'venue', public._txt(d, 'venue', 200),
        'event_dates', public._txt(d, 'event_dates', 200),
        'event_start', public._txt(d, 'event_start', 30),
        'event_end', public._txt(d, 'event_end', 30),
        'amount_excl_gst', v_excl,
        'has_gst', v_has_gst,
        'gst_pct', v_gst_pct,
        'gst_amount', v_gst,
        'total_amount', v_total,
        'organiser_contact', public._txt(d, 'organiser_contact', 100),
        'expected_footfall', public._txt(d, 'expected_footfall', 100),
        'stall_size_location', public._txt(d, 'stall_size_location', 100),
        'provides', coalesce(d->'provides', '[]'::jsonb),
        'is_waitlist', coalesce((d->>'is_waitlist')::boolean, false),
        'region_id', public._txt(d, 'region_id', 36),
        'region_name', public._txt(d, 'region_name', 100)
      ))
    );
  end if;
end $function$;

-- 3. Update create_typed_draft
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
  v_amount numeric;
  v_target_head public.profiles;
  v_dept_id uuid;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_region_id uuid;
  v_region_name text;
  v_is_waitlist boolean;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types) or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, p_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  if p_type = 'asset_below_20k' and v_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
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

  select name into v_shop from public.shops where id = me.shop_id;

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

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, me.shop_id, v_shop, case when p_type = 'non_cash' then p_details else v->'details' end,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist
  )
  returning id into v_id;
  return v_id;
end $function$;

-- 4. Update submit_request
create or replace function public.submit_request(p_request_id uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; rh public.profiles; v_no text; n int; v_rh_count int;
  v_next public.request_status; v_cat_ok boolean;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request has already been submitted'; end if;
  if r.request_type <> 'non_cash' and r.amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if not (r.request_type = any(me.allowed_types) or (r.request_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are no longer allowed to raise % requests', r.request_type;
  end if;
  if r.request_type = 'general' and not exists (
       select 1 from public.request_files where request_id = r.id and kind = 'document') then
    raise exception 'Attach at least one document';
  end if;
  if r.request_type = 'discount' and not exists (
       select 1 from public.request_files
        where request_id = r.id and kind = 'document' and mime_type = 'application/pdf' and added_by is null) then
    raise exception 'Attach the discount PDF to submit';
  end if;

  -- Work category (only needed when several clerks split the target department's work).
  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  -- Asset Buying (regular): min 2 bills or quotations
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

  -- Asset Buying Below 20k: amount max 20000, min 1 bill or quotation
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

  -- Employees under a Regional Head go to the Regional Head first.
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
  v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));
  update public.requests set status = v_next, request_no = v_no,
    route = null, routed_by = null, routed_at = null, reviewed_by = null, reviewed_by_name = null, reviewed_at = null,
    regional_head_id = rh.id, regional_head_name = rh.full_name, regional_forwarded_at = null,
    submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'submitted', r.status, v_next, null, true);
  perform public.notify_next_actor(r.id, v_next);
end $function$;

-- 5. Update select_quote to support asset_below_20k
create or replace function public.select_quote(p_request_id uuid, p_file_id uuid, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests; f public.request_files; threshold numeric;
  next_status public.request_status; v_route public.approval_route; n int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or (r.request_type <> 'asset' and r.request_type <> 'asset_below_20k') then
    raise exception 'Not found';
  end if;
  select * into f from public.request_files where id = p_file_id and request_id = r.id;
  if f.id is null or f.quote_amount is null then raise exception 'That document is not a quotation on this request'; end if;

  if me.role = 'head' then
    if r.department_id <> me.department_id or r.requester_id = me.id then raise exception 'Not found'; end if;
    if r.status not in ('pending_head_review','pending_head_approval') then
      raise exception 'This request is not waiting for quote selection';
    end if;
    select count(*) into n from public.head_consultations where request_id = r.id and status in ('pending','disagreed');
    if n > 0 then raise exception 'Resolve the inter-department head consultations first'; end if;
  elsif me.role = 'admin' then
    if r.status <> 'pending_admin_approval' then raise exception 'This request is not waiting for Admin approval'; end if;
    if r.selected_quote_id is not null then
      raise exception 'The Head has already selected the quotation; Admin approves or returns it';
    end if;
  else
    raise exception 'Only the Head (or Admin) can select the quotation';
  end if;

  update public.request_files set quote_status = case when id = f.id then 'selected' else 'rejected' end
   where request_id = r.id and quote_amount is not null;

  next_status := r.status; v_route := r.route;
  if me.role = 'head' then
    select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
    threshold := coalesce(threshold, 10000);
    if f.quote_amount <= threshold then
      next_status := 'pending_head_approval'; v_route := 'B';
    else
      next_status := 'pending_admin_approval'; v_route := 'A';
    end if;
  end if;

  update public.requests set selected_quote_id = f.id, quote_selected_by = me.id, quote_selected_by_name = me.full_name,
    quote_selected_at = now(), amount = f.quote_amount, status = next_status, route = v_route,
    reviewed_by = case when next_status = 'pending_admin_approval' and me.role = 'head' then me.id else reviewed_by end,
    reviewed_by_name = case when next_status = 'pending_admin_approval' and me.role = 'head' then me.full_name else reviewed_by_name end,
    reviewed_at = case when next_status = 'pending_admin_approval' and me.role = 'head' then now() else reviewed_at end,
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'quote_selected', r.status, next_status,
    'Selected ' || coalesce(f.quote_vendor, f.original_name) || ' · Rs. ' || to_char(f.quote_amount, 'FM999999999990.00')
      || case when next_status = 'pending_admin_approval' and r.status <> 'pending_admin_approval'
              then ' · above limit, sent to Admin' else '' end
      || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
    true);

  if next_status = 'pending_head_approval' then
    perform public.notify_head_quote_chosen(r.id, f.id);
  else
    perform public.notify_next_actor(r.id, next_status);
  end if;

  return jsonb_build_object('selected_quote_id', f.id, 'amount', f.quote_amount, 'status', next_status, 'route', v_route);
end $$;

-- 6. Helper: check if a user can be deleted
create or replace function public.can_delete_user(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count bigint := 0;
begin
  select count(*) into v_count from (
    select id from public.requests
     where requester_id = p_user_id
        or owner_head_id = p_user_id
        or routed_by = p_user_id
        or reviewed_by = p_user_id
        or approved_by = p_user_id
        or quote_selected_by = p_user_id
        or regional_head_id = p_user_id
    union all
    select id from public.request_actions where actor_id = p_user_id
    union all
    select id from public.request_files where added_by = p_user_id
    union all
    select id from public.head_consultations where head_id = p_user_id
    union all
    select id from public.request_payments where recorded_by = p_user_id or cancelled_by = p_user_id
  ) t;

  return jsonb_build_object(
    'can_delete', (v_count = 0),
    'request_count', v_count,
    'reason', case when v_count > 0
                   then 'User has ' || v_count || ' associated request(s) or workflow action(s).'
                   else 'No associated requests.' end
  );
end $$;
revoke execute on function public.can_delete_user(uuid) from public, anon;
grant execute on function public.can_delete_user(uuid) to authenticated;

-- 7. RPC: permanently delete a user account (only if no requests associated)
create or replace function public.delete_user_account(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target public.profiles;
  v_req_count bigint := 0;
begin
  me := public._me();
  if me.id = p_user_id then raise exception 'You cannot delete your own account'; end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;

  if me.role = 'admin' or (me.role = 'head' and target.department_id = me.department_id) then
    -- Allowed
  else
    raise exception 'Permission denied: only Admin or the Department Head can delete users';
  end if;

  -- Count associated requests
  select count(*) into v_req_count from (
    select id from public.requests
     where requester_id = p_user_id
        or owner_head_id = p_user_id
        or routed_by = p_user_id
        or reviewed_by = p_user_id
        or approved_by = p_user_id
        or quote_selected_by = p_user_id
        or regional_head_id = p_user_id
    union all
    select id from public.request_actions where actor_id = p_user_id
    union all
    select id from public.request_files where added_by = p_user_id
    union all
    select id from public.head_consultations where head_id = p_user_id
    union all
    select id from public.request_payments where recorded_by = p_user_id or cancelled_by = p_user_id
  ) t;

  if v_req_count > 0 then
    raise exception 'Cannot delete user: % request(s) or workflow action(s) are associated with this user. Deactivate the user instead.', v_req_count;
  end if;

  -- Clean up ancillary relationships
  delete from public.regional_head_shops where regional_head_id = p_user_id;
  delete from public.clerk_categories where clerk_id = p_user_id;
  delete from public.user_heads where user_id = p_user_id or head_id = p_user_id;
  delete from public.approver_credentials where user_id = p_user_id;
  update public.profiles set default_head_id = null where default_head_id = p_user_id;
  update public.profiles set regional_head_id = null where regional_head_id = p_user_id;

  delete from public.profiles where id = p_user_id;

  return jsonb_build_object('success', true, 'deleted_id', p_user_id, 'username', target.username);
end $$;
revoke execute on function public.delete_user_account(uuid) from public, anon;
grant execute on function public.delete_user_account(uuid) to authenticated;

-- 8. RPC: update user details (full_name, username, designation)
create or replace function public.update_user_details(
  p_user_id uuid,
  p_full_name text,
  p_username text,
  p_designation text default null
)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target public.profiles;
  v_username text;
  v_fullname text;
  v_designation text;
  v_res public.profiles;
begin
  me := public._me();
  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;

  if me.role = 'admin' or (me.role = 'head' and target.department_id = me.department_id) or me.id = p_user_id then
    -- Allowed
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

  update public.profiles
  set full_name = v_fullname,
      username = v_username,
      designation = v_designation,
      updated_at = now()
  where id = p_user_id
  returning * into v_res;

  return v_res;
end $$;
revoke execute on function public.update_user_details(uuid, text, text, text) from public, anon;
grant execute on function public.update_user_details(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
