import { rampAsymptotic } from "@/games/core/curve";
import type { ArrowKey } from "@/games/core/InputManager";

/**
 * The facing model. Four directions exist from day one even though v1 only
 * spawns from the sides — opening a side is a weight change, not a refactor.
 */
export type Dir = "up" | "down" | "left" | "right";

export interface DirInfo {
  /** Unit vector pointing from the player toward that side. */
  vx: number;
  vy: number;
  /** Canvas-space angle of that unit vector, radians. */
  angle: number;
  opposite: Dir;
  /**
   * Pitch multiplier for this side's warning sound. Each side gets its own
   * pitch so the ear can identify the threat before the eye finds the flare.
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
    opposite: "left",
    detune: 1.06,
    label: "RIGHT",
    from: "THE RIGHT",
    labelKo: "오른쪽",
  },
  down: {
    vx: 0,
    vy: 1,
    angle: Math.PI / 2,
    opposite: "up",
    detune: 0.78,
    label: "DOWN",
    from: "BELOW",
    labelKo: "아래",
  },
  left: {
    vx: -1,
    vy: 0,
    angle: Math.PI,
    opposite: "right",
    detune: 0.9,
    label: "LEFT",
    from: "THE LEFT",
    labelKo: "왼쪽",
  },
  up: {
    vx: 0,
    vy: -1,
    angle: -Math.PI / 2,
    opposite: "down",
    detune: 1.18,
    label: "UP",
    from: "ABOVE",
    labelKo: "위",
  },
};

export const KEY_TO_DIR: Record<ArrowKey, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function isVertical(dir: Dir): boolean {
  return dir === "up" || dir === "down";
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
 * Weight of a single vertical side against a horizontal side's 1. Asymptotic to
 * 0.9, so vertical strikes top out near 47% of spawns: enough that the player
 * can never stop checking, not so much that the horizontal duel stops being the
 * spine of the game.
 */
export function verticalWeight(elapsed: number): number {
  if (elapsed < VERTICAL_START) return 0;
  return rampAsymptotic(elapsed - VERTICAL_START, 0, 0.9, 15);
}

export interface SpawnRow {
  dir: Dir;
  weight: number;
  vertical: boolean;
}

export const SPAWN_TABLE: readonly SpawnRow[] = [
  { dir: "left", weight: 1, vertical: false },
  { dir: "right", weight: 1, vertical: false },
  { dir: "up", weight: 1, vertical: true },
  { dir: "down", weight: 1, vertical: true },
];

function rowWeight(row: SpawnRow, vert: number): number {
  return row.vertical ? row.weight * vert : row.weight;
}

/** Weighted pick. A vertical weight of 0 makes up/down unreachable. */
export function pickSpawnDir(vert: number): Dir {
  let total = 0;
  for (let i = 0; i < SPAWN_TABLE.length; i++) total += rowWeight(SPAWN_TABLE[i], vert);
  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < SPAWN_TABLE.length; i++) {
    acc += rowWeight(SPAWN_TABLE[i], vert);
    if (r < acc) return SPAWN_TABLE[i].dir;
  }
  return SPAWN_TABLE[0].dir;
}

/** A spawnable side other than `dir`, used when the scheduler retries. */
export function pickSpawnDirExcept(dir: Dir, vert: number): Dir {
  for (let attempt = 0; attempt < 8; attempt++) {
    const d = pickSpawnDir(vert);
    if (d !== dir) return d;
  }
  // The opposite side is always spawnable whenever `dir` itself was.
  return DIR_INFO[dir].opposite;
}
