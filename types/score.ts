import type { GameId } from "./game";

/** One row of `public.game_scores`. See talk532/supabase/game-scores.sql. */
export interface ScoreRow {
  id: number;
  game_id: GameId;
  /** The talk532 account that posted it. Null for a score posted while signed out. */
  user_id: string | null;
  nickname: string;
  score: number;
  created_at: string;
}

export interface RankingEntry {
  /** The `game_scores` row behind this line. Stable across refetches. */
  id: number;
  rank: number;
  nickname: string;
  score: number;
  createdAt: string;
  /**
   * The talk532 account this row belongs to, when there is one to talk to.
   *
   * Present only for members who leave themselves findable in talk532 — the
   * database decides that, not this app (`game_ranking`). Two things follow
   * from it, and both matter:
   *
   * - The row gets a "대화하기" button. Rows without it get none, because
   *   `start_direct_room` refuses anyone who is not findable; a button there
   *   would be one that only ever produces an error.
   * - Members who turned findability off are indistinguishable from guests on
   *   the leaderboard. Their id never leaves the database.
   */
  userId: string | null;
  /** talk532 avatar, resolved through `talkAvatarUrl`. Null alongside userId. */
  avatarIcon: string | null;
  avatarImage: string | null;
}

export interface SubmitScoreBody {
  gameId: GameId;
  /**
   * Only read for a signed-out player. A signed-in one is named by their
   * profile, looked up server-side from the session — see the API route.
   */
  nickname: string;
  score: number;
}

/**
 * Guest nickname ceiling.
 *
 * talk532 profiles are 2-10 characters of Hangul/Latin/digits, which is
 * narrower, so a member's name always fits here.
 */
export const NICKNAME_MAX = 12;
/** Hard ceiling used to reject absurd client-reported scores. */
export const SCORE_MAX = 10_000_000;
