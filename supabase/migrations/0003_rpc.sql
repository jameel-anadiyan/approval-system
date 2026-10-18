-- 0003 — Workflow RPCs (see docs/PLAN.md "Postgres functions (RPC)" and "Status rules")
-- Every function: security definer, search_path = '', row lock with FOR UPDATE,
-- one request_actions row and the notifications.

-- ───────────────────────── internal helpers (not callable by clients) ─────

create or replace function public._me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if me.id is null then raise exception 'Not signed in or account inactive' using errcode = '42501'; end if;
  return me;
end $$;

create or replace function public.next_number(p_prefix text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_name text; v bigint;
begin
  v_name := p_prefix || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  insert into public.counters as c (name, last_value) values (v_name, 1)
  on conflict (name) do update set last_value = c.last_value + 1
  returning last_value into v;
  return v_name || '-' || lpad(v::text, 6, '0');
end $$;

create or replace function public._log_action(
  p_request_id uuid, p_actor public.profiles, p_action text,
  p_from public.request_status, p_to public.request_status,
  p_remarks text, p_visible boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.request_actions
    (request_id, actor_id, actor_name, actor_role, action, from_status, to_status, remarks, visible_to_requester)
  values (p_request_id, p_actor.id, p_actor.full_name, p_actor.role, p_action, p_from, p_to,
          nullif(btrim(p_remarks), ''), p_visible)
$$;

create or replace function public._notify(p_user_ids uuid[], p_request_id uuid, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, request_id, title, body)
  select distinct u, p_request_id, p_title, p_body from unnest(p_user_ids) u where u is not null
$$;

-- Notify whoever the new status is waiting for (and the requester when it ends).
create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.requests; ids uuid[]; label text;
begin
  select * into r from public.requests where id = p_request_id;
  label := coalesce(r.request_no, 'Request') || ' - ' || r.title;
  if p_status = 'submitted' then
    select array_agg(id) into ids from public.profiles
      where role = 'clerk' and is_active and department_id = r.department_id and id <> r.requester_id;
    perform public._notify(ids, r.id, 'New request to route', label);
  elsif p_status in ('pending_head_approval','pending_head_review') then
    select array_agg(id) into ids from public.profiles
      where role = 'head' and is_active and department_id = r.department_id;
    perform public._notify(ids, r.id,
      case when p_status = 'pending_head_approval' then 'Request waiting for your approval'
           else 'Request waiting for your review' end, label);
  elsif p_status = 'pending_admin_approval' then
    select array_agg(id) into ids from public.profiles where role = 'admin' and is_active;
    perform public._notify(ids, r.id, 'Request waiting for Admin approval', label);
  elsif p_status = 'returned' then
    perform public._notify(array[r.requester_id], r.id, 'Returned for correction', label);
  elsif p_status = 'rejected' then
    perform public._notify(array[r.requester_id], r.id, 'Request rejected', label);
  elsif p_status = 'approved' then
    select array_agg(id) into ids from public.profiles
      where is_active and (
        id = r.requester_id or role = 'disbursement'
        or (role in ('clerk','head') and department_id = r.department_id));
    perform public._notify(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $$;

revoke execute on function public._me() from public, anon, authenticated;
revoke execute on function public.next_number(text) from public, anon, authenticated;
revoke execute on function public._log_action(uuid, public.profiles, text, public.request_status, public.request_status, text, boolean) from public, anon, authenticated;
revoke execute on function public._notify(uuid[], uuid, text, text) from public, anon, authenticated;
revoke execute on function public.notify_next_actor(uuid, public.request_status) from public, anon, authenticated;

-- ───────────────────────── requester: drafts and files ────────────────────

create or replace function public.create_draft(p_title text, p_amount numeric, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_id uuid;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head') then raise exception 'Your role cannot raise requests'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  insert into public.requests (requester_id, requester_name, requester_role, department_id, title, notes, amount)
  values (me.id, me.full_name, me.role, me.department_id, btrim(p_title), nullif(btrim(p_notes), ''), round(p_amount, 2))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_draft(p_request_id uuid, p_title text, p_amount numeric, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  update public.requests set title = btrim(p_title), amount = round(p_amount, 2),
    notes = nullif(btrim(p_notes), ''), updated_at = now() where id = r.id;
end $$;

create or replace function public.register_file(
  p_request_id uuid, p_kind public.file_kind, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint, p_page_count int default null, p_duration_sec numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; v_id uuid; n int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if public.storage_request_id(p_storage_path) is distinct from r.id then raise exception 'Bad file path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'File was not uploaded';
  end if;
  select count(*) into n from public.request_files where request_id = r.id and kind = p_kind;
  if p_kind = 'document' and n >= 10 then raise exception 'At most 10 documents per request'; end if;
  if p_kind = 'voice_note' and n >= 5 then raise exception 'At most 5 voice notes per request'; end if;
  if p_kind = 'document' and p_mime_type not in ('application/pdf','image/jpeg','image/png') then
    raise exception 'Documents must be PDF, JPG or PNG';
  end if;
  if p_kind = 'voice_note' and p_mime_type not like 'audio/%' then raise exception 'Voice notes must be audio'; end if;
  insert into public.request_files (request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, duration_sec, sort_order)
  values (r.id, p_kind, p_storage_path, left(p_original_name, 255), p_mime_type, p_size_bytes,
    p_page_count, p_duration_sec, n)
  returning id into v_id;
  update public.requests set updated_at = now() where id = r.id;
  return v_id;
end $$;

-- Returns the storage path; the browser then deletes the object (allowed by storage policy).
create or replace function public.remove_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me public.profiles; f public.request_files; r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  delete from public.request_files where id = f.id;
  return f.storage_path;
end $$;

create or replace function public.delete_draft(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status <> 'draft' or r.request_no is not null then raise exception 'Only an unsent draft can be deleted'; end if;
  if exists (select 1 from public.request_files where request_id = r.id) then
    raise exception 'Remove the attached files first';
  end if;
  delete from public.requests where id = r.id;
end $$;

-- ───────────────────────── requester: submit / withdraw ───────────────────

create or replace function public.submit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; v_no text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request has already been submitted'; end if;
  if r.amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if not exists (select 1 from public.request_files where request_id = r.id and kind = 'document') then
    raise exception 'Attach at least one document';
  end if;
  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));
  update public.requests set status = 'submitted', request_no = v_no,
    route = null, routed_by = null, routed_at = null, reviewed_by = null, reviewed_by_name = null, reviewed_at = null,
    submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
    r.status, 'submitted', null, true);
  perform public.notify_next_actor(r.id, 'submitted');
end $$;

create or replace function public.withdraw_request(p_request_id uuid, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('submitted','returned') then
    raise exception 'A request can only be withdrawn before routing or while returned';
  end if;
  update public.requests set status = 'withdrawn', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'withdrawn', r.status, 'withdrawn', p_remarks, true);
end $$;

-- ───────────────────────── clerk: route ───────────────────────────────────

create or replace function public.route_request(
  p_request_id uuid, p_route public.approval_route, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests;
  threshold numeric; has_head boolean; next_status public.request_status;
begin
  me := public._me();
  if me.role is distinct from 'clerk' then raise exception 'Only a clerk can route'; end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Not waiting for routing'; end if;

  select (value #>> '{}')::numeric into threshold
    from public.app_settings where key = 'high_value_threshold';
  threshold := coalesce(threshold, 10000);
  select exists (select 1 from public.profiles
    where department_id = r.department_id and role = 'head' and is_active) into has_head;

  if p_route = 'B' then
    if r.amount > threshold then raise exception 'Above threshold: Admin approval required'; end if;
    if r.requester_role = 'head' then raise exception 'A head cannot approve own request'; end if;
    if not has_head then raise exception 'Department has no active head'; end if;
    next_status := 'pending_head_approval';
  elsif r.requester_role = 'head' or not has_head then
    next_status := 'pending_admin_approval';
  else
    next_status := 'pending_head_review';
  end if;

  update public.requests set status = next_status, route = p_route,
    routed_by = me.id, routed_at = now(), updated_at = now() where id = r.id;
  perform public._log_action(r.id, me,
    case when r.requester_id = me.id then 'routed_own_' else 'routed_' end || p_route::text,
    r.status, next_status, p_remarks, false);
  perform public.notify_next_actor(r.id, next_status);
end $$;

-- ───────────────────────── head: forward ──────────────────────────────────

create or replace function public.forward_request(p_request_id uuid, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  if me.role is distinct from 'head' then raise exception 'Only a head can forward'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'pending_head_review' then raise exception 'Not waiting for head review'; end if;
  if r.requester_id = me.id then raise exception 'You cannot review your own request'; end if;
  update public.requests set status = 'pending_admin_approval', reviewed_by = me.id,
    reviewed_by_name = me.full_name, reviewed_at = now(), updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, false);
  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $$;

-- ───────────────────────── clerk / head / admin: return ───────────────────

create or replace function public.return_request(p_request_id uuid, p_remarks text)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; allowed boolean;
begin
  me := public._me();
  if p_remarks is null or btrim(p_remarks) = '' then raise exception 'A remark is required to return a request'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then raise exception 'Not found'; end if;
  allowed := case
    when r.status = 'submitted' then me.role = 'clerk' and r.department_id = me.department_id
    when r.status in ('pending_head_approval','pending_head_review')
      then me.role = 'head' and r.department_id = me.department_id and r.requester_id <> me.id
    when r.status = 'pending_admin_approval' then me.role = 'admin'
    else false end;
  if not allowed then raise exception 'You cannot return this request now'; end if;
  update public.requests set status = 'returned', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'returned', r.status, 'returned', p_remarks, true);
  perform public.notify_next_actor(r.id, 'returned');
end $$;

-- ───────────────────────── head / admin: reject ───────────────────────────

create or replace function public.reject_request(p_request_id uuid, p_remarks text)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; allowed boolean;
begin
  me := public._me();
  if p_remarks is null or btrim(p_remarks) = '' then raise exception 'A reason is required to reject a request'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then raise exception 'Not found'; end if;
  allowed := (r.status = 'pending_head_approval' and me.role = 'head'
                and r.department_id = me.department_id and r.requester_id <> me.id)
          or (r.status = 'pending_admin_approval' and me.role = 'admin');
  if not allowed then raise exception 'You cannot reject this request now'; end if;
  update public.requests set status = 'rejected', decided_by = me.id, decided_at = now(),
    approver_role = me.role, approver_name = me.full_name, updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'rejected', r.status, 'rejected', p_remarks, true);
  perform public.notify_next_actor(r.id, 'rejected');
end $$;

-- ───────────────────────── disbursement: mark paid ────────────────────────

create or replace function public.mark_paid(
  p_request_id uuid, p_payment_date date default null, p_payment_mode text default null,
  p_payment_ref text default null, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  if me.role is distinct from 'disbursement' then raise exception 'Only Disbursement can mark as paid'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;
  if r.status = 'paid' then raise exception 'Already marked as paid'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be paid'; end if;
  update public.requests set status = 'paid', paid_by = me.id, paid_at = now(),
    payment_date = coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date),
    payment_mode = nullif(btrim(p_payment_mode), ''), payment_ref = nullif(btrim(p_payment_ref), ''),
    payment_remarks = nullif(btrim(p_remarks), ''), updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, 'paid', 'approved', 'paid', p_remarks, true);
  perform public.notify_next_actor(r.id, 'paid');
end $$;

-- ───────────────────────── admin: settings and departments ────────────────

create or replace function public.update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; old jsonb;
begin
  me := public._me();
  if me.role is distinct from 'admin' then raise exception 'Only Admin can change settings'; end if;
  if p_key = 'high_value_threshold' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <= 0 then
      raise exception 'Threshold must be a positive number';
    end if;
    p_value := to_jsonb(round((p_value #>> '{}')::numeric, 2));
  elsif p_key in ('approval_prefix','request_prefix') then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[A-Z]{2,6}$' then
      raise exception 'Prefix must be 2-6 capital letters';
    end if;
  else
    raise exception 'Unknown setting';
  end if;
  select value into old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, me.id, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name, 'setting_changed', 'setting', p_key, jsonb_build_object('from', old, 'to', p_value));
end $$;

create or replace function public.save_department(p_id uuid, p_name text, p_code text, p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_id uuid;
begin
  me := public._me();
  if me.role is distinct from 'admin' then raise exception 'Only Admin can manage departments'; end if;
  if p_id is null then
    insert into public.departments (name, code, is_active) values (btrim(p_name), upper(btrim(p_code)), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.departments set name = btrim(p_name), code = upper(btrim(p_code)),
      is_active = coalesce(p_is_active, true), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Not found'; end if;
  end if;
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name, case when p_id is null then 'department_created' else 'department_updated' end,
    'department', v_id::text, jsonb_build_object('name', p_name, 'code', upper(p_code), 'is_active', p_is_active));
  return v_id;
end $$;

-- ───────────────────────── everyone: notifications, password flag ─────────

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := public._me();
  update public.notifications set read_at = now()
  where user_id = me.id and read_at is null and (p_ids is null or id = any(p_ids));
end $$;

create or replace function public.password_changed()
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := public._me();
  update public.profiles set must_change_password = false, updated_at = now() where id = me.id;
end $$;

-- Disbursement / any viewer: verify page by random token.
create or replace function public.verify_approval(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; r public.requests; d public.departments;
begin
  me := public._me();
  select * into r from public.requests where verify_token = p_token and status in ('approved','paid');
  if r.id is null then return null; end if;
  select * into d from public.departments where id = r.department_id;
  return jsonb_build_object(
    'request_id', r.id, 'approval_no', r.approval_no, 'request_no', r.request_no, 'title', r.title,
    'amount', r.amount, 'status', r.status, 'approver_name', r.approver_name, 'approver_role', r.approver_role,
    'decided_at', r.decided_at, 'paid_at', r.paid_at, 'department', d.name, 'requester_name', r.requester_name,
    'can_open', public.can_view_request(r.id),
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_name', s.file_name, 'sha256', s.sha256,
                'page_count', s.page_count, 'is_packet', s.is_packet) order by s.is_packet desc, s.file_name)
              from public.signed_files s where s.request_id = r.id), '[]'::jsonb));
end $$;

-- ───────────────────────── server only: approval (service_role) ───────────

create or replace function public.begin_approval(p_request_id uuid, p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests; c public.approver_credentials; d public.departments;
  v_no text; v_prev public.request_status; v_now timestamptz := now();
begin
  select * into me from public.profiles where id = p_approver_id and is_active;
  if me.id is null then raise exception 'Approver not found'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  if r.status = 'approving' then
    if r.approving_started_at > v_now - interval '5 minutes' then
      raise exception 'Approval already in progress';
    end if;
    v_prev := r.status_before_approving;   -- stuck run: allow retry
  else
    v_prev := r.status;
  end if;

  if me.role = 'head' then
    if v_prev <> 'pending_head_approval' or r.department_id <> me.department_id then
      raise exception 'This request is not waiting for your approval';
    end if;
  elsif me.role = 'admin' then
    if v_prev <> 'pending_admin_approval' then raise exception 'This request is not waiting for your approval'; end if;
  else
    raise exception 'Only a Head or Admin can approve';
  end if;
  if r.requester_id = me.id then raise exception 'You cannot approve your own request'; end if;

  select * into c from public.approver_credentials where user_id = me.id;
  if c.seal_path is null or c.signature_path is null then
    raise exception 'Upload your seal and signature before approving';
  end if;

  v_no := coalesce(r.approval_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'approval_prefix'), 'APR')));

  update public.requests set status = 'approving', approval_no = v_no, approving_by = me.id,
    approving_started_at = v_now, status_before_approving = v_prev, decided_at = v_now,
    last_error = null, updated_at = v_now
  where id = r.id;

  select * into d from public.departments where id = r.department_id;
  return jsonb_build_object(
    'request', jsonb_build_object('id', r.id, 'request_no', r.request_no, 'title', r.title, 'notes', r.notes,
       'amount', r.amount, 'route', r.route, 'requester_name', r.requester_name, 'department', d.name,
       'department_code', d.code, 'submitted_at', r.submitted_at, 'verify_token', r.verify_token,
       'reviewed_by_name', r.reviewed_by_name, 'reviewed_at', r.reviewed_at),
    'approval_no', v_no, 'decided_at', v_now,
    'approver', jsonb_build_object('id', me.id, 'full_name', me.full_name, 'designation', me.designation,
       'role', me.role, 'department', (select name from public.departments where id = me.department_id)),
    'seal_path', c.seal_path, 'signature_path', c.signature_path,
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'storage_path', f.storage_path,
       'original_name', f.original_name, 'mime_type', f.mime_type) order by f.sort_order, f.created_at)
       from public.request_files f where f.request_id = r.id and f.kind = 'document'), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('actor_name', a.actor_name, 'actor_role', a.actor_role,
       'action', a.action, 'remarks', a.remarks, 'created_at', a.created_at) order by a.created_at)
       from public.request_actions a where a.request_id = r.id), '[]'::jsonb));
end $$;

create or replace function public.finalize_approval(p_request_id uuid, p_approver_id uuid, p_files jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; f jsonb;
begin
  select * into me from public.profiles where id = p_approver_id;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.status <> 'approving' or r.approving_by <> p_approver_id then
    raise exception 'Approval is not in progress for this approver';
  end if;
  if jsonb_array_length(p_files) = 0 then raise exception 'No signed files'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    insert into public.signed_files (request_id, source_file_id, is_packet, file_name, storage_path, sha256, page_count)
    values (r.id, nullif(f->>'source_file_id', '')::uuid, coalesce((f->>'is_packet')::boolean, false),
      f->>'file_name', f->>'storage_path', f->>'sha256', (f->>'page_count')::int);
  end loop;
  update public.requests set status = 'approved', decided_by = me.id, approver_role = me.role,
    approver_name = me.full_name, approving_by = null, approving_started_at = null,
    status_before_approving = null, updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, 'approved', r.status_before_approving, 'approved',
    'Approval No ' || r.approval_no, true);
  perform public.notify_next_actor(r.id, 'approved');
end $$;

create or replace function public.abort_approval(p_request_id uuid, p_approver_id uuid, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.status <> 'approving' or r.approving_by <> p_approver_id then return; end if;
  -- the approval number stays reserved on the request for the retry
  update public.requests set status = r.status_before_approving, approving_by = null,
    approving_started_at = null, status_before_approving = null, decided_at = null,
    last_error = left(p_error, 500), updated_at = now()
  where id = r.id;
end $$;

-- ───────────────────────── grants ─────────────────────────────────────────

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_draft(text, numeric, text)', 'update_draft(uuid, text, numeric, text)',
    'register_file(uuid, public.file_kind, text, text, text, bigint, int, numeric)', 'remove_file(uuid)',
    'delete_draft(uuid)', 'submit_request(uuid)', 'withdraw_request(uuid, text)',
    'route_request(uuid, public.approval_route, text)', 'forward_request(uuid, text)',
    'return_request(uuid, text)', 'reject_request(uuid, text)',
    'mark_paid(uuid, date, text, text, text)', 'update_setting(text, jsonb)',
    'save_department(uuid, text, text, boolean)', 'mark_notifications_read(bigint[])',
    'password_changed()', 'verify_approval(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'begin_approval(uuid, uuid)', 'finalize_approval(uuid, uuid, jsonb)', 'abort_approval(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
