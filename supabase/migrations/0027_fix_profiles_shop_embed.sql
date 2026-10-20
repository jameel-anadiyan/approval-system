-- Fix: with a composite primary key, PostgREST treated regional_head_shops (and clerk_categories)
-- as many-to-many junctions, which made the existing `profiles -> shops` embed
-- (`shop:shops(*)`, used at sign-in) ambiguous (PGRST201). A surrogate primary key
-- plus a unique index keeps the same data rules without creating the junction.
alter table public.regional_head_shops drop constraint if exists regional_head_shops_pkey;
alter table public.regional_head_shops add column if not exists id uuid not null default gen_random_uuid();
alter table public.regional_head_shops add primary key (id);
create unique index if not exists regional_head_shops_rh_shop_key
  on public.regional_head_shops (regional_head_id, shop_id);

alter table public.clerk_categories drop constraint if exists clerk_categories_pkey;
alter table public.clerk_categories add column if not exists id uuid not null default gen_random_uuid();
alter table public.clerk_categories add primary key (id);
create unique index if not exists clerk_categories_clerk_cat_key
  on public.clerk_categories (clerk_id, category_id);

notify pgrst, 'reload schema';
