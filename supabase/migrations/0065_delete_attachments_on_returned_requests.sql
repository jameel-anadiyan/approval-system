-- ==============================================================================
-- 0065_delete_attachments_on_returned_requests.sql
-- 
-- 1. Update can_edit_request_files:
--    Allow requester, admin, clerk, and department head to edit/delete attachments
--    when a request is returned or draft.
--
-- 2. Update remove_file:
--    Allow deleting ANY attachment on draft or returned requests (no block on
--    files added by previous approvers or reviewers).
--
-- 3. RLS policy on public.request_files:
--    Allow authenticated users who own or manage the draft/returned request
--    to delete records from request_files.
-- ==============================================================================

-- 1. can_edit_request_files
create or replace function public.can_edit_request_files(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      -- 1. Requester while draft or returned (any user type who created it)
      (r.requester_id = me.id and r.status in ('draft', 'returned'))
      -- 2. Admin anytime before final closure
      or (
        me.role = 'admin'
        and r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled')
      )
      -- 3. Department Head / Regional Head for own or department requests
      or (
        me.role in ('head', 'regional_head') and (
          r.department_id = me.department_id 
          or r.owner_head_id = me.id
          or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
        )
        and r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled')
      )
      -- 4. Clerk for department requests when draft or returned
      or (
        me.role = 'clerk' and r.department_id = me.department_id
        and r.status in ('draft', 'returned')
      )
    )
  )
$$;

revoke execute on function public.can_edit_request_files(uuid) from public, anon;
grant execute on function public.can_edit_request_files(uuid) to authenticated;

-- 2. remove_file RPC
create or replace function public.remove_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  f public.request_files;
  r public.requests;
  can_remove boolean := false;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'File not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  -- Case 1: When request is draft or returned
  -- Requester, admin, owning head, or clerk can remove ANY existing attachment
  if r.status in ('draft', 'returned') then
    if (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role in ('head', 'regional_head') and (r.department_id = me.department_id or r.owner_head_id = me.id))
      or (me.role = 'clerk' and r.department_id = me.department_id)
    ) then
      can_remove := true;
    end if;

  -- Case 2: When request is before final approval
  -- Head or admin can remove files they attached (or admin can remove any)
  elsif r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled') then
    if f.added_by = me.id or me.role = 'admin' then
      can_remove := true;
    end if;
  end if;

  if not can_remove then
    raise exception 'You cannot remove files from this request at this stage';
  end if;

  delete from public.request_files where id = f.id;

  if r.status <> 'draft' then
    perform public._log_action(
      r.id, me, 'file_removed', r.status, r.status,
      'Removed attachment: ' || f.original_name,
      true
    );
  end if;

  return f.storage_path;
end $$;

revoke execute on function public.remove_file(uuid) from public, anon;
grant execute on function public.remove_file(uuid) to authenticated;

-- 3. RLS policy on public.request_files for delete
drop policy if exists request_files_delete on public.request_files;
create policy request_files_delete on public.request_files for delete to authenticated
  using (
    exists (
      select 1 from public.requests r
      join public.profiles me on me.id = auth.uid() and me.is_active
      where r.id = request_files.request_id and (
        (
          r.status in ('draft', 'returned') and (
            r.requester_id = me.id
            or me.role = 'admin'
            or (me.role in ('head', 'regional_head') and (r.department_id = me.department_id or r.owner_head_id = me.id))
            or (me.role = 'clerk' and r.department_id = me.department_id)
          )
        )
        or (
          (request_files.added_by = me.id or me.role = 'admin')
          and r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled')
        )
      )
    )
  );

grant select, delete on public.request_files to authenticated;

notify pgrst, 'reload schema';
