-- 0035_set_user_region_rpc.sql
-- Dedicated RPC and RLS policies to reliably assign regions to Regional Heads & Heads.

-- 1. Ensure public.regions has universal select policy for all logged-in staff & anon
alter table public.regions enable row level security;
drop policy if exists "regions select" on public.regions;
drop policy if exists "regions select all" on public.regions;
create policy "regions select all" on public.regions for select using (true);
grant select on public.regions to authenticated, anon;

-- 2. Seed initial regions if not already present
insert into public.regions (name, code, is_active) values
  ('South Region', 'SOU', true),
  ('North Region', 'NOR', true),
  ('Central Region', 'CEN', true),
  ('Kerala Region', 'KER', true),
  ('UAE & GCC', 'GCC', true)
on conflict (code) do nothing;

-- 3. RPC to assign a region to a user (Admin or Department Head)
drop function if exists public.set_user_region(uuid, uuid);
create or replace function public.set_user_region(
  p_user_id uuid,
  p_region_id uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  u public.profiles;
begin
  me := public._me();
  select * into u from public.profiles where id = p_user_id;
  if u.id is null then raise exception 'User not found'; end if;

  if not (me.role = 'admin' or (me.role = 'head' and u.department_id = me.department_id)) then
    raise exception 'You do not have permission to assign regions to this user';
  end if;

  if p_region_id is not null and not exists (select 1 from public.regions where id = p_region_id) then
    raise exception 'Selected region does not exist';
  end if;

  update public.profiles
  set region_id = p_region_id, updated_at = now()
  where id = p_user_id;
end $$;

revoke execute on function public.set_user_region(uuid, uuid) from public, anon;
grant execute on function public.set_user_region(uuid, uuid) to authenticated;

-- 4. Allow Admins and Heads to update profiles (e.g. region_id)
drop policy if exists "profiles admin update" on public.profiles;
drop policy if exists "profiles update region" on public.profiles;
create policy "profiles update region" on public.profiles
  for update to authenticated
  using ((select public.my_role()) = 'admin' or (select public.my_role()) = 'head')
  with check ((select public.my_role()) = 'admin' or (select public.my_role()) = 'head');

grant select, update (region_id, updated_at) on public.profiles to authenticated;

notify pgrst, 'reload schema';
