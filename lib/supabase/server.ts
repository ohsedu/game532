import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { ROOT_DOMAIN } from "@/lib/talk";

/**
 * Server-side Supabase access.
 *
 * Three capabilities, deliberately separated:
 *
 * - READ (rankings) needs only the anon key. RLS already grants anon SELECT on
 *   game_scores and EXECUTE on the ranking functions, so rankings work as soon
 *   as the URL and anon key are set. This path never touches cookies.
 * - WRITE (score submission) needs the service-role key, which bypasses RLS.
 *   That key must never reach the client, so this module is server-only.
 * - IDENTITY (who is submitting) reads the session cookie. Only the score POST
 *   uses it — see the warning on getRequestUser.
 *
 * Splitting them means a project configured with just the public keys still
 * shows rankings instead of failing shut.
 */

/**
 * Reads an environment variable, treating blank as absent.
 *
 * `SUPABASE_SERVICE_ROLE_KEY=` with nothing after it is a *set* variable whose
 * value is the empty string, and `??` does not fall back on that — which broke
 * rankings the moment the key was left blank in .env.local: `serviceKey ??
 * anonKey` chose `""`, getReadClient returned null, and every ranking answered
 * 503 while isReadConfigured happily said yes (`||` there, `??` here). The two
 * have to agree, and both have to agree with the promise this module makes:
 * public keys alone are enough to read.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

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

/** Who a score belongs to, resolved on the server so it cannot be forged. */
export interface RequestUser {
  id: string;
  /** talk532 profile nickname. Null when the account has not chosen one yet. */
  nickname: string | null;
}

/**
 * The signed-in player, read from the shared `.ohsedu.site` session cookie.
 *
 * ★ **Never call this from a response that carries a shared Cache-Control.**
 *
 *   `getUser()` may refresh an expiring token, and a refresh writes Set-Cookie.
 *   On a response cached at the edge (`public, s-maxage=...`) that header is
 *   cached with the body, and the next visitor is handed someone else's
 *   session. GET /api/scores is exactly such a response, which is why the
 *   ranking is built to be identical for every viewer and reads no cookies at
 *   all. Only POST uses this.
 *
 * Returns null for a guest, and for a session the auth server rejects. The
 * nickname comes from `profiles` rather than the request body — "register
 * automatically under my nickname" has to mean *their* nickname, and a name
 * the client sends is a name anyone can send.
 */
export async function getRequestUser(): Promise<RequestUser | null> {
  if (!url || !anonKey) return null;

  const [store, head] = await Promise.all([cookies(), headers()]);

  /*
   * The cookie scope is taken from the request host, matching what the browser
   * client writes. Deriving it from NODE_ENV instead would be wrong on a
   * preview deployment: that runs in production mode on a *.vercel.app host,
   * where a `.ohsedu.site` cookie is rejected outright.
   *
   * This only matters when getUser() refreshes a token and writes it back. A
   * mismatched scope there would leave a second cookie of the same name at a
   * narrower scope, and the browser would then send two — with the stale one
   * winning on some paths.
   */
  const host = (head.get("host") ?? "").split(":")[0].toLowerCase();
  const shared = host === ROOT_DOMAIN || host.endsWith("." + ROOT_DOMAIN);

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: {
      domain: shared ? "." + ROOT_DOMAIN : undefined,
      secure: shared,
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Setting cookies is only allowed while the response is still open.
          // A refreshed token that cannot be written back just means the
          // browser refreshes again on its next request — not a failure worth
          // rejecting a score over.
        }
      },
    },
  });

  // getUser, not getSession: this verifies the token with the auth server
  // instead of trusting a cookie the browser could have been given by anyone.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", data.user.id)
    .maybeSingle();

  const nickname =
    profile && typeof profile.nickname === "string" ? profile.nickname : null;

  return { id: data.user.id, nickname };
}
