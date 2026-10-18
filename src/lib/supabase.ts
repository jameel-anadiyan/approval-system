import { createClient } from '@supabase/supabase-js';

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

export async function checkSupabaseConnection(): Promise<{ connected: boolean; message?: string }> {
  try {
    const timeoutPromise = new Promise<{ connected: boolean; message: string }>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out')), 3500)
    );

    const testPromise = (async () => {
      const { error } = await supabase.from('departments').select('id').limit(1);
      if (error) {
        return { connected: false, message: error.message };
      }
      return { connected: true };
    })();

    return await Promise.race([testPromise, timeoutPromise]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unreachable';
    return { connected: false, message: msg };
  }
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
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
