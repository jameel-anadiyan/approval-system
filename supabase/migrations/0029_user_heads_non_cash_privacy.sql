-- Migration 0029: User Heads, Non Cash request type, and Voice Privacy
-- ---------------------------------------------------------------------

-- 1. Table public.user_heads
create table if not exists public.user_heads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  head_id uuid not null references public.profiles(id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint user_heads_user_head_key unique (user_id, head_id)
);

create index if not exists user_heads_user_id_idx on public.user_heads(user_id);
create index if not exists user_heads_head_id_idx on public.user_heads(head_id);

alter table public.user_heads enable row level security;

drop policy if exists user_heads_select on public.user_heads;
create policy user_heads_select on public.user_heads for select to authenticated using (
  user_id = (select auth.uid())
  or head_id = (select auth.uid())
  or ((select public.my_role()) in ('admin'::public.app_role, 'head'::public.app_role, 'clerk'::public.app_role, 'regional_head'::public.app_role))
);

-- 2. Add default_head_id to profiles
alter table public.profiles
  add column if not exists default_head_id uuid references public.profiles(id) on delete set null;

-- 3. Backfill user_heads for existing employees and regional heads
insert into public.user_heads (user_id, head_id, is_default)
select distinct p.id, h.id, true
from public.profiles p
join public.profiles h on h.department_id = p.department_id and h.role = 'head' and h.is_active
where p.role in ('employee', 'regional_head')
on conflict (user_id, head_id) do update set is_default = true;

update public.profiles p
set default_head_id = h.id
from public.profiles h
where h.department_id = p.department_id and h.role = 'head' and h.is_active
  and p.role in ('employee', 'regional_head')
  and p.default_head_id is null;

-- 4. Allowed types update for non_cash
update public.profiles
set allowed_types = array_append(allowed_types, 'non_cash'::public.request_type)
where not ('non_cash'::public.request_type = any(allowed_types));

alter table public.profiles
  alter column allowed_types set default array[
    'general'::public.request_type,
    'discount'::public.request_type,
    'exhibition'::public.request_type,
    'asset'::public.request_type,
    'non_cash'::public.request_type
  ];

-- 4b. Update _build_details for non_cash
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_q1000 int; v_q500 int; v_other numeric; v_budget numeric; v_provides jsonb;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
begin
  if p_type = 'non_cash' then
    return jsonb_build_object(
      'amount', 0,
      'details', coalesce(d, '{}'::jsonb)
    );

  elsif p_type = 'general' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, false);
    v_base := public._num(d, 'base_amount');
    v_gen_gst := public._num(d, 'gst_amount');
    v_gen_rate := public._num(d, 'gst_rate');
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'base_amount', coalesce(v_base, round(p_amount, 2)),
        'has_gst', v_has_gst,
        'gst_rate', case when v_has_gst then coalesce(v_gen_rate, 18) else 0 end,
        'gst_amount', case when v_has_gst then coalesce(v_gen_gst, round(p_amount - coalesce(v_base, p_amount), 2)) else 0 end,
        'total_amount', round(p_amount, 2)
      ))
    );

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

  elsif p_type = 'asset' then
    if public._txt(d, 'asset_name') is null then raise exception 'Asset name is required'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the quotation amounts'; end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'asset_name', public._txt(d, 'asset_name', 200),
        'quantity', public._txt(d, 'quantity', 50),
        'specification', public._txt(d, 'specification', 1000),
        'purpose', public._txt(d, 'purpose', 1000))));

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
        'other_costs', v_other, 'total_budget', v_budget,
        'terms', public._txt(d, 'terms')));
  end if;
end $function$;


-- 5. RPC to get heads available for a user
create or replace function public.get_user_target_heads(p_user_id uuid default null)
returns table (
  head_id uuid,
  head_name text,
  department_id uuid,
  department_name text,
  is_default boolean
) language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_role public.app_role;
begin
  v_uid := coalesce(p_user_id, auth.uid());
  select role into v_role from public.profiles where id = auth.uid();

  -- Security check: callers can inspect their own heads, heads/admins can inspect any user
  if auth.uid() is distinct from v_uid and v_role not in ('admin', 'head') then
    raise exception 'Not authorized to view heads for this user';
  end if;

  return query
  select
    h.id as head_id,
    h.full_name as head_name,
    h.department_id,
    coalesce(d.name, 'Department') as department_name,
    coalesce(uh.is_default, (p.default_head_id = h.id), false) as is_default
  from public.user_heads uh
  join public.profiles h on h.id = uh.head_id and h.role = 'head' and h.is_active
  left join public.departments d on d.id = h.department_id
  join public.profiles p on p.id = uh.user_id
  where uh.user_id = v_uid
  order by (case when coalesce(uh.is_default, false) then 0 else 1 end), h.full_name;
end $$;
revoke execute on function public.get_user_target_heads(uuid) from public, anon;
grant execute on function public.get_user_target_heads(uuid) to authenticated;

-- 6. Trigger to maintain request owner_head and department
create or replace function public.set_request_owner_head()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_head public.profiles;
begin
  if new.owner_head_id is not null then
    select * into v_head from public.profiles where id = new.owner_head_id and role = 'head';
    if v_head.id is not null then
      new.owner_head_name := v_head.full_name;
      if new.department_id is null or new.department_id <> v_head.department_id then
        new.department_id := v_head.department_id;
      end if;
      return new;
    end if;
  end if;

  -- Fallback: lookup by department or requester
  select * into v_head
  from public.profiles
  where department_id = new.department_id
    and role = 'head'
    and is_active
  order by created_at desc
  limit 1;

  if v_head.id is not null then
    new.owner_head_id := v_head.id;
    new.owner_head_name := v_head.full_name;
  elsif new.requester_role = 'head' then
    new.owner_head_id := new.requester_id;
    new.owner_head_name := new.requester_name;
  end if;
  return new;
end $$;

-- 7. Update create_typed_draft to accept target_head_id and non_cash
drop function if exists public.create_typed_draft(public.request_type, text, numeric, text, jsonb);

create or replace function public.create_typed_draft(
  p_type public.request_type,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb,
  p_target_head_id uuid default null::uuid
)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  v jsonb;
  v_id uuid;
  v_title text;
  v_shop text;
  v_amount numeric;
  v_target_head public.profiles;
  v_dept_id uuid;
  v_owner_head_id uuid;
  v_owner_head_name text;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types)) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, p_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and p_type = 'asset' then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Determine target head and department
  if p_target_head_id is not null then
    select * into v_target_head from public.profiles
    where id = p_target_head_id and role = 'head' and is_active;
    if v_target_head.id is null then
      raise exception 'The selected Head is not active or not found';
    end if;
    v_dept_id := v_target_head.department_id;
    v_owner_head_id := v_target_head.id;
    v_owner_head_name := v_target_head.full_name;
  elsif me.default_head_id is not null then
    select * into v_target_head from public.profiles
    where id = me.default_head_id and role = 'head' and is_active;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  select name into v_shop from public.shops where id = me.shop_id;

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, me.shop_id, v_shop, case when p_type = 'non_cash' then p_details else v->'details' end,
    v_owner_head_id, v_owner_head_name
  )
  returning id into v_id;
  return v_id;
end $function$;
revoke execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) from public, anon;
grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;


-- 8. Update submit_request: allow amount = 0 for non_cash
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
  if r.request_type <> 'non_cash' and r.amount <= 0 then raise exception 'Amount must be more than zero'; end if;
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
       and (p.department_id = me.department_id or p.department_id = r.department_id);
    if rh.id is null and me.shop_id is not null then
      select count(*) into v_rh_count from public.profiles p
        join public.regional_head_shops s on s.regional_head_id = p.id
       where p.role = 'regional_head' and p.is_active
         and s.shop_id = me.shop_id;
      if v_rh_count = 1 then
        select p.* into rh from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active
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

-- 9. RPC to update draft target head
create or replace function public.set_request_target_head(p_request_id uuid, p_head_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  h public.profiles;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'Cannot change Head after submission'; end if;
  select * into h from public.profiles where id = p_head_id and role = 'head' and is_active;
  if h.id is null then raise exception 'Invalid or inactive Head'; end if;
  update public.requests
  set owner_head_id = h.id, owner_head_name = h.full_name, department_id = h.department_id, updated_at = now()
  where id = r.id;
end $$;
revoke execute on function public.set_request_target_head(uuid, uuid) from public, anon;
grant execute on function public.set_request_target_head(uuid, uuid) to authenticated;

-- 10. Update request_files_select policy:
-- Regional Heads can see documents + only their own or requester voice notes (NOT clerk, head, admin voice notes)
drop policy if exists request_files_select on public.request_files;
create policy request_files_select on public.request_files for select using (
  public.can_view_request(request_id) and (
    (((select public.my_role()) = 'disbursement'::public.app_role) and (clarification_id is not null))
    or (((select public.my_role()) = 'regional_head'::public.app_role) and (
        (kind <> 'voice_note'::public.file_kind)
        or (added_by is null)
        or (added_by = (select auth.uid()))
    ))
    or (((select public.my_role()) not in ('disbursement'::public.app_role, 'regional_head'::public.app_role)) and (
        (kind <> 'voice_note'::public.file_kind)
        or ((select public.my_role()) = any (array['admin'::public.app_role, 'head'::public.app_role, 'clerk'::public.app_role]))
        or (added_by is null)
        or (added_by = (select auth.uid()))
    ))
  )
);

-- 11. Update requests_select policy:
-- Disbursement only sees approved/paid requests of type OTHER THAN discount and non_cash
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
        and (regional_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type)))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

-- 12. Update notify_next_actor: exclude non_cash from disbursement
create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
 returns void language plpgsql security definer set search_path to '' as $function$
declare r public.requests; ids uuid[]; label text;
begin
  select * into r from public.requests where id = p_request_id;
  label := coalesce(r.request_no, 'Request') || ' - ' || r.title;
  if p_status = 'submitted' then
    select array_agg(u) into ids from unnest(public._clerk_ids_for(r.department_id, r.category_id)) u
     where u is not null;
    perform public._notify(ids, r.id, 'New request to route', label);
  elsif p_status = 'pending_regional_review' then
    if r.regional_head_id is not null then
      perform public._notify(array[r.regional_head_id], r.id, 'Request waiting for your review', label);
    end if;
  elsif p_status in ('pending_head_review','pending_head_approval') then
    select array_agg(id) into ids from public.profiles
     where (id = r.owner_head_id or (department_id = r.department_id and role = 'head')) and is_active;
    perform public._notify(ids, r.id,
      case when p_status = 'pending_head_review' then 'Request waiting for your review' else 'Request waiting for your approval' end,
      label);
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
        or (role = 'disbursement' and r.request_type not in ('discount', 'non_cash'))
        or (role in ('clerk','head') and (department_id = r.department_id or id = r.owner_head_id)));
    perform public._notify(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $function$;

-- 13. Ensure attach_action_voice has protective validation against 0-byte audio
create or replace function public.attach_action_voice(
  p_request_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_duration_sec numeric default null::numeric
)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; v_id uuid; n int; v_role text;
begin
  me := public._me();
  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'Audio recording is empty (0 bytes). Please re-record your voice note';
  end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_add_action_voice(r.id) then
    raise exception 'You cannot add a voice note now';
  end if;
  if public.storage_request_id(p_storage_path) is distinct from r.id then
    raise exception 'Bad file path';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'File was not uploaded';
  end if;
  if p_mime_type not like 'audio/%' then
    raise exception 'Voice notes must be audio';
  end if;
  select count(*) into n from public.request_files where request_id = r.id and added_by is not null;
  if n >= 15 then
    raise exception 'Too many approver voice notes on this request';
  end if;
  v_role := case me.role
    when 'clerk' then 'Clerk'
    when 'head' then 'Head'
    when 'regional_head' then 'Regional Head'
    when 'disbursement' then 'Disbursement'
    else 'Admin' end;
  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    duration_sec, sort_order, added_by, added_by_name, added_by_role
  )
  values (
    r.id, 'voice_note', p_storage_path, left('Voice note – ' || me.full_name || ' (' || v_role || ')', 255),
    p_mime_type, p_size_bytes, p_duration_sec, 100 + n, me.id, me.full_name, me.role
  )
  returning id into v_id;
  return v_id;
end $function$;

-- 14. RPC to save user assigned heads and default head
create or replace function public.save_user_heads(
  p_user_id uuid,
  p_head_ids uuid[],
  p_default_head_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target_user public.profiles;
  hid uuid;
begin
  caller := public._me();
  if caller.role not in ('admin', 'head') then
    raise exception 'Only Admin or Head can configure assigned heads';
  end if;

  select * into target_user from public.profiles where id = p_user_id;
  if target_user.id is null then raise exception 'User not found'; end if;

  -- Delete old associations
  delete from public.user_heads where user_id = p_user_id;

  -- Insert new associations
  if p_head_ids is not null then
    foreach hid in array p_head_ids loop
      if exists (select 1 from public.profiles where id = hid and role = 'head' and is_active) then
        insert into public.user_heads (user_id, head_id, is_default)
        values (p_user_id, hid, (hid = p_default_head_id))
        on conflict (user_id, head_id) do update set is_default = (hid = p_default_head_id);
      end if;
    end loop;
  end if;

  -- Update default_head_id on profile
  update public.profiles
  set default_head_id = p_default_head_id, updated_at = now()
  where id = p_user_id;
end $$;
revoke execute on function public.save_user_heads(uuid, uuid[], uuid) from public, anon;
grant execute on function public.save_user_heads(uuid, uuid[], uuid) to authenticated;

