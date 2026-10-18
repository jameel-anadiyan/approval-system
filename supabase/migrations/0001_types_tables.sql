-- 0001 — Types and tables (see docs/PLAN.md "Database design")

create type public.app_role as enum ('admin','head','clerk','employee','disbursement');
create type public.request_status as enum ('draft','submitted','returned',
  'pending_head_approval','pending_head_review','pending_admin_approval',
  'approving','approved','rejected','paid','withdrawn');
create type public.approval_route as enum ('A','B');
create type public.file_kind as enum ('document','voice_note');

-- departments ---------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  code text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- profiles ------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name text not null check (char_length(full_name) between 1 and 100),
  designation text check (designation is null or char_length(designation) <= 100),
  role public.app_role not null,
  department_id uuid references public.departments(id),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_department_by_role check (
    (role in ('head','clerk','employee')) = (department_id is not null)
  )
);
create unique index profiles_one_active_head on public.profiles(department_id)
  where role = 'head' and is_active;
create index profiles_department_idx on public.profiles(department_id);

-- approver_credentials ------------------------------------------------------
create table public.approver_credentials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  seal_path text,
  signature_path text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- requests ------------------------------------------------------------------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique,
  requester_id uuid not null references public.profiles(id),
  requester_name text not null,
  requester_role public.app_role not null,
  department_id uuid not null references public.departments(id),
  title text not null check (char_length(title) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  amount numeric(14,2) not null check (amount > 0),
  status public.request_status not null default 'draft',
  route public.approval_route,
  routed_by uuid references public.profiles(id),
  routed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  approval_no text unique,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  approver_role public.app_role,
  approver_name text,
  verify_token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  approving_by uuid references public.profiles(id),
  approving_started_at timestamptz,
  status_before_approving public.request_status,
  last_error text,
  paid_by uuid references public.profiles(id),
  paid_at timestamptz,
  payment_date date,
  payment_mode text check (payment_mode is null or char_length(payment_mode) <= 50),
  payment_ref text check (payment_ref is null or char_length(payment_ref) <= 100),
  payment_remarks text check (payment_remarks is null or char_length(payment_remarks) <= 500),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_requester_idx on public.requests(requester_id);
create index requests_department_status_idx on public.requests(department_id, status);
create index requests_status_idx on public.requests(status);
create index requests_routed_by_idx on public.requests(routed_by);
create index requests_reviewed_by_idx on public.requests(reviewed_by);
create index requests_decided_by_idx on public.requests(decided_by);
create index requests_approving_by_idx on public.requests(approving_by);
create index requests_paid_by_idx on public.requests(paid_by);

-- request_files -------------------------------------------------------------
create table public.request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  kind public.file_kind not null,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) <= 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  page_count int check (page_count is null or page_count > 0),
  duration_sec numeric(8,2) check (duration_sec is null or duration_sec <= 305),
  sha256 text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index request_files_request_idx on public.request_files(request_id);

-- signed_files --------------------------------------------------------------
create table public.signed_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  source_file_id uuid references public.request_files(id) on delete set null,
  is_packet boolean not null default false,
  file_name text not null,
  storage_path text not null unique,
  sha256 text not null,
  page_count int not null,
  created_at timestamptz not null default now()
);
create index signed_files_request_idx on public.signed_files(request_id);
create index signed_files_source_idx on public.signed_files(source_file_id);

-- request_actions (append-only timeline) -----------------------------------
create table public.request_actions (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  actor_name text not null,
  actor_role public.app_role,
  action text not null,
  from_status public.request_status,
  to_status public.request_status,
  remarks text,
  visible_to_requester boolean not null default true,
  created_at timestamptz not null default now()
);
create index request_actions_request_idx on public.request_actions(request_id, created_at);
create index request_actions_actor_idx on public.request_actions(actor_id);

-- notifications -------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.requests(id) on delete cascade,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_request_idx on public.notifications(request_id);

-- app_settings --------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index app_settings_updated_by_idx on public.app_settings(updated_by);

-- counters ------------------------------------------------------------------
create table public.counters (
  name text primary key,
  last_value bigint not null default 0
);

-- audit_log -----------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log(created_at desc);
create index audit_log_actor_idx on public.audit_log(actor_id);

create index profiles_created_by_idx on public.profiles(created_by);
create index approver_credentials_updated_by_idx on public.approver_credentials(updated_by);

-- RLS on for every table ----------------------------------------------------
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.approver_credentials enable row level security;
alter table public.requests enable row level security;
alter table public.request_files enable row level security;
alter table public.signed_files enable row level security;
alter table public.request_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.app_settings enable row level security;
alter table public.counters enable row level security;
alter table public.audit_log enable row level security;

-- The browser never writes tables directly; only RPCs and the server do.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant update (read_at) on public.notifications to authenticated;
