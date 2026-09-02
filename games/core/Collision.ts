import { distSq } from "./Vector2";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function circleHit(a: Circle, b: Circle): boolean {
  const rr = a.r + b.r;
  return distSq(a.x, a.y, b.x, b.y) <= rr * rr;
}

/** Circle vs circle with a forgiveness margin subtracted from the sum of radii. */
export function circleHitForgiving(a: Circle, b: Circle, forgiveness: number): boolean {
  const rr = Math.max(0, a.r + b.r - forgiveness);
  return distSq(a.x, a.y, b.x, b.y) <= rr * rr;
}

export function rectHit(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** `rect` uses top-left origin. */
export function circleRectHit(c: Circle, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(c.x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(c.y, rect.y + rect.h));
  return distSq(c.x, c.y, nx, ny) <= c.r * c.r;
}

/** Distance between circle edges. Negative when overlapping. Used for grazing. */
export function edgeGap(a: Circle, b: Circle): number {
  return Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r);
}

export function outOfBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  margin: number
): boolean {
  return x < -margin || x > w + margin || y < -margin || y > h + margin;
}
