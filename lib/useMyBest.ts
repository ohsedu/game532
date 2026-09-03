"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { GameId } from "@/types/game";
import { getBest, subscribeBest } from "./localBest";
import {
  getAccountBests,
  getServerAccountBests,
  subscribeAccountBest,
} from "./accountBest";

/**
 * The player's own best score for a game.
 *
 * For a signed-in player this is their **account's** record, not this
 * browser's. The two disagree more often than you would guess: a run that was
 * never registered (the nickname prompt dismissed, the post failed) leaves a
 * local number no leaderboard has ever seen, and it looked absurd on the home
 * page — "내 기록 74,375" sitting under a first place of 36,980.
 *
 * localStorage remains the answer for a guest, and the fallback while the
 * session cookie is still being read. Blanking the line for that moment would
 * pop six cards' worth of layout once the answer arrived, and for a guest — who
 * resolves with no network at all — the local number is already final.
 */
export function useMyBest(id: GameId): number {
  const local = useSyncExternalStore(
    subscribeBest,
    useCallback(() => getBest(id), [id]),
    () => 0
  );

  const account = useSyncExternalStore(
    subscribeAccountBest,
    getAccountBests,
    getServerAccountBests
  );

  if (account.kind === "member") return account.bests[id] ?? 0;
  return local;
}
