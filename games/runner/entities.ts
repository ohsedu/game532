/**
 * Data shapes and pools for DASH RUN.
 *
 * Plain data only — the game owns every behaviour. The pool is built once when
 * the game object is constructed and entries are only ever flipped with
 * `active`, so a run never allocates.
 */

export const TAU = Math.PI * 2;

/** Obstacle kinds. Numeric so the hot loop compares ints, not strings. */
export const KIND_BLOCK = 0;
export const KIND_BEAM = 1;
export const KIND_PIT = 2;

export type ObstacleKind = 0 | 1 | 2;

export interface Obstacle {
  active: boolean;
  kind: ObstacleKind;
  /** Left edge in screen space; obstacles scroll right to left. */
  x: number;
  w: number;
  /**
   * BLOCK: height of the box above the floor.
   * BEAM:  clearance left underneath it.
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
  };
}

export function createObstaclePool(n: number): Obstacle[] {
  return Array.from({ length: n }, blank);
}

/**
 * Hazard palette. The runner owns purple and nothing that can kill is allowed
 * to wear it: at a glance the player has to be able to tell their own body from
 * the thing about to end the run, and two purple shapes on one floor is exactly
 * the moment that read fails. Every kind gets its own hue instead.
 */
export const BLOCK_FILL: readonly string[] = ["#4ecb71", "#ffb443"];
export const BLOCK_LINE: readonly string[] = ["#2f9a4f", "#c07a12"];
export const BEAM_FILL = "#ff6b8a";
export const BEAM_LINE = "#c8425f";
export const PIT_RIM = "#4f8cff";
export const PIT_RIM_LINE = "#2f5fd0";
