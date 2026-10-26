-- Migration 0047: Add stock_transfer to request_type enum
-- Note: A new enum value cannot be used in the same transaction that adds it,
-- so this statement lives in its own dedicated migration file.

alter type public.request_type add value if not exists 'stock_transfer';
