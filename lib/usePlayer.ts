"use client";

import { useEffect, useState } from "react";
import { getBrowserClient, isSupabaseConfiguredClient } from "./supabase/client";

export interface Player {
  id: string;
  /**
   * talk532 profile nickname. Null while it is still being read, and for an
   * account that signed up but has not chosen one yet.
   *
   * Score registration only goes automatic once this has a value — a member
   * with no nickname has nothing to register under, so they get the same typed
   * field a guest gets (and the server agrees; see the API route).
   */
  nickname: string | null;
  avatarIcon: string | null;
  avatarImage: string | null;
}

export type PlayerState =
  /** The session cookie has not been read yet. Render neither state. */
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "member"; player: Player };

/**
 * Who is playing, from the session cookie shared across `*.ohsedu.site`.
 *
 * There is no login form in this app. Signing in happens on login.ohsedu.site
 * and the cookie is simply already here when the player comes back, so this
 * hook has nothing to do with authenticating — it only reads.
 *
 * 'loading' is a state the caller has to render, not a detail to collapse into
 * 'guest'. Treating it as signed-out shows the signed-out avatar to everyone
 * for a moment on every page load, which reads as having been logged out.
 */
export function usePlayer(): PlayerState {
  const [state, setState] = useState<PlayerState>(() =>
    // Without Supabase there is no sign-in at all; say so on the first render
    // instead of showing a spinner that never resolves.
    isSupabaseConfiguredClient() ? { kind: "loading" } : { kind: "guest" }
  );

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;

    let alive = true;

    /**
     * Fills in the profile for a user id. Failure leaves the nickname null
     * rather than dropping to guest — a member whose profile could not be read
     * is still signed in, and calling them a guest would offer them a login
     * button they do not need.
     */
    async function load(id: string) {
      const { data } = await supabase!
        .from("profiles")
        .select("nickname, avatar_icon, avatar_image")
        .eq("id", id)
        .maybeSingle();

      if (!alive) return;

      setState({
        kind: "member",
        player: {
          id,
          nickname:
            data && typeof data.nickname === "string" ? data.nickname : null,
          avatarIcon: (data?.avatar_icon as string | null) ?? null,
          avatarImage: (data?.avatar_image as string | null) ?? null,
        },
      });
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const id = data.session?.user.id;
      if (!id) {
        setState({ kind: "guest" });
        return;
      }
      void load(id);
    });

    /*
     * Signing out in another tab — or on talk.ohsedu.site, which shares this
     * cookie — has to land here too. Without this the header keeps showing an
     * avatar for a session that is gone, and score registration silently falls
     * back to the guest path with no explanation on screen.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      const id = session?.user.id;
      if (!id) {
        setState({ kind: "guest" });
        return;
      }
      void load(id);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
