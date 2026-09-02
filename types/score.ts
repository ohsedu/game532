import type { GameId } from "./game";

export interface ScoreRow {
  id: number;
  game_id: GameId;
  nickname: string;
  score: number;
  created_at: string;
}

export interface RankingEntry {
  rank: number;
  nickname: string;
  score: number;
  createdAt: string;
}

export interface SubmitScoreBody {
  gameId: GameId;
  nickname: string;
  score: number;
}

export const NICKNAME_MAX = 12;
/** Hard ceiling used to reject absurd client-reported scores. */
export const SCORE_MAX = 10_000_000;
