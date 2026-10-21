-- 0031_return_for_correction_fixes.sql
-- Fixes return-for-correction permissions across all roles & cross-department heads,
-- ensures Regional Heads can view their returned requests and employee returned requests,
-- and notifies Regional Head when an employee's request is returned.

-- 1. Update _is_regional_actor to support owner_head across departments
create or replace function public._is_regional_actor(r public.requests, me public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select (me.role = 'regional_head' and me.id = r.regional_head_id)
      or (me.role = 'head' and (me.department_id = r.department_id or me.id = r.owner_head_id) and r.requester_id <> me.id
          and not exists (select 1 from public.profiles p where p.id = r.regional_head_id and p.is_active))
$$;
revoke execute on function public._is_regional_actor(public.requests, public.profiles) from public, anon, authenticated;

-- 2. Update return_request to permit owner_head and admin in approving status
create or replace function public.return_request(p_request_id uuid, p_remarks text)
 returns void language plpgsql security definer set search_path to '' as $function$
declare me public.profiles; r public.requests; allowed boolean;
begin
  me := public._me();
  if p_remarks is null or btrim(p_remarks) = '' then raise exception 'A remark is required to return a request'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then raise exception 'Not found'; end if;
  allowed := case
    when r.status = 'pending_regional_review' then public._is_regional_actor(r, me)
    when r.status = 'submitted' then me.role = 'clerk' and r.department_id = me.department_id
      and me.id = any(public._clerk_ids_for(r.department_id, r.category_id))
    when r.status in ('pending_head_approval','pending_head_review')
      then me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.requester_id <> me.id
    when r.status in ('pending_admin_approval', 'approving') then me.role = 'admin'
    else false end;
  if not allowed then raise exception 'You cannot return this request now'; end if;
  update public.requests set status = 'returned', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'returned', r.status, 'returned', p_remarks, true);
  perform public.notify_next_actor(r.id, 'returned');
end $function$;
revoke execute on function public.return_request(uuid, text) from public, anon;
grant execute on function public.return_request(uuid, text) to authenticated;

-- 3. Update notify_next_actor: notify both requester and regional head on return
create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
 returns void language plpgsql security definer set search_path to '' as $function$
declare r public.requests; ids uuid[]; label text;
begin
  select * into r from public.requests where id = p_request_id;
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
    select array_agg(distinct u) into ids
    from unnest(array[r.requester_id, r.regional_head_id]) u
    where u is not null;
    perform public._notify(ids, r.id, 'Returned for correction', label);
  elsif p_status = 'rejected' then
    perform public._notify(array[r.requester_id], r.id, 'Request rejected', label);
  elsif p_status = 'approved' then
    select array_agg(id) into ids from public.profiles
      where is_active and (
        id = r.requester_id
        or id = r.regional_head_id
        or (role = 'disbursement' and r.request_type not in ('discount', 'non_cash'))
        or (role in ('clerk','head') and (department_id = r.department_id or id = r.owner_head_id)));
    perform public._notify(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $function$;

-- 4. Update can_view_request
create or replace function public.can_view_request(p_request_id uuid)
 returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        r.requester_id = me.id
        or (me.role = 'admin' and r.status <> 'draft')
        or (me.role in ('clerk','head') and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.status <> 'draft')
        or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.requester_id = me.id) and r.status <> 'draft')
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;

-- 5. Update RLS policy requests_select
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and ((department_id = (select public.my_department())) or (owner_head_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type)))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
