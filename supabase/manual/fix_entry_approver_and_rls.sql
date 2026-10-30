-- ============================================================================
-- fix_entry_approver_and_rls.sql
--
-- INSTRUCTIONS:
-- 1. Copy the entire contents of this file.
-- 2. Open Supabase Dashboard -> SQL Editor -> New Query.
-- 3. Paste and click "Run".
--
-- FIXES:
-- 1. profiles_disbursement_type_check:
--    Ensures 'entry_approver' is an allowed disbursement_type in public.profiles.
--
-- 2. Auto-upgrade existing Entry Verification / Checking accounts:
--    Updates any disbursement account whose designation, username, or name
--    indicates they are an Entry Approver / Checking person to 'entry_approver'.
--
-- 3. my_disbursement_type() helper:
--    Updates the SQL function so that if disbursement_type = 'entry_approver'
--    OR the account name/designation matches (approv|check|verif|review|audit),
--    it automatically returns 'entry_approver' in RLS checks.
--
-- 4. set_user_disbursement_type() RPC:
--    Allows Admin to set all 4 disbursement types ('entry_only', 'payment_only',
--    'stock_transfer_monitor', 'entry_approver').
--
-- 5. requests_select RLS policy:
--    Ensures Entry Approver accounts can view ALL approved/paid payable requests
--    across all departments (not restricted by assigned_entry_user_id).
--
-- 6. disbursement_entries_select RLS policy:
--    Explicitly grants select to Admin and Entry Approver accounts, guaranteeing
--    disbursement entries always load on Entry Approvals and Disbursement screens.
-- ============================================================================

-- 1. Allow 'entry_approver' in profiles table constraint
alter table public.profiles drop constraint if exists profiles_disbursement_type_check;
alter table public.profiles
  add constraint profiles_disbursement_type_check
  check (disbursement_type is null or disbursement_type in ('entry_only', 'payment_only', 'stock_transfer_monitor', 'entry_approver'));

-- 2. Auto-upgrade existing Entry Checking / Approver / Verification accounts
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

-- 3. Update my_disbursement_type() helper function
create or replace function public.my_disbursement_type()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.disbursement_type = 'entry_approver' then 'entry_approver'
    when p.disbursement_type in ('payment_only', 'stock_transfer_monitor') then p.disbursement_type
    when lower(coalesce(p.designation, '')) ~ '(approv|check|verif|review|audit)'
      or lower(coalesce(p.username, '')) ~ '(approv|check|verif|review|audit)'
      or lower(coalesce(p.full_name, '')) ~ '(approv|check|verif|review|audit)' then 'entry_approver'
    else coalesce(p.disbursement_type, 'entry_only')
  end
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;
revoke execute on function public.my_disbursement_type() from public, anon;
grant execute on function public.my_disbursement_type() to authenticated;

-- 4. Update set_user_disbursement_type RPC
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
  if me.role <> 'admin' then
    raise exception 'Only administrators can change disbursement account types';
  end if;

  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;
  if target.role <> 'disbursement' then
    raise exception 'Disbursement type only applies to users with the disbursement role';
  end if;

  if p_type is not null and p_type not in ('entry_only', 'payment_only', 'stock_transfer_monitor', 'entry_approver') then
    raise exception 'Invalid disbursement type. Must be entry_only, payment_only, stock_transfer_monitor, or entry_approver';
  end if;

  update public.profiles set
    disbursement_type = p_type,
    updated_at = now()
  where id = p_user_id;

  perform public._log_action(null, me, 'user_disbursement_type_updated',
    'Updated ' || target.full_name || ' to ' || coalesce(p_type, 'default'));

  return jsonb_build_object('success', true, 'disbursement_type', p_type);
end;
$$;
revoke execute on function public.set_user_disbursement_type(uuid, text) from public, anon;
grant execute on function public.set_user_disbursement_type(uuid, text) to authenticated;

-- 5. Ensure requests_select policy grants entry_approver access to all approved requests
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and (owner_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.can_view_exhibition_waitlist)
        and is_waitlist and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status or requester_id = (select auth.uid())))
    -- Entry Only accounts: requests assigned to them (or unassigned payable approved requests)
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_only'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type))
        and (assigned_entry_user_id is null or assigned_entry_user_id = (select auth.uid())))
    -- Entry Approver: sees all approved / paid payable requests across all departments
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_approver'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type)))
    -- Payment accounts: payable approved requests
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and coalesce((select public.my_disbursement_type()), '') in ('payment_only', '')
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type)))
    -- Stock Transfer Monitor
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'stock_transfer_monitor'
        and request_type = 'stock_transfer'::public.request_type
        and status = 'approved'::public.request_status)
    or (request_type = 'exhibition'::public.request_type and status not in ('rejected'::public.request_status, 'withdrawn'::public.request_status, 'cancelled'::public.request_status))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

-- 6. Ensure disbursement_entries_select policy allows Entry Approver & authenticated users to select entries
drop policy if exists disbursement_entries_select on public.disbursement_entries;
create policy disbursement_entries_select on public.disbursement_entries for select to authenticated
  using (
    ((select public.my_role()) = 'admin'::public.app_role)
    or (((select public.my_role()) = 'disbursement'::public.app_role) and (select public.my_disbursement_type()) = 'entry_approver')
    or public.can_view_request(request_id)
  );

notify pgrst, 'reload schema';
