-- 0035_set_user_region_rpc.sql
-- Dedicated RPC and RLS policies to reliably assign regions to Regional Heads & Heads.

-- 1. RPC to assign a region to a user (Admin only)
drop function if exists public.set_user_region(uuid, uuid);
create or replace function public.set_user_region(
  p_user_id uuid,
  p_region_id uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can assign regions to users';
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

-- 2. Allow Admins to directly update profiles (e.g. region_id)
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
  for update to authenticated
  using ((select public.my_role()) = 'admin')
  with check ((select public.my_role()) = 'admin');

-- 3. Ensure all authenticated users can read regions
grant select on public.regions to authenticated, anon;

notify pgrst, 'reload schema';
