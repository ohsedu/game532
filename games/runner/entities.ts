/**
 * Data shapes and pools for DASH RUN.
 *
 * Plain data only — the game owns every behaviour. The pools are built once
 * when the game object is constructed and entries are only ever flipped with
 * `active`, so a run never allocates.
 */

export const TAU = Math.PI * 2;

/** Obstacle kinds. Numeric so the hot loop compares ints, not strings. */
export const KIND_BLOCK = 0;
export const KIND_BEAM = 1;
export const KIND_PIT = 2;
/**
 * The low roof: a wide stretch with head clearance for a runner but not for a
 * jump. It is the only obstacle whose answer is to do nothing at all.
 */
export const KIND_CEIL = 3;

export type ObstacleKind = 0 | 1 | 2 | 3;

/** Role inside a compound pair. Singles are LINK_NONE. */
export const LINK_NONE = 0;
export const LINK_LEAD = 1;
export const LINK_TAIL = 2;

export interface Obstacle {
  active: boolean;
  kind: ObstacleKind;
  /** Left edge in screen space; obstacles scroll right to left. */
  x: number;
  w: number;
  /**
   * BLOCK: height of the box above the floor.
   * BEAM:  clearance left underneath it.
   * CEIL:  clearance left underneath it.
   * PIT:   unused.
   */
  h: number;
  /** Smallest vertical gap seen while the runner overlapped it, in px. */
  minClear: number;
  /** Set once the trailing edge is behind the runner and the near-miss paid. */
  scored: boolean;
  /** Per-instance visual phase, so identical shapes do not bob in lockstep. */
  phase: number;
  /** Index into BLOCK_FILL / BLOCK_LINE. Blocks only. */
  tint: number;
  /** LINK_NONE / LINK_LEAD / LINK_TAIL. */
  link: number;
  /** Shared id, so a lead can find its own tail without a map. */
  group: number;
  /** Kind of the partner, so the lead can badge what is coming. */
  linkKind: ObstacleKind;
  /** One-shot latch for the approach warning. Roofs only. */
  warned: boolean;
}

function blank(): Obstacle {
  return {
    active: false,
    kind: KIND_BLOCK,
    x: 0,
    w: 0,
    h: 0,
    minClear: Infinity,
    scored: false,
    phase: 0,
    tint: 0,
    link: LINK_NONE,
    group: 0,
    linkKind: KIND_BLOCK,
    warned: false,
  };
}

export function createObstaclePool(n: number): Obstacle[] {
  return Array.from({ length: n }, blank);
}

/** A single collectible. Position is absolute screen space, like obstacles. */
export interface Coin {
  active: boolean;
  x: number;
  y: number;
  /** Spin phase, so a line of coins flips out of step. */
  phase: number;
}

export function createCoinPool(n: number): Coin[] {
  return Array.from({ length: n }, () => ({ active: false, x: 0, y: 0, phase: 0 }));
}

/**
 * Hazard palette. The runner owns purple and nothing that can kill is allowed
 * to wear it: at a glance the player has to be able to tell their own body from
 * the thing about to end the run, and two purple shapes on one floor is exactly
 * the moment that read fails. Every kind gets its own hue instead.
 *
 * The four hazards are also grouped by the answer they want: green and blue are
 * the ground shapes you leave the floor for, pink hangs at head height and
 * wants the floor, and amber — used by nothing else — is the roof that wants
 * you to keep doing exactly what you are already doing.
 */
export const BLOCK_FILL: readonly string[] = ["#4ecb71", "#4f8cff"];
export const BLOCK_LINE: readonly string[] = ["#2f9a4f", "#2f5fd0"];
export const BEAM_FILL = "#ff6b8a";
export const BEAM_LINE = "#c8425f";
export const PIT_RIM = "#4f8cff";
export const PIT_RIM_LINE = "#2f5fd0";
export const CEIL_FILL = "#ffb443";
export const CEIL_LINE = "#b0700d";
/** Hazard tape on the roof's underside. Ink, because that edge is the killer. */
export const CEIL_TAPE = "rgba(34,37,45,0.82)";
/** Coins are lighter and warmer than the roof, and they are the only circles. */
export const COIN_FILL = "#ffd766";
export const COIN_LINE = "#c07a12";
export const COIN_CORE = "#fff3d0";
