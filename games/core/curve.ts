/**
 * Difficulty ramp helpers.
 *
 * All games share these so the three difficulty curves feel like they belong to
 * the same arcade rather than three unrelated projects.
 */

/** Linear ramp from `from` to `to` over `seconds`, then held at `to`. */
export function rampLinear(t: number, from: number, to: number, seconds: number): number {
  if (seconds <= 0) return to;
  const k = Math.min(1, Math.max(0, t / seconds));
  return from + (to - from) * k;
}

/**
 * Ease-out ramp: fast early gains that flatten out. Good for values the player
 * should feel changing immediately (spawn rate).
 */
export function rampEaseOut(t: number, from: number, to: number, seconds: number): number {
  if (seconds <= 0) return to;
  const k = Math.min(1, Math.max(0, t / seconds));
  return from + (to - from) * (1 - Math.pow(1 - k, 2));
}

/**
 * Ease-in ramp: gentle at first, steep later. Good for values that would make
 * the opening unfair if they climbed early (projectile speed).
 */
export function rampEaseIn(t: number, from: number, to: number, seconds: number): number {
  if (seconds <= 0) return to;
  const k = Math.min(1, Math.max(0, t / seconds));
  return from + (to - from) * k * k;
}

/**
 * Unbounded asymptotic growth: approaches `from + range` but never exceeds it.
 * Keeps very long runs escalating without a hard ceiling moment.
 */
export function rampAsymptotic(t: number, from: number, range: number, halfLife: number): number {
  return from + range * (1 - Math.exp(-t / Math.max(0.001, halfLife)));
}

/** Discrete difficulty stage, 0-based, one step every `seconds`. */
export function stage(t: number, seconds: number, maxStage = Infinity): number {
  return Math.min(maxStage, Math.floor(t / Math.max(0.001, seconds)));
}

/**
 * Grace window at the start of a run where nothing can kill the player.
 * Every game uses the same value so the first second always feels safe.
 */
export const OPENING_GRACE = 1.1;
