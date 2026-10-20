-- 0021_asset_type.sql
-- New request type: Asset buying (minimum 3 quotations; Head picks the best quote).
-- Own migration: a new enum value cannot be used in the same transaction that adds it.

alter type public.request_type add value if not exists 'asset';
