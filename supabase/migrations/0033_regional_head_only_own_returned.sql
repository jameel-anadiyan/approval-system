-- 0033_regional_head_only_own_returned.sql
-- Restrict Regional Head visibility strictly to requests belonging to him
-- (his own requests or employee requests where he is the assigned Regional Head).

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
        or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.requester_id = me.id) and (r.status <> 'draft' or r.requester_id = me.id))
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;
revoke execute on function public.can_view_request(uuid) from public, anon;
grant execute on function public.can_view_request(uuid) to authenticated;

-- Update requests_select RLS policy
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and (owner_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status or requester_id = (select auth.uid())))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type)))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

notify pgrst, 'reload schema';
