import { roundRect, withAlpha } from "./draw";

/**
 * Speed boost with a spendable, self-refilling fuel bar.
 *
 * Shared by both movement games so the mechanic feels identical in each: the
 * numbers here are the mechanic, and duplicating them per game is how they
 * drift apart.
 *
 * The design intent is an escape tool, not a movement upgrade — hence a short
 * burn, a deliberate pause before it starts coming back, and a refill slower
 * than the drain. Holding it down is always worse than saving it.
 */
export class Booster {
  /** 0..1. */
  fuel = 1;
  /** True on frames where boost is actually being applied. */
  active = false;

  /** Full tank empties in 1 / DRAIN seconds of continuous use. */
  private static readonly DRAIN = 0.55;
  /** Empty tank refills in 1 / REFILL seconds. */
  private static readonly REFILL = 0.2;
  /** Quiet period after releasing before fuel starts returning. */
  private static readonly REFILL_DELAY = 0.55;
  /**
   * A tank below this cannot start a boost. Without it, tapping at 1% fuel
   * gives a stutter of thrust every frame and the bar never visibly recovers.
   */
  private static readonly MIN_TO_ENGAGE = 0.12;

  private sinceRelease = 0;
  private engaged = false;

  /** Multiplier applied to movement speed while boosting. */
  readonly multiplier: number;

  constructor(multiplier = 1.75) {
    this.multiplier = multiplier;
  }

  reset(): void {
    this.fuel = 1;
    this.active = false;
    this.engaged = false;
    this.sinceRelease = 0;
  }

  /**
   * @param wants Whether the player is asking for boost this frame.
   * @returns The speed multiplier to apply — 1 when not boosting.
   */
  update(dt: number, wants: boolean): number {
    if (wants && !this.engaged && this.fuel >= Booster.MIN_TO_ENGAGE) {
      this.engaged = true;
    }
    if (!wants || this.fuel <= 0) {
      this.engaged = false;
    }

    this.active = this.engaged;

    if (this.active) {
      this.fuel = Math.max(0, this.fuel - Booster.DRAIN * dt);
      this.sinceRelease = 0;
      return this.multiplier;
    }

    this.sinceRelease += dt;
    if (this.sinceRelease >= Booster.REFILL_DELAY) {
      this.fuel = Math.min(1, this.fuel + Booster.REFILL * dt);
    }
    return 1;
  }

  /** True when the player could start a boost right now. */
  get ready(): boolean {
    return this.fuel >= Booster.MIN_TO_ENGAGE;
  }

  /**
   * Vertical gauge, drawn hugging the right edge of the play area.
   *
   * Deliberately slim and low-contrast: it has to be glanceable without ever
   * competing with a hazard for the player's attention.
   */
  render(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    accent: string,
    ink = "#22252d"
  ): void {
    const r = w / 2;

    g.save();

    // Rocket cap, so the bar reads as thrust rather than as a generic meter.
    this.drawRocket(g, x + r, y - 15, this.ready ? accent : withAlpha(ink, 0.3));

    // Track.
    g.fillStyle = withAlpha(ink, 0.07);
    roundRect(g, x, y, w, h, r);
    g.fill();

    // Fill grows upward from the bottom, so "running out" reads as draining.
    const fh = Math.max(0, h * this.fuel);
    if (fh > 0.5) {
      const empty = !this.ready;
      g.fillStyle = empty ? withAlpha(ink, 0.22) : this.active ? "#ffffff" : accent;
      if (this.active) {
        g.shadowColor = withAlpha(accent, 0.9);
        g.shadowBlur = 10;
      }
      roundRect(g, x, y + h - fh, w, fh, r);
      g.fill();
      g.shadowBlur = 0;

      // While boosting the bar is white-hot; a thin accent edge keeps it
      // legible against a light background.
      if (this.active) {
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        roundRect(g, x, y + h - fh, w, fh, r);
        g.stroke();
      }
    }

    // Cap line marking the minimum needed to engage, so an empty-ish bar
    // explains why nothing happens.
    const capY = y + h - h * Booster.MIN_TO_ENGAGE;
    g.strokeStyle = withAlpha(ink, 0.18);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 1, capY);
    g.lineTo(x + w + 1, capY);
    g.stroke();

    g.restore();
  }

  /** Small flat rocket, nose up, drawn around (cx, cy). */
  private drawRocket(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string
  ): void {
    g.save();
    g.translate(cx, cy);
    g.fillStyle = color;

    // Body: a teardrop — pointed nose, rounded tail.
    g.beginPath();
    g.moveTo(0, -9);
    g.quadraticCurveTo(4.6, -2.5, 4.2, 4);
    g.quadraticCurveTo(0, 6.4, -4.2, 4);
    g.quadraticCurveTo(-4.6, -2.5, 0, -9);
    g.closePath();
    g.fill();

    // Fins.
    g.beginPath();
    g.moveTo(-4.1, 0.6);
    g.lineTo(-7.4, 5.4);
    g.lineTo(-4.1, 4.6);
    g.closePath();
    g.moveTo(4.1, 0.6);
    g.lineTo(7.4, 5.4);
    g.lineTo(4.1, 4.6);
    g.closePath();
    g.fill();

    // Window.
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(0, -2.2, 1.7, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";

    // Exhaust, only while actually burning.
    if (this.active) {
      g.fillStyle = color;
      g.globalAlpha = 0.55;
      g.beginPath();
      g.moveTo(-2.2, 6);
      g.quadraticCurveTo(0, 12.5, 2.2, 6);
      g.closePath();
      g.fill();
    }

    g.restore();
  }
}
