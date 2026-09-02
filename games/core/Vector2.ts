export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function add(out: Vec2, x: number, y: number): Vec2 {
  out.x += x;
  out.y += y;
  return out;
}

export function scale(out: Vec2, s: number): Vec2 {
  out.x *= s;
  out.y *= s;
  return out;
}

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

/** Normalizes (x, y); returns {x:0,y:0} for a zero vector instead of NaN. */
export function normalize(out: Vec2, x: number, y: number): Vec2 {
  const l = Math.hypot(x, y);
  if (l === 0) return set(out, 0, 0);
  return set(out, x / l, y / l);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing toward `b`. */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, maxInclusive: number): number {
  return Math.floor(min + Math.random() * (maxInclusive - min + 1));
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
