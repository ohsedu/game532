export type GameId =
  | "dodge"
  | "poop"
  | "direction"
  | "stack"
  | "runner"
  | "aim";

export const GAME_IDS: readonly GameId[] = [
  "dodge",
  "poop",
  "direction",
  "stack",
  "runner",
  "aim",
] as const;

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
  /** How touch input reaches the game on a phone. */
  touch: TouchMode;
}

export type TouchMode =
  /** Drag anywhere to steer; a parked stick shows the vector. */
  | "joystick"
  /** Tap a side of the board to face that way. */
  | "sector"
  /** One big button - jump, drop, whatever the game calls it. */
  | "action"
  /** Tap the board directly; the game reads pointer coordinates. */
  | "pointer";
