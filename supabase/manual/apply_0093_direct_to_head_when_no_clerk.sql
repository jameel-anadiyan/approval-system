-- 0093: Direct routing to requested owner Department Head when no clerk is configured
-- Manual application mirror for Supabase SQL Editor

-- 1. Update public.submit_request
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
        status = 'pending_regional_review',
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
        r.status, 'pending_regional_review',
        'Petty Cash routed to Regional Head ' || rh.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_regional_review');
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
      where role = 'clerk'
        and is_active
        and (
          (pc_head.department_id is not null and department_id = pc_head.department_id)
          or default_head_id = pc_head.id
          or exists (
            select 1 from public.user_heads uh
            where uh.user_id = profiles.id and uh.head_id = pc_head.id
          )
        )
      order by created_at asc limit 1;

      if v_head_clerk.id is not null then
        v_next := 'submitted';
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
        if r.request_type::text = 'audit_report'
           or r.request_type = 'exhibition'
           or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment', 'non_cash')
               and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
          v_next := 'pending_head_review';
        else
          v_next := 'pending_head_approval';
        end if;

        update public.requests set
          status = v_next,
          request_no = v_no,
          department_id = pc_head.department_id,
          route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
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
      v_next := 'pending_regional_review';
      update public.requests set
        status = v_next,
        request_no = v_no,
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, v_next,
        'Submitted to Regional Head ' || rh.full_name,
        true);
      perform public.notify_next_actor(r.id, v_next);
      return;
    else
      -- Employee without regional head: check target owner head
      if r.owner_head_id is not null then
        select * into pc_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
      elsif r.department_id is not null then
        select * into pc_head from public.profiles where department_id = r.department_id and role = 'head' and is_active limit 1;
      elsif me.default_head_id is not null then
        select * into pc_head from public.profiles where id = me.default_head_id and role = 'head' and is_active;
      end if;

      select * into v_head_clerk
      from public.profiles
      where role = 'clerk'
        and is_active
        and (
          (coalesce(pc_head.department_id, r.department_id) is not null and department_id = coalesce(pc_head.department_id, r.department_id))
          or (pc_head.id is not null and (
            default_head_id = pc_head.id
            or exists (
              select 1 from public.user_heads uh
              where uh.user_id = profiles.id and uh.head_id = pc_head.id
            )
          ))
        )
      order by created_at asc limit 1;

      if v_head_clerk.id is not null then
        v_next := 'submitted';
        update public.requests set
          status = v_next,
          request_no = v_no,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, v_next,
          'Submitted to Clerk',
          true);
        perform public.notify_next_actor(r.id, v_next);
        return;
      else
        -- NO CLERK CONFIGURED UNDER OWNER HEAD: direct to requested owner head
        if r.request_type::text = 'audit_report'
           or r.request_type = 'exhibition'
           or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment', 'non_cash')
               and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
          v_next := 'pending_head_review';
        else
          v_next := 'pending_head_approval';
        end if;

        update public.requests set
          status = v_next,
          request_no = v_no,
          route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
          owner_head_id = coalesce(r.owner_head_id, pc_head.id),
          owner_head_name = coalesce(r.owner_head_name, pc_head.full_name),
          department_id = coalesce(pc_head.department_id, r.department_id),
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
          'Employee submitted request directly to ' || coalesce(pc_head.full_name, 'Department Head') || ' (no clerk configured)',
          true);
        perform public.notify_next_actor(r.id, v_next);
        return;
      end if;
    end if;

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
    return;

  elsif me.role = 'regional_head' then
    if r.owner_head_id is not null then
      select * into pc_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
    elsif r.department_id is not null then
      select * into pc_head from public.profiles where department_id = r.department_id and role = 'head' and is_active limit 1;
    elsif me.default_head_id is not null then
      select * into pc_head from public.profiles where id = me.default_head_id and role = 'head' and is_active;
    end if;

    select * into v_head_clerk
    from public.profiles
    where role = 'clerk'
      and is_active
      and (
        (coalesce(pc_head.department_id, r.department_id) is not null and department_id = coalesce(pc_head.department_id, r.department_id))
        or (pc_head.id is not null and (
          default_head_id = pc_head.id
          or exists (
            select 1 from public.user_heads uh
            where uh.user_id = profiles.id and uh.head_id = pc_head.id
          )
        ))
      )
    order by created_at asc limit 1;

    if v_head_clerk.id is not null and r.status = 'draft' then
      v_next := 'submitted';
      update public.requests set
        status = v_next,
        request_no = v_no,
        owner_head_id = coalesce(r.owner_head_id, pc_head.id),
        owner_head_name = coalesce(r.owner_head_name, pc_head.full_name),
        department_id = coalesce(pc_head.department_id, r.department_id),
        regional_forwarded_at = now(),
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, 'submitted',
        r.status, v_next,
        'Regional Head submitted request to Clerk (' || v_head_clerk.full_name || ')',
        true);
      perform public.notify_next_actor(r.id, v_next);
      return;
    else
      -- NO clerk or returned request: direct to owner head
      if r.request_type::text = 'audit_report'
         or r.request_type = 'exhibition'
         or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment', 'non_cash')
             and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
        v_next := 'pending_head_review';
      else
        v_next := 'pending_head_approval';
      end if;

      update public.requests set
        status = v_next,
        request_no = v_no,
        route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
        owner_head_id = coalesce(r.owner_head_id, pc_head.id),
        owner_head_name = coalesce(r.owner_head_name, pc_head.full_name),
        department_id = coalesce(pc_head.department_id, r.department_id),
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        regional_forwarded_at = now(),
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, v_next,
        case when r.status = 'returned' then 'Regional Head resubmitted returned request'
             else 'Regional Head submitted request directly to ' || coalesce(pc_head.full_name, 'Department Head') || ' (no clerk configured)' end,
        true);
      perform public.notify_next_actor(r.id, v_next);
      return;
    end if;
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

-- 2. Update public.regional_forward_request
create or replace function public.regional_forward_request(
  p_request_id uuid,
  p_remarks text default null,
  p_target_head_id uuid default null,
  p_category_id uuid default null,
  p_assigned_entry_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_target_head public.profiles;
  v_head_clerk public.profiles;
  v_entry_user public.profiles;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_dept_id uuid;
  v_cat_id uuid;
  v_cat_name text;
  v_entry_id uuid;
  v_entry_name text;
  v_entry_count int;
  v_head_changed boolean := false;
  v_final_remarks text;
  v_next public.request_status;
  v_route public.approval_route;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then
    raise exception 'Not found';
  end if;
  if r.status <> 'pending_regional_review' then
    raise exception 'This request is not waiting for the Regional Head';
  end if;
  if not public._is_regional_actor(r, me) then
    raise exception 'Only the assigned Regional Head can forward this request';
  end if;

  v_owner_head_id := r.owner_head_id;
  v_owner_head_name := r.owner_head_name;
  v_dept_id := r.department_id;
  v_cat_id := r.category_id;
  v_cat_name := r.category_name;
  v_entry_id := r.assigned_entry_user_id;
  v_entry_name := r.assigned_entry_user_name;

  -- Optional update of Disbursement Entry Account by Regional Head
  if p_assigned_entry_user_id is not null and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    if p_assigned_entry_user_id is distinct from r.assigned_entry_user_id then
      select count(*) into v_entry_count
        from public.disbursement_entries
       where request_id = r.id and status <> 'cancelled';
      if v_entry_count > 0 then
        raise exception 'A disbursement entry has already been created; entry account cannot be changed.';
      end if;

      select * into v_entry_user from public.profiles where id = p_assigned_entry_user_id and is_active;
      if v_entry_user.id is null
         or v_entry_user.role <> 'disbursement'
         or v_entry_user.disbursement_type is distinct from 'entry_only'
         or (lower(coalesce(v_entry_user.designation, '')) ~ '(approv|check|verif|review|audit)')
         or (lower(coalesce(v_entry_user.username, '')) ~ '(approv|check|verif|review|audit)')
         or (lower(coalesce(v_entry_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
        raise exception 'Selected user must be an active Disbursement Entry Only account';
      end if;

      v_entry_id := v_entry_user.id;
      v_entry_name := v_entry_user.full_name;
    end if;
  end if;

  -- PETTY CASH BRANCH: Choose Petty Cash Dealing Head & forward DIRECTLY to Head (skip clerk!)
  if r.request_type::text = 'petty_cash' then
    if p_target_head_id is not null and p_target_head_id is distinct from r.owner_head_id then
      select * into v_target_head
      from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;

      if v_target_head.id is null or not v_target_head.is_petty_cash_dealer then
        raise exception 'Selected Department Head is not an active Petty Cash Dealer';
      end if;

      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
      v_head_changed := true;
    else
      select * into v_target_head
      from public.profiles
      where id = v_owner_head_id and role = 'head' and is_active;

      if v_target_head.id is null or not v_target_head.is_petty_cash_dealer then
        raise exception 'Please select an active Petty Cash Dealing Head before forwarding';
      end if;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
    end if;

    if v_entry_id is null then
      raise exception 'Please select a Disbursement Entry Account before forwarding Petty Cash';
    end if;

    update public.requests
    set status = 'pending_head_approval'::public.request_status,
        route = 'B'::public.approval_route,
        routed_by = me.id,
        routed_at = now(),
        owner_head_id = v_owner_head_id,
        owner_head_name = v_owner_head_name,
        department_id = v_dept_id,
        category_id = null,
        category_name = null,
        assigned_entry_user_id = v_entry_id,
        assigned_entry_user_name = v_entry_name,
        assigned_entry_at = case when v_entry_id is distinct from r.assigned_entry_user_id then now() else r.assigned_entry_at end,
        assigned_entry_by = case when v_entry_id is distinct from r.assigned_entry_user_id then me.id else r.assigned_entry_by end,
        regional_forwarded_at = now(),
        updated_at = now()
    where id = r.id;

    if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
      v_final_remarks := '[Forwarded directly to Petty Cash Head ' || v_owner_head_name || ' · clerk skipped] ' || btrim(p_remarks);
    else
      v_final_remarks := 'Forwarded directly to Petty Cash Head ' || v_owner_head_name || ' (clerk skipped)';
    end if;

    perform public._log_action(r.id, me, 'regional_forwarded', r.status, 'pending_head_approval', v_final_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_head_approval'::public.request_status);
    return;
  end if;

  -- STANDARD NON-PETTY-CASH BRANCH
  if p_target_head_id is not null and r.request_type <> 'exhibition'::public.request_type then
    if p_target_head_id is distinct from r.owner_head_id then
      select * into v_target_head
      from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;

      if v_target_head.id is null then
        raise exception 'Selected Department Head is invalid or inactive';
      end if;

      if me.role = 'regional_head' then
        if not (
          p_target_head_id = me.default_head_id
          or exists (
            select 1 from public.user_heads uh
            where uh.user_id = me.id and uh.head_id = p_target_head_id
          )
          or (
            me.default_head_id is null
            and v_target_head.department_id = me.department_id
            and not exists (select 1 from public.user_heads uh2 where uh2.user_id = me.id)
          )
        ) then
          raise exception 'You are not allowed to forward requests to this Department Head';
        end if;
      end if;

      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
      v_head_changed := true;
    end if;
  end if;

  if p_category_id is not null and r.request_type <> 'exhibition'::public.request_type then
    select c.id, c.name into v_cat_id, v_cat_name
    from public.work_categories c
    where c.id = p_category_id
      and c.department_id = v_dept_id
      and c.is_active;

    if v_cat_id is null then
      raise exception 'Selected work category does not belong to the chosen Department Head''s department';
    end if;
  elsif v_cat_id is not null then
    if not exists (
      select 1 from public.work_categories c
      where c.id = v_cat_id and c.department_id = v_dept_id and c.is_active
    ) then
      v_cat_id := null;
      v_cat_name := null;
    end if;
  end if;

  -- Check if active clerk exists under this Department Head
  select * into v_head_clerk
  from public.profiles
  where role = 'clerk'
    and is_active
    and (
      (v_dept_id is not null and department_id = v_dept_id)
      or (v_owner_head_id is not null and (
        default_head_id = v_owner_head_id
        or exists (
          select 1 from public.user_heads uh
          where uh.user_id = profiles.id and uh.head_id = v_owner_head_id
        )
      ))
    )
  order by created_at asc limit 1;

  if v_head_clerk.id is not null then
    -- Clerk exists: normal routing to clerk queue via 'submitted'
    if r.request_type <> 'exhibition'::public.request_type
       and public._category_required(v_dept_id)
       and v_cat_id is null then
      raise exception 'Select the work category for the chosen Department Head';
    end if;

    update public.requests
    set status = 'submitted'::public.request_status,
        owner_head_id = v_owner_head_id,
        owner_head_name = v_owner_head_name,
        department_id = v_dept_id,
        category_id = v_cat_id,
        category_name = v_cat_name,
        assigned_entry_user_id = v_entry_id,
        assigned_entry_user_name = v_entry_name,
        assigned_entry_at = case when v_entry_id is distinct from r.assigned_entry_user_id then now() else r.assigned_entry_at end,
        assigned_entry_by = case when v_entry_id is distinct from r.assigned_entry_user_id then me.id else r.assigned_entry_by end,
        regional_forwarded_at = now(),
        updated_at = now()
    where id = r.id;

    if v_head_changed then
      if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
        v_final_remarks := '[Directed to ' || v_owner_head_name || '] ' || btrim(p_remarks);
      else
        v_final_remarks := 'Directed to ' || v_owner_head_name;
      end if;
    else
      v_final_remarks := nullif(btrim(coalesce(p_remarks, '')), '');
    end if;

    perform public._log_action(r.id, me, 'regional_forwarded', r.status, 'submitted', v_final_remarks, true);
    perform public.notify_next_actor(r.id, 'submitted'::public.request_status);
    return;
  else
    -- NO CLERK UNDER THIS DEPT HEAD:
    -- Forward DIRECTLY to the requested owner head!
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment', 'non_cash')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review'::public.request_status;
      v_route := 'A'::public.approval_route;
    else
      v_next := 'pending_head_approval'::public.request_status;
      v_route := 'B'::public.approval_route;
    end if;

    update public.requests
    set status = v_next,
        route = v_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        owner_head_id = v_owner_head_id,
        owner_head_name = v_owner_head_name,
        department_id = v_dept_id,
        category_id = v_cat_id,
        category_name = v_cat_name,
        assigned_entry_user_id = v_entry_id,
        assigned_entry_user_name = v_entry_name,
        assigned_entry_at = case when v_entry_id is distinct from r.assigned_entry_user_id then now() else r.assigned_entry_at end,
        assigned_entry_by = case when v_entry_id is distinct from r.assigned_entry_user_id then me.id else r.assigned_entry_by end,
        regional_forwarded_at = now(),
        updated_at = now()
    where id = r.id;

    if v_head_changed then
      if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
        v_final_remarks := '[Directed to ' || v_owner_head_name || ' · no clerk configured] ' || btrim(p_remarks);
      else
        v_final_remarks := 'Directed to ' || v_owner_head_name || ' (no clerk configured)';
      end if;
    else
      if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
        v_final_remarks := '[Forwarded directly to ' || v_owner_head_name || ' · no clerk configured] ' || btrim(p_remarks);
      else
        v_final_remarks := 'Forwarded directly to ' || v_owner_head_name || ' (no clerk configured)';
      end if;
    end if;

    perform public._log_action(r.id, me, 'regional_forwarded', r.status, v_next, v_final_remarks, true);
    perform public.notify_next_actor(r.id, v_next);
    return;
  end if;
end $$;

revoke execute on function public.regional_forward_request(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.regional_forward_request(uuid, text, uuid, uuid, uuid) to authenticated;
