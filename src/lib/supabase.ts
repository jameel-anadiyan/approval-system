import { createClient } from '@supabase/supabase-js';
import { errMsg } from './errorUtils';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rwwbpyodelmofjujgtyf.supabase.co';
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3d2JweW9kZWxtb2ZqdWpndHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjA1NzIsImV4cCI6MjEwNzAzNjU3Mn0.yJkXbQ332rTPz61xf6DZBf42iWgcINmVH7G2J3sjvu0';

export const LOGIN_DOMAIN = import.meta.env.VITE_LOGIN_DOMAIN || 'users.approvalapp.in';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Reachability check against the Auth health endpoint. (Table reads as anon are
// rightly refused by RLS, so they can't be used to detect connectivity.)
export async function checkSupabaseConnection(): Promise<{ connected: boolean; message?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseKey },
      signal: ctrl.signal,
    });
    return res.ok ? { connected: true } : { connected: false, message: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { connected: false, message: err instanceof Error ? err.message : 'Unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts a readable message from Edge Function errors (FunctionsHttpError carries the JSON body). */
export async function functionErrorMessage(err: unknown): Promise<string> {
  // deno-style { error: { message } } bodies from our Edge Functions
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error?.message) return body.error.message;
      if (typeof body?.error === 'string') return body.error;
      if (typeof body?.message === 'string') return body.message;
    } catch {
      /* ignore */
    }
  }
  return errMsg(err);
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.functions.invoke<T>(functionName, {
      body,
    });
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: new Error(await functionErrorMessage(err)) };
  }
}
