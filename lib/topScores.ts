import "server-only";

import type { GameId } from "@/types/game";
import { isGameId } from "@/types/game";
import { getReadClient, isReadConfigured } from "./supabase/server";

export interface TopScore {
  nickname: string;
  score: number;
}

export type TopScores = Partial<Record<GameId, TopScore>>;

/**
 * The best score anyone has posted, per game.
 *
 * Read on the server so the home page ships the numbers in its HTML — no client
 * fetch, no loading flash, and no round trip through the site's own API just to
 * reach a database the server can already see.
 *
 * One RPC for every game rather than one indexed lookup per game. It used to be
 * the latter — six concurrent `limit 1` queries — which was fine while the
 * nickname was a copy stored on the row. Now a member's name has to come from
 * their profile, and joining that per game means six round trips that each do a
 * join. `game_top_scores` does the whole thing once with a `distinct on`.
 *
 * Failures degrade to "no score yet" rather than breaking the page: a
 * leaderboard being unavailable is not a reason to refuse to show the games.
 */
export async function getTopScores(): Promise<TopScores> {
  if (!isReadConfigured()) return {};
  const supabase = getReadClient();
  if (!supabase) return {};

  const { data, error } = await supabase.rpc("game_top_scores");

  if (error) {
    console.error("[topScores] failed:", error.message);
    return {};
  }

  const out: TopScores = {};
  for (const row of (data ?? []) as {
    game_id: string;
    nickname: string;
    score: number;
  }[]) {
    // A game_id the app does not know about would be a game removed from the
    // registry but still in the table. Skipping keeps the map's type honest.
    if (!isGameId(row.game_id)) continue;
    out[row.game_id] = { nickname: row.nickname, score: row.score };
  }
  return out;
}
