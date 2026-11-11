-- Migration 0094: Enable Petty Cash for all Employees, Regional Heads, and Department Heads
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Update all existing profiles (employee, regional_head, head) so 'petty_cash' is ticked/enabled in allowed_types.
-- 2. Alter column default for allowed_types to array['general', 'petty_cash'].
-- 3. Extend set_department_special_request_access to support toggling 'petty_cash'.

-- 1. Add 'petty_cash' to allowed_types for all employee, regional_head, and head profiles
update public.profiles
   set allowed_types = case
     when allowed_types is null or coalesce(array_length(allowed_types, 1), 0) = 0 then
       array['general'::public.request_type, 'petty_cash'::public.request_type]
     when not ('petty_cash'::public.request_type = any(allowed_types)) then
       array_append(allowed_types, 'petty_cash'::public.request_type)
     else
       allowed_types
   end,
   updated_at = now()
 where role in ('employee', 'regional_head', 'head')
   and (allowed_types is null or not ('petty_cash'::public.request_type = any(allowed_types)));

-- 2. Alter default for allowed_types to include general and petty_cash
alter table public.profiles
  alter column allowed_types set default array['general'::public.request_type, 'petty_cash'::public.request_type];

-- 3. Update set_department_special_request_access to support 'petty_cash'
create or replace function public.set_department_special_request_access(
  p_head_id uuid,
  p_request_type text,
  p_enabled boolean,
  p_include_related_staff boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  v_head public.profiles;
  v_type text := lower(btrim(coalesce(p_request_type, '')));
  v_updated_count int := 0;
  rec record;
  v_next text[];
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can toggle department request access';
  end if;

  if v_type not in ('agreement', 'statutory_payment', 'audit_report', 'petty_cash') then
    raise exception 'Invalid request type: %', v_type;
  end if;

  select * into v_head from public.profiles where id = p_head_id and role = 'head';
  if v_head.id is null then
    raise exception 'Department Head not found';
  end if;

  for rec in
    select p.id, coalesce(p.allowed_types::text[], array['general', 'petty_cash']::text[]) as cur_types
      from public.profiles p
     where p.id = v_head.id
        or (
          coalesce(p_include_related_staff, true)
          and p.role in ('clerk', 'employee', 'regional_head')
          and (
            (v_head.department_id is not null and p.department_id = v_head.department_id)
            or p.default_head_id = v_head.id
            or exists (
              select 1 from public.user_heads uh
              where uh.user_id = p.id
                and uh.head_id = v_head.id
                and uh.is_default = true
            )
          )
        )
  loop
    if coalesce(p_enabled, false) then
      if v_type = any(rec.cur_types) then
        v_next := rec.cur_types;
      else
        v_next := array_append(rec.cur_types, v_type);
      end if;
    else
      v_next := array_remove(rec.cur_types, v_type);
      if coalesce(array_length(v_next, 1), 0) = 0 then
        v_next := array['general'];
      end if;
    end if;

    update public.profiles
       set allowed_types = v_next::public.request_type[],
           updated_at = now()
     where id = rec.id;

    v_updated_count := v_updated_count + 1;
  end loop;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    'department_request_type_toggled',
    'user',
    v_head.id::text,
    jsonb_build_object(
      'head_name', v_head.full_name,
      'request_type', v_type,
      'enabled', coalesce(p_enabled, false),
      'include_related_staff', coalesce(p_include_related_staff, true),
      'updated_users', v_updated_count
    )
  );

  return jsonb_build_object(
    'success', true,
    'head_id', v_head.id,
    'request_type', v_type,
    'enabled', coalesce(p_enabled, false),
    'updated_users', v_updated_count
  );
end $$;

revoke execute on function public.set_department_special_request_access(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.set_department_special_request_access(uuid, text, boolean, boolean) to authenticated;

