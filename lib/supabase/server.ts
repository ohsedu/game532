import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase access.
 *
 * Uses the service-role key, which bypasses RLS. This module must never be
 * imported from a client component - the key would end up in the bundle.
 * Score writes go exclusively through here, which is what lets RLS deny all
 * client-side inserts.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;

/**
 * The site is fully playable without Supabase (local best scores only), so a
 * missing configuration is a normal state, not an error.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && serviceKey);
}

export function getServiceClient(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
