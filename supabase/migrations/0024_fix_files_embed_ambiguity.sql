-- 0024_fix_files_embed_ambiguity.sql
-- 0022 added requests.selected_quote_id -> request_files(id). That gave PostgREST two relationships
-- between requests and request_files, so the app's `files:request_files(*)` embed failed (PGRST201)
-- and every request list came back empty. select_quote() already guarantees the quote belongs to
-- the request, so the foreign key is dropped.
alter table public.requests drop constraint if exists requests_selected_quote_id_fkey;
notify pgrst, 'reload schema';
