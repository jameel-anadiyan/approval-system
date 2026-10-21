-- 0030_head_dependent_categories_and_routing.sql
-- Makes work categories and clerk routing dynamically depend on the target Head selected for a request.

-- 1. Drop existing request_category_options signatures to avoid ambiguity
drop function if exists public.request_category_options();
drop function if exists public.request_category_options(uuid);
drop function if exists public.request_category_options(uuid, uuid);

-- 2. Update request_category_options to accept target_head_id or department_id
create or replace function public.request_category_options(
  p_target_head_id uuid default null,
  p_department_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
begin
  me := public._me();

  -- Prioritize explicitly supplied target Head
  if p_target_head_id is not null then
    select department_id into v_dept
    from public.profiles
    where id = p_target_head_id and role = 'head' and is_active;
  elsif p_department_id is not null then
    v_dept := p_department_id;
  elsif me.default_head_id is not null then
    select department_id into v_dept
    from public.profiles
    where id = me.default_head_id and role = 'head' and is_active;
  end if;

  if v_dept is null then
    v_dept := me.department_id;
  end if;

  if v_dept is null then
    return jsonb_build_object('required', false, 'categories', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'required', public._category_required(v_dept),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by lower(c.name))
        from public.work_categories c
       where c.department_id = v_dept and c.is_active
         and exists (select 1 from public.clerk_categories cc
                       join public.profiles p on p.id = cc.clerk_id and p.role = 'clerk' and p.is_active
                      where cc.category_id = c.id and p.department_id = v_dept)), '[]'::jsonb));
end $$;
revoke execute on function public.request_category_options(uuid, uuid) from public, anon;
grant execute on function public.request_category_options(uuid, uuid) to authenticated;


-- 3. Update set_request_target_head to clear category if it doesn't belong to the new head's department
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
  set owner_head_id = h.id,
      owner_head_name = h.full_name,
      department_id = h.department_id,
      category_id = case
        when exists (select 1 from public.work_categories where id = r.category_id and department_id = h.department_id and is_active) then r.category_id
        else null
      end,
      category_name = case
        when exists (select 1 from public.work_categories where id = r.category_id and department_id = h.department_id and is_active) then r.category_name
        else null
      end,
      updated_at = now()
  where id = r.id;
end $$;
revoke execute on function public.set_request_target_head(uuid, uuid) from public, anon;
grant execute on function public.set_request_target_head(uuid, uuid) to authenticated;


-- 4. Update can_view_request to ensure owner_head can view requests even across departments
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
        or (me.role in ('clerk','head') and (r.department_id = me.department_id or r.owner_head_id = me.id) and r.status <> 'draft')
        or (me.role = 'regional_head' and r.regional_head_id = me.id and r.status <> 'draft')
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;


-- 5. Update submit_request: ensure Regional Head check allows assigned Regional Head across departments
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

  -- Work category (only needed when several clerks split the target department's work).
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
    if me.regional_head_id is not null then
      select p.* into rh from public.profiles p
       where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active;
    end if;

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

  perform public._log_action(r.id, me, 'submitted', r.status, v_next, null, true);
  perform public.notify_next_actor(r.id, v_next);
end $function$;
revoke execute on function public.submit_request(uuid) from public, anon;
grant execute on function public.submit_request(uuid) to authenticated;
