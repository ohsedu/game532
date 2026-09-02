export type GameId = "dodge" | "poop" | "direction";

export const GAME_IDS: readonly GameId[] = ["dodge", "poop", "direction"] as const;

export function isGameId(v: unknown): v is GameId {
  return typeof v === "string" && (GAME_IDS as readonly string[]).includes(v);
}

/** Logical game coordinate space. Rendering size is decoupled from this. */
export const GAME_WIDTH = 1000;
export const GAME_HEIGHT = 700;

export type GameStatus = "ready" | "playing" | "gameover";

export interface GameMeta {
  id: GameId;
  /** "01" | "02" | "03" */
  no: string;
  /** English arcade title shown big on the card */
  title: string;
  /** Korean name */
  titleKo: string;
  /** One-line hook */
  description: string;
  /** How to play, one line */
  controls: string;
  /** Tailwind-friendly accent hex, used for glow/borders */
  accent: string;
}
