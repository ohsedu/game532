/**
 * Data shapes, pools and colour tables for AIM LAB.
 *
 * Plain data only — AimGame owns every behaviour. Pools are built once when the
 * game object is constructed and are only ever flipped with `active`, so a run
 * never allocates.
 */

export const TAU = Math.PI * 2;

/**
 * Target fills.
 *
 * Three hues only, because two candy colours are reserved and may never appear
 * on a live target:
 *   green  — the "plenty of time" tier of the countdown ring. Green must mean
 *            safe here exactly like it does in BULLET DODGE.
 *   purple — the decoy, the one thing on the range you must NOT click. If a
 *            real target could ever wear it, the single read the whole
 *            variation depends on would be gone.
 */
export const TARGET_FILL: readonly string[] = ["#ffb443", "#4f8cff", "#a77bff"];

/** Darker companion per fill, for the outline that lifts a disc off the floor. */
export const TARGET_LINE: readonly string[] = ["#c8425f", "#c07a12", "#2f6ad1"];

/** Middle band of the bullseye. White, so the rings read at a 20px radius. */
export const TARGET_BAND = "#ffffff";

export const DECOY_FILL = "#a77bff";
export const DECOY_LINE = "#6d45c4";

/**
 * Countdown ring tiers. Three flat steps rather than a gradient: when four
 * timers are draining at once the player is triaging at a glance, and a
 * discrete colour change is read far faster than a slow hue shift.
 */
export const RING_OK = "#4ecb71";
export const RING_MID = "#ffb443";
export const RING_LOW = "#ff3d63";
/** Fraction of life below which a ring switches tier. */
export const RING_MID_AT = 0.5;
export const RING_LOW_AT = 0.26;

export interface Target {
  active: boolean;
  x: number;
  y: number;
  /** Radius at spawn. The drawn radius shrinks with the timer; see AimGame. */
  r: number;
  life: number;
  maxLife: number;
  decoy: boolean;
  /** Index into TARGET_FILL. Unused by decoys, which own a single colour. */
  colorI: number;
  /**
   * 0..1 spawn-in animation. A real target's hit test ignores it — the box is
   * full size from frame one, so an early click can only ever be forgiven. A
   * decoy's punish box does follow it, because there the same slack would
   * punish a click on floor that is still empty.
   */
  pop: number;
  /** Per-second pop rate, so the animation stays a fixed *share* of a short life. */
  popRate: number;
  /** True once the "about to expire" tick has fired, so it fires at most once. */
  warned: boolean;
}

export function createTargetPool(n: number): Target[] {
  return Array.from({ length: n }, () => ({
    active: false,
    x: 0,
    y: 0,
    r: 0,
    life: 0,
    maxLife: 1,
    decoy: false,
    colorI: 0,
    pop: 0,
    popRate: 9,
    warned: false,
  }));
}

/** A spent click, left on the range so the player can read their grouping. */
export interface Marker {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  hit: boolean;
  color: string;
}

export function createMarkerPool(n: number): Marker[] {
  return Array.from({ length: n }, () => ({
    active: false,
    x: 0,
    y: 0,
    life: 0,
    maxLife: 1,
    hit: false,
    color: "#ffffff",
  }));
}

/** Floating score / penalty text. */
export interface Popup {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  label: string;
  color: string;
  big: boolean;
}

export function createPopupPool(n: number): Popup[] {
  return Array.from({ length: n }, () => ({
    active: false,
    x: 0,
    y: 0,
    life: 0,
    maxLife: 1,
    label: "",
    color: "#ffffff",
    big: false,
  }));
}
