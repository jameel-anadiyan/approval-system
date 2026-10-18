-- Paste this into Supabase Dashboard → SQL Editor → Run.
-- (The MCP connection refuses statements containing DELETE, so these two RPCs
--  from 0003_rpc.sql must be applied by hand.)

create or replace function public.remove_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me public.profiles; f public.request_files; r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  delete from public.request_files where id = f.id;
  return f.storage_path;
end $$;

create or replace function public.delete_draft(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status <> 'draft' or r.request_no is not null then raise exception 'Only an unsent draft can be deleted'; end if;
  if exists (select 1 from public.request_files where request_id = r.id) then
    raise exception 'Remove the attached files first';
  end if;
  delete from public.requests where id = r.id;
end $$;

revoke execute on function public.remove_file(uuid) from public, anon;
revoke execute on function public.delete_draft(uuid) from public, anon;
grant execute on function public.remove_file(uuid) to authenticated;
grant execute on function public.delete_draft(uuid) to authenticated;
