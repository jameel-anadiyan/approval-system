-- ============================================================================
-- 0052_fix_clerk_entry_only_accounts_and_filters.sql
--
-- Fixes:
-- 1. profiles_select RLS policy:
--    Allows Clerk and Department Head (and other authenticated users) to view
--    active Disbursement accounts, so Entry Only accounts list properly in
--    the Clerk Routing and Assign Entry Account portals.
--
-- 2. get_active_entry_only_users() RPC:
--    A security-definer helper to reliably retrieve only active Disbursement
--    Entry Only accounts across all clients (strictly excluding Entry Checking / Approvers).
--
-- 3. Auto-fix existing Entry Checking accounts:
--    Updates any disbursement account whose designation, username, or name
--    indicates they are an Entry Approver / Checking person to 'entry_approver'.
--
-- 4. set_user_disbursement_type RPC:
--    Allows all 4 disbursement types ('entry_only', 'payment_only',
--    'stock_transfer_monitor', 'entry_approver').
--
-- 5. assign_disbursement_entry_user RPC:
--    Strictly ensures the assigned account is role = 'disbursement' AND
--    disbursement_type = 'entry_only' (Admin, Entry Checking, and other types blocked).
--
-- 6. route_request RPC:
--    Strictly assigns only active disbursement accounts of 'entry_only' type.
-- ============================================================================

-- 1. Update profiles_select policy
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    (id = (select auth.uid()))
    or ((select public.my_role()) = 'admin'::public.app_role)
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role, 'regional_head'::public.app_role]))
        and (department_id = (select public.my_department())))
    or (role in ('head'::public.app_role, 'regional_head'::public.app_role) and is_active)
    or (role = 'disbursement'::public.app_role and is_active)
  );

-- 2. Auto-fix existing Entry Checking / Approver accounts that were saved as 'entry_only'
update public.profiles
   set disbursement_type = 'entry_approver',
       updated_at = now()
 where role = 'disbursement'
   and (
     disbursement_type is distinct from 'payment_only'
     and disbursement_type is distinct from 'stock_transfer_monitor'
   )
   and (
     lower(coalesce(designation, '')) ~ '(approv|check|verif|review|audit)'
     or lower(coalesce(username, '')) ~ '(approv|check|verif|review|audit)'
     or lower(coalesce(full_name, '')) ~ '(approv|check|verif|review|audit)'
   );

-- 3. RPC: get_active_entry_only_users
create or replace function public.get_active_entry_only_users()
returns table (
  id uuid,
  username text,
  full_name text,
  designation text,
  role public.app_role,
  disbursement_type text,
  is_active boolean
) language sql stable security definer set search_path = '' as $$
  select id, username, full_name, designation, role, disbursement_type, is_active
  from public.profiles
  where role = 'disbursement'
    and disbursement_type = 'entry_only'
    and is_active = true
    and not (
      lower(coalesce(designation, '')) ~ '(approv|check|verif|review|audit)'
      or lower(coalesce(username, '')) ~ '(approv|check|verif|review|audit)'
      or lower(coalesce(full_name, '')) ~ '(approv|check|verif|review|audit)'
    )
  order by full_name asc;
$$;

revoke execute on function public.get_active_entry_only_users() from public, anon;
grant execute on function public.get_active_entry_only_users() to authenticated;

-- 4. Update set_user_disbursement_type to allow 'entry_approver'
create or replace function public.set_user_disbursement_type(
  p_user_id uuid,
  p_type text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can set disbursement account type'; end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;
  if target.role <> 'disbursement' then raise exception 'User is not a disbursement account'; end if;
  if p_type is not null and p_type not in ('entry_only', 'payment_only', 'stock_transfer_monitor', 'entry_approver') then
    raise exception 'Invalid disbursement type. Must be entry_only, payment_only, stock_transfer_monitor, or entry_approver';
  end if;

  update public.profiles set disbursement_type = p_type, updated_at = now() where id = p_user_id;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name, 'disbursement_type_changed', 'user', target.id::text,
          jsonb_build_object('username', target.username, 'from', target.disbursement_type, 'to', p_type));

  return jsonb_build_object('success', true, 'user_id', target.id, 'disbursement_type', p_type);
end $$;

revoke execute on function public.set_user_disbursement_type(uuid, text) from public, anon;
grant execute on function public.set_user_disbursement_type(uuid, text) to authenticated;

-- 5. Update assign_disbursement_entry_user to strictly accept only 'entry_only' disbursement accounts (excluding entry approvers / checkers)
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
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  -- Role authorization check: Admin, Head, Regional Head, or Clerk of the department
  if me.role not in ('admin', 'head', 'regional_head', 'clerk') then
    raise exception 'Permission denied: Only Department Head, Regional Head, Clerk, or Admin can assign the disbursement entry account';
  end if;
  if me.role = 'clerk' and me.department_id is distinct from r.department_id then
    raise exception 'Permission denied: Clerks can only assign entry accounts for their own department';
  end if;

  -- Cannot assign if request is in terminal non-approved state
  if r.status in ('cancelled', 'rejected', 'withdrawn') then
    raise exception 'Cannot assign entry account on a % request', r.status;
  end if;

  -- Check if request requires payment
  if r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Disbursement entry accounts cannot be assigned to non-payment requests';
  end if;

  -- Verify no active entries have been created yet
  select count(*) into entry_count
    from public.disbursement_entries
   where request_id = r.id and status <> 'cancelled';

  if entry_count > 0 then
    raise exception 'Selection locked: A disbursement entry has already been created for this request. Entry account cannot be changed.';
  end if;

  -- Validate target user: must be strictly active disbursement role and entry_only type
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

  perform public._log_action(
    r.id, me, 'assigned_entry_account', r.status, r.status,
    'Assigned Disbursement Entry account to ' || target_user.full_name,
    true
  );

  return jsonb_build_object(
    'success', true,
    'request_id', r.id,
    'assigned_entry_user_id', target_user.id,
    'assigned_entry_user_name', target_user.full_name
  );
end $$;

revoke execute on function public.assign_disbursement_entry_user(uuid, uuid) from public, anon;
grant execute on function public.assign_disbursement_entry_user(uuid, uuid) to authenticated;

-- 6. Update route_request to strictly assign only active 'entry_only' disbursement accounts
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

  -- Asset request handling
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
    return;
  end if;

  -- Requester is head -> must go to Admin
  if r.requester_role = 'head' then
    update public.requests set
      route = 'A',
      status = 'pending_admin_approval',
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', 'pending_admin_approval', p_remarks, true);
    return;
  end if;

  -- Exhibition requests mandatory Route A
  if r.request_type = 'exhibition' then
    if p_route <> 'A' then raise exception 'Exhibition requests must be routed to Route A (Admin)'; end if;
    if not has_head then
      next_status := 'pending_admin_approval';
    else
      next_status := 'pending_head_approval';
    end if;
    update public.requests set
      route = 'A',
      status = next_status,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
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
    return;
  end if;

  next_status := 'pending_head_approval';
  update public.requests set
    route = p_route,
    status = next_status,
    routed_by = me.id,
    routed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'routed', 'submitted', next_status, p_remarks, true);
end $function$;

revoke execute on function public.route_request(uuid, public.approval_route, text, uuid) from public, anon;
grant execute on function public.route_request(uuid, public.approval_route, text, uuid) to authenticated;
