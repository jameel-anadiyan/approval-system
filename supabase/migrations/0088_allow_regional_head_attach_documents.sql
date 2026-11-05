-- ============================================================================
-- 0088_allow_regional_head_attach_documents.sql
--
-- Fix: Allow Regional Heads to attach additional documents to employee requests
-- under their purview across review stages before finalization.
--
-- 1. Updates `public.can_edit_request_files(p_request_id uuid)`:
--    Grants Regional Heads storage upload/edit permissions on requests under their
--    purview (regional_head_id, regional_head_shops, region_id, requester assignment,
--    or actions) for active (non-finalized) requests.
--
-- 2. Updates `public.register_file(...)`:
--    Allows Regional Heads reviewing or managing requests under their purview to
--    register attachments when the request is active (not approved, rejected,
--    paid, withdrawn, or cancelled).
--
-- 3. Updates `public.remove_file(p_file_id uuid)` and `request_files_delete` RLS:
--    Ensures Regional Heads can delete files they attached or remove files on
--    draft/returned requests in their purview.
-- ============================================================================

-- 1. Update can_edit_request_files
create or replace function public.can_edit_request_files(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        (r.requester_id = me.id and r.status in ('draft', 'returned'))
        or (
          r.status = 'returned'
          and (
            me.role = 'admin'
            or (me.role in ('head', 'clerk') and (r.department_id = me.department_id or r.owner_head_id = me.id or r.routed_by = me.id))
            or (
              me.role = 'regional_head'
              and (
                r.regional_head_id = me.id
                or r.department_id = me.department_id
                or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
                or exists (select 1 from public.profiles req where req.id = r.requester_id and (req.regional_head_id = me.id or req.region_id = me.region_id))
              )
            )
          )
        )
        or (
          r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled')
          and (
            me.role = 'admin'
            or (
              me.role = 'head'
              and (
                r.department_id = me.department_id
                or r.owner_head_id = me.id
                or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
              )
            )
            or (
              me.role = 'regional_head'
              and (
                r.regional_head_id = me.id
                or r.department_id = me.department_id
                or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
                or exists (select 1 from public.profiles req where req.id = r.requester_id and (req.regional_head_id = me.id or req.region_id = me.region_id))
                or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
              )
            )
            or (
              r.request_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report', 'exhibition')
              and (
                r.requester_id = me.id
                or (me.role = 'clerk' and r.department_id = me.department_id)
                or (me.role = 'regional_head' and r.regional_head_id = me.id)
              )
            )
          )
        )
      )
  );
$$;

revoke execute on function public.can_edit_request_files(uuid) from public, anon;
grant execute on function public.can_edit_request_files(uuid) to authenticated;

-- 2. Update register_file RPC
create or replace function public.register_file(
  p_request_id uuid,
  p_kind public.file_kind,
  p_storage_path text,
  p_original_name text,
  p_mime_type text default null,
  p_size_bytes bigint default 0,
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
  is_regional_head boolean;
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_name_lower text := lower(btrim(coalesce(p_original_name, '')));
  v_doc_ok boolean := false;
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
  is_regional_head := (
    me.role = 'regional_head' and (
      r.regional_head_id = me.id
      or r.department_id = me.department_id
      or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
      or exists (select 1 from public.profiles req where req.id = r.requester_id and (req.regional_head_id = me.id or req.region_id = me.region_id))
      or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
    )
  );

  if (r.requester_id = me.id and r.status in ('draft','returned')) then
    null;
  elsif r.status = 'returned' and (
    is_admin
    or is_regional_head
    or (me.role in ('head', 'clerk') and (r.department_id = me.department_id or r.owner_head_id = me.id or r.routed_by = me.id))
  ) then
    null;
  elsif (is_head or is_admin or is_regional_head) and r.status not in ('approved','rejected','paid','withdrawn','cancelled') then
    null;
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

  if p_kind = 'document' then
    v_doc_ok := (
      v_mime = 'application/pdf'
      or v_mime like 'image/%'
      or v_mime in (
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.macroenabled.12',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv',
        'application/csv',
        'text/plain',
        'application/rtf',
        'text/rtf'
      )
      or (
        v_mime in ('', 'application/octet-stream')
        and v_name_lower ~ '\.(pdf|png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif|avif|ico|xlsx?|xlsm|csv|ods|docx?|odt|rtf|txt|pptx?)$'
      )
    );
    if not v_doc_ok then
      raise exception 'Unsupported document format (%). Upload PDF, Excel, Word, CSV, or any image file.', coalesce(nullif(v_mime, ''), p_original_name);
    end if;
  end if;

  if p_kind = 'voice_note' and v_mime not like 'audio/%' then
    raise exception 'Voice notes must be audio';
  end if;

  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, duration_sec, sort_order,
    added_by, added_by_name, added_by_role
  )
  values (
    r.id, p_kind, p_storage_path, left(p_original_name, 255), coalesce(nullif(v_mime, ''), 'application/octet-stream'), p_size_bytes,
    p_page_count, p_duration_sec, n,
    case when me.id <> r.requester_id then me.id else null end,
    case when me.id <> r.requester_id then me.full_name else null end,
    case when me.id <> r.requester_id then me.role else null end
  )
  returning id into v_id;

  update public.requests set updated_at = now() where id = r.id;

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

-- 3. Update remove_file RPC
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
  -- Requester, admin, owning head, regional head, or clerk can remove ANY existing attachment
  if r.status in ('draft', 'returned') then
    if (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.profiles req where req.id = r.requester_id and (req.regional_head_id = me.id or req.region_id = me.region_id))
         ))
      or (me.role = 'clerk' and r.department_id = me.department_id)
    ) then
      can_remove := true;
    end if;

  -- Case 2: When request is before final approval
  -- Head, Regional Head, or admin can remove files they attached (or admin can remove any)
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

-- 4. Update request_files_delete RLS policy
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
            or (me.role = 'head' and (r.department_id = me.department_id or r.owner_head_id = me.id))
            or (me.role = 'regional_head' and (
                  r.regional_head_id = me.id
                  or r.department_id = me.department_id
                  or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
                  or exists (select 1 from public.profiles req where req.id = r.requester_id and (req.regional_head_id = me.id or req.region_id = me.region_id))
               ))
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
