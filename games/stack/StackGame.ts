import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import { OPENING_GRACE, rampAsymptotic, rampLinear } from "@/games/core/curve";
import { drawGrid, roundRect, text, withAlpha, type TextOptions } from "@/games/core/draw";
import type { ParticleOptions } from "@/games/core/Particles";
import { clamp, damp, randRange } from "@/games/core/Vector2";
import {
  CANDY,
  CANDY_DARK,
  createDebris,
  createLabels,
  createRows,
  TAU,
} from "./entities";

const ACCENT = "#4ecb71";
const BG = "#f7f8fc";
const FLOOR = "#eef0f7";
const INK = "#22252d";
const INK_DIM = "#6d7280";
const INK_FAINT = "#a3a8b5";

// Strings that never change are built once: withAlpha() parses a hex and
// concatenates an rgba string, which has no business running 60 times a second.
const C_GRID = "rgba(91,95,221,0.06)";
const C_SHADOW = "rgba(24,28,45,0.14)";
const C_SHADOW_SOFT = "rgba(24,28,45,0.08)";
const C_FRAME = "rgba(91,95,221,0.10)";
const C_BLOOM = "rgba(255,255,255,0.55)";
const C_GLOSS = "rgba(255,255,255,0.42)";
const C_GROUND = "#e6e9f3";
const C_GROUND_EDGE = "rgba(91,95,221,0.16)";
const C_MARKER = "rgba(91,95,221,0.13)";
const C_GUIDE = withAlpha(ACCENT, 0.34);
const C_PERFECT_BAND = withAlpha(ACCENT, 0.18);
const C_WHITE = "#ffffff";
const C_FLASH = "#fff3e6";
const C_BODY_FILL = "#ffffff";

// --- Card layout. Cosmetic only; the arena is still the full 1000x700. ------
const PANEL_PAD = 8;
const PANEL_R = 30;
const BANNER_W = 400;
const BANNER_H = 70;
const BANNER_Y = 74;
const BANNER_TIME = 1.5;

// --- Tower geometry --------------------------------------------------------
const BLOCK_H = 34;
const BLOCK_R = 9;
/** Starting width, and the hard ceiling the perfect-recovery may restore to. */
const START_W = 300;
const CENTER_X = 500;
/**
 * The corridor the moving block sweeps inside. 780px wide, so even a full
 * 300px block has 240px of centre travel available on either side of the tower.
 */
const ARENA_L = 110;
const ARENA_R = 890;
/** Screen y the moving block's top edge is pinned to. Everything else scrolls. */
const ANCHOR_Y = 250;
/**
 * Rows placed before the player touches anything, so the first drop lands on a
 * plinth instead of on a single brick floating over an empty floor.
 */
const FOUNDATION_ROWS = 1;
/**
 * Ring buffer of settled rows. The death pull-back bottoms out at CAM_SCALE_MIN,
 * which can show at most 700 / (0.22 * 34) ~= 94 rows, and that shot is anchored
 * to the TOP of the tower (see stepCamera), so the rows it asks for are always
 * among the newest 94. 110 leaves margin over that.
 */
const KEEP_ROWS = 110;

// --- Difficulty ------------------------------------------------------------
/**
 * Sweep speed, ramped against blocks placed rather than seconds: a player who
 * thinks before every tap should not be punished for thinking. Asymptotic so a
 * long run keeps tightening without a wall moment — it approaches 500px/s.
 */
const SPEED_FROM = 240;
const SPEED_RANGE = 260;
const SPEED_HALFLIFE = 22;
/**
 * Half-width of the sweep, measured from the centre of the block below. Keeping
 * the sweep centred on the target guarantees a perfect is always reachable no
 * matter how far the tower has drifted; a stacker that can hand you an
 * unreachable target is a slot machine, not a game.
 */
const SWING_FROM = 165;
const SWING_TO = 250;
const SWING_ROWS = 40;
/** A beat of stillness at spawn so the eye can find the new block before it moves. */
const SPAWN_PAUSE = 0.1;
/**
 * Minimum runway between the spawn edge and the target. When the tower has
 * drifted against a wall the clipped sweep can start almost on top of the
 * target, which would hand out a free perfect on the first frame and skip the
 * only decision the game has. The clipped sweep is never narrower than
 * SWING_FROM, so whenever one side is short the other has 100px+ of travel.
 */
const MIN_TRAVEL = 60;

// --- Perfect / recovery ----------------------------------------------------
/**
 * Centre misalignment that snaps flush. Deliberately CONSTANT: the sweep speed
 * already doubles over a run, which halves this window in real time. Shrinking
 * the pixels as well is what makes stackers feel like they cheated you.
 */
const PERFECT_PX = 7;
/**
 * Half a frame's sweep travel — the exact width at which consecutive rendered
 * positions can no longer step clean over the window, so a perfect stays
 * reachable on every pass. At 60fps that is ~4px and PERFECT_PX always wins, so
 * the normal case is untouched; at the loop's 20fps floor the block jumps 25px
 * per frame and a fixed 7px window would be literally unhittable — no tap could
 * land inside it. The drawn band stays at PERFECT_PX either way: a band that
 * breathed with the frame rate would be worse than one that is occasionally
 * more forgiving than it looks.
 */
const PERFECT_STEP_SHARE = 0.5;
/**
 * Floor on the width a slice may leave behind.
 *
 * Without it a landing that overhangs by (w - 0.2px) leaves a 0.2px sliver, and
 * the next drop has to be accurate to a fifth of a pixel — under half a
 * millisecond of sweep. That is a death with no readable chance, which is
 * exactly what this pass exists to remove. 20px is wider than the drawn perfect
 * band (2 * PERFECT_PX = 14) so the target always visibly fits inside the block,
 * and it still leaves a hard failure condition: the miss test uses this same
 * width, so at the floor the player must land within 20px or the run ends.
 */
const MIN_W = 20;
/** Perfects needed in a row before width starts coming back. */
const RECOVER_AT = 3;
const RECOVER_PX = 11;
/** A deep streak is the only way to rebuild a badly chewed tower quickly. */
const RECOVER_BIG_AT = 6;
const RECOVER_PX_BIG = 18;

// --- Scoring ---------------------------------------------------------------
const SCORE_BASE = 12;
/** Added on top of the base, scaled by how flush the landing was. */
const SCORE_CLEAN = 10;
/** ~4x a clean sloppy landing before the streak multiplier even starts. */
const SCORE_PERFECT = 50;
const MULT_CAP = 8;
const MILESTONE_EVERY = 10;
const SCORE_MILESTONE = 100;

// --- Camera ----------------------------------------------------------------
/** Settles a 34px step in ~0.3s: visibly a camera move, never a lag. */
const CAM_LAMBDA = 9;
const DEATH_CAM_LAMBDA = 2.4;
/** Pixels of tower the death shot tries to fit before it gives up and clips. */
const DEATH_FIT_H = 540;
const CAM_SCALE_MIN = 0.22;
/**
 * Where the top of the tower sits in the death shot once the tower is too tall
 * to fit: 0.36 of a screen height above centre, i.e. a comfortable 14% of the
 * frame as headroom above the final block.
 */
const DEATH_TOP_FRAC = 0.36;

// --- Debris ----------------------------------------------------------------
const DEBRIS_GRAVITY = 1500;
const DEBRIS_LIFE = 5;

/** Height rules every this many placed blocks. */
const MARKER_EVERY = 5;
/** Pre-rendered marker captions; String(n) in the render loop would allocate. */
const MARKER_LABELS: readonly string[] = Array.from({ length: 60 }, (_, i) =>
  String((i + 1) * MARKER_EVERY)
);
/** Likewise for the streak caption, which is drawn from an event, not a frame. */
const PERFECT_LABELS: readonly string[] = Array.from({ length: MULT_CAP }, (_, i) =>
  i === 0 ? "PERFECT" : "PERFECT x" + (i + 1)
);
const RECOVER_LABEL = "WIDTH +" + RECOVER_PX;
const RECOVER_LABEL_BIG = "WIDTH +" + RECOVER_PX_BIG;

// text() takes an options bag, and the render path calls it several times a
// frame. One reused object per call site keeps that off the allocator; every
// field that varies is assigned before each call, so nothing goes stale.
const MARKER_TXT: TextOptions = {
  size: 13,
  color: INK_FAINT,
  align: "right",
  alpha: 0.85,
};
const LABEL_TXT: TextOptions = {
  size: 24,
  color: ACCENT,
  alpha: 1,
  letterSpacing: "2px",
  shadow: C_SHADOW,
  shadowBlur: 6,
};
const HINT_TXT: TextOptions = {
  size: 15,
  color: INK_DIM,
  alpha: 1,
  letterSpacing: "5px",
};
/** Shown until the very first block lands, so an idle board never looks broken. */
const START_TXT: TextOptions = {
  size: 26,
  color: ACCENT,
  alpha: 1,
};
const START_SUB_TXT: TextOptions = {
  size: 14,
  color: INK_DIM,
  alpha: 1,
  letterSpacing: "3px",
};
const BANNER_TITLE_TXT: TextOptions = {
  size: 25,
  color: ACCENT,
  alpha: 1,
  letterSpacing: "6px",
};
const BANNER_SUB_TXT: TextOptions = {
  size: 12,
  color: INK_DIM,
  alpha: 1,
  letterSpacing: "4px",
};

/**
 * STACK UP - the block stacker.
 *
 * One button, one decision, repeated: the block sweeps, you tap, whatever hangs
 * over the edge is sliced off and tumbles away. The whole game is the gap
 * between what you see and when you commit, so the drop is resolved against the
 * position the player was actually looking at (input is read before the block
 * is stepped) and there is no fall animation between the tap and the verdict.
 */
export class StackGame extends BaseGame {
  private readonly tower = createRows(KEEP_ROWS);
  private readonly debris = createDebris(22);
  private readonly labels = createLabels(6);
  /** One reused options object behind every particle. See puff(). */
  private readonly po: ParticleOptions = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0.5,
    size: 3,
    sizeEnd: 0,
    color: C_WHITE,
    shape: "circle",
    drag: 1,
    gravity: 0,
    rotation: 0,
    spin: 0,
    additive: false,
  };
  private readonly stats: HudStat[] = [
    { label: "HEIGHT", value: "0" },
    { label: "PERFECT", value: "-", highlight: true },
  ];

  /** Rows settled in the tower, foundation included. Also the active row index. */
  private rowCount = 0;
  /** Cached top row, so the drop math never has to index the ring buffer. */
  private topX = CENTER_X;
  private topW = START_W;

  private blockX = CENTER_X;
  private blockW = START_W;
  private dir = 1;
  private moveDelay = 0;
  /**
   * Taps are swallowed while a fresh block is still settling into view. No
   * legitimate drop happens within 100ms of the last one — the block needs at
   * least 0.7s to travel from its spawn edge to the target — so this only ever
   * eats the second half of a double-tap, which would otherwise slam a block
   * down at the far edge and end the run out of nowhere.
   */
  private canDrop = true;
  /** Sweep limits for the current block, in centre coordinates. */
  private lo = CENTER_X;
  private hi = CENTER_X;

  /** Length of the frame the drop is being judged on. See perfectWindow(). */
  private frameDt = 1 / 60;

  private streak = 0;
  /** Row index and 0..1 intensity of the white landing flash. */
  private flashRow = -1;
  private flashT = 0;

  private camY = 0;
  private camScale = 1;

  private bannerT = 0;
  private bannerTitle = "";
  private bannerSub = "";
  private hintT = 1;

  private debrisCursor = 0;
  private labelCursor = 0;
  private emberCd = 0;

  /** Last values the HUD strings were built from. See hudStats(). */
  private heightLabelFor = -1;
  private streakLabelFor = -1;

  constructor(services: GameServices) {
    super(services, 420);
  }

  /** Blocks the player has actually placed. The foundation does not count. */
  private get placed(): number {
    return this.rowCount - FOUNDATION_ROWS;
  }

  protected onReset(): void {
    for (let i = 0; i < this.tower.length; i++) this.tower[i].active = false;
    for (let i = 0; i < this.debris.length; i++) this.debris[i].active = false;
    for (let i = 0; i < this.labels.length; i++) this.labels[i].active = false;

    this.rowCount = 0;
    this.topX = CENTER_X;
    this.topW = START_W;
    for (let i = 0; i < FOUNDATION_ROWS; i++) this.addRow(CENTER_X, START_W);

    this.streak = 0;
    this.flashRow = -1;
    this.flashT = 0;

    this.bannerT = 0;
    this.bannerTitle = "";
    this.bannerSub = "";
    this.hintT = 1;
    this.debrisCursor = 0;
    this.labelCursor = 0;
    this.emberCd = 0;
    this.frameDt = 1 / 60;
    // -1 forces both HUD strings to rebuild on the first frame of the new run.
    this.heightLabelFor = -1;
    this.streakLabelFor = -1;

    this.spawnBlock(true);
    // Snap, not ease: easing in from a stale camera would open the run with a
    // lurch the player did not cause.
    this.camY = ANCHOR_Y + this.rowCount * BLOCK_H;
    this.camScale = 1;
  }

  /**
   * Called every frame by the base class, so the strings are rebuilt only when
   * the value behind them actually moved.
   */
  protected hudStats(): HudStat[] {
    if (this.placed !== this.heightLabelFor) {
      this.heightLabelFor = this.placed;
      this.stats[0].value = String(this.placed);
    }
    if (this.streak !== this.streakLabelFor) {
      this.streakLabelFor = this.streak;
      this.stats[1].value = this.streak > 0 ? "x" + this.streak : "-";
    }
    return this.stats;
  }

  // --- Simulation ----------------------------------------------------------

  protected onUpdate(dt: number): void {
    this.frameDt = dt;
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt * 5);
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.placed > 0 && this.hintT > 0) this.hintT = Math.max(0, this.hintT - dt * 2.2);

    // Read the tap BEFORE stepping the block: the drop must resolve against the
    // position the player was looking at when they committed, not against a
    // frame of movement they never saw.
    if (this.input.justActioned() && this.canDrop) this.drop();
    if (this.status !== "playing") return;

    this.stepBlock(dt);
    this.stepDebris(dt);
    this.stepLabels(dt);
    this.stepCamera(dt);
  }

  protected onDeathUpdate(dt: number): void {
    this.stepDebris(dt);
    this.stepLabels(dt);
    this.stepCamera(dt);

    // Dust keeps ticking off the toppling block for a moment, so the run ends
    // with a collapse rather than with the picture simply stopping.
    if (this.deathTime > 0.8) return;
    this.emberCd -= dt;
    if (this.emberCd > 0) return;
    this.emberCd = 0.06;
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      this.puff(
        d.x + randRange(-d.w * 0.5, d.w * 0.5),
        d.y,
        randRange(-40, 40),
        randRange(-30, 20),
        randRange(0.3, 0.6),
        2.6,
        0.6,
        CANDY[d.hue],
        0.35
      );
    }
  }

  private sweepSpeed(): number {
    return rampAsymptotic(this.placed, SPEED_FROM, SPEED_RANGE, SPEED_HALFLIFE);
  }

  /**
   * The perfect tolerance for this drop. Fixed at PERFECT_PX in every sane case;
   * it only ever opens up when a frame was long enough that the block skipped
   * clean over a 7px window between two rendered positions.
   */
  private perfectWindow(): number {
    return Math.max(PERFECT_PX, this.sweepSpeed() * this.frameDt * PERFECT_STEP_SHARE);
  }

  private stepBlock(dt: number): void {
    let step = dt;
    if (this.moveDelay > 0) {
      this.moveDelay -= dt;
      if (this.moveDelay > 0) return;
      // Spend only the leftover of the frame, so a pause that expires mid-frame
      // does not hand the block a free full step.
      step = -this.moveDelay;
      this.moveDelay = 0;
      this.canDrop = true;
    }
    let x = this.blockX + this.dir * this.sweepSpeed() * step;
    // Reflect rather than clamp: at 500px/s a clamp would eat up to 25px of
    // travel in the frame that turns, and the sweep would visibly stutter.
    if (x > this.hi) {
      x = this.hi - (x - this.hi);
      this.dir = -1;
      this.audio.play("click", 0.55, 0.07);
    } else if (x < this.lo) {
      x = this.lo + (this.lo - x);
      this.dir = 1;
      this.audio.play("click", 0.55, 0.07);
    }
    this.blockX = clamp(x, this.lo, this.hi);
  }

  private stepCamera(dt: number): void {
    if (this.status === "gameover") {
      const topWorld = -(this.rowCount - 1) * BLOCK_H;
      const fit = clamp(DEATH_FIT_H / (this.rowCount * BLOCK_H + 80), CAM_SCALE_MIN, 1);
      // World height the shot can cover once it has finished pulling back.
      const visH = this.height / fit;
      // Frame the whole tower when it fits; anchor the TOP when it does not.
      // Centring the midpoint of a 150-block tower shows neither the ground nor
      // the block that ended the run — just an anonymous middle — and it asks
      // for rows the ring buffer recycled a hundred blocks ago, which draws as
      // a hole under the tower. Anchoring the top always lands inside the
      // buffer, because the buffer holds the newest rows.
      const focus = Math.min(
        (topWorld + BLOCK_H) * 0.5,
        topWorld + visH * DEATH_TOP_FRAC
      );
      this.camScale = damp(this.camScale, fit, DEATH_CAM_LAMBDA, dt);
      this.camY = damp(this.camY, this.height * 0.5 - focus, DEATH_CAM_LAMBDA, dt);
      return;
    }
    this.camY = damp(this.camY, ANCHOR_Y + this.rowCount * BLOCK_H, CAM_LAMBDA, dt);
  }

  private stepDebris(dt: number): void {
    const mid = this.height * 0.5;
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      d.life -= dt;
      d.vy += DEBRIS_GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.spin * dt;
      // Recycled once it has cleared the bottom of the visible board.
      const sy = mid + (d.y + this.camY - mid) * this.camScale;
      if (d.life <= 0 || sy - d.h > this.height + 60) d.active = false;
    }
  }

  private stepLabels(dt: number): void {
    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      if (!l.active) continue;
      l.life -= dt;
      if (l.life <= 0) {
        l.active = false;
        continue;
      }
      l.y -= 42 * dt;
    }
  }

  // --- The drop ------------------------------------------------------------

  private drop(): void {
    const w = this.blockW;
    const mis = this.blockX - this.topX;
    const abs = Math.abs(mis);
    const rowTop = -this.rowCount * BLOCK_H;

    if (abs >= w) {
      this.missed(mis, rowTop, w);
    } else if (abs <= this.perfectWindow()) {
      this.perfect(rowTop, w);
    } else {
      this.slice(mis, abs, rowTop, w);
    }
  }

  private perfect(rowTop: number, w: number): void {
    this.streak++;
    const hue = this.rowCount % CANDY.length;

    let nw = w;
    if (this.streak >= RECOVER_AT) {
      const gain = this.streak >= RECOVER_BIG_AT ? RECOVER_PX_BIG : RECOVER_PX;
      nw = Math.min(START_W, w + gain);
    }
    // Growing symmetrically about the target can push a drifted tower past the
    // corridor, so the restored block is nudged back inside. At most 9px of
    // nudge, and only ever within a block's width of a wall.
    const nx = clamp(this.topX, ARENA_L + nw * 0.5, ARENA_R - nw * 0.5);
    const seam = rowTop + BLOCK_H;

    const mult = Math.min(this.streak, MULT_CAP);
    this.rawScore += SCORE_PERFECT * mult;
    this.label(nx, rowTop - 6, PERFECT_LABELS[mult - 1], ACCENT, 24, 0.95);

    if (nw > w) {
      const grew = nw - w;
      this.label(
        nx,
        rowTop - 40,
        grew >= RECOVER_PX_BIG ? RECOVER_LABEL_BIG : RECOVER_LABEL,
        INK_DIM,
        14,
        1.1
      );
      this.audio.play("score", 1.3, 0.55);
      // Chips popping out of both new edges show exactly where the width went.
      for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < 4; i++) {
          this.puff(
            nx + s * nw * 0.5,
            seam - BLOCK_H * 0.5,
            s * randRange(40, 110),
            randRange(-90, -20),
            0.5,
            3,
            0.5,
            ACCENT,
            0.4
          );
        }
      }
    }

    // A spark line along the whole seam, so a perfect reads as edge-to-edge
    // contact rather than as a hit somewhere near the middle.
    for (let i = 0; i < 12; i++) {
      const px = nx + (i / 11 - 0.5) * nw;
      this.puff(
        px,
        seam,
        randRange(-30, 30),
        randRange(-150, -60),
        randRange(0.3, 0.55),
        3.2,
        0.4,
        ACCENT,
        0.4
      );
    }
    this.puff(nx, seam, 0, 0, 0.4, 7, 0, ACCENT, 1, "ring");

    this.audio.play("success", 1 + mult * 0.07, 0.85);
    this.shake.add(3 + mult * 0.4, 0.16);

    this.place(nx, nw, hue, 1);
  }

  private slice(mis: number, abs: number, rowTop: number, w: number): void {
    const sign = mis > 0 ? 1 : -1;
    // The floor is applied to the surviving block, never to the offcut: the
    // piece that flies away is always the true overhang, so what the player
    // sees leave the tower still matches what they lost.
    const nw = Math.max(MIN_W, w - abs);
    // Re-clipped to the corridor because the floor can push the block a few px
    // wider than the true overlap. Every spawn assumes the row below sits
    // entirely inside the corridor — that is what guarantees the sweep can
    // always reach the target — so this is the one place that could break it.
    const nx = clamp(this.blockX - mis * 0.5, ARENA_L + nw * 0.5, ARENA_R - nw * 0.5);
    const hue = this.rowCount % CANDY.length;
    const seam = rowTop + BLOCK_H;

    // The offcut keeps the block's own colour so the eye can follow the piece
    // it just lost all the way off the bottom of the board.
    this.spawnDebris(
      this.blockX + sign * (w - abs) * 0.5,
      rowTop + BLOCK_H * 0.5,
      abs,
      sign * randRange(70, 150),
      randRange(-160, -60),
      // Small chips whip, heavy slabs wallow. Purely for the read.
      sign * (2.2 + 220 / (abs + 40)),
      hue
    );

    const clean = 1 - abs / w;
    this.rawScore += SCORE_BASE + SCORE_CLEAN * clean;
    // Losing a real streak is an event, and it used to pass in silence.
    if (this.streak >= RECOVER_AT) this.audio.play("hit", 0.45, 0.2);
    this.streak = 0;

    // Dust off the cut edge.
    const cutX = nx + sign * nw * 0.5;
    for (let i = 0; i < 7; i++) {
      this.puff(
        cutX,
        seam - randRange(0, BLOCK_H),
        sign * randRange(20, 90),
        randRange(-70, 10),
        randRange(0.3, 0.6),
        2.8,
        0.4,
        INK_FAINT,
        0.4,
        "square",
        randRange(0, TAU)
      );
    }

    this.audio.play("click", 0.85 + clean * 0.45, 0.55);
    this.shake.add(1.6 + (1 - clean) * 3.4, 0.14);

    this.place(nx, nw, hue, 0.35);
  }

  private missed(mis: number, rowTop: number, w: number): void {
    const sign = mis > 0 ? 1 : -1;
    const hue = this.rowCount % CANDY.length;
    const cy = rowTop + BLOCK_H * 0.5;
    // The whole block topples off instead of settling. Same debris the offcuts
    // use, at full width and with real spin on it.
    this.spawnDebris(
      this.blockX,
      cy,
      w,
      sign * randRange(90, 170),
      randRange(-200, -110),
      sign * randRange(2.4, 4.2),
      hue
    );

    for (let i = 0; i < 20; i++) {
      const a = randRange(0, TAU);
      const s = randRange(60, 260);
      this.puff(
        this.blockX,
        cy,
        Math.cos(a) * s,
        Math.sin(a) * s,
        randRange(0.5, 1.1),
        randRange(2.5, 5),
        0.8,
        CANDY[(hue + i) % CANDY.length],
        0.4,
        i % 2 === 0 ? "circle" : "square",
        a
      );
    }
    // One expanding ring sells the miss better than more debris would.
    this.puff(this.blockX, cy, 0, 0, 0.6, 9, 0, INK_FAINT, 1, "ring");

    this.streak = 0;
    this.shake.add(16, 0.8);
    this.audio.play("death");
    this.audio.play("hit", 0.6, 0.9);
    this.die();
  }

  /** Settles a row, then immediately arms the next block. */
  private place(x: number, w: number, hue: number, flash: number): void {
    this.flashRow = this.rowCount;
    this.flashT = flash;
    this.addRow(x, w);

    if (this.placed % MILESTONE_EVERY === 0) {
      this.rawScore += SCORE_MILESTONE;
      this.bannerTitle = "HEIGHT " + this.placed;
      this.bannerSub = this.streak > 1 ? "PERFECT x" + this.streak : "+" + SCORE_MILESTONE;
      this.bannerT = BANNER_TIME;
      this.audio.play("score", 1.15, 0.6);
    }

    this.spawnBlock(false);
  }

  /** Writes one row into the ring buffer. Used by onReset and by place(). */
  private addRow(x: number, w: number): void {
    const r = this.tower[this.rowCount % KEEP_ROWS];
    r.active = true;
    r.index = this.rowCount;
    r.x = x;
    r.w = w;
    r.hue = this.rowCount % CANDY.length;
    this.rowCount++;
    this.topX = x;
    this.topW = w;
  }

  private spawnBlock(first: boolean): void {
    const w = this.topW;
    this.blockW = w;

    const swing = rampLinear(this.placed, SWING_FROM, SWING_TO, SWING_ROWS);
    // The sweep is centred on the block below, then clipped to the corridor.
    // Every settled row is kept entirely inside the corridor — a slice can only
    // narrow it, and the two places that widen one (perfect recovery, the MIN_W
    // floor) both re-clip — so the target always survives this clip and there is
    // no reachable state with an unhittable drop.
    this.lo = Math.max(this.topX - swing, ARENA_L + w * 0.5);
    this.hi = Math.min(this.topX + swing, ARENA_R - w * 0.5);

    if (first) {
      // OPENING_GRACE, honoured literally: for the first 1.1s the block is
      // parked dead on target, so the earliest possible tap is a free PERFECT.
      // Nothing can kill in that window, and it shows what the goal looks like.
      this.blockX = this.topX;
      this.dir = Math.random() < 0.5 ? -1 : 1;
      this.moveDelay = OPENING_GRACE;
      this.canDrop = true;
      return;
    }
    let fromLeft = Math.random() < 0.5;
    // A side with no runway would put the block on the target before the player
    // has looked at it. Flip to the far side; see MIN_TRAVEL for why one always
    // qualifies.
    if (fromLeft ? this.topX - this.lo < MIN_TRAVEL : this.hi - this.topX < MIN_TRAVEL) {
      fromLeft = !fromLeft;
    }
    this.blockX = fromLeft ? this.lo : this.hi;
    this.dir = fromLeft ? 1 : -1;
    this.moveDelay = SPAWN_PAUSE;
    this.canDrop = false;
  }

  private spawnDebris(
    x: number,
    y: number,
    w: number,
    vx: number,
    vy: number,
    spin: number,
    hue: number
  ): void {
    const d = this.debris[this.debrisCursor];
    this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
    d.active = true;
    d.x = x;
    d.y = y;
    d.w = w;
    d.h = BLOCK_H;
    d.vx = vx;
    d.vy = vy;
    d.rot = 0;
    d.spin = spin;
    d.hue = hue;
    d.life = DEBRIS_LIFE;
  }

  private label(
    x: number,
    y: number,
    str: string,
    color: string,
    size: number,
    life: number
  ): void {
    const l = this.labels[this.labelCursor];
    this.labelCursor = (this.labelCursor + 1) % this.labels.length;
    l.active = true;
    l.x = x;
    l.y = y;
    l.str = str;
    l.color = color;
    l.size = size;
    l.maxLife = life;
    l.life = life;
  }

  /**
   * Emits one particle through a single reused options object. The engine
   * copies every field out of it, so mutating one object per emit keeps the
   * hot loop allocation-free while still going through the pooled API.
   */
  private puff(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    sizeEnd: number,
    color: string,
    drag: number,
    shape: "circle" | "square" | "ring" = "circle",
    rotation = 0
  ): void {
    const p = this.po;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.size = size;
    p.sizeEnd = sizeEnd;
    p.color = color;
    p.shape = shape;
    p.drag = drag;
    p.rotation = rotation;
    // Square chips are masonry debris and should fall and tumble; sparks and
    // rings float and hold their angle.
    p.gravity = shape === "square" ? 420 : 0;
    p.spin = shape === "square" ? randRange(-7, 7) : 0;
    this.fx.emit(p);
  }

  // --- Render --------------------------------------------------------------

  protected onRender(g: CanvasRenderingContext2D): void {
    this.drawBackdrop(g);

    const s = this.camScale;
    const mid = this.height * 0.5;
    g.save();
    // World -> screen: scale about the board centre, then offset by the camera.
    // Doing it on the context keeps every draw call below in world coordinates.
    roundRect(
      g,
      PANEL_PAD,
      PANEL_PAD,
      this.width - PANEL_PAD * 2,
      this.height - PANEL_PAD * 2,
      PANEL_R
    );
    g.clip();
    g.translate(CENTER_X, mid);
    g.scale(s, s);
    g.translate(-CENTER_X, -mid + this.camY);

    // World-space bounds of the visible board, for culling.
    const wTop = -mid / s + mid - this.camY;
    const wBot = mid / s + mid - this.camY;
    this.drawGround(g, wBot);
    this.drawMarkers(g, wTop, wBot);
    this.drawTower(g, wTop, wBot);
    this.drawDebris(g);
    if (this.status === "playing") this.drawActive(g);
    this.drawLabels(g);
    g.restore();

    this.drawFrame(g);

    if (this.status === "gameover") {
      const flash = Math.max(0, 1 - this.deathTime * 3.2);
      if (flash > 0) {
        // Laid on normally. "lighter" over a near-white floor would blow the
        // whole board out to blank paper.
        g.save();
        g.globalAlpha = flash * 0.55;
        g.fillStyle = C_FLASH;
        g.fillRect(0, 0, this.width, this.height);
        g.restore();
      }
    }
  }

  private drawBackdrop(g: CanvasRenderingContext2D): void {
    g.fillStyle = BG;
    g.fillRect(0, 0, this.width, this.height);
    g.save();
    // The board is a rounded card lying on the page, not a hard screen edge.
    roundRect(
      g,
      PANEL_PAD,
      PANEL_PAD,
      this.width - PANEL_PAD * 2,
      this.height - PANEL_PAD * 2,
      PANEL_R
    );
    g.fillStyle = FLOOR;
    g.fill();
    g.clip();
    // The lattice is deliberately static. The tower sliding past the fixed
    // height rules is what sells the climb; a second scrolling grid behind it
    // only made the whole board feel like it was falling.
    drawGrid(g, this.width, this.height, 100, 0, C_GRID);
    g.restore();
  }

  /**
   * White feather plus a hairline frame. Darkening the rim of a light board
   * would fight the theme and eat the blocks nearest the edge.
   */
  private drawFrame(g: CanvasRenderingContext2D): void {
    g.save();
    roundRect(
      g,
      PANEL_PAD,
      PANEL_PAD,
      this.width - PANEL_PAD * 2,
      this.height - PANEL_PAD * 2,
      PANEL_R
    );
    g.strokeStyle = C_BLOOM;
    g.lineWidth = 16;
    g.stroke();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  private drawGround(g: CanvasRenderingContext2D, wBot: number): void {
    if (BLOCK_H > wBot) return;
    g.fillStyle = C_GROUND;
    roundRect(g, ARENA_L - 46, BLOCK_H, ARENA_R - ARENA_L + 92, 3000, 22);
    g.fill();
    g.strokeStyle = C_GROUND_EDGE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ARENA_L - 46, BLOCK_H);
    g.lineTo(ARENA_R + 46, BLOCK_H);
    g.stroke();
  }

  /** Faint height rules, so the climb has a scale and not just a score. */
  private drawMarkers(g: CanvasRenderingContext2D, wTop: number, wBot: number): void {
    const first = Math.max(MARKER_EVERY, 1 - FOUNDATION_ROWS - wBot / BLOCK_H);
    let h = Math.ceil(first / MARKER_EVERY) * MARKER_EVERY;
    const hMax = 1 - FOUNDATION_ROWS - wTop / BLOCK_H;
    g.strokeStyle = C_MARKER;
    g.lineWidth = 1;
    // Bounded so a degenerate camera scale can never spin here.
    for (let n = 0; h <= hMax && n < 48; h += MARKER_EVERY, n++) {
      const y = -(FOUNDATION_ROWS + h - 1) * BLOCK_H;
      g.beginPath();
      g.moveTo(ARENA_L - 60, y);
      g.lineTo(ARENA_R + 60, y);
      g.stroke();
      const li = h / MARKER_EVERY - 1;
      if (li < MARKER_LABELS.length) text(g, MARKER_LABELS[li], ARENA_L - 70, y, MARKER_TXT);
    }
  }

  private drawTower(g: CanvasRenderingContext2D, wTop: number, wBot: number): void {
    for (let i = 0; i < this.tower.length; i++) {
      const r = this.tower[i];
      if (!r.active) continue;
      const top = -r.index * BLOCK_H;
      if (top > wBot || top + BLOCK_H < wTop) continue;
      this.paintBlock(
        g,
        r.x,
        top,
        r.w,
        r.hue,
        r.index === this.flashRow ? this.flashT : 0,
        false
      );
    }
  }

  private drawDebris(g: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      g.save();
      // Fades only in its last half-second, so a piece never blinks out while
      // it is still the thing the eye is following.
      g.globalAlpha = Math.min(1, d.life * 2);
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      const r = Math.min(BLOCK_R, d.w * 0.32);
      g.fillStyle = C_SHADOW_SOFT;
      roundRect(g, -d.w * 0.5 + 2, -d.h * 0.5 + 4, d.w, d.h, r);
      g.fill();
      g.fillStyle = CANDY[d.hue];
      roundRect(g, -d.w * 0.5, -d.h * 0.5, d.w, d.h, r);
      g.fill();
      g.strokeStyle = CANDY_DARK[d.hue];
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  }

  /** The moving block plus the aiming furniture that belongs to it. */
  private drawActive(g: CanvasRenderingContext2D): void {
    const top = -this.rowCount * BLOCK_H;
    const hue = this.rowCount % CANDY.length;

    // Guide and perfect band sit above the block, never under it: nothing that
    // decides the run may be drawn through a wash, however soft.
    g.strokeStyle = C_GUIDE;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(this.topX, top - 118);
    g.lineTo(this.topX, top);
    g.stroke();

    // The band is the literal perfect window, drawn at true width. Showing the
    // tolerance is what turns a lucky snap into a target you can learn.
    g.fillStyle = C_PERFECT_BAND;
    g.fillRect(this.topX - PERFECT_PX, top - 74, PERFECT_PX * 2, 74);
    g.strokeStyle = ACCENT;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.topX - 9, top - 82);
    g.lineTo(this.topX, top - 72);
    g.lineTo(this.topX + 9, top - 82);
    g.stroke();

    // Parked blocks breathe, so "not moving yet" is never read as a freeze.
    if (this.moveDelay > 0) g.globalAlpha = 0.72 + 0.28 * Math.sin(this.elapsed * 9);
    this.paintBlock(g, this.blockX, top, this.blockW, hue, 0, true);
    g.globalAlpha = 1;
  }

  /**
   * One block. The active block gets an ink outline and a heavier shadow: it is
   * the only thing on screen that can end the run, so it has to out-contrast
   * the tower it is about to land on.
   */
  private paintBlock(
    g: CanvasRenderingContext2D,
    cx: number,
    top: number,
    w: number,
    hue: number,
    flash: number,
    active: boolean
  ): void {
    const x = cx - w * 0.5;
    const r = Math.min(BLOCK_R, w * 0.32);

    // A flat ink slab nudged down-right does the job of shadowBlur at a
    // fraction of the cost, and depth is what stops candy rects reading as
    // flat stickers on the floor.
    g.fillStyle = active ? C_SHADOW : C_SHADOW_SOFT;
    roundRect(g, x + 2, top + 5, w, BLOCK_H, r);
    g.fill();

    g.fillStyle = CANDY[hue];
    roundRect(g, x, top, w, BLOCK_H, r);
    g.fill();
    if (flash > 0) {
      g.globalAlpha = flash * 0.85;
      g.fillStyle = C_WHITE;
      g.fill();
      g.globalAlpha = 1;
    }

    if (w > 26) {
      g.fillStyle = C_GLOSS;
      roundRect(g, x + 4, top + 3, w - 8, BLOCK_H * 0.34, r * 0.7);
      g.fill();
    }

    g.strokeStyle = active ? INK : CANDY_DARK[hue];
    g.lineWidth = active ? 3 : 2;
    roundRect(g, x, top, w, BLOCK_H, r);
    g.stroke();

    // A centre notch, pointing up at the perfect band. Lining one mark up with
    // another is a far easier read than judging the middle of a 200px slab by
    // eye, and it is the only cue a block too narrow for a face still gets.
    if (active) {
      g.fillStyle = INK;
      g.fillRect(cx - 1.5, top - 6, 3, 9);
    }

    // Dot eyes leaning the way it travels. Only while there is room for them;
    // a 30px sliver with a face on it just reads as noise.
    if (active && w >= 52) {
      const ey = top + BLOCK_H * 0.46;
      const lean = this.moveDelay > 0 ? 0 : this.dir * 2.5;
      g.fillStyle = INK;
      g.beginPath();
      g.arc(cx - 7 + lean, ey, 2.7, 0, TAU);
      g.arc(cx + 7 + lean, ey, 2.7, 0, TAU);
      g.fill();
    }
  }

  private drawLabels(g: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      if (!l.active) continue;
      LABEL_TXT.size = l.size;
      LABEL_TXT.color = l.color;
      LABEL_TXT.alpha = Math.min(1, (l.life / l.maxLife) * 1.8);
      text(g, l.str, l.x, l.y, LABEL_TXT);
    }
  }

  protected onRenderOverlay(g: CanvasRenderingContext2D): void {
    if (this.status === "playing" && this.placed === 0) {
      // Worded for the device actually in the player hands: telling a phone to
      // press SPACE is the fastest way to look broken.
      const pulse = 0.78 + Math.sin(this.elapsed * 5) * 0.22;
      START_TXT.alpha = pulse;
      START_SUB_TXT.alpha = pulse * 0.8;
      text(
        g,
        this.isTouch ? "화면을 탭하세요" : "SPACE 를 누르세요",
        CENTER_X,
        this.height - 96,
        START_TXT
      );
      text(g, "블록이 멈춰서 쌓입니다", CENTER_X, this.height - 62, START_SUB_TXT);
    } else if (this.hintT > 0 && this.status === "playing") {
      HINT_TXT.alpha = this.hintT * 0.9;
      text(g, this.isTouch ? "TAP TO DROP" : "SPACE TO DROP", CENTER_X, this.height - 54, HINT_TXT);
    }

    if (this.bannerT <= 0) return;
    const k = this.bannerT / BANNER_TIME;
    // Snap in, hold, drift out. onUpdate stops at death, so bannerT freezes;
    // the death fade keeps a caught banner from sitting there forever.
    const fade = this.status === "gameover" ? Math.max(0, 1 - this.deathTime * 1.4) : 1;
    const alpha = (k > 0.82 ? (1 - k) / 0.18 : Math.min(1, k / 0.28)) * fade;
    if (alpha <= 0) return;

    // A white pill behind the words: text alone loses to the tower crossing it.
    const bx = (this.width - BANNER_W) * 0.5;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = C_SHADOW_SOFT;
    roundRect(g, bx, BANNER_Y + 4, BANNER_W, BANNER_H, BANNER_H * 0.5);
    g.fill();
    g.fillStyle = C_BODY_FILL;
    roundRect(g, bx, BANNER_Y, BANNER_W, BANNER_H, BANNER_H * 0.5);
    g.fill();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.restore();

    BANNER_TITLE_TXT.alpha = alpha;
    text(g, this.bannerTitle, CENTER_X, BANNER_Y + 28, BANNER_TITLE_TXT);
    BANNER_SUB_TXT.alpha = alpha * 0.9;
    text(g, this.bannerSub, CENTER_X, BANNER_Y + 52, BANNER_SUB_TXT);
  }
}
