/**
 * Pooled entity records for POOP STORM.
 *
 * Every array is allocated once in `onReset` and reused via the `active` flag,
 * so a frame of play never allocates.
 */

/** A single falling turd. `warning` means it is still telegraphing at the top edge. */
export interface Poop {
  active: boolean;
  /** While true the body is off-screen and only the top-edge marker is drawn. */
  warning: boolean;
  x: number;
  y: number;
  vy: number;
  r: number;
  warnLeft: number;
  warnTotal: number;
  /** Drives wobble rotation and the scale pulse. Position never wobbles — see PoopGame. */
  phase: number;
  wobble: number;
  grazed: boolean;
}

export function blankPoop(): Poop {
  return {
    active: false,
    warning: false,
    x: 0,
    y: 0,
    vy: 0,
    r: 12,
    warnLeft: 0,
    warnTotal: 1,
    phase: 0,
    wobble: 2,
    grazed: false,
  };
}

/** A flattened stain left on the ground strip. */
export interface Decal {
  active: boolean;
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  /** Frozen randomness so the blob shape stays put while it fades. */
  seed: number;
}

export function blankDecal(): Decal {
  return { active: false, x: 0, y: 0, r: 10, life: 0, maxLife: 1, seed: 0 };
}

/** Floating "NICE!" style text popped on a near miss. */
export interface Label {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  word: string;
  /** 0 hides the multiplier line. */
  combo: number;
}

export function blankLabel(): Label {
  return { active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1, word: "", combo: 0 };
}

/** Parallax haze drifting behind everything. */
export interface Cloud {
  x: number;
  y: number;
  s: number;
  vx: number;
  alpha: number;
}

export function blankCloud(): Cloud {
  return { x: 0, y: 0, s: 1, vx: -10, alpha: 0.08 };
}

/** Background dust speck. */
export interface Mote {
  x: number;
  y: number;
  r: number;
  vy: number;
  alpha: number;
}

export function blankMote(): Mote {
  return { x: 0, y: 0, r: 1, vy: 10, alpha: 0.1 };
}

/**
 * Everything the character renderer needs, kept as one preallocated record so
 * the draw call takes no argument list and allocates nothing.
 */
export interface GuyPose {
  x: number;
  y: number;
  /** Lean into travel, radians. */
  lean: number;
  squashX: number;
  squashY: number;
  legPhase: number;
  /** 0..1 stride width / arm swing. */
  run: number;
  /** 1 = eyes open, 0 = blinking. */
  eyes: number;
  /** 0..1 mouth openness — he screams when a turd is close. */
  scream: number;
  /** 0..1 flattened-by-poop death pose. */
  dead: number;
}

export function blankPose(): GuyPose {
  return {
    x: 0,
    y: 0,
    lean: 0,
    squashX: 1,
    squashY: 1,
    legPhase: 0,
    run: 0,
    eyes: 1,
    scream: 0,
    dead: 0,
  };
}

/**
 * A boost cell: the one thing that falls out of this sky and is good for you.
 *
 * It drifts down far slower than a turd and dissolves just above the floor, so
 * `fade` counts the dissolve down while the record is still active — snapping
 * it off would read as "you missed it" a frame before the player had.
 */
export interface Pickup {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  r: number;
  /** Drives tilt, bob and twinkle. */
  phase: number;
  /** Seconds since spawn; only used for the scale-in pop. */
  age: number;
  /** Seconds of dissolve left, or -1 while still falling. */
  fade: number;
  /** Seconds resting on the floor, driving the blink warning. Negative while falling. */
  grounded: number;
  /** Sparkle-trail emission accumulator, in particles. */
  trail: number;
}

export function blankPickup(): Pickup {
  return {
    active: false,
    x: 0,
    y: 0,
    vy: 0,
    r: 14,
    phase: 0,
    age: 0,
    fade: -1,
    grounded: -1,
    trail: 0,
  };
}
