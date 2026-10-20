-- Regional Heads + clerk work categories.
--
-- Regional Head (role 'regional_head'): sits between employees and the clerk.
--   * Created by the department Head (or Admin) and assigned one or more shops.
--   * Employees are assigned a Regional Head. Their requests go to the Regional
--     Head first (status 'pending_regional_review'); the Regional Head can only
--     forward to the clerk or return to the employee (no approve / reject).
--   * A Regional Head's own requests go straight to the clerk.
--
-- Work categories: a department may split its work between several clerks.
--   * The Head (or Admin) keeps the department's category list.
--   * Each clerk handles one or more categories.
--   * When the department has more than one active clerk (and categories are
--     set up), the requester must pick a category and only that category's
--     clerk(s) are notified and can route / return it. A category without an
--     active clerk falls back to every clerk of the department.

-- ---------------------------------------------------------------- schema
alter table public.profiles drop constraint if exists profiles_department_by_role;
alter table public.profiles add constraint profiles_department_by_role
  check ((role in ('head','clerk','employee','regional_head')) = (department_id is not null));

alter table public.profiles
  add column if not exists regional_head_id uuid references public.profiles(id) on delete set null;

create table if not exists public.work_categories (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists work_categories_dept_name_key
  on public.work_categories (department_id, lower(name));

create table if not exists public.clerk_categories (
  clerk_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.work_categories(id) on delete cascade,
  primary key (clerk_id, category_id)
);
create index if not exists clerk_categories_category_idx on public.clerk_categories (category_id);

create table if not exists public.regional_head_shops (
  regional_head_id uuid not null references public.profiles(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  primary key (regional_head_id, shop_id)
);
create index if not exists regional_head_shops_shop_idx on public.regional_head_shops (shop_id);

alter table public.requests
  add column if not exists category_id uuid references public.work_categories(id) on delete set null,
  add column if not exists category_name text,
  add column if not exists regional_head_id uuid references public.profiles(id) on delete set null,
  add column if not exists regional_head_name text,
  add column if not exists regional_forwarded_at timestamptz;
create index if not exists requests_regional_head_idx on public.requests (regional_head_id);

alter table public.work_categories enable row level security;
alter table public.clerk_categories enable row level security;
alter table public.regional_head_shops enable row level security;
revoke all on public.work_categories, public.clerk_categories, public.regional_head_shops from anon;
revoke insert, update, delete, truncate on public.work_categories, public.clerk_categories,
  public.regional_head_shops from authenticated;
grant select on public.work_categories, public.clerk_categories, public.regional_head_shops to authenticated;

drop policy if exists work_categories_select on public.work_categories;
create policy work_categories_select on public.work_categories for select
  using ((select public.my_role()) is not null);
drop policy if exists clerk_categories_select on public.clerk_categories;
create policy clerk_categories_select on public.clerk_categories for select
  using ((select public.my_role()) is not null);
drop policy if exists regional_head_shops_select on public.regional_head_shops;
create policy regional_head_shops_select on public.regional_head_shops for select
  using ((select public.my_role()) is not null);

-- ---------------------------------------------------------------- helpers
-- Clerks who handle a request: the category's active clerks, else every active clerk.
create or replace function public._clerk_ids_for(p_department_id uuid, p_category_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select array_agg(p.id order by p.id) from public.profiles p
       join public.clerk_categories cc on cc.clerk_id = p.id
      where p_category_id is not null and cc.category_id = p_category_id
        and p.role = 'clerk' and p.is_active and p.department_id = p_department_id),
    (select array_agg(p.id order by p.id) from public.profiles p
      where p.role = 'clerk' and p.is_active and p.department_id = p_department_id),
    '{}'::uuid[])
$$;
revoke execute on function public._clerk_ids_for(uuid, uuid) from public, anon, authenticated;

-- PostgREST computed column: select=*,routing_clerk_ids
create or replace function public.routing_clerk_ids(r public.requests)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select public._clerk_ids_for(r.department_id, r.category_id)
$$;
revoke execute on function public.routing_clerk_ids(public.requests) from public, anon;
grant execute on function public.routing_clerk_ids(public.requests) to authenticated;

-- A category is required when several clerks split the work and categories exist.
create or replace function public._category_required(p_department_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.profiles
           where role = 'clerk' and is_active and department_id = p_department_id) > 1
     and exists (select 1 from public.work_categories c
                   join public.clerk_categories cc on cc.category_id = c.id
                   join public.profiles p on p.id = cc.clerk_id and p.role = 'clerk' and p.is_active
                  where c.department_id = p_department_id and c.is_active)
$$;
revoke execute on function public._category_required(uuid) from public, anon, authenticated;

-- Categories a requester of my department can pick (only those with an active clerk).
create or replace function public.request_category_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := public._me();
  if me.department_id is null then
    return jsonb_build_object('required', false, 'categories', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'required', public._category_required(me.department_id),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by lower(c.name))
        from public.work_categories c
       where c.department_id = me.department_id and c.is_active
         and exists (select 1 from public.clerk_categories cc
                       join public.profiles p on p.id = cc.clerk_id and p.role = 'clerk' and p.is_active
                      where cc.category_id = c.id)), '[]'::jsonb));
end $$;
revoke execute on function public.request_category_options() from public, anon;
grant execute on function public.request_category_options() to authenticated;

-- Head (own department) or Admin (any department) maintains the category list.
create or replace function public.save_work_category(p_id uuid, p_name text, p_is_active boolean default true,
  p_department_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_id uuid; v_dept uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  me := public._me();
  if me.role not in ('head','admin') then raise exception 'Only a Head or Admin can manage work categories'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Category name must be 2-60 characters';
  end if;
  if p_id is null then
    v_dept := case when me.role = 'head' then me.department_id else p_department_id end;
    if v_dept is null or not exists (select 1 from public.departments where id = v_dept) then
      raise exception 'Select the department';
    end if;
    if exists (select 1 from public.work_categories where department_id = v_dept and lower(name) = lower(v_name)) then
      raise exception 'This category already exists';
    end if;
    insert into public.work_categories (department_id, name, is_active)
    values (v_dept, v_name, coalesce(p_is_active, true)) returning id into v_id;
  else
    select department_id into v_dept from public.work_categories where id = p_id;
    if v_dept is null or (me.role = 'head' and v_dept is distinct from me.department_id) then
      raise exception 'Not found';
    end if;
    if exists (select 1 from public.work_categories
                where department_id = v_dept and lower(name) = lower(v_name) and id <> p_id) then
      raise exception 'This category already exists';
    end if;
    update public.work_categories set name = v_name, is_active = coalesce(p_is_active, true), updated_at = now()
     where id = p_id returning id into v_id;
  end if;
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name, case when p_id is null then 'category_created' else 'category_updated' end,
    'work_category', v_id::text, jsonb_build_object('name', v_name, 'department_id', v_dept, 'is_active', p_is_active));
  return v_id;
end $$;
revoke execute on function public.save_work_category(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.save_work_category(uuid, text, boolean, uuid) to authenticated;

-- Requester picks (or clears) the work category while the request is editable.
create or replace function public.set_request_category(p_request_id uuid, p_category_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; c public.work_categories;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if p_category_id is not null then
    select * into c from public.work_categories
     where id = p_category_id and department_id = r.department_id and is_active;
    if c.id is null then raise exception 'Work category not found'; end if;
  end if;
  update public.requests set category_id = c.id, category_name = c.name, updated_at = now() where id = r.id;
end $$;
revoke execute on function public.set_request_category(uuid, uuid) from public, anon;
grant execute on function public.set_request_category(uuid, uuid) to authenticated;

-- The assigned Regional Head; the department Head steps in only if that Regional Head is inactive.
create or replace function public._is_regional_actor(r public.requests, me public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select (me.role = 'regional_head' and me.id = r.regional_head_id)
      or (me.role = 'head' and me.department_id = r.department_id and r.requester_id <> me.id
          and not exists (select 1 from public.profiles p where p.id = r.regional_head_id and p.is_active))
$$;
revoke execute on function public._is_regional_actor(public.requests, public.profiles) from public, anon, authenticated;

-- ---------------------------------------------------------------- visibility
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
        or (me.role in ('clerk','head') and r.department_id = me.department_id and r.status <> 'draft')
        or (me.role = 'regional_head' and r.regional_head_id = me.id and r.status <> 'draft')
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and (regional_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status])))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  ));

-- Regional Heads see the profiles of their department (employees, clerks, Head), like a clerk.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  (id = (select auth.uid()))
  or ((select public.my_role()) = 'admin'::public.app_role)
  or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role, 'regional_head'::public.app_role]))
      and (department_id = (select public.my_department())))
  or (((select public.my_role()) = 'head'::public.app_role) and (role = 'head'::public.app_role) and is_active)
);

-- Approver voice notes are visible to Regional Heads too.
drop policy if exists request_files_select on public.request_files;
create policy request_files_select on public.request_files for select using (
  public.can_view_request(request_id) and (
    (((select public.my_role()) <> 'disbursement'::public.app_role) and (
        (kind <> 'voice_note'::public.file_kind)
        or ((select public.my_role()) = any (array['admin'::public.app_role, 'head'::public.app_role,
                                                   'clerk'::public.app_role, 'regional_head'::public.app_role]))
        or (added_by is null)
        or (added_by = (select auth.uid()))))
    or (((select public.my_role()) = 'disbursement'::public.app_role) and (clarification_id is not null))
  ));

create or replace function public.can_add_action_voice(p_request_id uuid)
 returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (
    select 1 from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id and (
      (me.role = 'clerk' and r.department_id = me.department_id and r.status in ('submitted', 'approving'))
      or (me.role = 'regional_head' and r.regional_head_id = me.id and r.status = 'pending_regional_review')
      or (me.role = 'head' and r.department_id = me.department_id and r.status = 'pending_regional_review'
          and public._is_regional_actor(r, me))
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
$function$;

create or replace function public.attach_action_voice(p_request_id uuid, p_storage_path text, p_mime_type text,
  p_size_bytes bigint, p_duration_sec numeric default null::numeric)
 returns uuid language plpgsql security definer set search_path to '' as $function$
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
  v_role := case me.role when 'clerk' then 'Clerk' when 'head' then 'Head'
                         when 'regional_head' then 'Regional Head' when 'disbursement' then 'Disbursement'
                         else 'Admin' end;
  insert into public.request_files (request_id, kind, storage_path, original_name, mime_type, size_bytes,
    duration_sec, sort_order, added_by, added_by_name, added_by_role)
  values (r.id, 'voice_note', p_storage_path, left('Voice note – ' || me.full_name || ' (' || v_role || ')', 255),
    p_mime_type, p_size_bytes, p_duration_sec, 100 + n, me.id, me.full_name, me.role)
  returning id into v_id;
  return v_id;
end $function$;

-- ---------------------------------------------------------------- notifications
create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
 returns void language plpgsql security definer set search_path to '' as $function$
declare r public.requests; ids uuid[]; label text;
begin
  select * into r from public.requests where id = p_request_id;
  label := coalesce(r.request_no, 'Request') || ' - ' || r.title;
  if p_status = 'submitted' then
    select array_agg(u) into ids from unnest(public._clerk_ids_for(r.department_id, r.category_id)) u
     where u <> r.requester_id;
    perform public._notify(ids, r.id, 'New request to route',
      label || case when r.category_name is not null then ' · ' || r.category_name else '' end);
  elsif p_status = 'pending_regional_review' then
    select array_agg(id) into ids from public.profiles where id = r.regional_head_id and is_active;
    if ids is null then  -- Regional Head inactive: the department Head steps in
      select array_agg(id) into ids from public.profiles
        where role = 'head' and is_active and department_id = r.department_id;
    end if;
    perform public._notify(ids, r.id, 'Request to review & forward', label);
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
        or id = r.regional_head_id
        or (role = 'disbursement' and r.request_type <> 'discount')
        or (role in ('clerk','head') and department_id = r.department_id));
    perform public._notify(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $function$;

-- ---------------------------------------------------------------- workflow
create or replace function public.create_typed_draft(p_type public.request_type, p_title text, p_amount numeric,
  p_notes text default null::text, p_details jsonb default null::jsonb)
 returns uuid language plpgsql security definer set search_path to '' as $function$
declare me public.profiles; v jsonb; v_id uuid; v_title text; v_shop text;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then raise exception 'Your role cannot raise requests'; end if;
  if not (p_type = any(me.allowed_types)) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;
  v := public._build_details(p_type, p_amount, p_details);
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and p_type = 'asset' then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null then raise exception 'Title is required'; end if;
  select name into v_shop from public.shops where id = me.shop_id;
  insert into public.requests (requester_id, requester_name, requester_role, department_id, title, notes, amount,
                               request_type, shop_id, shop_name, details)
  values (me.id, me.full_name, me.role, me.department_id, left(v_title, 200), nullif(btrim(p_notes), ''),
          (v->>'amount')::numeric, p_type, me.shop_id, v_shop, v->'details')
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.submit_request(p_request_id uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; rh public.profiles; v_no text; n int; v_rh_count int;
  v_next public.request_status; v_cat_ok boolean;
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
  if r.request_type = 'discount' and not exists (
       select 1 from public.request_files
        where request_id = r.id and kind = 'document' and mime_type = 'application/pdf' and added_by is null) then
    raise exception 'Attach the discount PDF to submit';
  end if;

  -- Work category (only needed when several clerks split the department's work).
  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  if r.request_type = 'asset' then
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 3 then raise exception 'Attach at least 3 quotations, each with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  -- Employees under a Regional Head go to the Regional Head first.
  if me.role = 'employee' then
    select p.* into rh from public.profiles p
     where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active
       and p.department_id = me.department_id;
    if rh.id is null and me.shop_id is not null then
      select count(*) into v_rh_count from public.profiles p
        join public.regional_head_shops s on s.regional_head_id = p.id
       where p.role = 'regional_head' and p.is_active and p.department_id = me.department_id
         and s.shop_id = me.shop_id;
      if v_rh_count = 1 then
        select p.* into rh from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active and p.department_id = me.department_id
           and s.shop_id = me.shop_id;
      elsif v_rh_count > 1 then
        raise exception 'Your Regional Head is not assigned yet. Ask your Head to assign one before submitting';
      end if;
    end if;
  end if;
  v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));
  update public.requests set status = v_next, request_no = v_no,
    route = null, routed_by = null, routed_at = null, reviewed_by = null, reviewed_by_name = null, reviewed_at = null,
    regional_head_id = rh.id, regional_head_name = rh.full_name, regional_forwarded_at = null,
    submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
    r.status, v_next, null, true);
  perform public.notify_next_actor(r.id, v_next);
end $function$;

-- Regional Head forwards an employee's request to the clerk (no approval power).
create or replace function public.regional_forward_request(p_request_id uuid, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then raise exception 'Not found'; end if;
  if r.status <> 'pending_regional_review' then raise exception 'This request is not waiting for the Regional Head'; end if;
  if not public._is_regional_actor(r, me) then
    raise exception 'Only the assigned Regional Head can forward this request';
  end if;
  update public.requests set status = 'submitted', regional_forwarded_at = now(), updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'regional_forwarded', r.status, 'submitted', p_remarks, true);
  perform public.notify_next_actor(r.id, 'submitted');
end $$;
revoke execute on function public.regional_forward_request(uuid, text) from public, anon;
grant execute on function public.regional_forward_request(uuid, text) to authenticated;

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
      then me.role = 'head' and r.department_id = me.department_id and r.requester_id <> me.id
    when r.status = 'pending_admin_approval' then me.role = 'admin'
    else false end;
  if not allowed then raise exception 'You cannot return this request now'; end if;
  update public.requests set status = 'returned', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'returned', r.status, 'returned', p_remarks, true);
  perform public.notify_next_actor(r.id, 'returned');
end $function$;

create or replace function public.route_request(p_request_id uuid, p_route public.approval_route,
  p_remarks text default null::text)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; threshold numeric;
  next_status public.request_status; has_head boolean; v_route public.approval_route;
begin
  me := public._me();
  if me.role is distinct from 'clerk' then raise exception 'Only a clerk can route requests'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Not waiting for clerk routing'; end if;
  if not (me.id = any(public._clerk_ids_for(r.department_id, r.category_id))) then
    raise exception 'This request is for the % clerk', coalesce(r.category_name, 'assigned');
  end if;

  select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
  threshold := coalesce(threshold, 10000);

  select exists (select 1 from public.profiles
    where department_id = r.department_id and role = 'head' and is_active) into has_head;

  if r.request_type = 'asset' then
    -- The Head's quote choice decides the level, so the clerk only forwards.
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_review'; v_route := null;
    end if;
    update public.requests set status = next_status, route = v_route,
      routed_by = me.id, routed_at = now(), updated_at = now() where id = r.id;
    perform public._log_action(r.id, me, 'sent_for_quote_selection', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

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
    r.status, next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $function$;

create or replace function public.withdraw_request(p_request_id uuid, p_remarks text default null::text)
 returns void language plpgsql security definer set search_path to '' as $function$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('submitted','pending_regional_review','returned') then
    raise exception 'A request can only be withdrawn before routing or while returned';
  end if;
  update public.requests set status = 'withdrawn', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'withdrawn', r.status, 'withdrawn', p_remarks, true);
end $function$;
