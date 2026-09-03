/**
 * The facing model: eight compass points, all of them live from the first
 * spawn. There is no tier ladder any more — the opening teaches eight answers
 * at once, with the warning flare (see enemies.ts) carrying that load for the
 * first twelve seconds instead of a slow unlock doing it over half a minute.
 * Nothing downstream ever special-cases a named pair.
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
import { STRIKE_DIST, spawnDistFor } from "./arena";

const Q = Math.SQRT1_2;
const P4 = Math.PI / 4;

export interface DirInfo {
  /** Unit vector pointing from the player toward that side. */
  vx: number;
  vy: number;
  /** Distance to this direction's own wall; where its enemies start. */
  spawn: number;
  /** spawn - STRIKE_DIST, the distance an enemy of this side actually covers. */
  travel: number;
  /** Canvas-space angle of that unit vector, radians. */
  angle: number;
  /**
   * Compass index: 0 = right, one step per 45 degrees clockwise. The scheduling
   * guard, the chain mixer and the diagonal-compose grace all reason in these
   * steps, which is what keeps them from degenerating into a list of
   * hand-written pairs.
   */
  octant: number;
  diagonal: boolean;
  opposite: Dir;
  /**
   * Pitch multiplier for this side's warning sound. Pitch tracks height on
   * screen, so the ear places the threat vertically before the eye finds it —
   * which is why the caller slides it back to 1 once the flare is gone. A sound
   * that names the side would be the flare with the picture turned off.
   *
   * The pre-arrival `warn` tick is the ONLY cue this reaches: the arrival sound
   * is a noise burst, and AudioManager applies detune to oscillators only, so
   * noise cannot carry a pitch however it is called. Neutralizing `warn` really
   * does close the last channel that answers the question early.
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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
    spawn: 0,
    travel: 0,
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

/**
 * The compass in order, indexed by octant.
 *
 * Every pick below is octant arithmetic on this table rather than a filtered
 * list plus a retry loop: "at least two steps from the last one" is one modulo
 * and no allocation, and it can never fail to find a side.
 */
const OCTANT_DIRS: readonly Dir[] = [
  "right",
  "downRight",
  "down",
  "downLeft",
  "left",
  "upLeft",
  "up",
  "upRight",
];

/**
 * Uniform over all eight sides, from the very first spawn.
 *
 * Uniform rather than weighted on purpose: the diagonals used to be a late
 * unlock earned by surviving, and a player who only ever sees them at 34s has
 * spent half a minute learning that "the answer is one of four". Opening flat
 * means the read the player builds in the first ten seconds is the read the
 * whole run uses. It also puts a diagonal on half of all spawns, which is what
 * makes the flare worth paying attention to while it is still there.
 */
export function pickSpawnDir(): Dir {
  return OCTANT_DIRS[(Math.random() * 8) | 0];
}

/** A side other than `dir`, used when the scheduler retries a congested one. */
export function pickSpawnDirExcept(dir: Dir): Dir {
  const step = 1 + ((Math.random() * 7) | 0);
  return OCTANT_DIRS[(DIR_INFO[dir].octant + step) & 7];
}

/**
 * The next side of a chain: at least `minSteps` around the compass from the one
 * before it.
 *
 * A burst that repeats a side is one answer held, not several read — the player
 * turns once and waits. Forcing a real gap between links is what makes a chain
 * the thing it is fun for: several directions in quick succession. The offset
 * is drawn from the legal range directly, so no draw is ever rejected and the
 * cost is one modulo.
 *
 * `minSteps` is 1..4; two steps is the useful floor, since one step is the pose
 * the compose ambiguity already lives in.
 */
export function pickChainDir(prev: Dir, minSteps: number): Dir {
  const span = 9 - 2 * minSteps;
  const off = minSteps + ((Math.random() * span) | 0);
  return OCTANT_DIRS[(DIR_INFO[prev].octant + off) & 7];
}


// Derived rather than typed out: the wall distance is pure geometry, and a
// hand-written copy would drift the moment the stage or the player moved.
for (const info of Object.values(DIR_INFO)) {
  info.spawn = spawnDistFor(info.vx, info.vy);
  info.travel = info.spawn - STRIKE_DIST;
}
