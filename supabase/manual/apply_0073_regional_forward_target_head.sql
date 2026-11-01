-- ============================================================================
-- apply_0073_regional_forward_target_head.sql
-- Run this script in Supabase SQL Editor to enable Regional Heads to select an
-- Admin-allowed Department Head when forwarding employee requests.
-- ============================================================================

-- 1. Ensure get_user_target_heads returns all Admin-allowed heads + default fallback
create or replace function public.get_user_target_heads(p_user_id uuid default null)
returns table (
  head_id uuid,
  head_name text,
  department_id uuid,
  department_name text,
  is_default boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.app_role;
  v_prof public.profiles;
begin
  v_uid := coalesce(p_user_id, auth.uid());
  select role into v_role from public.profiles where id = auth.uid();

  -- Callers can inspect their own allowed heads; heads/admins can inspect any user
  if auth.uid() is distinct from v_uid and v_role not in ('admin', 'head') then
    raise exception 'Not authorized to view heads for this user';
  end if;

  select * into v_prof from public.profiles where id = v_uid;
  if v_prof.id is null then
    return;
  end if;

  return query
  with candidate_heads as (
    select
      uh.head_id as hid,
      coalesce(uh.is_default, (v_prof.default_head_id = uh.head_id), false) as is_def
    from public.user_heads uh
    where uh.user_id = v_uid

    union all

    select
      v_prof.default_head_id as hid,
      true as is_def
    where v_prof.default_head_id is not null
      and not exists (
        select 1 from public.user_heads uh2
        where uh2.user_id = v_uid and uh2.head_id = v_prof.default_head_id
      )

    union all

    select
      dh.id as hid,
      true as is_def
    from public.profiles dh
    where dh.role = 'head'
      and dh.is_active
      and dh.department_id = v_prof.department_id
      and v_prof.default_head_id is null
      and not exists (
        select 1 from public.user_heads uh3
        where uh3.user_id = v_uid
      )
  )
  select
    h.id as head_id,
    h.full_name as head_name,
    h.department_id,
    coalesce(d.name, 'Department') as department_name,
    bool_or(ch.is_def) as is_default
  from candidate_heads ch
  join public.profiles h on h.id = ch.hid and h.role = 'head' and h.is_active
  left join public.departments d on d.id = h.department_id
  group by h.id, h.full_name, h.department_id, d.name
  order by (case when bool_or(ch.is_def) then 0 else 1 end), h.full_name;
end $$;

revoke execute on function public.get_user_target_heads(uuid) from public, anon;
grant execute on function public.get_user_target_heads(uuid) to authenticated;

-- 2. Replace regional_forward_request to support selecting an Admin-allowed target Head
drop function if exists public.regional_forward_request(uuid, text);
drop function if exists public.regional_forward_request(uuid, text, uuid, uuid);

create or replace function public.regional_forward_request(
  p_request_id uuid,
  p_remarks text default null,
  p_target_head_id uuid default null,
  p_category_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_target_head public.profiles;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_dept_id uuid;
  v_cat_id uuid;
  v_cat_name text;
  v_head_changed boolean := false;
  v_final_remarks text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then
    raise exception 'Not found';
  end if;
  if r.status <> 'pending_regional_review' then
    raise exception 'This request is not waiting for the Regional Head';
  end if;
  if not public._is_regional_actor(r, me) then
    raise exception 'Only the assigned Regional Head can forward this request';
  end if;

  v_owner_head_id := r.owner_head_id;
  v_owner_head_name := r.owner_head_name;
  v_dept_id := r.department_id;
  v_cat_id := r.category_id;
  v_cat_name := r.category_name;

  -- Allow redirecting non-exhibition requests to an Admin-allowed Department Head
  if p_target_head_id is not null and r.request_type <> 'exhibition'::public.request_type then
    if p_target_head_id is distinct from r.owner_head_id then
      select * into v_target_head
      from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;

      if v_target_head.id is null then
        raise exception 'Selected Department Head is invalid or inactive';
      end if;

      if me.role = 'regional_head' then
        if not (
          p_target_head_id = me.default_head_id
          or exists (
            select 1 from public.user_heads uh
            where uh.user_id = me.id and uh.head_id = p_target_head_id
          )
          or (
            me.default_head_id is null
            and v_target_head.department_id = me.department_id
            and not exists (select 1 from public.user_heads uh2 where uh2.user_id = me.id)
          )
        ) then
          raise exception 'You are not allowed to forward requests to this Department Head';
        end if;
      end if;

      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
      v_head_changed := true;
    end if;
  end if;

  -- Resolve work category for the target Department Head's department
  if p_category_id is not null and r.request_type <> 'exhibition'::public.request_type then
    select c.id, c.name into v_cat_id, v_cat_name
    from public.work_categories c
    where c.id = p_category_id
      and c.department_id = v_dept_id
      and c.is_active;

    if v_cat_id is null then
      raise exception 'Selected work category does not belong to the chosen Department Head''s department';
    end if;
  elsif v_cat_id is not null then
    if not exists (
      select 1 from public.work_categories c
      where c.id = v_cat_id and c.department_id = v_dept_id and c.is_active
    ) then
      v_cat_id := null;
      v_cat_name := null;
    end if;
  end if;

  if r.request_type <> 'exhibition'::public.request_type
     and public._category_required(v_dept_id)
     and v_cat_id is null then
    raise exception 'Select the work category for the chosen Department Head';
  end if;

  update public.requests
  set status = 'submitted'::public.request_status,
      owner_head_id = v_owner_head_id,
      owner_head_name = v_owner_head_name,
      department_id = v_dept_id,
      category_id = v_cat_id,
      category_name = v_cat_name,
      regional_forwarded_at = now(),
      updated_at = now()
  where id = r.id;

  if v_head_changed then
    if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
      v_final_remarks := '[Directed to ' || v_owner_head_name || '] ' || btrim(p_remarks);
    else
      v_final_remarks := 'Directed to ' || v_owner_head_name;
    end if;
  else
    v_final_remarks := nullif(btrim(coalesce(p_remarks, '')), '');
  end if;

  perform public._log_action(r.id, me, 'regional_forwarded', r.status, 'submitted', v_final_remarks, true);
  perform public.notify_next_actor(r.id, 'submitted'::public.request_status);
end $$;

revoke execute on function public.regional_forward_request(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.regional_forward_request(uuid, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
