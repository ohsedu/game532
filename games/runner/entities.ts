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
/**
 * The barricade: solid from the floor to well above the jump apex, so there is
 * neither a way over it nor a slot under it. The only obstacle in the game the
 * player is meant to run straight AT, and the only one a dash destroys.
 */
export const KIND_WALL = 4;

export type ObstacleKind = 0 | 1 | 2 | 3 | 4;

/**
 * Role inside a burst — a cluster of obstacles committed as one challenge.
 * Singles are LINK_NONE. A burst is LEAD, then any number of MIDs, then TAIL;
 * the rail is drawn from the tail back, so the tail is the anchor.
 */
export const LINK_NONE = 0;
export const LINK_LEAD = 1;
export const LINK_TAIL = 2;
export const LINK_MID = 3;

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
   * WALL:  height of the slab above the floor.
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
  /** LINK_NONE / LINK_LEAD / LINK_TAIL / LINK_MID. */
  link: number;
  /** Shared id, so a burst can find the rest of itself without a map. */
  group: number;
  /** One-shot latch for the approach warning. Roofs and barricades only. */
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
 * The burger: five seconds of smashing everything. Same shape as a coin, but
 * its own pool so the rarity rules never have to filter a shared list.
 */
export interface Burger {
  active: boolean;
  x: number;
  y: number;
  phase: number;
}

export function createBurgerPool(n: number): Burger[] {
  return Array.from({ length: n }, () => ({ active: false, x: 0, y: 0, phase: 0 }));
}

/**
 * Hazard palette. The runner owns purple and nothing that can kill is allowed
 * to wear it: at a glance the player has to be able to tell their own body from
 * the thing about to end the run, and two purple shapes on one floor is exactly
 * the moment that read fails. Every kind gets its own hue instead.
 *
 * The hazards are grouped by the answer they want: green and blue are the
 * ground shapes you leave the floor for, pink hangs at head height and wants
 * the floor, amber is the roof that wants you to keep doing exactly what you
 * are already doing, and ink — the only near-black on a near-white card, and so
 * the highest-contrast thing that can be on screen — is the barricade you run
 * at. Nothing else in the run is dark, which is the whole read.
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
export const WALL_FILL = "#2b2f3d";
export const WALL_LINE = "#12141b";
/** Mortar between the courses: lighter than the slab, so it reads as masonry. */
export const WALL_SEAM = "rgba(247,248,252,0.22)";
/** The run-at arrows. White on ink is the loudest mark the palette allows. */
export const WALL_CHEV = "#ffffff";
/** Coins are lighter and warmer than the roof, and they are the only circles. */
export const COIN_FILL = "#ffd766";
export const COIN_LINE = "#c07a12";
export const COIN_CORE = "#fff3d0";
/** The burger. Food colours, so it can never be mistaken for a hazard. */
export const BUN_FILL = "#ffc25c";
export const BUN_LINE = "#b0700d";
export const PATTY_FILL = "#8a5230";
export const LETTUCE_FILL = "#4ecb71";
