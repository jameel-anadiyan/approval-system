/**
 * Safe error message extractor.
 * Handles:
 * - Error instances
 * - Supabase / PostgREST plain error objects ({ message, code, details, hint })
 * - Edge Function JSON error payloads ({ error: { message }, error: string, message: string })
 * - Auth errors ({ error_description, error })
 * - Failed to fetch / network aborts
 * 
 * Guarantees NEVER returning "[object Object]".
 */
export function errMsg(err: unknown): string {
  if (!err) return 'An unexpected error occurred';

  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (!trimmed || trimmed === '[object Object]') {
      return 'An unexpected error occurred. Please check console logs.';
    }
    if (trimmed.includes('Failed to fetch')) {
      return 'Network / connection error: Unable to reach the server. Please check your internet connection or verify your session.';
    }
    return trimmed;
  }

  if (typeof err === 'object') {
    const o = err as Record<string, any>;

    // 1. Nested { error: { message } } or { error: string }
    if (o.error) {
      if (typeof o.error === 'string' && o.error.trim()) {
        return errMsg(o.error);
      }
      if (typeof o.error === 'object') {
        const sub = errMsg(o.error);
        if (sub && sub !== 'An unexpected error occurred') return sub;
      }
    }

    // 2. Direct message property (Error instance or plain PostgREST error)
    if (typeof o.message === 'string' && o.message.trim() && o.message !== '[object Object]') {
      const msg = o.message.trim();
      if (msg.includes('Failed to fetch')) {
        return 'Network / connection error: Unable to reach the server. Please check your internet connection or verify your session.';
      }
      if (o.hint && typeof o.hint === 'string' && o.hint.trim()) {
        return `${msg} (${o.hint.trim()})`;
      }
      return msg;
    }

    // 3. Alternative error attributes
    if (typeof o.error_description === 'string' && o.error_description.trim()) {
      return o.error_description.trim();
    }
    if (typeof o.details === 'string' && o.details.trim()) {
      return o.details.trim();
    }
    if (typeof o.reason === 'string' && o.reason.trim()) {
      return o.reason.trim();
    }
    if (typeof o.description === 'string' && o.description.trim()) {
      return o.description.trim();
    }

    // 4. Try JSON stringify if it has useful contents
    try {
      const s = JSON.stringify(o);
      if (s && s !== '{}' && s !== '[]') {
        return s;
      }
    } catch {
      // ignore
    }
  }

  // 5. Fallback toString, strictly guarding against "[object Object]"
  try {
    const str = String(err);
    if (!str || str === '[object Object]') {
      return 'An unexpected error occurred. Please check console logs.';
    }
    if (str.includes('Failed to fetch')) {
      return 'Network / connection error: Unable to reach the server. Please check your internet connection or verify your session.';
    }
    return str;
  } catch {
    return 'An unexpected error occurred';
  }
}
