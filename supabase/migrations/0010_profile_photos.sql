-- 0010 — Employee profile photos
-- Photos live in the private `profile-photos` bucket; uploads go through the
-- admin-users Edge Function (service role). Any signed-in staff member may view
-- photos so the requester's face appears on every request.

alter table public.profiles add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('profile-photos', 'profile-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile-photos read" on storage.objects;
create policy "profile-photos read" on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and (select public.my_role()) is not null);

-- Photo paths for a set of users (profiles RLS hides most rows from non-admins).
create or replace function public.get_profile_photos(p_ids uuid[])
returns table (id uuid, photo_path text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.photo_path
  from public.profiles p
  where p.id = any(p_ids)
    and p.photo_path is not null
    and public.my_role() is not null
$$;
revoke all on function public.get_profile_photos(uuid[]) from public, anon;
grant execute on function public.get_profile_photos(uuid[]) to authenticated;

-- Allow all authenticated staff to select profiles so requester details and photo are visible on requests.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.my_role()) is not null);

