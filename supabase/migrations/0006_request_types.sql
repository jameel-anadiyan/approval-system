-- 0006 — Request types (General, Discount, Exhibition), shop master, per-user allowed
-- request types, and voice notes from Clerk / Head / Admin on each workflow step.
--
-- Rules
--   general    : as before (Clerk picks A or B; amount threshold applies; Disbursement pays)
--   discount   : B-level only (Head approves). amount = before − after. No Disbursement step.
--                (If the requester is the Head or the department has no Head, it goes to Admin.)
--   exhibition : A-level only (Head reviews → Admin approves). amount = total incl. GST.
--                Disbursement pays after approval.

create type public.request_type as enum ('general','discount','exhibition');

-- shops ----------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 100),
  code text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shops enable row level security;
revoke all on public.shops from anon;
revoke insert, update, delete, truncate on public.shops from authenticated;
create policy shops_select on public.shops for select to authenticated
  using ((select public.my_role()) is not null);

-- profiles: shop + which request types the user may raise ----------------------
alter table public.profiles
  add column shop_id uuid references public.shops(id),
  add column allowed_types public.request_type[] not null default '{general}';
create index profiles_shop_idx on public.profiles(shop_id);
-- existing users keep working with every type until Admin / Head narrows it
update public.profiles set allowed_types = '{general,discount,exhibition}';

-- requests: type, shop snapshot, type-specific form data -----------------------
alter table public.requests
  add column request_type public.request_type not null default 'general',
  add column shop_id uuid references public.shops(id),
  add column shop_name text,
  add column details jsonb not null default '{}'::jsonb;
create index requests_type_idx on public.requests(request_type);
create index requests_shop_idx on public.requests(shop_id);

-- request_files: who added it (null = requester) -------------------------------
alter table public.request_files
  add column added_by uuid references public.profiles(id),
  add column added_by_name text,
  add column added_by_role public.app_role;
create index request_files_added_by_idx on public.request_files(added_by);

-- ───────────────────────── visibility: Disbursement never sees Discount ──────

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
        or (me.role = 'disbursement' and r.status in ('approved','paid') and r.request_type <> 'discount')
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
      or ((select public.my_role()) = 'disbursement' and status in ('approved','paid') and request_type <> 'discount')
    )
  );

-- ───────────────────────── type-specific form validation ────────────────────

create or replace function public._num(p jsonb, k text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if p ? k and nullif(btrim(p->>k), '') is not null then
    return round((p->>k)::numeric, 2);
  end if;
  return null;
exception when others then
  raise exception '% must be a number', k;
end $$;

create or replace function public._txt(p jsonb, k text, maxlen int default 300)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p->>k, '')), maxlen), '')
$$;

-- Returns {"amount": n, "details": {...}} with only known keys, computed values filled in.
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_q1000 int; v_q500 int; v_other numeric; v_budget numeric; v_provides jsonb;
begin
  if p_type = 'general' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    return jsonb_build_object('amount', round(p_amount, 2), 'details', '{}'::jsonb);

  elsif p_type = 'discount' then
    v_before := public._num(d, 'before_amount');
    v_after := public._num(d, 'after_amount');
    if v_before is null or v_before <= 0 then raise exception 'Enter the amount before discount'; end if;
    if v_after is null or v_after < 0 then raise exception 'Enter the amount after discount'; end if;
    if v_after >= v_before then raise exception 'After-discount amount must be less than the amount before discount'; end if;
    return jsonb_build_object(
      'amount', v_before - v_after,
      'details', jsonb_build_object(
        'before_amount', v_before, 'after_amount', v_after,
        'discount_amount', v_before - v_after,
        'discount_pct', round((v_before - v_after) / v_before * 100, 2),
        'customer_name', public._txt(d, 'customer_name', 100),
        'reference', public._txt(d, 'reference', 100)));

  else -- exhibition
    if public._txt(d, 'event_name') is null then raise exception 'Event name is required'; end if;
    if public._txt(d, 'venue') is null then raise exception 'Venue is required'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_gst_pct := coalesce(public._num(d, 'gst_pct'), 0);
    if v_gst_pct < 0 or v_gst_pct > 100 then raise exception 'GST %% must be between 0 and 100'; end if;
    v_gst := round(v_excl * v_gst_pct / 100, 2);
    v_total := v_excl + v_gst;
    v_q1000 := greatest(coalesce(public._num(d, 'voucher_1000_qty'), 0), 0)::int;
    v_q500 := greatest(coalesce(public._num(d, 'voucher_500_qty'), 0), 0)::int;
    v_other := greatest(coalesce(public._num(d, 'other_costs'), 0), 0);
    v_budget := coalesce(public._num(d, 'total_budget'), v_total + v_q1000 * 1000 + v_q500 * 500 + v_other);
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_provides
      from jsonb_array_elements_text(case when jsonb_typeof(d->'provides') = 'array' then d->'provides' else '[]'::jsonb end) x
      where x in ('stall_space','table_chairs','electricity_lights','logo_stage_banners','stage_announcements','social_media','other');
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_build_object(
        'event_name', public._txt(d, 'event_name', 200),
        'organiser_contact', public._txt(d, 'organiser_contact'),
        'venue', public._txt(d, 'venue'),
        'event_dates', public._txt(d, 'event_dates'),
        'expected_footfall', public._txt(d, 'expected_footfall', 100),
        'stall_size_location', public._txt(d, 'stall_size_location'),
        'amount_excl_gst', v_excl, 'gst_pct', v_gst_pct, 'gst_amount', v_gst, 'total_incl_gst', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due'),
        'organiser_gstin', upper(coalesce(public._txt(d, 'organiser_gstin', 20), '')),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'provides', v_provides,
        'provides_other', public._txt(d, 'provides_other', 200),
        'voucher_1000_qty', v_q1000, 'voucher_500_qty', v_q500,
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'voucher_validity', public._txt(d, 'voucher_validity', 100),
        'lucky_draw', public._txt(d, 'lucky_draw'),
        'winners_draw', public._txt(d, 'winners_draw'),
        'other_costs', v_other,
        'total_budget', v_budget,
        'purpose', public._txt(d, 'purpose', 2000)));
  end if;
end $$;

-- ───────────────────────── drafts (typed) ───────────────────────────────────

create or replace function public.create_typed_draft(
  p_type public.request_type, p_title text, p_amount numeric, p_notes text default null, p_details jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v jsonb; v_id uuid; v_title text; v_shop text;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head') then raise exception 'Your role cannot raise requests'; end if;
  if not (p_type = any(me.allowed_types)) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;
  v := public._build_details(p_type, p_amount, p_details);
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null then raise exception 'Title is required'; end if;
  select name into v_shop from public.shops where id = me.shop_id;
  insert into public.requests (requester_id, requester_name, requester_role, department_id, title, notes, amount,
                               request_type, shop_id, shop_name, details)
  values (me.id, me.full_name, me.role, me.department_id, left(v_title, 200), nullif(btrim(p_notes), ''),
          (v->>'amount')::numeric, p_type, me.shop_id, v_shop, v->'details')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_typed_draft(
  p_request_id uuid, p_title text, p_amount numeric, p_notes text default null, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; v jsonb; v_title text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(p_details, r.details));
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null then raise exception 'Title is required'; end if;
  update public.requests set title = left(v_title, 200), amount = (v->>'amount')::numeric,
    notes = nullif(btrim(p_notes), ''), details = v->'details', updated_at = now()
  where id = r.id;
end $$;

-- old entry points keep working (General)
create or replace function public.create_draft(p_title text, p_amount numeric, p_notes text default null)
returns uuid language sql security definer set search_path = '' as $$
  select public.create_typed_draft('general', p_title, p_amount, p_notes, null)
$$;

create or replace function public.update_draft(p_request_id uuid, p_title text, p_amount numeric, p_notes text default null)
returns void language sql security definer set search_path = '' as $$
  select public.update_typed_draft(p_request_id, p_title, p_amount, p_notes, null)
$$;

-- requester files: voice-note limit counts only the requester's own notes
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
  select count(*) into n from public.request_files where request_id = r.id and kind = p_kind and added_by is null;
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

-- requester cannot remove voice notes added by Clerk / Head / Admin
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
  if f.added_by is not null and f.added_by <> me.id then raise exception 'This voice note was added by an approver'; end if;
  delete from public.request_files where id = f.id;
  return f.storage_path;
end $$;

-- ───────────────────────── submit: documents required only for General ─────

create or replace function public.submit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; v_no text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request has already been submitted'; end if;
  if r.amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if not (r.request_type = any(me.allowed_types)) then
    raise exception 'You are no longer allowed to raise % requests', r.request_type;
  end if;
  if r.request_type = 'general' and not exists (
       select 1 from public.request_files where request_id = r.id and kind = 'document') then
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

-- ───────────────────────── route: type decides the level ─────────────────────

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

  if r.request_type = 'exhibition' and p_route <> 'A' then
    raise exception 'Exhibition approvals need A-level (Admin) approval';
  end if;
  if r.request_type = 'discount' and p_route <> 'B' and has_head and r.requester_role <> 'head' then
    raise exception 'Discount approvals need B-level (Head) approval';
  end if;

  if p_route = 'B' then
    if r.request_type <> 'discount' and r.amount > threshold then
      raise exception 'Above threshold: Admin approval required';
    end if;
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

-- ───────────────────────── paid: never for Discount ───────────────────────────

create or replace function public.mark_paid(
  p_request_id uuid, p_payment_date date default null, p_payment_mode text default null,
  p_payment_ref text default null, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  if me.role is distinct from 'disbursement' then raise exception 'Only Disbursement can mark as paid'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type = 'discount' then raise exception 'Not found'; end if;
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

-- ───────────────────────── notifications: Discount skips Disbursement ────────

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
        id = r.requester_id
        or (role = 'disbursement' and r.request_type <> 'discount')
        or (role in ('clerk','head') and department_id = r.department_id));
    perform public._notify(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $$;
revoke execute on function public.notify_next_actor(uuid, public.request_status) from public, anon, authenticated;

-- ───────────────────────── voice notes on each workflow step ─────────────────

-- Is the current user the one who acts on this request right now?
create or replace function public.can_add_action_voice(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      (me.role = 'clerk' and r.department_id = me.department_id and r.status = 'submitted')
      or (me.role = 'head' and r.department_id = me.department_id
          and r.status in ('pending_head_approval','pending_head_review') and r.requester_id <> me.id)
      or (me.role = 'admin' and r.status = 'pending_admin_approval')
    )
  )
$$;
revoke execute on function public.can_add_action_voice(uuid) from public, anon;
grant execute on function public.can_add_action_voice(uuid) to authenticated;

-- upload path: {request_id}/voice-{uuid}.{ext}
create policy "request-files action voice insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and split_part(name, '/', 2) like 'voice-%'
    and public.can_add_action_voice(public.storage_request_id(name))
  );

create or replace function public.attach_action_voice(
  p_request_id uuid, p_storage_path text, p_mime_type text, p_size_bytes bigint, p_duration_sec numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; v_id uuid; n int; v_role text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_add_action_voice(r.id) then raise exception 'You cannot add a voice note now'; end if;
  if public.storage_request_id(p_storage_path) is distinct from r.id then raise exception 'Bad file path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'File was not uploaded';
  end if;
  if p_mime_type not like 'audio/%' then raise exception 'Voice notes must be audio'; end if;
  select count(*) into n from public.request_files where request_id = r.id and added_by is not null;
  if n >= 15 then raise exception 'Too many approver voice notes on this request'; end if;
  v_role := case me.role when 'clerk' then 'Clerk' when 'head' then 'Head' else 'Admin' end;
  insert into public.request_files (request_id, kind, storage_path, original_name, mime_type, size_bytes,
    duration_sec, sort_order, added_by, added_by_name, added_by_role)
  values (r.id, 'voice_note', p_storage_path, left('Voice note – ' || me.full_name || ' (' || v_role || ')', 255),
    p_mime_type, p_size_bytes, p_duration_sec, 100 + n, me.id, me.full_name, me.role)
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── shops (Admin) ────────────────────────────────────

create or replace function public.save_shop(p_id uuid, p_name text, p_code text, p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_id uuid;
begin
  me := public._me();
  if me.role is distinct from 'admin' then raise exception 'Only Admin can manage shops'; end if;
  if p_id is null then
    insert into public.shops (name, code, is_active) values (btrim(p_name), upper(btrim(p_code)), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.shops set name = btrim(p_name), code = upper(btrim(p_code)),
      is_active = coalesce(p_is_active, true), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Not found'; end if;
  end if;
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name, case when p_id is null then 'shop_created' else 'shop_updated' end,
    'shop', v_id::text, jsonb_build_object('name', p_name, 'code', upper(p_code), 'is_active', p_is_active));
  return v_id;
end $$;

-- ───────────────────────── approval run: pass type + form data ──────────────

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
       'reviewed_by_name', r.reviewed_by_name, 'reviewed_at', r.reviewed_at,
       'request_type', r.request_type, 'details', r.details, 'shop_name', r.shop_name),
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

-- verify page shows the type
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
    'request_type', r.request_type, 'shop_name', r.shop_name,
    'can_open', public.can_view_request(r.id),
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_name', s.file_name, 'sha256', s.sha256,
                'page_count', s.page_count, 'is_packet', s.is_packet) order by s.is_packet desc, s.file_name)
              from public.signed_files s where s.request_id = r.id), '[]'::jsonb));
end $$;

-- ───────────────────────── grants ─────────────────────────────────────────

revoke execute on function public._num(jsonb, text) from public, anon, authenticated;
revoke execute on function public._txt(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public._build_details(public.request_type, numeric, jsonb) from public, anon, authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_typed_draft(public.request_type, text, numeric, text, jsonb)',
    'update_typed_draft(uuid, text, numeric, text, jsonb)',
    'create_draft(text, numeric, text)', 'update_draft(uuid, text, numeric, text)',
    'register_file(uuid, public.file_kind, text, text, text, bigint, int, numeric)', 'remove_file(uuid)',
    'submit_request(uuid)', 'route_request(uuid, public.approval_route, text)',
    'mark_paid(uuid, date, text, text, text)', 'verify_approval(text)',
    'attach_action_voice(uuid, text, text, bigint, numeric)', 'save_shop(uuid, text, text, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'revoke execute on function public.begin_approval(uuid, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.begin_approval(uuid, uuid) to service_role';
end $$;
