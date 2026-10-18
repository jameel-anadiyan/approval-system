-- 0002 — Helper functions and RLS policies (see docs/PLAN.md "Who can read what")

create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.my_department()
returns uuid language sql stable security definer set search_path = '' as $$
  select department_id from public.profiles where id = auth.uid() and is_active
$$;

-- Can the current user see this request?
create or replace function public.can_view_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        r.requester_id = me.id
        or (me.role = 'admin' and r.status <> 'draft')
        or (me.role in ('clerk','head') and r.department_id = me.department_id and r.status <> 'draft')
        or (me.role = 'disbursement' and r.status in ('approved','paid'))
      )
  )
$$;

-- Is the current user the requester, and is the request still editable?
create or replace function public.can_edit_request_files(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and r.requester_id = me.id and r.status in ('draft','returned')
  )
$$;

-- Parse "{request_id}/..." from a storage object name, null when not a uuid.
create or replace function public.storage_request_id(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid end
$$;

revoke execute on function public.my_role() from public, anon;
revoke execute on function public.my_department() from public, anon;
revoke execute on function public.can_view_request(uuid) from public, anon;
revoke execute on function public.can_edit_request_files(uuid) from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_department() to authenticated;
grant execute on function public.can_view_request(uuid) to authenticated;
grant execute on function public.can_edit_request_files(uuid) to authenticated;

-- departments: every logged-in user reads; changes via RPC only -------------
create policy departments_select on public.departments for select to authenticated
  using ((select public.my_role()) is not null);

-- app_settings: every logged-in user reads ---------------------------------
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select public.my_role()) is not null);

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.my_role()) = 'admin'
    or ((select public.my_role()) in ('clerk','head') and department_id = (select public.my_department()))
  );

-- approver_credentials: admin all, head own row -----------------------------
create policy approver_credentials_select on public.approver_credentials for select to authenticated
  using (
    (select public.my_role()) = 'admin'
    or ((select public.my_role()) = 'head' and user_id = (select auth.uid()))
  );

-- requests ------------------------------------------------------------------
create policy requests_select on public.requests for select to authenticated
  using (
    (select public.my_role()) is not null and (
      requester_id = (select auth.uid())
      or ((select public.my_role()) = 'admin' and status <> 'draft')
      or ((select public.my_role()) in ('clerk','head')
          and department_id = (select public.my_department()) and status <> 'draft')
      or ((select public.my_role()) = 'disbursement' and status in ('approved','paid'))
    )
  );

-- request_files: anyone who sees the request, except Disbursement -----------
create policy request_files_select on public.request_files for select to authenticated
  using ((select public.my_role()) <> 'disbursement' and public.can_view_request(request_id));

-- signed_files --------------------------------------------------------------
create policy signed_files_select on public.signed_files for select to authenticated
  using (public.can_view_request(request_id));

-- request_actions: requester only sees rows marked visible ------------------
create policy request_actions_select on public.request_actions for select to authenticated
  using (
    public.can_view_request(request_id)
    and (
      visible_to_requester
      or not exists (select 1 from public.requests r
                     where r.id = request_id and r.requester_id = (select auth.uid()))
    )
  );

-- notifications: own only; may set read_at ---------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- audit_log: admin only -----------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.my_role()) = 'admin');

-- counters: no policies → nobody but the server.
