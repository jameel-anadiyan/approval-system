-- ============================================================================
-- 0053_limit_returned_notifications_to_associated_head_and_clerk.sql
--
-- Requirement:
-- "in returned request now all head het notified , only the associated head and clerk know the return"
--
-- When a request is returned:
-- - ONLY the requester (to revise/resubmit)
-- - ONLY the regional head (if submitted through a regional head)
-- - ONLY the associated Head (r.owner_head_id, or department head if owner_head_id is null)
-- - ONLY the associated Clerk (r.routed_by, or department clerk if not routed yet)
-- All other department heads and clerks must NOT receive notification.
-- ============================================================================

create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
 returns void language plpgsql security definer set search_path to '' as $function$
declare r public.requests; ids uuid[]; label text;
begin
  select * into r from public.requests where id = p_request_id;
  if r.id is null then return; end if;
  label := coalesce(r.request_no, 'Request') || ' - ' || r.title;

  if p_status = 'submitted' then
    select array_agg(u) into ids from unnest(public._clerk_ids_for(r.department_id, r.category_id)) u
     where u is not null;
    perform public._notify(ids, r.id, 'New request to route', label);

  elsif p_status = 'pending_regional_review' then
    if r.regional_head_id is not null then
      perform public._notify(array[r.regional_head_id], r.id, 'Request waiting for your review', label);
    end if;

  elsif p_status in ('pending_head_review','pending_head_approval') then
    select array_agg(id) into ids from public.profiles
     where (id = r.owner_head_id or (department_id = r.department_id and role = 'head')) and is_active;
    perform public._notify(ids, r.id,
      case when p_status = 'pending_head_review' then 'Request waiting for your review' else 'Request waiting for your approval' end,
      label);

  elsif p_status = 'pending_admin_approval' then
    select array_agg(id) into ids from public.profiles where role = 'admin' and is_active;
    perform public._notify(ids, r.id, 'Request waiting for Admin approval', label);

  elsif p_status = 'returned' then
    -- Strictly only notify:
    -- 1. Requester
    -- 2. Regional Head (if request went through regional head)
    -- 3. Associated Head (assigned owner_head_id or department head if unassigned)
    -- 4. Associated Clerk (clerk who routed it, or department clerk if not yet routed)
    select array_agg(distinct u) into ids
    from (
      select r.requester_id as u
      union
      select r.regional_head_id as u
      union
      select r.routed_by as u
      union
      select r.owner_head_id as u
      union
      select p.id as u from public.profiles p
       where p.is_active
         and p.role = 'head'
         and p.department_id = r.department_id
         and (r.owner_head_id is null or r.owner_head_id = p.id)
      union
      select p.id as u from public.profiles p
       where p.is_active
         and p.role = 'clerk'
         and p.department_id = r.department_id
         and (r.routed_by is null or r.routed_by = p.id)
    ) sub
    where u is not null;
    perform public._notify(ids, r.id, 'Returned for correction', label);

  elsif p_status = 'rejected' then
    perform public._notify(array[r.requester_id], r.id, 'Request rejected', label);

  elsif p_status = 'approved' then
    select array_agg(id) into ids from public.profiles
      where is_active and (
        id = r.requester_id
        or id = r.regional_head_id
        or (role = 'disbursement'
            and coalesce(disbursement_type, '') <> 'stock_transfer_monitor'
            and r.request_type not in ('discount', 'non_cash', 'stock_transfer'))
        or (role = 'disbursement'
            and disbursement_type = 'stock_transfer_monitor'
            and r.request_type = 'stock_transfer')
        or (role in ('clerk','head') and (department_id = r.department_id or id = r.owner_head_id)));
    perform public._notify(ids, r.id,
      case when r.request_type = 'stock_transfer' then 'Stock transfer approved - ' else 'Approved - ' end
        || coalesce(r.approval_no, ''),
      label);

  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $function$;

revoke execute on function public.notify_next_actor(uuid, public.request_status) from public, anon, authenticated;

-- Clean up any existing 'Returned for correction' notifications sent to non-associated heads or clerks
delete from public.notifications n
 using public.requests r
 where n.request_id = r.id
   and n.title = 'Returned for correction'
   and n.user_id not in (
     select unnest(array[r.requester_id, r.regional_head_id, r.routed_by, r.owner_head_id])
   )
   and not exists (
     select 1 from public.profiles p
      where p.id = n.user_id
        and p.department_id = r.department_id
        and p.role in ('head', 'clerk')
   );
