export type FrameHandler = (dt: number) => void;

/**
 * requestAnimationFrame loop with delta-time clamping.
 *
 * dt is seconds. It is clamped to MAX_DT so that returning to a backgrounded
 * tab does not teleport entities through each other (tunneling).
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private running = false;

  static readonly MAX_DT = 1 / 20;

  constructor(private readonly onFrame: FrameHandler) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > GameLoop.MAX_DT) dt = GameLoop.MAX_DT;
    if (dt < 0) dt = 0;
    this.onFrame(dt);
    this.raf = requestAnimationFrame(this.tick);
  };
}
