/**
 * Data shapes and pools for BULLET DODGE.
 *
 * Everything in here is plain data — the game owns all behavior. Pools are
 * built once when the game object is constructed and are only ever flipped
 * with `active`, so a run never allocates.
 */

export const TAU = Math.PI * 2;

/** Bullet kinds. Numeric so the hot loop compares ints instead of strings. */
export const KIND_AIMED = 0;
export const KIND_SPREAD = 1;
export const KIND_WALL = 2;
export const KIND_SPIRAL = 3;
export const KIND_HEAVY = 4;

export type BulletKind = 0 | 1 | 2 | 3 | 4;

/**
 * One color per kind. Threat type has to be readable at a glance when 150
 * bullets are on screen, and hue is the only channel fast enough to do that.
 *
 * Nothing here may be blue. On the near-white arena the player's outline and
 * core are blue, and the single most important read on a full screen is "which
 * dot am I" — so the whole hazard palette sits in the warm/violet half of the
 * candy wheel and the player owns blue alone. Green is reserved too: it is the
 * one color that ever means *safe* (the wall's gap), so no hazard may wear it.
 */
export const KIND_COLOR: readonly string[] = [
  "#ff6b8a", // aimed  - candy pink, the constant background threat
  "#ffb443", // spread - orange, visibly a fan of the same idea
  "#a77bff", // wall   - purple, the "event" color
  "#ef4444", // spiral - cherry red
  "#f97316", // heavy  - deep orange, the slow big threat
];

/**
 * Darker companion per kind, for the 2px outline that makes a solid candy
 * circle pop off a near-white floor. Precomputed because a per-frame color
 * mix would be the most expensive thing in the bullet loop.
 */
export const KIND_OUTLINE: readonly string[] = [
  "#c8425f", // aimed
  "#c07a12", // spread
  "#6d45c4", // wall
  "#a81f1f", // spiral
  "#b45209", // heavy
];

export interface Bullet {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Collision radius; the drawn glow is larger than this on purpose. */
  r: number;
  kind: BulletKind;
  color: string;
  age: number;
  rot: number;
  /** Visual spin, radians/sec. */
  spin: number;
  /** Radians/sec the velocity may be steered toward the player. 0 = straight. */
  turn: number;
  /** Phase offset so identical bullets do not pulse in lockstep. */
  pulse: number;
  /** Grazes score once per bullet, otherwise a parked bullet farms points. */
  grazed: boolean;
}

function blankBullet(): Bullet {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 6,
    kind: KIND_AIMED,
    color: KIND_COLOR[KIND_AIMED],
    age: 0,
    rot: 0,
    spin: 0,
    turn: 0,
    pulse: 0,
    grazed: false,
  };
}

export function createBulletPool(capacity: number): Bullet[] {
  return Array.from({ length: capacity }, blankBullet);
}

/**
 * A pending wall. The cue and the wall are the same object: it holds every
 * parameter of the volley while it is still just a warning on the edge, then
 * spawns from those parameters when the timer runs out.
 */
export interface WallCue {
  active: boolean;
  /** 0 = spans the full height and travels along x; 1 = spans width, travels along y. */
  axis: 0 | 1;
  /** Travel direction along that axis. */
  dir: 1 | -1;
  /** Center of the single opening, in span coordinates. */
  gapCenter: number;
  gapHalf: number;
  spacing: number;
  speed: number;
  /** Seconds left before the wall fires. */
  timer: number;
  /** Telegraph length, kept so the cue can draw its own charge-up. */
  total: number;
}

export function createWallCue(): WallCue {
  return {
    active: false,
    axis: 0,
    dir: 1,
    gapCenter: 0,
    gapHalf: 70,
    spacing: 36,
    speed: 200,
    timer: 0,
    total: 1,
  };
}

/** The stage-3 emitter: a point that crawls around the border, spraying a fan. */
export interface SpiralEmitter {
  /** Perimeter parameter in [0, 4): one unit per side, clockwise from top-left. */
  p: number;
  /** Current fan angle. */
  angle: number;
  /** Sweep direction, flipped every burst so the pattern is not memorizable. */
  spinDir: 1 | -1;
  fireCd: number;
  /** Seconds left in the current burst-or-rest phase. */
  phase: number;
  firing: boolean;
}

export function createSpiral(): SpiralEmitter {
  return { p: 0, angle: 0, spinDir: 1, fireCd: 0, phase: 0, firing: false };
}

/**
 * A boost can waiting to be collected.
 *
 * Deliberately not a Bullet: it shares no field with one, so no loop can ever
 * treat a can as a hazard by accident.
 */
/** Pickup kinds. Numeric for the same reason bullet kinds are. */
export const PICK_FUEL = 0;
export const PICK_LASER = 1;

export type PickupKind = 0 | 1;

export interface Pickup {
  active: boolean;
  /** Fuel can or laser cell. */
  kind: PickupKind;
  x: number;
  y: number;
  /** Seconds of life left. Drives the fade-out, so it is never snapped away. */
  life: number;
  /** Counts up from spawn; drives the pop-in scale. */
  age: number;
  /** Random phase so two cans on screen never bob in lockstep. */
  bob: number;
}

function blankPickup(): Pickup {
  return { active: false, kind: PICK_FUEL, x: 0, y: 0, life: 0, age: 0, bob: 0 };
}

export function createPickupPool(capacity: number): Pickup[] {
  return Array.from({ length: capacity }, blankPickup);
}

/**
 * Can livery. Green and cyan only, and both are structurally unavailable to
 * hazards: KIND_COLOR is entirely warm/violet and green is already the arena's
 * one word for "safe" (the wall's gap lane). A can therefore cannot be misread
 * as a threat even in peripheral vision on a full screen.
 */
export const CAN_BODY = "#4ecb71";
export const CAN_OUTLINE = "#2c8b4c";
export const CAN_TRIM = "#2fd6c4";
export const CAN_TRIM_OUTLINE = "#158c81";
