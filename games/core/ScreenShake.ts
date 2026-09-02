import { randRange } from "./Vector2";

/** Decaying positional shake. Apply around the whole scene render. */
export class ScreenShake {
  private time = 0;
  private duration = 0;
  private magnitude = 0;
  x = 0;
  y = 0;

  /** Stacks with whatever shake is already running instead of replacing it. */
  add(magnitude: number, duration = 0.25): void {
    this.magnitude = Math.max(this.magnitude, magnitude);
    this.duration = Math.max(this.duration, duration);
    this.time = this.duration;
  }

  update(dt: number): void {
    if (this.time <= 0) {
      this.x = 0;
      this.y = 0;
      this.magnitude = 0;
      return;
    }
    this.time -= dt;
    const t = Math.max(0, this.time / this.duration);
    const falloff = t * t;
    const m = this.magnitude * falloff;
    this.x = randRange(-m, m);
    this.y = randRange(-m, m);
  }

  reset(): void {
    this.time = 0;
    this.duration = 0;
    this.magnitude = 0;
    this.x = 0;
    this.y = 0;
  }
}
