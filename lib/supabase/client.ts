import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COOKIE_DOMAIN } from "@/lib/talk";

/**
 * Browser Supabase client, anon key only.
 *
 * Two jobs:
 *
 * - Reading who is signed in. The session lives in a cookie scoped to
 *   `.ohsedu.site`, so a login performed on login.ohsedu.site is already
 *   visible here — nothing is handed over through the URL.
 * - Calling the reads that need an identity (`my_game_bests`).
 *
 * Writes are still not available to it by design: score submission goes through
 * POST /api/scores, which is the only place the per-second plausibility ceilings
 * and the IP rate limit exist. `game_scores` has no insert policy at all.
 *
 * ★ The cookie name, domain and encoding must match talk532's client exactly
 *   (talk532/lib/supabase.ts). All three are defaults except the domain, which
 *   both sides take from the same rule.
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
    cached = createBrowserClient(url, anonKey, {
      cookieOptions: {
        domain: COOKIE_DOMAIN,
        // localhost is http, where a Secure cookie is dropped without a word.
        secure:
          typeof window !== "undefined" && window.location.protocol === "https:",
      },
    });
  }
  return cached;
}
