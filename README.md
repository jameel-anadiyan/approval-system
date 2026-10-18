# Approval Workflow App

Mobile-first money-request approval system: **Employee / Clerk / Head** raise requests →
**Clerk** routes (Route A → Head review → Admin, or Route B → Head approves) →
approver's **seal + signature** are stamped on every PDF page → **Disbursement** verifies the QR and marks paid.

- Frontend: React + Vite + TypeScript + Tailwind v4 (`src/`)
- Backend: Supabase — Postgres + RLS, RPCs, Storage, Realtime, Edge Functions (`supabase/`)
- Login is by **username**; it maps to the hidden email `username@users.approvalapp.in`.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
```

`.env` (only public keys — never put the service-role key in the browser):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_LOGIN_DOMAIN=users.approvalapp.in
```

If Supabase can't be reached the app runs in **sandbox mode** with demo users
(`admin`, `head_fin`, `clerk_fin`, `emp_ravi`, `disb_anil`) and local demo data.
When connected, only real accounts and real data are shown.

## One-time Supabase setup

1. **Migrations** `supabase/migrations/0001…0005` (tables, RLS, RPCs, storage, settings).
2. **SQL Editor →** run `supabase/manual/apply_in_sql_editor.sql` (`remove_file`, `delete_draft`).
3. **Edge Functions:** `approve-request`, `admin-users`, `credentials`, `bootstrap-admin`.
4. **Edge Function secrets:**
   - `ADMIN_INITIAL_PASSWORD` — 8+ chars, letters and digits.
   - `APP_URL` — your deployed site origin (fallback for the QR verify link).
5. **Bootstrap the first admin** (one time):
   ```bash
   curl -X POST https://<project>.supabase.co/functions/v1/bootstrap-admin \
     -H "apikey: <publishable key>" -H "Content-Type: application/json" -d '{}'
   ```
6. **Auth → Sign In / Providers:** turn **off** "Allow new users to sign up".

## First login (Admin)

1. Sign in as `admin` with `ADMIN_INITIAL_PASSWORD`; you'll be asked to change it.
2. **Departments** → create departments.
3. **Heads** / **Disbursement** → create those users (temporary passwords; they must change on first login).
4. **Credentials** → upload a PNG **seal** and **signature** for Admin and each Head (required to approve).
5. **Settings** → high-value threshold (default ₹10,000).
6. Each Head creates their department's Clerks and Employees under **Users**.

## Deploy

Any static host. `vercel.json` / `public/_redirects` provide the SPA fallback so
QR links like `/verify/<token>` open correctly. Set the three `VITE_*` env vars on the host.
