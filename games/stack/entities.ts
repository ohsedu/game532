/**
 * Pools and shared tables for STACK UP.
 *
 * Everything here is allocated once, at module load or in the game's field
 * initializers, and reused for the lifetime of the page. Nothing in this file
 * may be called from `onUpdate` / `onRender`.
 */

export const TAU = Math.PI * 2;

/**
 * Fills cycled by row index so a tall tower reads as a gradient rather than as
 * one long stripe. Green first: it is the game's accent, so the foundation the
 * player builds on is instantly recognisable as "this game".
 */
export const CANDY: readonly string[] = [
  "#4ecb71",
  "#4f8cff",
  "#a77bff",
  "#ff6b8a",
  "#ffb443",
];

/**
 * Hand-picked darker partners for the 2px outline. Derived shades (multiply,
 * HSL rotation) went muddy on the orange and washed out on the green, so the
 * pairs are literal.
 */
export const CANDY_DARK: readonly string[] = [
  "#2ea653",
  "#2f68d6",
  "#7f52d6",
  "#d94a68",
  "#cf8a1e",
];

/** One settled row of the tower. `index` is its height in the world. */
export interface Row {
  active: boolean;
  index: number;
  /** Centre x in logical space. */
  x: number;
  w: number;
  /** Index into CANDY / CANDY_DARK. */
  hue: number;
}

/** An offcut (or the whole block, on death) tumbling out of the world. */
export interface Debris {
  active: boolean;
  /** Centre, in world space: y is measured up from the foundation. */
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  hue: number;
  life: number;
}

/** A short rising caption pinned to a spot in the tower. */
export interface Label {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  str: string;
  color: string;
  size: number;
}

export function createRows(n: number): Row[] {
  return Array.from({ length: n }, () => ({
    active: false,
    index: 0,
    x: 0,
    w: 0,
    hue: 0,
  }));
}

export function createDebris(n: number): Debris[] {
  return Array.from({ length: n }, () => ({
    active: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    spin: 0,
    hue: 0,
    life: 0,
  }));
}

export function createLabels(n: number): Label[] {
  return Array.from({ length: n }, () => ({
    active: false,
    x: 0,
    y: 0,
    life: 0,
    maxLife: 1,
    str: "",
    color: "#ffffff",
    size: 18,
  }));
}
