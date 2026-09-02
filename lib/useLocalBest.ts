"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { GameId } from "@/types/game";
import { getBest, subscribeBest } from "./localBest";

/**
 * Reads the stored best score for a game.
 *
 * Uses useSyncExternalStore so the server snapshot is explicitly 0 — that keeps
 * SSR output and the first client render identical (no hydration mismatch)
 * without copying storage into state inside an effect.
 */
export function useLocalBest(id: GameId): number {
  const getSnapshot = useCallback(() => getBest(id), [id]);
  return useSyncExternalStore(subscribeBest, getSnapshot, () => 0);
}
