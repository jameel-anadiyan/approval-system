-- 0085: Allow Department Heads to track any request (including other heads' requests)
-- and add security-definer track_request RPC

-- 1. Update can_view_request to allow Head role to view/track any non-draft request
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
        -- Department heads can track and view any non-draft request across the organization
        or (me.role = 'head' and r.status <> 'draft')
        or (me.role = 'clerk' and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.status <> 'draft')
        or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.requester_id = me.id) and (r.status <> 'draft' or r.requester_id = me.id))
        or (me.role = 'disbursement' and coalesce(me.disbursement_type, '') <> 'stock_transfer_monitor'
            and r.status in ('approved','paid','cancelled')
            and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report'))
        or (me.role = 'disbursement' and me.disbursement_type = 'stock_transfer_monitor'
            and r.request_type = 'stock_transfer' and r.status = 'approved')
        or (r.request_type = 'exhibition' and r.status not in ('rejected', 'withdrawn', 'cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;

revoke execute on function public.can_view_request(uuid) from public, anon;
grant execute on function public.can_view_request(uuid) to authenticated;

-- 2. Update requests_select policy so Head role can select any non-draft request
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    -- Department heads can view and track any non-draft request across all departments
    or (((select public.my_role()) = 'head'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'clerk'::public.app_role)
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status or requester_id = (select auth.uid())))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_only'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report'))
        and (assigned_entry_user_id is null or assigned_entry_user_id = (select auth.uid())))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_approver'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status]))
        and (request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report')))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and coalesce((select public.my_disbursement_type()), '') in ('payment_only', '')
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report')))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'stock_transfer_monitor'
        and request_type = 'stock_transfer'::public.request_type
        and status = 'approved'::public.request_status)
    or (request_type = 'exhibition'::public.request_type and status not in ('rejected'::public.request_status, 'withdrawn'::public.request_status, 'cancelled'::public.request_status))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

-- 3. Security-definer RPC: track_request
-- Allows Department Heads and Admins to fetch full tracking data for any request by Request ID, Approval ID, or UUID
create or replace function public.track_request(p_query text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_user_role public.app_role;
  v_req record;
  v_is_uuid boolean;
  v_clean text;
begin
  select role into v_user_role from public.profiles where id = auth.uid() and is_active;
  if v_user_role is null or v_user_role not in ('head', 'admin', 'clerk', 'regional_head') then
    raise exception 'Unauthorized to track requests';
  end if;

  v_clean := trim(p_query);
  if v_clean = '' then
    return null;
  end if;

  v_is_uuid := v_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if v_is_uuid then
    select r.*,
           row_to_json(d) as department,
           jsonb_build_object('id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'photo_path', p.photo_path) as requester
    into v_req
    from public.requests r
    left join public.departments d on d.id = r.department_id
    left join public.profiles p on p.id = r.requester_id
    where (r.id = v_clean::uuid or r.request_no ilike v_clean or r.approval_no ilike v_clean)
      and r.status <> 'draft'
    order by (case when r.request_no ilike v_clean or r.approval_no ilike v_clean then 0 else 1 end), r.created_at desc
    limit 1;
  else
    select r.*,
           row_to_json(d) as department,
           jsonb_build_object('id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'photo_path', p.photo_path) as requester
    into v_req
    from public.requests r
    left join public.departments d on d.id = r.department_id
    left join public.profiles p on p.id = r.requester_id
    where (r.request_no ilike '%' || v_clean || '%' or r.approval_no ilike '%' || v_clean || '%')
      and r.status <> 'draft'
    order by (case when r.request_no ilike v_clean or r.approval_no ilike v_clean then 0 else 1 end), r.created_at desc
    limit 1;
  end if;

  if v_req.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'request', to_jsonb(v_req),
    'actions', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at asc), '[]'::jsonb) from public.request_actions a where a.request_id = v_req.id),
    'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by e.entry_no asc), '[]'::jsonb) from public.disbursement_entries e where e.request_id = v_req.id),
    'files', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.request_files f where f.request_id = v_req.id),
    'signed_files', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.signed_files s where s.request_id = v_req.id),
    'consultations', (
      select coalesce(jsonb_agg(
        to_jsonb(c) || jsonb_build_object('head', jsonb_build_object('id', hp.id, 'full_name', hp.full_name, 'designation', hp.designation, 'photo_path', hp.photo_path))
      ), '[]'::jsonb)
      from public.head_consultations c
      left join public.profiles hp on hp.id = c.head_id
      where c.request_id = v_req.id
    )
  );
end;
$$;

revoke execute on function public.track_request(text) from public, anon;
grant execute on function public.track_request(text) to authenticated;

