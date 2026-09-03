/**
 * The geometry of a drag-anywhere joystick, kept out of React so it can be
 * driven by a script and measured.
 *
 * `dx, dy` is the thumb's displacement from a moving origin, in CSS px. The
 * component that owns the pointer feeds `begin` and `move`; the input manager
 * turns the displacement into arrow keys.
 *
 * Two rules move the origin:
 *
 * 1. **Follow.** Past `radius` the origin is dragged along, so a long pull keeps
 *    steering instead of pinning at the edge.
 *
 * 2. **Reversal assist.** When the thumb moves fast *against* its displacement
 *    on an axis, the origin moves the same way on that axis, `reverseGain`
 *    times as far.
 *
 *    A plain following stick is slow to reverse: after a pull of `radius` the
 *    origin sits `radius` behind the thumb, so a reversal spends that whole
 *    distance still reporting the OLD direction, then a deadzone of nothing,
 *    before the new direction exists. At the old 52px radius and 12px deadzone
 *    that was 64px of thumb travel — most of a phone's thumb reach — to flip
 *    from up-right to down-left, and it read as the character swinging round.
 *    With the assist the displacement collapses at (1 + gain) times the thumb
 *    speed, so a reversal costs (radius + deadzone) / (1 + gain) of travel.
 *
 *    Per axis, because the input is per axis. Up-right to up-left moves the
 *    thumb against x while y is untouched; assisting along the whole motion
 *    vector would have been right here, but on a curved thumb path it triples
 *    the tangential motion too, and the direction skips a sector. Assisting
 *    along the displacement instead shrinks the axis the player is keeping.
 *    Treating x and y separately does neither.
 *
 *    Gated on SPEED, not distance. The assist is one-sided — moving with the
 *    displacement is capped by the follow rule, moving against it is amplified
 *    — so any back-and-forth that clears a distance floor ratchets: each cycle
 *    nets a loss, and a held direction quietly drains to nothing. A tremor is
 *    slow (a pixel or two per frame, under 150px/s) and a reversal is fast
 *    (300px/s and up), so the speed of the motion tells them apart where its
 *    length cannot. A tremor is left at 1:1, where the follow rule restores
 *    whatever it takes.
 */
export class VirtualStick {
  /** Thumb displacement from the origin. Read after each move(). */
  dx = 0;
  dy = 0;

  private ox = 0;
  private oy = 0;
  private tx = 0;
  private ty = 0;
  /** Timestamp of the last sample, ms. */
  private tt = 0;

  constructor(
    private readonly radius: number,
    private readonly reverseGain: number,
    /** Thumb speed, px/s, from which a motion counts as a reversal. */
    private readonly reverseSpeed: number
  ) {}

  /** The thumb landed. The origin is wherever it landed. */
  begin(x: number, y: number, t: number): void {
    this.ox = this.tx = x;
    this.oy = this.ty = y;
    this.tt = t;
    this.dx = 0;
    this.dy = 0;
  }

  move(x: number, y: number, t: number): void {
    // This event's thumb motion, before the thumb is updated.
    const mx = x - this.tx;
    const my = y - this.ty;
    const ms = t - this.tt;
    this.tx = x;
    this.ty = y;
    this.tt = t;

    // Two samples with one timestamp carry no speed; leave them at 1:1.
    const fast = ms > 0 && (Math.hypot(mx, my) / ms) * 1000 >= this.reverseSpeed;
    if (fast) {
      if (this.dx * mx < 0) this.ox -= mx * this.reverseGain;
      if (this.dy * my < 0) this.oy -= my * this.reverseGain;
    }

    this.dx = this.tx - this.ox;
    this.dy = this.ty - this.oy;

    // Follow.
    const d = Math.hypot(this.dx, this.dy);
    if (d > this.radius) {
      const pull = (d - this.radius) / d;
      this.ox += this.dx * pull;
      this.oy += this.dy * pull;
      this.dx = this.tx - this.ox;
      this.dy = this.ty - this.oy;
    }
  }
}
