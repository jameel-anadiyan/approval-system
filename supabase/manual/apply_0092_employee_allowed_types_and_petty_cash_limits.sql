-- Manual SQL Script: Apply Migration 0092 in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ensure new profiles default strictly to 'general' request access.
-- 2. In create_typed_draft, remove petty_cash bypass so employees/clerks/regional heads
--    must have 'petty_cash' in allowed_types to raise petty cash requests.
-- 3. In submit_request, compute v_pc_limit directly from category (showroom: 4000,
--    accommodation: 1500, water_bottle: 2500, normal: 1000) so submissions above ₹1,000 succeed.

-- 1. Set default allowed_types to general only
alter table public.profiles
  alter column allowed_types set default array['general'::public.request_type];

-- 2. Update create_typed_draft
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
  v_disb_mode text;
  v_is_payable boolean;
  v_pc_limit numeric;
  v_pc_cat text;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head','admin') then
    raise exception 'Your role cannot raise requests';
  end if;

  if p_type::text in ('agreement', 'statutory_payment', 'audit_report') then
    if not (me.role = 'admin' or p_type = any(me.allowed_types)) then
      raise exception 'You do not have access to raise % requests yet', p_type;
    end if;
  elsif not (
    p_type = any(me.allowed_types)
    or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types))
    or me.role in ('admin', 'head')
  ) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

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

  if p_type::text = 'petty_cash' then
    v_pc_cat := coalesce(v->'details'->>'petty_cash_category', 'normal');
    if v_pc_cat = 'showroom_cleaning' then
      v_pc_limit := 4000;
    elsif v_pc_cat = 'accommodation_cleaning' then
      v_pc_limit := 1500;
    elsif v_pc_cat = 'water_bottle' then
      v_pc_limit := 2500;
    else
      v_pc_limit := 1000;
    end if;
    if v_amount > v_pc_limit then
      raise exception 'Petty Cash amount cannot exceed ₹% for %', v_pc_limit, v_pc_cat;
    end if;
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type::text = 'petty_cash' then
    v_title := 'Petty Cash: ' || left(coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Expense'), 60);
  end if;
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing / Target Head rules
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
  elsif p_type::text = 'petty_cash' then
    if p_target_head_id is not null then
      select * into v_target_head from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;
      if v_target_head.id is null then
        raise exception 'Selected Petty Cash Dealing Head is not active or not found';
      end if;
      if not v_target_head.is_petty_cash_dealer and me.id <> v_target_head.id then
        raise exception 'Selected Department Head is not enabled as a Petty Cash Dealer';
      end if;
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
  elsif me.role = 'head' then
    v_dept_id := me.department_id;
    v_owner_head_id := me.id;
    v_owner_head_name := me.full_name;
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
  elsif me.department_id is not null then
    select * into v_target_head from public.profiles
    where department_id = me.department_id and role = 'head' and is_active limit 1;
    v_dept_id := me.department_id;
    if v_target_head.id is not null then
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  -- Shop assignment
  if p_type in ('general', 'non_cash') or p_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report') then
    v_shop_id := public._resolve_request_shop(me, p_details);
  elsif p_type = 'exhibition' then
    v_shop_id := public._resolve_request_shop(
      me,
      case
        when p_details is not null and (p_details ? 'conducting_shop_id')
          then jsonb_build_object('shop_id', p_details->>'conducting_shop_id')
        else p_details
      end
    );
  else
    v_shop_id := me.shop_id;
  end if;
  if v_shop_id is not null then
    select name into v_shop from public.shops where id = v_shop_id;
  end if;

  if p_type = 'exhibition' and v_shop_id is not null then
    v := jsonb_set(
      v,
      '{details}',
      coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
        'conducting_shop_id', v_shop_id::text,
        'conducting_shop_name', v_shop
      )
    );
  end if;

  if p_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  -- Region snapshot for Exhibition
  if p_type = 'exhibition' then
    if (v_clean_details ? 'region_id') and (v_clean_details->>'region_id') ~ '^[0-9a-fA-F-]{36}$' then
      v_region_id := (v_clean_details->>'region_id')::uuid;
      v_region_name := v_clean_details->>'region_name';
    elsif me.region_id is not null then
      v_region_id := me.region_id;
      select name into v_region_name from public.regions where id = me.region_id;
    end if;
    v_is_waitlist := coalesce((v->'details'->>'is_waitlist')::boolean, false);
  end if;

  v_is_payable := p_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report');

  if v_is_payable then
    v_disb_mode := nullif(p_details->>'disbursement_mode', '');
    if p_type::text = 'petty_cash' and v_disb_mode is null then
      v_disb_mode := 'cash';
    end if;

    v_bank_details := jsonb_strip_nulls(jsonb_build_object(
      'disbursement_mode', v_disb_mode,
      'enter_bank_details_later', coalesce((p_details->>'enter_bank_details_later')::boolean, false),
      'bank_account_no', nullif(p_details->>'bank_account_no', ''),
      'bank_ifsc', nullif(p_details->>'bank_ifsc', ''),
      'bank_name', nullif(p_details->>'bank_name', ''),
      'bank_branch', nullif(p_details->>'bank_branch', ''),
      'bank_account_holder_name', nullif(p_details->>'bank_account_holder_name', ''),
      'bank_verified', coalesce((p_details->>'bank_verified')::boolean, false),
      'bank_verification_message', nullif(p_details->>'bank_verification_message', '')
    ));

    v := jsonb_set(v, '{details}', coalesce(v->'details', '{}'::jsonb) || v_bank_details);
  end if;

  insert into public.requests (
    request_type, requester_id, department_id, title, notes,
    amount, details, status, is_draft, owner_head_id, owner_head_name,
    shop_id, shop_name, region_id, region_name, is_waitlist,
    disbursement_mode, enter_bank_details_later, bank_account_no, bank_ifsc,
    bank_name, bank_branch, bank_account_holder_name, bank_verified, bank_verification_message,
    assigned_entry_user_id
  ) values (
    p_type, me.id, v_dept_id, v_title, nullif(btrim(coalesce(p_notes, '')), ''),
    v_amount, v->'details', 'draft', true, v_owner_head_id, v_owner_head_name,
    v_shop_id, v_shop, v_region_id, v_region_name, coalesce(v_is_waitlist, false),
    v_disb_mode::public.disbursement_mode,
    case when v_disb_mode = 'bank' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else false end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_account_no', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_ifsc', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_name', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_branch', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_account_holder_name', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then coalesce((p_details->>'bank_verified')::boolean, false) else false end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_verification_message', '') else null end,
    case when (p_details ? 'assigned_entry_user_id') and (p_details->>'assigned_entry_user_id') ~ '^[0-9a-fA-F-]{36}$'
         then (p_details->>'assigned_entry_user_id')::uuid else null end
  ) returning id into v_id;

  return v_id;
end $function$;

grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- 3. Update submit_request
create or replace function public.submit_request(p_request_id uuid, p_entry_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  pc_head public.profiles;
  target_entry_user public.profiles;
  v_next public.request_status;
  v_rh_count int;
  v_no text;
  v_clerk public.profiles;
  v_head_clerk public.profiles;
  v_is_cross_head boolean := false;
  v_pc_limit numeric;
  v_pc_cat text;
  v_bottle_qty int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.status not in ('draft', 'returned') then
    raise exception 'Only draft or returned requests can be submitted';
  end if;

  if r.requester_id <> me.id and me.role <> 'admin' then
    if not (r.status = 'returned' and me.role = 'clerk' and r.department_id = me.department_id) then
      raise exception 'Only the requester can submit this request';
    end if;
  end if;

  -- Optional entry account assignment on submission
  if p_entry_user_id is not null then
    select * into target_entry_user from public.profiles
    where id = p_entry_user_id and is_active = true and role = 'disbursement' and disbursement_type = 'entry_only';

    if target_entry_user.id is null then
      raise exception 'Selected Disbursement Entry Account is invalid, inactive, or not Entry Only';
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
    v_pc_cat := coalesce(r.details->>'petty_cash_category', 'normal');
    if v_pc_cat = 'showroom_cleaning' then
      v_pc_limit := 4000;
    elsif v_pc_cat = 'accommodation_cleaning' then
      v_pc_limit := 1500;
    elsif v_pc_cat = 'water_bottle' then
      v_pc_limit := 2500;
    else
      v_pc_limit := 1000;
    end if;
    v_bottle_qty := (r.details->>'bottle_qty')::int;

    if r.amount > v_pc_limit then
      raise exception 'Petty Cash amount cannot exceed ₹% for %', v_pc_limit, v_pc_cat;
    end if;
    if v_pc_cat = 'water_bottle' and v_bottle_qty is not null and v_bottle_qty > 0 then
      if round(r.amount / v_bottle_qty, 2) > 6.00 then
        raise exception 'Bottle price is high please put this in general request';
      end if;
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

    if r.request_no is null then
      v_no := public.gen_request_no();
    else
      v_no := r.request_no;
    end if;

    if me.role = 'employee' and rh.id is not null then
      update public.requests set
        status = 'pending_regional_forward',
        request_no = v_no,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        route = 'B'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_regional_forward',
        'Petty Cash routed to Regional Head ' || rh.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_regional_forward');
      return;

    elsif pc_head.id is not null then
      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
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

  -- Non-Petty-Cash validation
  if r.request_type::text not in ('exhibition', 'petty_cash') and me.role not in ('head', 'admin') and r.category_id is null then
    if exists (select 1 from public.request_categories rc where rc.is_active and (rc.department_id is null or rc.department_id = r.department_id)) then
      raise exception 'Please select a work category before submitting';
    end if;
  end if;

  if r.request_type = 'asset_below_20k' and r.amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  if r.request_no is null then
    v_no := public.gen_request_no();
  else
    v_no := r.request_no;
  end if;

  -- Role-specific routing
  if me.role = 'head' then
    v_is_cross_head := r.owner_head_id is not null and r.owner_head_id <> me.id;

    if v_is_cross_head then
      select * into pc_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
      if pc_head.id is null then
        raise exception 'Assigned Department Head is not active or not found';
      end if;

      if r.category_id is null then
        if exists (select 1 from public.request_categories rc where rc.is_active and (rc.department_id is null or rc.department_id = pc_head.department_id)) then
          raise exception 'Please select a work category under % before routing', pc_head.full_name;
        end if;
      end if;

      select * into v_head_clerk
      from public.profiles
      where role = 'clerk' and department_id = pc_head.department_id and is_active
      order by created_at asc limit 1;

      if v_head_clerk.id is not null then
        v_next := 'pending_clerk_review';
        update public.requests set
          status = v_next,
          request_no = v_no,
          department_id = pc_head.department_id,
          route = 'B'::public.approval_route,
          routed_by = me.id,
          routed_at = now(),
          reviewed_by = null,
          reviewed_by_name = null,
          reviewed_at = null,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, v_next,
          'Department Head routed request to ' || pc_head.full_name || ' Department Clerk (' || v_head_clerk.full_name || ')',
          true);
        perform public.notify_next_actor(r.id, v_next);
        return;
      else
        v_next := 'pending_head_approval';
        update public.requests set
          status = v_next,
          request_no = v_no,
          department_id = pc_head.department_id,
          route = 'B'::public.approval_route,
          routed_by = me.id,
          routed_at = now(),
          reviewed_by = null,
          reviewed_by_name = null,
          reviewed_at = null,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, v_next,
          'Department Head routed request directly to ' || pc_head.full_name || ' (no clerk configured)',
          true);
        perform public.notify_next_actor(r.id, v_next);
        return;
      end if;

    else
      -- Direct to Admin
      v_next := 'pending_admin_approval';
      update public.requests set
        status = v_next,
        request_no = v_no,
        route = 'A'::public.approval_route,
        routed_by = me.id,
        routed_at = now(),
        reviewed_by = me.id,
        reviewed_by_name = me.full_name,
        reviewed_at = now(),
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, v_next,
        'Department Head routed directly to Admin for approval',
        true);
      perform public.notify_next_actor(r.id, v_next);
      return;
    end if;

  elsif me.role = 'employee' then
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

    if rh.id is not null then
      v_next := 'pending_regional_forward';
      update public.requests set
        status = v_next,
        request_no = v_no,
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;
    else
      v_next := 'pending_clerk_review';
      update public.requests set
        status = v_next,
        request_no = v_no,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;
    end if;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when rh.id is not null then 'Submitted to Regional Head ' || rh.full_name else 'Submitted to Clerk' end,
      true);
    perform public.notify_next_actor(r.id, v_next);

  elsif me.role = 'clerk' then
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Clerk resubmitted request' else 'Clerk submitted request' end,
      true);
    perform public.notify_next_actor(r.id, v_next);

  elsif me.role = 'regional_head' and r.status = 'returned' then
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      regional_forwarded_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'resubmitted',
      r.status, v_next,
      'Regional Head resubmitted returned request',
      true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;
