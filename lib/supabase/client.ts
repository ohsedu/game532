import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, anon key only.
 *
 * Ranking reads are public under RLS, so this is safe to ship. Writes are not
 * available to it by design - score submission goes through POST /api/scores.
 * Currently unused by the app (the ranking page reads through the API route so
 * it can be cached server-side), kept as the documented client entry point.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function isSupabaseConfiguredClient(): boolean {
  return Boolean(url && anonKey);
}

export function getBrowserClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!cached) {
    cached = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
  }
  return cached;
}
