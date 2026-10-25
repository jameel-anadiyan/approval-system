-- 0037_add_asset_below_20k_enum.sql
-- New request type: Asset buying below 20k (maximum amount 20,000 INR, minimum 1 bill or quote mandatory).
-- Own migration: a new enum value cannot be used in the same transaction that adds it.

alter type public.request_type add value if not exists 'asset_below_20k';
