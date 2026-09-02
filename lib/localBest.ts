import { GAME_IDS, type GameId } from "@/types/game";

const KEY = "arcade:best";
const NICK_KEY = "arcade:nickname";

type BestMap = Partial<Record<GameId, number>>;

function read(): BestMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: BestMap = {};
    for (const id of GAME_IDS) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[id] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function getBest(id: GameId): number {
  return read()[id] ?? 0;
}

export function getAllBest(): BestMap {
  return read();
}

// --- Subscription -----------------------------------------------------------
// localStorage is an external store, so React reads it through
// useSyncExternalStore rather than copying it into state inside an effect.
// The native `storage` event only fires in OTHER tabs, so writes in this tab
// notify listeners explicitly.

const listeners = new Set<() => void>();

export function subscribeBest(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onChange);
  }
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onChange);
    }
  };
}

function notify(): void {
  for (const l of listeners) l();
}

/** Stores `score` if it beats the stored best. Returns true when it is a new record. */
export function commitBest(id: GameId, score: number): boolean {
  if (typeof window === "undefined") return false;
  const map = read();
  const prev = map[id] ?? 0;
  if (score <= prev) return false;
  map[id] = Math.floor(score);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode, quota). The run still counts in memory.
  }
  notify();
  return true;
}

export function getSavedNickname(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(nickname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NICK_KEY, nickname);
  } catch {
    // Ignored: remembering the nickname is a convenience, not a requirement.
  }
}
