import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase access.
 *
 * Two capabilities, deliberately separated:
 *
 * - READ (rankings) needs only the anon key. RLS already grants anon SELECT on
 *   scores, so rankings work as soon as the URL and anon key are set.
 * - WRITE (score submission) needs the service-role key, which bypasses RLS.
 *   That key must never reach the client, so this module is server-only.
 *
 * Splitting them means a project configured with just the public keys still
 * shows rankings instead of failing shut.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const options = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

let readClient: SupabaseClient | null = null;
let writeClient: SupabaseClient | null = null;

/** Rankings can be listed. */
export function isReadConfigured(): boolean {
  return Boolean(url && (serviceKey || anonKey));
}

/** Scores can be submitted. */
export function isWriteConfigured(): boolean {
  return Boolean(url && serviceKey);
}

/** Prefers the service key when present, otherwise reads as anon under RLS. */
export function getReadClient(): SupabaseClient | null {
  if (!url) return null;
  const key = serviceKey ?? anonKey;
  if (!key) return null;
  if (!readClient) readClient = createClient(url, key, options);
  return readClient;
}

export function getWriteClient(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  if (!writeClient) writeClient = createClient(url, serviceKey, options);
  return writeClient;
}
