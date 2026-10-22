-- 0034_regions_and_exhibition_rules.sql
-- 1. Region master (managed strictly by Admin, not Head).
-- 2. Regional Head assignment to a Region.
-- 3. Exhibition request conditions (quota & special waiting list).
-- 4. Head special waiting list tab access permission.

-- 1. Regions table -------------------------------------------------------------
create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 60),
  code text not null unique check (char_length(btrim(code)) between 2 and 10),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.regions enable row level security;

-- Region master read: all authenticated staff
drop policy if exists "regions select" on public.regions;
create policy "regions select" on public.regions for select to authenticated
  using (true);

-- Region master write: Admin only (Head cannot manage region master)
drop policy if exists "regions admin all" on public.regions;
create policy "regions admin all" on public.regions for all to authenticated
  using ((select public.my_role()) = 'admin')
  with check ((select public.my_role()) = 'admin');

-- 2. Profile additions --------------------------------------------------------
alter table public.profiles
  add column if not exists region_id uuid references public.regions(id) on delete set null,
  add column if not exists can_view_exhibition_waitlist boolean not null default false;

-- 3. Request additions --------------------------------------------------------
alter table public.requests
  add column if not exists region_id uuid references public.regions(id) on delete set null,
  add column if not exists region_name text,
  add column if not exists is_waitlist boolean not null default false,
  add column if not exists waitlist_approved_by uuid references public.profiles(id),
  add column if not exists waitlist_approved_at timestamptz;

create index if not exists requests_region_idx on public.requests(region_id);
create index if not exists requests_is_waitlist_idx on public.requests(is_waitlist) where is_waitlist is true;

-- 4. Seed initial regions if empty --------------------------------------------
insert into public.regions (name, code, is_active) values
  ('South Region', 'SOU', true),
  ('North Region', 'NOR', true),
  ('Central Region', 'CEN', true),
  ('Kerala Region', 'KER', true),
  ('UAE & GCC', 'GCC', true)
on conflict (code) do nothing;

-- 5. RPC to save/update a region (Admin only) ---------------------------------
drop function if exists public.save_region(uuid, text, text, boolean);
create or replace function public.save_region(
  p_id uuid default null,
  p_name text default null,
  p_code text default null,
  p_is_active boolean default true
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_id uuid;
  v_name text;
  v_code text;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can manage Region master';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  v_code := upper(btrim(coalesce(p_code, '')));

  if char_length(v_name) < 2 then raise exception 'Region name must be at least 2 characters'; end if;
  if char_length(v_code) < 2 or char_length(v_code) > 10 then raise exception 'Region code must be 2-10 characters'; end if;

  if p_id is not null then
    update public.regions
    set name = v_name, code = v_code, is_active = coalesce(p_is_active, true), updated_at = now()
    where id = p_id
    returning id into v_id;
  else
    insert into public.regions (name, code, is_active)
    values (v_name, v_code, coalesce(p_is_active, true))
    returning id into v_id;
  end if;

  return v_id;
end $$;
revoke execute on function public.save_region(uuid, text, text, boolean) from public, anon;
grant execute on function public.save_region(uuid, text, text, boolean) to authenticated;

-- 6. RPC to set a Head's access to Special Waiting List tab (Admin only) ------
drop function if exists public.set_exhibition_waitlist_access(uuid, boolean);
create or replace function public.set_exhibition_waitlist_access(
  p_user_id uuid,
  p_allowed boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  u public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can grant or revoke Special Waiting List tab access';
  end if;

  select * into u from public.profiles where id = p_user_id;
  if u.id is null then raise exception 'User not found'; end if;
  if u.role <> 'head' then raise exception 'Only Department Heads can receive Special Waiting List tab access'; end if;

  update public.profiles
  set can_view_exhibition_waitlist = coalesce(p_allowed, false), updated_at = now()
  where id = p_user_id;
end $$;
revoke execute on function public.set_exhibition_waitlist_access(uuid, boolean) from public, anon;
grant execute on function public.set_exhibition_waitlist_access(uuid, boolean) to authenticated;

-- 7. RPC to approve or reject exhibition waitlist (Head with access or Admin) -
drop function if exists public.decide_exhibition_waitlist(uuid, text, text);
create or replace function public.decide_exhibition_waitlist(
  p_request_id uuid,
  p_action text, -- 'approve' | 'reject'
  p_remarks text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
begin
  me := public._me();
  if not (me.role = 'admin' or (me.role = 'head' and me.can_view_exhibition_waitlist)) then
    raise exception 'You do not have permission to decide Special Waiting List exhibitions';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not r.is_waitlist then raise exception 'This request is not on the Special Waiting List'; end if;

  if p_action = 'approve' then
    update public.requests
    set waitlist_approved_by = me.id,
        waitlist_approved_at = now(),
        updated_at = now()
    where id = r.id;

    perform public._log_action(
      r.id, me, 'forwarded', r.status, r.status,
      coalesce(nullif(btrim(p_remarks), ''), 'Special Waiting List Exhibition approved by Head'),
      true
    );
  elsif p_action = 'reject' then
    update public.requests
    set status = 'rejected',
        decided_by = me.id,
        decided_at = now(),
        approver_role = me.role,
        updated_at = now()
    where id = r.id;

    perform public._log_action(
      r.id, me, 'rejected', r.status, 'rejected',
      coalesce(nullif(btrim(p_remarks), ''), 'Special Waiting List Exhibition rejected'),
      true
    );
  else
    raise exception 'Invalid action % (expected approve or reject)', p_action;
  end if;
end $$;
revoke execute on function public.decide_exhibition_waitlist(uuid, text, text) from public, anon;
grant execute on function public.decide_exhibition_waitlist(uuid, text, text) to authenticated;

-- 8. Visibility updates for waitlisted requests -------------------------------
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
        or (me.role = 'disbursement' and r.status in ('approved','paid','cancelled'))
        or exists (
          select 1 from public.head_consultations hc
          where hc.request_id = r.id and hc.head_id = me.id
        )
      )
  )
$function$;
revoke execute on function public.can_view_request(uuid) from public, anon;
grant execute on function public.can_view_request(uuid) to authenticated;

-- Update requests_select RLS policy
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
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type)))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

notify pgrst, 'reload schema';
