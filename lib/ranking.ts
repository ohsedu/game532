import "server-only";

import type { GameId } from "@/types/game";
import type { RankingEntry } from "@/types/score";
import { getReadClient, isReadConfigured } from "./supabase/server";

export const RANKING_LIMIT = 100;

export interface RankingResult {
  configured: boolean;
  entries: RankingEntry[];
}

/** One row as `game_ranking` returns it. */
export interface RankingRow {
  id: number;
  rank: number;
  nickname: string;
  score: number;
  created_at: string;
  user_id: string | null;
  avatar_icon: string | null;
  avatar_image: string | null;
}

/**
 * Maps `game_ranking` rows to what the table renders. Shared by the ranking
 * page and the API route so there is one definition of what a ranking is.
 */
export function toEntries(rows: readonly RankingRow[]): RankingEntry[] {
  return rows.map((row) => ({
    id: row.id,
    rank: row.rank,
    nickname: row.nickname,
    score: row.score,
    createdAt: row.created_at,
    userId: row.user_id,
    avatarIcon: row.avatar_icon,
    avatarImage: row.avatar_image,
  }));
}

/**
 * Top scores for one game.
 *
 * The ordering, the tiebreak, and the folding of a member's many submissions
 * down to their single best all live in `game_ranking` rather than here. They
 * have to match everywhere or the same score jumps position depending on which
 * path fetched it, and the folding in particular cannot be expressed through
 * the Supabase query builder at all.
 *
 * The function deliberately does not look at who is asking, so this result is
 * the same for every viewer and stays cacheable. "This row is me" is decided in
 * the browser from its own session.
 */
export async function getRanking(gameId: GameId): Promise<RankingResult> {
  if (!isReadConfigured()) return { configured: false, entries: [] };

  const supabase = getReadClient();
  if (!supabase) return { configured: false, entries: [] };

  const { data, error } = await supabase.rpc("game_ranking", {
    p_game_id: gameId,
    p_limit: RANKING_LIMIT,
  });

  if (error) {
    console.error("[ranking] " + gameId + " query failed:", error.message);
    throw new Error("ranking query failed");
  }

  return { configured: true, entries: toEntries((data ?? []) as RankingRow[]) };
}
