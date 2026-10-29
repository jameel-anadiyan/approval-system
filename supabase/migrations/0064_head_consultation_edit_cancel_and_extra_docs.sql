-- ==============================================================================
-- 0064_head_consultation_edit_cancel_and_extra_docs.sql
-- 1. Inter-Department Head Review:
--    - When in pending status, the requester can remove/cancel the consultation request.
--    - When in pending status, the requester can edit the message/note given to the other head.
-- 2. Department Head Extra Documents:
--    - Department Head (and Admin) can attach extra documents to a request before approval.
-- ==============================================================================

-- ───────────────────────────── 1. can_edit_request_files ──────────────────────
-- Update can_edit_request_files so:
-- - Requester can edit while draft or returned
-- - Department Head (or Admin) can upload extra documents before final approval/rejection
create or replace function public.can_edit_request_files(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      -- Requester while draft or returned
      (r.requester_id = me.id and r.status in ('draft','returned'))
      -- OR Department Head (owning head, department head, or consulted head) adding extra docs before approval
      or (
        (me.role = 'head' and (
          r.department_id = me.department_id 
          or r.owner_head_id = me.id
          or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
        ))
        and r.status not in ('approved','rejected','paid','withdrawn','cancelled')
      )
      -- OR Admin adding extra docs before approval
      or (
        me.role = 'admin'
        and r.status not in ('approved','rejected','paid','withdrawn','cancelled')
      )
    )
  )
$$;

revoke execute on function public.can_edit_request_files(uuid) from public, anon;
grant execute on function public.can_edit_request_files(uuid) to authenticated;

-- ───────────────────────────── 2. register_file ──────────────────────────────
-- Allow Department Head and Admin to attach extra documents before approval
create or replace function public.register_file(
  p_request_id uuid,
  p_kind public.file_kind,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_page_count int default null,
  p_duration_sec numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_id uuid;
  n int;
  is_head boolean;
  is_admin boolean;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  is_head := (
    me.role = 'head' and (
      r.department_id = me.department_id 
      or r.owner_head_id = me.id
      or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
    )
  );
  is_admin := (me.role = 'admin');

  -- Can edit if requester in draft/returned, OR head/admin before approval
  if (r.requester_id = me.id and r.status in ('draft','returned')) then
    null; -- normal requester upload
  elsif (is_head or is_admin) and r.status not in ('approved','rejected','paid','withdrawn','cancelled') then
    null; -- head or admin adding extra docs before approval
  else
    raise exception 'You cannot attach documents to this request at this stage';
  end if;

  if public.storage_request_id(p_storage_path) is distinct from r.id then
    raise exception 'Bad file path';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'File was not uploaded';
  end if;

  select count(*) into n from public.request_files where request_id = r.id and kind = p_kind;
  if p_kind = 'document' and n >= 25 then
    raise exception 'At most 25 documents per request';
  end if;
  if p_kind = 'voice_note' and n >= 10 then
    raise exception 'At most 10 voice notes per request';
  end if;
  if p_kind = 'document' and p_mime_type not in ('application/pdf','image/jpeg','image/png') then
    raise exception 'Documents must be PDF, JPG or PNG';
  end if;
  if p_kind = 'voice_note' and p_mime_type not like 'audio/%' then
    raise exception 'Voice notes must be audio';
  end if;

  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, duration_sec, sort_order,
    added_by, added_by_name, added_by_role
  )
  values (
    r.id, p_kind, p_storage_path, left(p_original_name, 255), p_mime_type, p_size_bytes,
    p_page_count, p_duration_sec, n,
    case when me.id <> r.requester_id then me.id else null end,
    case when me.id <> r.requester_id then me.full_name else null end,
    case when me.id <> r.requester_id then me.role else null end
  )
  returning id into v_id;

  update public.requests set updated_at = now() where id = r.id;

  -- Log action if attached by an approver / head
  if me.id <> r.requester_id then
    perform public._log_action(
      r.id, me, 'file_attached', r.status, r.status,
      'Attached extra document: ' || left(p_original_name, 255),
      true
    );
  end if;

  return v_id;
end $$;

revoke execute on function public.register_file(uuid, public.file_kind, text, text, text, bigint, int, numeric) from public, anon;
grant execute on function public.register_file(uuid, public.file_kind, text, text, text, bigint, int, numeric) to authenticated;

-- ───────────────────────────── 3. remove_file ────────────────────────────────
create or replace function public.remove_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  f public.request_files;
  r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;

  if (r.requester_id = me.id and r.status in ('draft','returned')) then
    if f.added_by is not null and f.added_by <> me.id then
      raise exception 'This file was added by an approver and cannot be deleted';
    end if;
  elsif (f.added_by = me.id or me.role = 'admin') and r.status not in ('approved','rejected','paid','withdrawn','cancelled') then
    -- Head or admin can remove files they attached before approval
    null;
  else
    raise exception 'You cannot remove files from this request at this stage';
  end if;

  delete from public.request_files where id = f.id;

  if f.added_by is not null and me.id <> r.requester_id then
    perform public._log_action(
      r.id, me, 'file_removed', r.status, r.status,
      'Removed extra document: ' || f.original_name,
      true
    );
  end if;

  return f.storage_path;
end $$;

revoke execute on function public.remove_file(uuid) from public, anon;
grant execute on function public.remove_file(uuid) to authenticated;

-- ───────────────────────────── 4. cancel_head_consultation ───────────────────
-- Allows the requester (or owning head / admin) to cancel/remove a pending
-- Inter-Department Head Review consultation.
create or replace function public.cancel_head_consultation(p_consultation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.head_consultations;
  r public.requests;
  can_cancel boolean;
begin
  me := public._me();
  select * into c from public.head_consultations where id = p_consultation_id;
  if c.id is null then
    raise exception 'Consultation not found';
  end if;

  select * into r from public.requests where id = c.request_id for update;
  if r.id is null then
    raise exception 'Request not found';
  end if;

  -- Only pending consultations can be cancelled/removed
  if c.status <> 'pending' then
    raise exception 'Only pending consultations can be cancelled or removed';
  end if;

  -- Allowed if caller requested it, or is the owning head of the request, or admin
  can_cancel := (c.requested_by = me.id)
    or (me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id))
    or (me.role = 'admin');

  if not can_cancel then
    raise exception 'You do not have permission to cancel this consultation';
  end if;

  delete from public.head_consultations where id = c.id;

  -- Clean up unread consultation notification for the target head if exists
  delete from public.notifications
  where user_id = c.head_id
    and request_id = r.id
    and title like 'Consultation Request:%'
    and read_at is null;

  perform public._log_action(
    r.id, me, 'consultation_cancelled', r.status, r.status,
    'Cancelled Inter-Department consultation with ' || c.head_name,
    true
  );

  return jsonb_build_object(
    'success', true,
    'deleted_id', p_consultation_id,
    'head_name', c.head_name
  );
end $$;

revoke execute on function public.cancel_head_consultation(uuid) from public, anon;
grant execute on function public.cancel_head_consultation(uuid) to authenticated;

-- ───────────────────────────── 5. update_head_consultation_note ──────────────
-- Allows the requester (or owning head / admin) to edit the message/note
-- given to the other head while the consultation is in pending status.
create or replace function public.update_head_consultation_note(
  p_consultation_id uuid,
  p_note text,
  p_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.head_consultations;
  r public.requests;
  can_edit boolean;
  clean_note text;
begin
  me := public._me();
  clean_note := nullif(btrim(p_note), '');

  select * into c from public.head_consultations where id = p_consultation_id;
  if c.id is null and p_request_id is not null then
    -- Fallback: select first pending consultation on request
    select * into c from public.head_consultations
    where request_id = p_request_id and status = 'pending'
    order by created_at desc limit 1;
  end if;

  if c.id is null then
    raise exception 'Consultation not found';
  end if;

  select * into r from public.requests where id = c.request_id for update;
  if r.id is null then
    raise exception 'Request not found';
  end if;

  if c.status <> 'pending' then
    raise exception 'The message can only be edited while the consultation is pending';
  end if;

  can_edit := (c.requested_by = me.id)
    or (me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id))
    or (me.role = 'admin');

  if not can_edit then
    raise exception 'You do not have permission to edit this consultation message';
  end if;

  -- Update note for this consultation (or all pending consultations on request if intended)
  update public.head_consultations
  set request_note = clean_note
  where request_id = r.id and status = 'pending';

  perform public._log_action(
    r.id, me, 'consultation_note_updated', r.status, r.status,
    'Updated Inter-Department consultation note' || case when clean_note is not null then ': "' || clean_note || '"' else ' (cleared)' end,
    true
  );

  return jsonb_build_object(
    'success', true,
    'note', clean_note,
    'consultation_id', c.id
  );
end $$;

revoke execute on function public.update_head_consultation_note(uuid, text, uuid) from public, anon;
grant execute on function public.update_head_consultation_note(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
