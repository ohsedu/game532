import "server-only";

import { GAME_IDS, type GameId } from "@/types/game";
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
 * One query per game rather than one query for everything: Postgres has no
 * portable "top row per group" through the Supabase client, and six indexed
 * LIMIT 1 lookups against scores_ranking_idx are cheaper than pulling every row
 * and reducing in JS. They run concurrently, so the page waits for the slowest
 * one, not the sum.
 *
 * Failures degrade to "no score yet" rather than breaking the page: a leaderboard
 * being unavailable is not a reason to refuse to show the games.
 */
export async function getTopScores(): Promise<TopScores> {
  if (!isReadConfigured()) return {};
  const supabase = getReadClient();
  if (!supabase) return {};

  const rows = await Promise.all(
    GAME_IDS.map(async (id) => {
      const { data, error } = await supabase
        .from("scores")
        .select("nickname, score")
        .eq("game_id", id)
        // Ties go to whoever recorded it first, matching the ranking page.
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);

      if (error) {
        console.error("[topScores] " + id + " failed:", error.message);
        return null;
      }
      const row = data?.[0];
      if (!row) return null;
      return {
        id,
        top: { nickname: row.nickname as string, score: row.score as number },
      };
    })
  );

  const out: TopScores = {};
  for (const r of rows) if (r) out[r.id] = r.top;
  return out;
}
