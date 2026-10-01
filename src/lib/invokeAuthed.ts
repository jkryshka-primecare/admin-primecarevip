import { supabase } from "@/integrations/supabase/client";

/**
 * Invoke a staff-gated edge function with a guaranteed-fresh session.
 * - Refreshes the token if it is missing or within 60s of expiry.
 * - On a 401, refreshes once and retries.
 * - If no valid session can be obtained, returns a friendly error instead of
 *   letting the 401 bubble up as an unhandled runtime error.
 */
export async function invokeAuthed<T = unknown>(
  fn: string,
  body: unknown,
): Promise<{ data: T | null; error: { message: string; status?: number } | null }> {
  const ensure = async (force: boolean) => {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    const expSoon = !s?.expires_at || s.expires_at * 1000 - Date.now() < 60_000;
    if (s && !force && !expSoon) return true;
    if (!s) return false;
    const { data: r, error } = await supabase.auth.refreshSession();
    return !error && !!r.session;
  };

  const expired = { data: null, error: { message: "Your session expired. Please sign in again.", status: 401 } };

  if (!(await ensure(false))) return expired;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke(fn, { body: body as any });
    if (!error) return { data: data as T, error: null };
    const status = (error as any)?.context?.status as number | undefined;
    if (status === 401 && attempt === 0 && (await ensure(true))) continue;
    if (status === 401) return expired;
    if (status === 403) return { data: null, error: { message: "Your account isn't approved for patient data yet.", status } };
    return { data: null, error: { message: error.message, status } };
  }
  return expired;
}
