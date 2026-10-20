// Shared server-only helpers for Edge Functions.
// Every function: verify the caller's token with Supabase Auth, load their profile,
// check role/department, and only then use the service-role client.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export const LOGIN_DOMAIN = Deno.env.get("LOGIN_DOMAIN") ?? "users.approvalapp.in";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type Role = "admin" | "head" | "clerk" | "employee" | "disbursement" | "regional_head";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  designation: string | null;
  role: Role;
  department_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return json({ error: { code: e.code, message: e.message } }, e.status);
  }
  const message = e instanceof Error ? e.message : "Unexpected error";
  console.error("Unhandled error:", message);
  return json({ error: { code: "server_error", message } }, 500);
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Verify the Bearer token with the Auth server (so banned users fail at once) and load the active profile. */
export async function getCaller(req: Request): Promise<{ admin: SupabaseClient; me: Profile }> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "unauthorized", "Please sign in again.");
  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized", "Your session has expired. Please sign in again.");
  const { data: me, error: pErr } = await admin
    .from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (pErr) throw new HttpError(500, "server_error", pErr.message);
  if (!me || !me.is_active) throw new HttpError(403, "forbidden", "Your account is inactive.");
  return { admin, me: me as Profile };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "bad_request", "Request body must be JSON.");
  }
}

export function requireString(v: unknown, name: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof v !== "string") throw new HttpError(400, "bad_request", `${name} is required.`);
  const s = v.trim();
  if (s.length < (opts.min ?? 1)) throw new HttpError(400, "bad_request", `${name} is required.`);
  if (opts.max && s.length > opts.max) throw new HttpError(400, "bad_request", `${name} is too long.`);
  return s;
}

export function validatePassword(p: unknown): string {
  if (typeof p !== "string" || p.length < 8 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    throw new HttpError(400, "weak_password", "Password must be at least 8 characters with letters and digits.");
  }
  if (p.length > 72) throw new HttpError(400, "weak_password", "Password is too long.");
  return p;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(v: unknown, name: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, "bad_request", `${name} is invalid.`);
  return v;
}

export async function audit(
  admin: SupabaseClient, me: Profile, action: string, targetType: string, targetId: string,
  details: Record<string, unknown> = {},
) {
  await admin.from("audit_log").insert({
    actor_id: me.id, actor_name: me.full_name, action, target_type: targetType, target_id: targetId, details,
  });
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
    try {
      return await fn(req);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
