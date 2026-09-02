import "server-only";

import type { GameId } from "@/types/game";
import type { RankingEntry } from "@/types/score";
import { getReadClient, isReadConfigured } from "./supabase/server";

export const RANKING_LIMIT = 100;

export interface RankingResult {
  configured: boolean;
  entries: RankingEntry[];
}

/**
 * Top scores for one game.
 *
 * Shared by the ranking page and the API route so there is one definition of
 * what a ranking is — in particular the tiebreak, which has to match everywhere
 * or the same score jumps position depending on which path fetched it.
 */
export async function getRanking(gameId: GameId): Promise<RankingResult> {
  if (!isReadConfigured()) return { configured: false, entries: [] };

  const supabase = getReadClient();
  if (!supabase) return { configured: false, entries: [] };

  const { data, error } = await supabase
    .from("scores")
    .select("nickname, score, created_at")
    .eq("game_id", gameId)
    // Ties go to whoever recorded it first.
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(RANKING_LIMIT);

  if (error) {
    console.error("[ranking] " + gameId + " query failed:", error.message);
    throw new Error("ranking query failed");
  }

  const entries: RankingEntry[] = (data ?? []).map((row, i) => ({
    rank: i + 1,
    nickname: row.nickname as string,
    score: row.score as number,
    createdAt: row.created_at as string,
  }));

  return { configured: true, entries };
}
