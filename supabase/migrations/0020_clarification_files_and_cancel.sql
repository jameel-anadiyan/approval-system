-- 0020_clarification_files_and_cancel.sql
-- 1. Head can attach new documents when answering a Disbursement clarification.
--    Files live in request_files (kind 'document', added_by = head, clarification_id set) and
--    are the ONLY originals Disbursement can see (everything else they get is the stamped packet).
-- 2. The request's owner Head can cancel an approved request at any time before it is fully paid.
--    Requires 0019 (the 'cancelled' enum value) to be committed first.

-- Columns ------------------------------------------------------------------
alter table public.requests
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancelled_by_name text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000);

alter table public.request_files
  add column if not exists clarification_id uuid references public.disbursement_clarifications(id) on delete set null;
create index if not exists request_files_clarification_idx on public.request_files(clarification_id);

-- Visibility: Disbursement keeps seeing requests it was working on after they are cancelled ----
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
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$$;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (
    (select public.my_role()) is not null and (
      requester_id = (select auth.uid())
      or ((select public.my_role()) = 'admin' and status <> 'draft')
      or ((select public.my_role()) in ('clerk','head')
          and department_id = (select public.my_department()) and status <> 'draft')
      or ((select public.my_role()) = 'disbursement' and status in ('approved','paid','cancelled'))
      or exists (select 1 from public.head_consultations hc
                 where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
    )
  );

-- request_files: Disbursement may now read the files a Head attached to a clarification ---------
drop policy if exists request_files_select on public.request_files;
create policy request_files_select on public.request_files for select to authenticated
  using (
    public.can_view_request(request_id) and (
      ((select public.my_role()) <> 'disbursement' and (
        kind <> 'voice_note'
        or (select public.my_role()) in ('admin','head','clerk')
        or added_by is null
        or added_by = (select auth.uid())
      ))
      or ((select public.my_role()) = 'disbursement' and clarification_id is not null)
    )
  );

drop policy if exists "request-files read" on storage.objects;
create policy "request-files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (
      ((select public.my_role()) <> 'disbursement' and public.can_view_request(public.storage_request_id(name)))
      or ((select public.my_role()) = 'disbursement' and exists (
        select 1 from public.requests r
        where r.id = public.storage_request_id(name) and r.status in ('approved','paid','cancelled')
      ))
    )
  );

drop policy if exists "signed-documents read" on storage.objects;
create policy "signed-documents read" on storage.objects for select to authenticated
  using (
    bucket_id = 'signed-documents'
    and exists (select 1 from public.requests r
                where r.id = public.storage_request_id(name) and r.status in ('approved','paid','cancelled'))
    and public.can_view_request(public.storage_request_id(name))
  );

-- Who may answer a clarification (and so upload files for it) ------------------------------------
create or replace function public.can_answer_clarification(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and r.status = 'approved'
      and exists (select 1 from public.disbursement_clarifications c
                  where c.request_id = r.id and c.status = 'pending_head'
                    and (me.role = 'admin'
                         or (me.role = 'head' and (c.head_id = me.id or r.owner_head_id = me.id
                                                   or r.department_id = me.department_id))))
  )
$$;
revoke execute on function public.can_answer_clarification(uuid) from public, anon;
grant execute on function public.can_answer_clarification(uuid) to authenticated;

drop policy if exists "request-files clarification insert" on storage.objects;
create policy "request-files clarification insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and split_part(name, '/', 2) like 'clarif-%'
    and public.can_answer_clarification(public.storage_request_id(name))
  );

-- Owner head may also leave a voice note while cancelling (even on a request they raised) ---------
create or replace function public.can_add_action_voice(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      (me.role = 'clerk' and r.department_id = me.department_id and r.status in ('submitted', 'approving'))
      or (me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id)
          and r.status in ('pending_head_approval','pending_head_review','approving', 'approved') and r.requester_id <> me.id)
      or (me.role = 'head' and r.status = 'approved' and (r.department_id = me.department_id or r.owner_head_id = me.id))
      or (me.role = 'admin' and r.status in ('pending_admin_approval','approving', 'approved'))
      or (me.role = 'head' and exists (
            select 1 from public.head_consultations hc
            where hc.request_id = r.id and hc.head_id = me.id
          ))
      or (me.role = 'disbursement' and r.status in ('approved', 'paid'))
    )
  )
$$;

-- Answer a clarification, optionally attaching new documents ------------------------------------
drop function if exists public.respond_disbursement_clarification(uuid, text, text, numeric);
create or replace function public.respond_disbursement_clarification(
  p_clarification_id uuid,
  p_response_note text default null,
  p_voice_path text default null,
  p_voice_duration numeric default null,
  p_files jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.disbursement_clarifications;
  r public.requests;
  f jsonb;
  v_path text; v_name text; v_mime text; v_size bigint;
  v_count int := 0;
  v_base int;
  v_remark text;
begin
  me := public._me();
  select * into c from public.disbursement_clarifications where id = p_clarification_id for update;
  if c.id is null then raise exception 'Clarification record not found'; end if;
  if c.status <> 'pending_head' then raise exception 'This clarification has already been answered'; end if;

  select * into r from public.requests where id = c.request_id for update;
  if r.status <> 'approved' then raise exception 'This request is no longer awaiting payment'; end if;
  if not public.can_answer_clarification(r.id) then
    raise exception 'Only the request owner Head or an Admin can answer this clarification';
  end if;

  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then raise exception 'Bad files list'; end if;
  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 10 then raise exception 'At most 10 files per clarification'; end if;
  if btrim(coalesce(p_response_note, '')) = '' and p_voice_path is null
     and jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then
    raise exception 'Add a note, a voice message or a file';
  end if;

  select coalesce(max(sort_order), 0) into v_base from public.request_files where request_id = r.id;

  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    v_path := f->>'storage_path';
    v_name := left(coalesce(nullif(btrim(f->>'original_name'), ''), 'Attachment'), 255);
    v_mime := f->>'mime_type';
    v_size := (f->>'size_bytes')::bigint;
    if public.storage_request_id(v_path) is distinct from r.id or split_part(v_path, '/', 2) not like 'clarif-%' then
      raise exception 'Bad file path';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = v_path) then
      raise exception 'File % was not uploaded', v_name;
    end if;
    if v_mime not in ('application/pdf','image/jpeg','image/png') then
      raise exception 'Documents must be PDF, JPG or PNG';
    end if;
    if v_size is null or v_size <= 0 or v_size > 20971520 then raise exception 'Each file must be under 20 MB'; end if;
    v_count := v_count + 1;
    insert into public.request_files (request_id, kind, storage_path, original_name, mime_type, size_bytes,
      page_count, sort_order, added_by, added_by_name, added_by_role, clarification_id)
    values (r.id, 'document', v_path, v_name, v_mime, v_size,
      nullif(f->>'page_count', '')::int, v_base + v_count, me.id, me.full_name, me.role, c.id);
  end loop;

  update public.disbursement_clarifications set
    responded_by = me.id,
    responded_by_name = me.full_name,
    response_note = btrim(coalesce(p_response_note, '')),
    response_voice_path = p_voice_path,
    response_voice_duration = p_voice_duration,
    responded_at = now(),
    status = 'clarified',
    updated_at = now()
  where id = c.id;

  v_remark := coalesce(nullif(btrim(p_response_note), ''), 'Head provided clarification and sent back to Disbursement')
    || case when v_count > 0 then ' · ' || v_count || ' new file(s) attached' else '' end;

  insert into public.request_actions (
    request_id, actor_id, actor_name, actor_role, action, from_status, to_status, remarks, visible_to_requester
  ) values (
    c.request_id, me.id, me.full_name, me.role, 'disbursement_clarification_provided',
    r.status, r.status, v_remark, false
  );

  insert into public.notifications (user_id, request_id, title, body)
  values (
    c.requested_by, c.request_id,
    'Clarification Provided by Head',
    me.full_name || ' responded to your clarification on ' || coalesce(r.request_no, 'request')
      || case when v_count > 0 then ' and attached ' || v_count || ' file(s)' else '' end
  );

  return jsonb_build_object('success', true, 'files', v_count);
end;
$$;
revoke execute on function public.respond_disbursement_clarification(uuid, text, text, numeric, jsonb) from public, anon;
grant execute on function public.respond_disbursement_clarification(uuid, text, text, numeric, jsonb) to authenticated;

-- Cancel an approved request (owner Head, before full payment) ----------------------------------
create or replace function public.cancel_approved_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; ids uuid[]; v_reason text := btrim(coalesce(p_reason, ''));
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;
  if me.role is distinct from 'head'
     or not (r.owner_head_id = me.id or r.department_id = me.department_id) then
    raise exception 'Only the request owner Head can cancel this request';
  end if;
  if r.status = 'paid' then raise exception 'This request is already fully paid and can no longer be cancelled'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be cancelled'; end if;
  if char_length(v_reason) < 3 then raise exception 'Please give a reason for cancelling'; end if;

  update public.requests set status = 'cancelled', cancelled_by = me.id, cancelled_by_name = me.full_name,
    cancelled_at = now(), cancel_reason = left(v_reason, 1000), updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'cancelled', 'approved', 'cancelled',
    v_reason || case when r.paid_amount > 0
      then ' · ₹' || to_char(r.paid_amount, 'FM999999999990.00') || ' already paid before cancellation' else '' end,
    true);

  select array_agg(id) into ids from public.profiles
   where is_active and id <> me.id and (
     id = r.requester_id
     or (role = 'disbursement' and r.request_type <> 'discount')
     or (role = 'admin' and (r.route = 'A' or r.approver_role = 'admin'))
     or (role in ('clerk','head') and department_id = r.department_id));
  perform public._notify(ids, r.id, 'Approval cancelled - ' || coalesce(r.approval_no, r.request_no, ''),
    coalesce(r.request_no, 'Request') || ' - ' || r.title || ' · ' || v_reason);
end $$;
revoke execute on function public.cancel_approved_request(uuid, text) from public, anon;
grant execute on function public.cancel_approved_request(uuid, text) to authenticated;

-- Public verification shows cancelled approvals as cancelled (not "not found") ------------------
create or replace function public.verify_approval(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.requests; d public.departments; v_code text := btrim(coalesce(p_token, ''));
begin
  if v_code = '' or char_length(v_code) > 200 then return null; end if;
  select * into r from public.requests
   where status in ('approved','paid','cancelled')
     and (verify_token = v_code
          or (auth.uid() is not null and (upper(approval_no) = upper(v_code) or upper(request_no) = upper(v_code))))
   limit 1;
  if r.id is null then return null; end if;
  select * into d from public.departments where id = r.department_id;
  return jsonb_build_object(
    'request_id', r.id, 'approval_no', r.approval_no, 'request_no', r.request_no, 'title', r.title,
    'amount', r.amount, 'status', r.status, 'approver_name', r.approver_name, 'approver_role', r.approver_role,
    'decided_at', r.decided_at, 'paid_at', r.paid_at, 'department', d.name, 'requester_name', r.requester_name,
    'request_type', r.request_type, 'shop_name', r.shop_name,
    'paid_amount', r.paid_amount, 'balance', greatest(r.amount - r.paid_amount, 0),
    'cancelled_at', r.cancelled_at, 'cancelled_by_name', r.cancelled_by_name,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'payment_date', p.payment_date)
                             order by p.payment_date, p.created_at)
                          from public.request_payments p where p.request_id = r.id), '[]'::jsonb),
    'can_open', case when auth.uid() is null then false else public.can_view_request(r.id) end,
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_name', s.file_name, 'sha256', s.sha256,
                'page_count', s.page_count, 'is_packet', s.is_packet) order by s.is_packet desc, s.file_name)
              from public.signed_files s where s.request_id = r.id), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
