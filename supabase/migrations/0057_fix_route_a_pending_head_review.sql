-- ============================================================================
-- 0057_fix_route_a_pending_head_review.sql
--
-- Fix: Route A requests must transition to 'pending_head_review' (To Review)
-- when routed by Clerk, NOT 'pending_head_approval' (To Approve).
--
-- Why the problem occurred:
-- In migration 0052, line 347 in public.route_request accidentally assigned:
--   next_status := 'pending_head_approval';
-- unconditionally for General requests, instead of checking if p_route was 'A' or 'B'.
-- In addition, line 287 assigned 'pending_head_approval' for Exhibition requests
-- when a department head exists, instead of 'pending_head_review'.
--
-- Consequently, Route A requests (including REQ-2026-000046) were placed in the
-- Head's "To Approve (Route B)" panel instead of the "To Review (Route A)" panel.
-- ============================================================================

drop function if exists public.route_request(uuid, public.approval_route, text);
drop function if exists public.route_request(uuid, public.approval_route, text, uuid);

create or replace function public.route_request(
  p_request_id uuid,
  p_route public.approval_route,
  p_remarks text default null::text,
  p_assigned_entry_user_id uuid default null
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  threshold numeric;
  next_status public.request_status;
  has_head boolean;
  v_route public.approval_route;
  target_entry public.profiles;
begin
  me := public._me();
  if me.role is distinct from 'clerk' then raise exception 'Only a clerk can route requests'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Not waiting for clerk routing'; end if;
  if not (me.id = any(public._clerk_ids_for(r.department_id, r.category_id))) then
    raise exception 'This request is for the % clerk', coalesce(r.category_name, 'assigned');
  end if;

  select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
  threshold := coalesce(threshold, 10000);

  select exists (
    select 1 from public.profiles
    where department_id = r.department_id and role = 'head' and is_active
  ) into has_head;

  -- If entry user provided for payment request, assign it (strictly active disbursement entry_only, excluding checking/approvers)
  if p_assigned_entry_user_id is not null and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    select * into target_entry from public.profiles where id = p_assigned_entry_user_id and is_active;
    if target_entry.id is not null
       and target_entry.role = 'disbursement'
       and target_entry.disbursement_type = 'entry_only'
       and not (
         lower(coalesce(target_entry.designation, '')) ~ '(approv|check|verif|review|audit)'
         or lower(coalesce(target_entry.username, '')) ~ '(approv|check|verif|review|audit)'
         or lower(coalesce(target_entry.full_name, '')) ~ '(approv|check|verif|review|audit)'
       ) then
      update public.requests set
        assigned_entry_user_id = target_entry.id,
        assigned_entry_user_name = target_entry.full_name,
        assigned_entry_at = now(),
        assigned_entry_by = me.id
      where id = r.id;
    end if;
  end if;

  -- Asset request handling: quotation selection by Head
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_review'; v_route := null;
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'sent_for_quote_selection', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Requester is head -> must go to Admin directly
  if r.requester_role = 'head' then
    update public.requests set
      route = 'A',
      status = 'pending_admin_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval', p_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
    return;
  end if;

  -- Exhibition requests mandatory Route A
  if r.request_type = 'exhibition' then
    if p_route <> 'A' then raise exception 'Exhibition requests must be routed to Route A (Admin)'; end if;
    if not has_head then
      next_status := 'pending_admin_approval';
    else
      next_status := 'pending_head_review';
    end if;
    update public.requests set
      route = 'A',
      status = next_status,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Discount & Stock Transfer requests mandatory Route B
  if r.request_type = 'discount' or r.request_type = 'stock_transfer' then
    if p_route <> 'B' then
      raise exception '% requests must be routed to Route B (Department Head)',
        case when r.request_type = 'discount' then 'Discount' else 'Stock Transfer' end;
    end if;
    if not has_head then
      update public.requests set
        route = 'A',
        status = 'pending_admin_approval',
        routed_by = me.id,
        routed_at = now(),
        updated_at = now()
      where id = r.id;
      perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval',
        coalesce(p_remarks, '') || ' [Auto Route A: department has no active head]', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
    update public.requests set
      route = 'B',
      status = 'pending_head_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_head_approval', p_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_head_approval');
    return;
  end if;

  -- General requests
  if p_route = 'B' and r.amount > threshold then
    raise exception 'Requests above % must be routed to Route A (Admin)', threshold;
  end if;

  if not has_head then
    update public.requests set
      route = 'A',
      status = 'pending_admin_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval',
      coalesce(p_remarks, '') || ' [Auto Route A: department has no active head]', true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
    return;
  end if;

  -- Department has active head:
  -- Route A: Head reviews and forwards with comments to Admin (pending_head_review)
  -- Route B: Head is the final approval authority (pending_head_approval)
  if p_route = 'B' then
    next_status := 'pending_head_approval';
  else
    next_status := 'pending_head_review';
  end if;

  update public.requests set
    route = p_route,
    status = next_status,
    routed_by = me.id,
    routed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $function$;

revoke execute on function public.route_request(uuid, public.approval_route, text, uuid) from public, anon;
grant execute on function public.route_request(uuid, public.approval_route, text, uuid) to authenticated;

-- ============================================================================
-- Data Migration / Correction:
-- Fix REQ-2026-000046 and any other Route A requests stuck in pending_head_approval
-- ============================================================================
do $$
declare
  r record;
begin
  for r in
    select id, request_no, department_id, requester_role
    from public.requests
    where (
      request_no = 'REQ-2026-000046'
      or (
        route = 'A'
        and status = 'pending_head_approval'
        and requester_role <> 'head'
      )
    )
  loop
    -- Ensure status is updated to pending_head_review
    update public.requests
    set status = 'pending_head_review',
        updated_at = now()
    where id = r.id;

    -- Add an action history log
    insert into public.request_actions (
      request_id,
      actor_id,
      actor_name,
      actor_role,
      action,
      from_status,
      to_status,
      remarks,
      visible_to_requester
    ) values (
      r.id,
      null,
      'System',
      'admin',
      'routed_a_corrected',
      'pending_head_approval',
      'pending_head_review',
      'Corrected routing status: Route A requests require Department Head review before Admin approval',
      true
    );

    -- Remove misleading 'Request waiting for your approval' notifications
    delete from public.notifications
    where request_id = r.id
      and title = 'Request waiting for your approval';

    -- Send proper 'Request waiting for your review' notification to the Department Head
    perform public.notify_next_actor(r.id, 'pending_head_review');
  end loop;
end $$;
