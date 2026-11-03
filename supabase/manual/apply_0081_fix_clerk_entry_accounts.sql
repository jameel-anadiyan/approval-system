-- ============================================================================
-- apply_0081_fix_clerk_entry_accounts.sql
--
-- FIX:
-- When a Clerk or Head raises a request or routes a request, the active
-- Disbursement Entry Only account was not showing up ("No active Disbursement
-- Entry Only accounts found. Please contact Admin").
--
-- CAUSES FIXED:
-- 1. profiles_select RLS policy:
--    Ensures all authenticated users (especially Clerks and Heads) can view
--    active disbursement profiles (role = 'disbursement' and is_active = true).
--
-- 2. get_active_entry_only_users() security-definer RPC:
--    Reliably returns active Entry Only accounts for all authenticated users,
--    even if disbursement_type was left NULL in the database (treats NULL as 'entry_only').
--
-- 3. Auto-heal existing disbursement profiles:
--    Sets disbursement_type = 'entry_only' on any active disbursement account
--    where it was left unassigned (NULL or empty), excluding approvers/checkers.
--
-- 4. assign_disbursement_entry_user and submit_request:
--    Gracefully treats NULL disbursement_type as 'entry_only' so submission
--    succeeds without "Selected user must be an active Disbursement Entry Only account".
-- ============================================================================

-- 1. Auto-heal existing active disbursement accounts
update public.profiles
   set disbursement_type = 'entry_only',
       updated_at = now()
 where role = 'disbursement'
   and is_active = true
   and (
     disbursement_type is null
     or btrim(disbursement_type) = ''
     or lower(btrim(disbursement_type)) in ('entry', 'entry_only')
   )
   and not (
     lower(coalesce(designation, '')) ~ '(approv|check|verif|review|audit)'
     or lower(coalesce(username, '')) ~ '(approv|check|verif|review|audit)'
     or lower(coalesce(full_name, '')) ~ '(approv|check|verif|review|audit)'
   );

-- 2. Update profiles_select RLS policy so Clerks, Heads & Employees can view active Disbursement accounts
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

-- 3. Security-definer RPC: get_active_entry_only_users
create or replace function public.get_active_entry_only_users()
returns table (
  id uuid,
  username text,
  full_name text,
  designation text,
  role public.app_role,
  disbursement_type text,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Auto-heal in background on call
  update public.profiles
     set disbursement_type = 'entry_only',
         updated_at = now()
   where role = 'disbursement'
     and is_active = true
     and (
       disbursement_type is null
       or btrim(disbursement_type) = ''
       or lower(btrim(disbursement_type)) in ('entry', 'entry_only')
     )
     and not (
       lower(coalesce(designation, '')) ~ '(approv|check|verif|review|audit)'
       or lower(coalesce(username, '')) ~ '(approv|check|verif|review|audit)'
       or lower(coalesce(full_name, '')) ~ '(approv|check|verif|review|audit)'
     );

  return query
    select p.id, p.username, p.full_name, p.designation, p.role,
           coalesce(nullif(btrim(p.disbursement_type), ''), 'entry_only') as disbursement_type,
           p.is_active
    from public.profiles p
    where p.role = 'disbursement'
      and p.is_active = true
      and coalesce(nullif(btrim(p.disbursement_type), ''), 'entry_only') in ('entry_only', 'entry')
      and not (
        lower(coalesce(p.designation, '')) ~ '(approv|check|verif|review|audit)'
        or lower(coalesce(p.username, '')) ~ '(approv|check|verif|review|audit)'
        or lower(coalesce(p.full_name, '')) ~ '(approv|check|verif|review|audit)'
      )
    order by p.full_name asc;
end;
$$;

revoke execute on function public.get_active_entry_only_users() from public, anon;
grant execute on function public.get_active_entry_only_users() to authenticated;

-- 4. Update assign_disbursement_entry_user to gracefully accept NULL/empty disbursement_type as 'entry_only'
create or replace function public.assign_disbursement_entry_user(
  p_request_id uuid,
  p_entry_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if r.id is null then
    raise exception 'Request not found';
  end if;

  if r.request_type::text in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    raise exception 'This request type does not use disbursement entry accounts';
  end if;

  is_requester_draft := (r.requester_id = me.id and r.status = 'draft');
  if me.role = 'admin' then
    v_can_assign := true;
  elsif me.role = 'head' and (
    r.owner_head_id = me.id
    or r.department_id = me.department_id
    or is_requester_draft
    or (r.request_type::text = 'petty_cash' and me.is_petty_cash_dealer)
  ) then
    v_can_assign := true;
  elsif me.role = 'clerk' and (r.department_id = me.department_id or is_requester_draft) then
    v_can_assign := true;
  elsif me.role = 'regional_head' and is_requester_draft then
    v_can_assign := true;
  elsif me.role = 'employee' and is_requester_draft and r.request_type::text = 'petty_cash' then
    v_can_assign := true;
  end if;

  if not v_can_assign then
    raise exception 'You do not have permission to assign the disbursement entry account for this request';
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
     or coalesce(nullif(btrim(target_user.disbursement_type), ''), 'entry_only') not in ('entry_only', 'entry')
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

notify pgrst, 'reload schema';
