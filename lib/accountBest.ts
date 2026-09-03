"use client";

import { isGameId, type GameId } from "@/types/game";
import { getBrowserClient } from "./supabase/client";

export type BestMap = Readonly<Partial<Record<GameId, number>>>;

/**
 * The signed-in account's best score per game.
 *
 * Three states, not two. "Not read yet" has to be distinguishable from "signed
 * out" — collapsing them means every member is treated as a guest for the first
 * frame after load, and the number on screen then changes under them.
 */
export type AccountBests =
  /** The session cookie has not been read yet. */
  | { kind: "unknown" }
  | { kind: "guest" }
  /** Signed in. `bests` is empty for a member who has posted nothing. */
  | { kind: "member"; bests: BestMap };

/**
 * A module-level store rather than a hook per component.
 *
 * `my_game_bests` answers for every game at once, and the home page renders six
 * cards. A hook that fetched per card would open six auth listeners and make
 * six round trips for one answer.
 */
const UNKNOWN: AccountBests = { kind: "unknown" };
const GUEST: AccountBests = { kind: "guest" };

let state: AccountBests = UNKNOWN;
const listeners = new Set<() => void>();
let started = false;

function set(next: AccountBests): void {
  state = next;
  for (const l of listeners) l();
}

async function load(): Promise<void> {
  const supabase = getBrowserClient();
  if (!supabase) return;

  const { data, error } = await supabase.rpc("my_game_bests");

  if (error) {
    // Whatever is on screen stays. Answering "no record" for a read that failed
    // is indistinguishable from never having played, and would wipe a member's
    // number off six cards because one request timed out.
    console.error("[accountBest] " + error.message);
    return;
  }

  const bests: Partial<Record<GameId, number>> = {};
  for (const row of (data ?? []) as { game_id: string; score: number }[]) {
    // A game_id the app no longer has a card for is simply skipped.
    if (!isGameId(row.game_id)) continue;
    if (typeof row.score !== "number" || !Number.isFinite(row.score)) continue;
    bests[row.game_id] = Math.floor(row.score);
  }
  set({ kind: "member", bests });
}

function start(): void {
  if (started) return;
  started = true;

  const supabase = getBrowserClient();
  // No Supabase means no sign-in at all, so nobody is ever a member here.
  if (!supabase) {
    set(GUEST);
    return;
  }

  /*
   * One listener for the life of the page. onAuthStateChange delivers
   * INITIAL_SESSION as well, so this covers the first read, and it is also how
   * signing out on talk.ohsedu.site — which shares this cookie — gets here.
   */
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) void load();
    else set(GUEST);
  });
}

export function subscribeAccountBest(onChange: () => void): () => void {
  start();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getAccountBests(): AccountBests {
  return state;
}

/** Nothing is known on the server, where there is no cookie to read. */
export function getServerAccountBests(): AccountBests {
  return UNKNOWN;
}

/**
 * Folds a score that was just registered into the cached map.
 *
 * The alternative is re-running the RPC after every submission, which asks the
 * database for a number the client already knows — the server stored exactly
 * this score under exactly this account.
 *
 * A no-op for a guest: their run did not land on an account.
 */
export function noteAccountBest(id: GameId, score: number): void {
  if (state.kind !== "member") return;
  const prev = state.bests[id] ?? 0;
  if (score <= prev) return;
  set({ kind: "member", bests: { ...state.bests, [id]: Math.floor(score) } });
}
