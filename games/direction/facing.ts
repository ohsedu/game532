import { rampAsymptotic } from "@/games/core/curve";

/**
 * The facing model: eight compass points, complete from day one even though a
 * run only opens them a tier at a time. Opening a tier is a weight change, not
 * a refactor, and nothing downstream ever special-cases a named pair.
 */
export type Dir =
  | "up"
  | "down"
  | "left"
  | "right"
  | "upLeft"
  | "upRight"
  | "downLeft"
  | "downRight";

/** Diagonal unit component. Every side sits the same distance out, so approach
 *  time — and therefore the reaction window — never depends on the side. */
const Q = Math.SQRT1_2;
const P4 = Math.PI / 4;

export interface DirInfo {
  /** Unit vector pointing from the player toward that side. */
  vx: number;
  vy: number;
  /** Canvas-space angle of that unit vector, radians. */
  angle: number;
  /**
   * Compass index: 0 = right, one step per 45 degrees clockwise. The scheduling
   * guard and the diagonal-compose grace both reason in these steps, which is
   * what keeps them from degenerating into a list of hand-written pairs.
   */
  octant: number;
  diagonal: boolean;
  opposite: Dir;
  /**
   * Pitch multiplier for this side's warning sound. Pitch tracks height on
   * screen, so the ear places the threat vertically before the eye finds it.
   */
  detune: number;
  label: string;
  /** Reads after "STRUCK FROM ". "THE UP" is not English. */
  from: string;
  labelKo: string;
}

export const DIR_INFO: Record<Dir, DirInfo> = {
  right: {
    vx: 1,
    vy: 0,
    angle: 0,
    octant: 0,
    diagonal: false,
    opposite: "left",
    detune: 1.06,
    label: "RIGHT",
    from: "THE RIGHT",
    labelKo: "오른쪽",
  },
  downRight: {
    vx: Q,
    vy: Q,
    angle: P4,
    octant: 1,
    diagonal: true,
    opposite: "upLeft",
    detune: 0.9,
    label: "DOWN-RIGHT",
    from: "BELOW RIGHT",
    labelKo: "오른쪽 아래",
  },
  down: {
    vx: 0,
    vy: 1,
    angle: P4 * 2,
    octant: 2,
    diagonal: false,
    opposite: "up",
    detune: 0.76,
    label: "DOWN",
    from: "BELOW",
    labelKo: "아래",
  },
  downLeft: {
    vx: -Q,
    vy: Q,
    angle: P4 * 3,
    octant: 3,
    diagonal: true,
    opposite: "upRight",
    detune: 0.84,
    label: "DOWN-LEFT",
    from: "BELOW LEFT",
    labelKo: "왼쪽 아래",
  },
  left: {
    vx: -1,
    vy: 0,
    angle: Math.PI,
    octant: 4,
    diagonal: false,
    opposite: "right",
    detune: 0.98,
    label: "LEFT",
    from: "THE LEFT",
    labelKo: "왼쪽",
  },
  upLeft: {
    vx: -Q,
    vy: -Q,
    angle: -P4 * 3,
    octant: 5,
    diagonal: true,
    opposite: "downRight",
    detune: 1.12,
    label: "UP-LEFT",
    from: "ABOVE LEFT",
    labelKo: "왼쪽 위",
  },
  up: {
    vx: 0,
    vy: -1,
    angle: -P4 * 2,
    octant: 6,
    diagonal: false,
    opposite: "down",
    detune: 1.26,
    label: "UP",
    from: "ABOVE",
    labelKo: "위",
  },
  upRight: {
    vx: Q,
    vy: -Q,
    angle: -P4,
    octant: 7,
    diagonal: true,
    opposite: "downLeft",
    detune: 1.18,
    label: "UP-RIGHT",
    from: "ABOVE RIGHT",
    labelKo: "오른쪽 위",
  },
};

/**
 * Held-axis pair -> facing, indexed by (axisY + 1) * 3 + (axisX + 1).
 *
 * Facing is derived from what is HELD, not from a press edge: a diagonal on the
 * keyboard is two arrows down together, and on touch it is two taps delivered
 * on the same frame, so one table serves both without a touch-specific path.
 */
const AXIS_DIRS: readonly (Dir | null)[] = [
  "upLeft",
  "up",
  "upRight",
  "left",
  null,
  "right",
  "downLeft",
  "down",
  "downRight",
];

/** null while nothing is held, so the caller can latch the last real facing. */
export function dirFromAxes(ax: number, ay: number): Dir | null {
  return AXIS_DIRS[(ay + 1) * 3 + (ax + 1)];
}

/** Compass steps between two facings, 0 (same) to 4 (opposite). */
export function octantDist(a: Dir, b: Dir): number {
  const d = Math.abs(DIR_INFO[a].octant - DIR_INFO[b].octant);
  return d > 4 ? 8 - d : d;
}

export function isVertical(dir: Dir): boolean {
  return dir === "up" || dir === "down";
}

export function isDiagonal(dir: Dir): boolean {
  return DIR_INFO[dir].diagonal;
}

/**
 * Seconds before the vertical sides open.
 *
 * Until then the duel is a binary read — the answer is always "the other one" —
 * and every difficulty knob before this point only makes that same read faster.
 * Opening up/down changes the question itself from one bit to two, which is the
 * one escalation in this game that alters what the player is actually doing.
 */
export const VERTICAL_START = 16;

/**
 * Seconds before the diagonals open, the second and last rule change.
 *
 * Deliberately far behind the verticals: a diagonal is not just a fifth answer,
 * it is the first one that costs two keys instead of one, so the player needs
 * the four-way read to be automatic before the input itself gets harder.
 */
export const DIAGONAL_START = 34;

/**
 * Weight of a single vertical side against a horizontal side's 1. Asymptotic to
 * 0.9, so vertical strikes top out near 47% of spawns: enough that the player
 * can never stop checking, not so much that the horizontal duel stops being the
 * spine of the game.
 */
export function verticalWeight(elapsed: number): number {
  if (elapsed < VERTICAL_START) return 0;
  return rampAsymptotic(elapsed - VERTICAL_START, 0, 0.9, 15);
}

/**
 * Weight of a single diagonal. Lower per side than a cardinal, but there are
 * four of them, so they settle near 44% of spawns collectively — the hardest
 * read is common enough to matter and still never the majority of the run.
 */
export function diagonalWeight(elapsed: number): number {
  if (elapsed < DIAGONAL_START) return 0;
  return rampAsymptotic(elapsed - DIAGONAL_START, 0, 0.75, 18);
}

/** 0 = always live, 1 = gated on the vertical weight, 2 = on the diagonal one. */
const TIER_ALWAYS = 0;
const TIER_VERTICAL = 1;
const TIER_DIAGONAL = 2;

export interface SpawnRow {
  dir: Dir;
  weight: number;
  tier: number;
}

export const SPAWN_TABLE: readonly SpawnRow[] = [
  { dir: "left", weight: 1, tier: TIER_ALWAYS },
  { dir: "right", weight: 1, tier: TIER_ALWAYS },
  { dir: "up", weight: 1, tier: TIER_VERTICAL },
  { dir: "down", weight: 1, tier: TIER_VERTICAL },
  { dir: "upLeft", weight: 1, tier: TIER_DIAGONAL },
  { dir: "upRight", weight: 1, tier: TIER_DIAGONAL },
  { dir: "downLeft", weight: 1, tier: TIER_DIAGONAL },
  { dir: "downRight", weight: 1, tier: TIER_DIAGONAL },
];

function rowWeight(row: SpawnRow, vert: number, diag: number): number {
  if (row.tier === TIER_VERTICAL) return row.weight * vert;
  if (row.tier === TIER_DIAGONAL) return row.weight * diag;
  return row.weight;
}

/** Weighted pick. A tier weight of 0 makes that tier unreachable. */
export function pickSpawnDir(vert: number, diag: number): Dir {
  let total = 0;
  for (let i = 0; i < SPAWN_TABLE.length; i++) total += rowWeight(SPAWN_TABLE[i], vert, diag);
  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < SPAWN_TABLE.length; i++) {
    acc += rowWeight(SPAWN_TABLE[i], vert, diag);
    if (r < acc) return SPAWN_TABLE[i].dir;
  }
  return SPAWN_TABLE[0].dir;
}

/** A spawnable side other than `dir`, used when the scheduler retries. */
export function pickSpawnDirExcept(dir: Dir, vert: number, diag: number): Dir {
  for (let attempt = 0; attempt < 8; attempt++) {
    const d = pickSpawnDir(vert, diag);
    if (d !== dir) return d;
  }
  // Opposites always share a tier, so this is spawnable whenever `dir` was.
  return DIR_INFO[dir].opposite;
}
