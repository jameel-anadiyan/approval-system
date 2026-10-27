-- ============================================================================
-- 0049_request_shop_and_stock_transfer_monitor.sql
--
-- A. Shop on General & Non-Cash requests
--    - A user's "associated shops" = their own shop + the shops they cover as Regional Head.
--    - Exactly one associated shop  -> that shop is assigned automatically.
--    - More than one                -> the requester must pick one (validated server-side).
--    - None                         -> optional pick from any active shop.
--    - The chosen shop is saved on requests.shop_id / shop_name, so every panel,
--      list, approval PDF and verify page shows it.
--    - Existing General / Non-Cash requests with a blank shop are back-filled
--      when the requester has exactly one associated shop.
--
-- B. Stock Transfer Monitor (new Disbursement account type)
--    - disbursement_type = 'stock_transfer_monitor'
--    - Sees ONLY approved Stock Transfer requests (no payable requests).
--    - Marks a transfer as "Transfer Completed" (requests.transfer_completed_*).
--    - Can never create payment entries / record payments.
--
-- C. Stock Transfer Report
--    - Admin and Stock Transfer Monitor always; any other user when Admin grants
--      profiles.can_view_stock_transfer_report (same pattern as the Discount Report).
-- ============================================================================

-- ───────────────────────── A1. Associated shops helpers ─────────────────────

create or replace function public._user_shop_ids(p_user_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.shop_id), '{}'::uuid[])
  from (
    select p.shop_id from public.profiles p where p.id = p_user_id and p.shop_id is not null
    union
    select rhs.shop_id from public.regional_head_shops rhs where rhs.regional_head_id = p_user_id
  ) x
  join public.shops s on s.id = x.shop_id and s.is_active;
$$;
revoke execute on function public._user_shop_ids(uuid) from public, anon, authenticated;

-- Shops the signed-in user can raise a General / Non-Cash request for.
-- associated = true  -> user's own / covered shops (pick one when more than one)
-- associated = false -> user has no associated shop; any active shop may be chosen (optional)
create or replace function public.my_request_shops()
returns table (id uuid, name text, code text, associated boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then return; end if;
  v_ids := public._user_shop_ids(auth.uid());
  if cardinality(v_ids) > 0 then
    return query
      select s.id, s.name, s.code, true
        from public.shops s
       where s.id = any(v_ids)
       order by s.name;
  else
    return query
      select s.id, s.name, s.code, false
        from public.shops s
       where s.is_active
       order by s.name;
  end if;
end $$;
revoke execute on function public.my_request_shops() from public, anon;
grant execute on function public.my_request_shops() to authenticated;

-- Pick the shop for a General / Non-Cash request from the requester's choice.
create or replace function public._resolve_request_shop(p_user public.profiles, p_details jsonb)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_pick uuid;
begin
  v_ids := public._user_shop_ids(p_user.id);

  if p_details is not null and (p_details->>'shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_pick := (p_details->>'shop_id')::uuid;
  end if;

  if v_pick is not null then
    if cardinality(v_ids) > 0 and not (v_pick = any(v_ids)) then
      raise exception 'The selected shop is not assigned to you';
    end if;
    if cardinality(v_ids) = 0 and not exists (select 1 from public.shops s where s.id = v_pick and s.is_active) then
      raise exception 'The selected shop is not available';
    end if;
    return v_pick;
  end if;

  if cardinality(v_ids) = 1 then
    return v_ids[1];
  end if;

  -- Several shops and none picked yet (allowed for drafts; submit enforces it), or no shop at all.
  return null;
end $$;
revoke execute on function public._resolve_request_shop(public.profiles, jsonb) from public, anon, authenticated;

-- ───────────────────────── A2. create_typed_draft ───────────────────────────

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
  v_shop_id uuid;
  v_amount numeric;
  v_target_head public.profiles;
  v_dept_id uuid;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_region_id uuid;
  v_region_name text;
  v_is_waitlist boolean;
  v_clean_details jsonb;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types) or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  -- The shop choice travels inside p_details; never store it in the typed details.
  v_clean_details := coalesce(p_details, '{}'::jsonb) - 'shop_id' - 'shop_name';

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, v_clean_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  if p_type = 'asset_below_20k' and v_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing rules:
  -- For exhibition requests: STRICTLY to Main Head only, NO choosing.
  if p_type = 'exhibition' then
    if me.default_head_id is not null then
      select * into v_target_head from public.profiles
      where id = me.default_head_id and role = 'head' and is_active;
    end if;
    if v_target_head.id is null and me.department_id is not null then
      select * into v_target_head from public.profiles
      where department_id = me.department_id and role = 'head' and is_active limit 1;
    end if;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  elsif p_target_head_id is not null then
    select * into v_target_head from public.profiles
    where id = p_target_head_id and role = 'head' and is_active;
    if v_target_head.id is null then raise exception 'The selected Head is not active or not found'; end if;
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

  -- Shop assignment
  if p_type in ('general', 'non_cash') then
    v_shop_id := public._resolve_request_shop(me, p_details);
  else
    v_shop_id := me.shop_id;
  end if;
  select name into v_shop from public.shops where id = v_shop_id;

  if p_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_region_id := null;
  v_region_name := null;
  v_is_waitlist := false;
  if p_type = 'exhibition' then
    v_region_id := coalesce(
      me.region_id,
      (select p.region_id from public.profiles p where p.id = me.regional_head_id),
      case when p_details ? 'region_id' and p_details->>'region_id' ~ '^[0-9a-fA-F-]{36}$'
           then (p_details->>'region_id')::uuid else null end
    );
    if v_region_id is not null then
      select name into v_region_name from public.regions where id = v_region_id;
    end if;
    v_is_waitlist := coalesce((p_details->>'is_waitlist')::boolean, false);
  end if;

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, v_shop_id, v_shop, case when p_type = 'non_cash' then v_clean_details else v->'details' end,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist
  )
  returning id into v_id;
  return v_id;
end $function$;

-- ───────────────────────── A3. update_typed_draft ───────────────────────────
-- Also fixes editing Non-Cash drafts (they have no typed details to build).

create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
  v_shop_id uuid;
  v_shop_name text;
  v_clean_details jsonb;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;

  v_clean_details := case when p_details is null then null else p_details - 'shop_id' - 'shop_name' end;

  if r.request_type <> 'non_cash' then
    v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(v_clean_details, r.details));
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;

  if r.request_type in ('general', 'non_cash') and p_details is not null and p_details ? 'shop_id' then
    v_shop_id := public._resolve_request_shop(me, p_details);
    select name into v_shop_name from public.shops where id = v_shop_id;
  elsif r.request_type in ('general', 'non_cash') and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = case when r.request_type = 'non_cash' then coalesce(v_clean_details, r.details) else v->'details' end,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    updated_at = now()
  where id = r.id;
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

-- ───────────────────────── A4. submit_request (shop check) ──────────────────

create or replace function public.submit_request(p_request_id uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; rh public.profiles; v_no text; n int; v_rh_count int;
  v_next public.request_status; v_cat_ok boolean; v_shop_ids uuid[];
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request cannot be submitted'; end if;

  -- Requester profile must be complete (shop required for employee unless stock transfer specifies it)
  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  -- General / Non-Cash: one associated shop is auto-assigned; several need a choice.
  if r.request_type in ('general', 'non_cash') and r.shop_id is null then
    v_shop_ids := public._user_shop_ids(me.id);
    if cardinality(v_shop_ids) = 1 then
      update public.requests
         set shop_id = v_shop_ids[1],
             shop_name = (select s.name from public.shops s where s.id = v_shop_ids[1])
       where id = r.id;
      r.shop_id := v_shop_ids[1];
    elsif cardinality(v_shop_ids) > 1 then
      raise exception 'Select the shop for this request (you are assigned to more than one shop)';
    end if;
  end if;

  -- Title and amount sanity (non_cash and stock_transfer are exempt from monetary payment requirement)
  if r.request_type not in ('non_cash', 'stock_transfer') and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if not (r.request_type = any(me.allowed_types) or (r.request_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
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
  -- Department Head requests bypass clerk routing completely.
  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role <> 'head' and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  -- Asset Buying (regular): min 2 bills or quotations
  if r.request_type = 'asset' then
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 2 then raise exception 'Attach at least 2 bills or quotations, each with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  -- Asset Buying Below 20k: amount max 20000, min 1 bill or quotation
  if r.request_type = 'asset_below_20k' then
    if r.amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount'; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  -- Routing target for employees: check Regional Head
  if me.role = 'employee' then
    if me.regional_head_id is not null then
      select * into rh from public.profiles p
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
    v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;
  else
    v_next := 'submitted';
  end if;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

  if me.role = 'head' then
    update public.requests set
      status = 'pending_admin_approval',
      request_no = v_no,
      route = 'A',
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'submitted', r.status, 'pending_admin_approval',
      'Department Head request routed directly to Admin for approval', true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
  else
    update public.requests set
      status = v_next,
      request_no = v_no,
      route = null,
      routed_by = null,
      routed_at = null,
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = rh.id,
      regional_head_name = rh.full_name,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'submitted', r.status, v_next, null, true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

-- ───────────────────────── A5. Back-fill blank shops ────────────────────────

update public.requests r
   set shop_name = s.name
  from public.shops s
 where s.id = r.shop_id
   and r.shop_name is null;

update public.requests r
   set shop_id = x.ids[1],
       shop_name = (select s.name from public.shops s where s.id = x.ids[1])
  from (
    select p.id as user_id, public._user_shop_ids(p.id) as ids
      from public.profiles p
  ) x
 where x.user_id = r.requester_id
   and r.request_type in ('general', 'non_cash')
   and r.shop_id is null
   and cardinality(x.ids) = 1;

-- ───────────────────────── B1. Stock Transfer Monitor account type ──────────

do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
     where con.conrelid = 'public.profiles'::regclass
       and con.contype = 'c'
       and att.attname = 'disbursement_type'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_disbursement_type_check
  check (disbursement_type is null or disbursement_type in ('entry_only', 'payment_only', 'stock_transfer_monitor'));

create or replace function public.my_disbursement_type()
returns text language sql stable security definer set search_path = '' as $$
  select disbursement_type from public.profiles where id = auth.uid() and is_active
$$;
revoke execute on function public.my_disbursement_type() from public, anon;
grant execute on function public.my_disbursement_type() to authenticated;

create or replace function public.set_user_disbursement_type(
  p_user_id uuid,
  p_type text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can set disbursement account type'; end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;
  if target.role <> 'disbursement' then raise exception 'User is not a disbursement account'; end if;
  if p_type is not null and p_type not in ('entry_only', 'payment_only', 'stock_transfer_monitor') then
    raise exception 'Invalid disbursement type. Must be entry_only, payment_only or stock_transfer_monitor';
  end if;

  update public.profiles set disbursement_type = p_type, updated_at = now() where id = p_user_id;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name, 'disbursement_type_changed', 'user', target.id::text,
          jsonb_build_object('username', target.username, 'from', target.disbursement_type, 'to', p_type));

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'disbursement_type', p_type);
end $$;
revoke execute on function public.set_user_disbursement_type(uuid, text) from public, anon;
grant execute on function public.set_user_disbursement_type(uuid, text) to authenticated;

-- Monitor accounts can never move money, even through SECURITY DEFINER RPCs.
create or replace function public._block_stock_monitor_money()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'disbursement' and p.disbursement_type = 'stock_transfer_monitor'
  ) then
    raise exception 'Stock Transfer Monitor accounts cannot create payment entries, record payments or raise disbursement queries';
  end if;
  return new;
end $$;

drop trigger if exists block_stock_monitor_payments on public.request_payments;
create trigger block_stock_monitor_payments
  before insert on public.request_payments
  for each row execute function public._block_stock_monitor_money();

drop trigger if exists block_stock_monitor_entries on public.disbursement_entries;
create trigger block_stock_monitor_entries
  before insert on public.disbursement_entries
  for each row execute function public._block_stock_monitor_money();

drop trigger if exists block_stock_monitor_clarifications on public.disbursement_clarifications;
create trigger block_stock_monitor_clarifications
  before insert on public.disbursement_clarifications
  for each row execute function public._block_stock_monitor_money();

-- ───────────────────────── B2. Transfer completion columns ──────────────────

alter table public.requests
  add column if not exists transfer_completed_at timestamptz,
  add column if not exists transfer_completed_by uuid references public.profiles(id),
  add column if not exists transfer_completed_by_name text,
  add column if not exists transfer_completed_remarks text
    check (transfer_completed_remarks is null or char_length(transfer_completed_remarks) <= 500);

create index if not exists requests_stock_transfer_monitor_idx
  on public.requests (request_type, status, transfer_completed_at)
  where request_type = 'stock_transfer';

-- ───────────────────────── B3. Visibility (RLS + can_view_request) ──────────

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and (owner_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.can_view_exhibition_waitlist)
        and is_waitlist and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status or requester_id = (select auth.uid())))
    -- Entry Only / Payment Only accounts: payable approvals
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and coalesce((select public.my_disbursement_type()), '') <> 'stock_transfer_monitor'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type)))
    -- Stock Transfer Monitor accounts: approved stock transfers only
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'stock_transfer_monitor'
        and request_type = 'stock_transfer'::public.request_type
        and status = 'approved'::public.request_status)
    or (request_type = 'exhibition'::public.request_type and status not in ('rejected'::public.request_status, 'withdrawn'::public.request_status, 'cancelled'::public.request_status))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

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
        or (me.role = 'head' and me.can_view_exhibition_waitlist and r.is_waitlist and r.status <> 'draft')
        or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.requester_id = me.id) and (r.status <> 'draft' or r.requester_id = me.id))
        or (me.role = 'disbursement' and coalesce(me.disbursement_type, '') <> 'stock_transfer_monitor'
            and r.status in ('approved','paid','cancelled') and r.request_type not in ('discount', 'non_cash', 'stock_transfer'))
        or (me.role = 'disbursement' and me.disbursement_type = 'stock_transfer_monitor'
            and r.request_type = 'stock_transfer' and r.status = 'approved')
        or (r.request_type = 'exhibition' and r.status not in ('rejected', 'withdrawn', 'cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;

-- ───────────────────────── B4. Mark transfer complete ───────────────────────

create or replace function public.mark_stock_transfer_complete(
  p_request_id uuid,
  p_remarks text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_ids uuid[];
begin
  me := public._me();
  if not (me.role = 'admin' or (me.role = 'disbursement' and me.disbursement_type = 'stock_transfer_monitor')) then
    raise exception 'Only a Stock Transfer Monitor account or Admin can mark transfers complete';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type <> 'stock_transfer' then raise exception 'Stock transfer not found'; end if;
  if r.status <> 'approved' then raise exception 'Only approved stock transfers can be marked complete'; end if;
  if r.transfer_completed_at is not null then
    raise exception 'This transfer was already marked complete by % on %',
      coalesce(r.transfer_completed_by_name, 'someone'),
      to_char(r.transfer_completed_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM');
  end if;

  update public.requests set
    transfer_completed_at = now(),
    transfer_completed_by = me.id,
    transfer_completed_by_name = me.full_name,
    transfer_completed_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
    updated_at = now()
  where id = r.id;

  perform public._log_action(
    r.id, me, 'transfer_completed', r.status, r.status,
    coalesce(nullif(btrim(coalesce(p_remarks, '')), ''), 'Stock transfer marked as completed'),
    true
  );

  select array_agg(distinct u) into v_ids
    from unnest(array[r.requester_id, r.owner_head_id, r.regional_head_id]) u
   where u is not null;
  perform public._notify(
    v_ids, r.id, 'Stock transfer completed',
    coalesce(r.approval_no, r.request_no, 'Request') || ' - ' || r.title
  );

  return jsonb_build_object('success', true, 'request_id', r.id, 'completed_at', now());
end $$;
revoke execute on function public.mark_stock_transfer_complete(uuid, text) from public, anon;
grant execute on function public.mark_stock_transfer_complete(uuid, text) to authenticated;

-- ───────────────────────── B5. Notifications on approval ────────────────────

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
    select array_agg(distinct u) into ids
    from unnest(array[r.requester_id, r.regional_head_id]) u
    where u is not null;
    perform public._notify(ids, r.id, 'Returned for correction', label);
  elsif p_status = 'rejected' then
    perform public._notify(array[r.requester_id], r.id, 'Request rejected', label);
  elsif p_status = 'approved' then
    select array_agg(id) into ids from public.profiles
      where is_active and (
        id = r.requester_id
        or id = r.regional_head_id
        or (role = 'disbursement'
            and coalesce(disbursement_type, '') <> 'stock_transfer_monitor'
            and r.request_type not in ('discount', 'non_cash', 'stock_transfer'))
        or (role = 'disbursement'
            and disbursement_type = 'stock_transfer_monitor'
            and r.request_type = 'stock_transfer')
        or (role in ('clerk','head') and (department_id = r.department_id or id = r.owner_head_id)));
    perform public._notify(ids, r.id,
      case when r.request_type = 'stock_transfer' then 'Stock transfer approved - ' else 'Approved - ' end
        || coalesce(r.approval_no, ''),
      label);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $function$;

-- ───────────────────────── C. Stock Transfer Report ─────────────────────────

alter table public.profiles
  add column if not exists can_view_stock_transfer_report boolean not null default false;

create or replace function public.set_stock_transfer_report_access(p_user_id uuid, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; t public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can grant report access'; end if;
  select * into t from public.profiles where id = p_user_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role = 'admin' then raise exception 'Admin always has access to the Stock Transfer Report'; end if;
  update public.profiles set can_view_stock_transfer_report = coalesce(p_allowed, false), updated_at = now()
   where id = t.id;
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name,
          case when p_allowed then 'stock_transfer_report_granted' else 'stock_transfer_report_revoked' end,
          'user', t.id::text, jsonb_build_object('username', t.username));
end $$;
revoke execute on function public.set_stock_transfer_report_access(uuid, boolean) from public, anon;
grant execute on function public.set_stock_transfer_report_access(uuid, boolean) to authenticated;

-- One row per submitted stock transfer (drafts excluded) in the date window (by submitted date)
create or replace function public.stock_transfer_report(p_from date default null, p_to date default null)
returns table (
  id uuid, request_no text, approval_no text, title text, status public.request_status,
  requester_id uuid, requester_name text, department_id uuid, department_name text, approver_name text,
  submitted_at timestamptz, decided_at timestamptz,
  from_shop_id text, from_shop_name text, to_shop_id text, to_shop_name text,
  transfer_mode text, pieces integer, gross_weight numeric, total_mrp numeric,
  transfer_completed_at timestamptz, transfer_completed_by_name text, transfer_completed_remarks text,
  details jsonb
) language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := public._me();
  if not (
    me.role = 'admin'
    or (me.role = 'disbursement' and me.disbursement_type = 'stock_transfer_monitor')
    or coalesce(me.can_view_stock_transfer_report, false)
  ) then
    raise exception 'You do not have access to the stock transfer report' using errcode = '42501';
  end if;
  return query
    select r.id, r.request_no, r.approval_no, r.title, r.status,
           r.requester_id, r.requester_name, r.department_id, d.name, r.approver_name,
           r.submitted_at, r.decided_at,
           r.details->>'from_shop_id', coalesce(fs.name, r.details->>'from_shop_name', 'Unknown shop'),
           r.details->>'to_shop_id', coalesce(ts.name, r.details->>'to_shop_name', 'Unknown shop'),
           coalesce(r.details->>'transfer_mode', 'itemized'),
           coalesce(nullif(r.details->>'total_pieces', '')::numeric, nullif(r.details->>'pieces_count', '')::numeric, 0)::integer,
           coalesce(nullif(r.details->>'total_gross_weight', '')::numeric, 0),
           coalesce(nullif(r.details->>'total_mrp', '')::numeric, r.amount, 0),
           r.transfer_completed_at, r.transfer_completed_by_name, r.transfer_completed_remarks,
           r.details
      from public.requests r
      left join public.departments d on d.id = r.department_id
      left join public.shops fs on fs.id::text = r.details->>'from_shop_id'
      left join public.shops ts on ts.id::text = r.details->>'to_shop_id'
     where r.request_type = 'stock_transfer'
       and r.status <> 'draft'
       and (p_from is null or r.submitted_at >= p_from::timestamptz)
       and (p_to is null or r.submitted_at < (p_to + 1)::timestamptz)
     order by r.submitted_at desc nulls last;
end $$;
revoke execute on function public.stock_transfer_report(date, date) from public, anon;
grant execute on function public.stock_transfer_report(date, date) to authenticated;

notify pgrst, 'reload schema';
