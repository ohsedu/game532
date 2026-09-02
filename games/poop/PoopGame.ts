import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import { Booster } from "@/games/core/Booster";
import { circleHitForgiving, edgeGap, type Circle } from "@/games/core/Collision";
import {
  OPENING_GRACE,
  rampEaseOut,
  rampLinear,
} from "@/games/core/curve";
import { roundRect, text, type TextOptions } from "@/games/core/draw";
import type { ParticleOptions } from "@/games/core/Particles";
import { clamp, damp, pick, randRange } from "@/games/core/Vector2";
import {
  blankCloud,
  blankDecal,
  blankLabel,
  blankMote,
  blankPoop,
  blankPose,
  type Cloud,
  type Decal,
  type Label,
  type Mote,
  type Poop,
} from "./entities";
import {
  CONFETTI_COLORS,
  drawCloud,
  drawDecal,
  drawGuy,
  drawImpactShadow,
  drawPoop,
  drawWarning,
  POOP_LIGHT,
  SPLAT_COLORS,
} from "./art";

// --- Layout (fixed 1000x700 space) ------------------------------------------
const FLOOR_Y = 636;
/** The player is locked below this line: the bottom ~35% of the play area. */
const PLAY_TOP = 455;
const PLAYER_MIN_Y = PLAY_TOP + 22;
const PLAYER_MAX_Y_POS = FLOOR_Y - 28;
const EDGE = 26;

// --- Feel -------------------------------------------------------------------
const PLAYER_MAX_X = 400;
const PLAYER_MAX_Y = 250;
/** Reaching ~90% of top speed in about 0.1s is what makes the run feel snappy. */
/**
 * Hold-to-accelerate.
 *
 * A tap used to hit full speed in about 45ms, which made positioning feel like
 * teleporting rather than running. Now a fresh press starts at HOLD_BASE of top
 * speed and climbs to full over HOLD_RAMP seconds, so a nudge is a nudge and a
 * committed run is a run. The ramp resets when the key is released or the
 * direction flips, which is what makes the commitment meaningful.
 *
 * The volley corridor guard assumes the player covers PLAYER_MAX_X * lead *
 * REACH_SAFETY (0.52). Starting from rest the average factor over a typical
 * 1.2s lead is ~0.79, so every gap the guard places is still reachable.
 */
const HOLD_BASE = 0.42;
const HOLD_RAMP = 0.8;

const ACCEL_LAMBDA = 11;
const BRAKE_LAMBDA = 27;
const PLAYER_R = 17;
/** Shaved off the sum of radii: every death should look like it actually touched. */
const FORGIVENESS = 6;
const GRAZE_MARGIN = 24;
const COMBO_WINDOW = 2;

// --- Difficulty -------------------------------------------------------------
const SPAWN_DELAY = 0.35;
/**
 * Volleys unlock early on purpose. They are the only thing that changes *what*
 * the player does — rain is dodged locally, a wall has to be read and committed
 * to — and the mechanic should be taught while the rain is still thin enough
 * that a wrong guess is survivable, not introduced at peak density.
 */
const VOLLEY_START = 16;
/**
 * Fraction of the theoretically reachable distance a volley gap may sit from
 * the player. The slack covers acceleration ramp-up, human reaction time, and —
 * the reason this is well under a half rather than near it — the fact that the
 * run to the hole is made *through* ordinary rain, not across an empty screen.
 */
const REACH_SAFETY = 0.52;
/**
 * A wall needs a hard floor on its telegraph, not just a multiple of the rain's:
 * late game `warnTime()` bottoms out at 0.42s, and reading a full-width wall,
 * finding its hole and committing to a direction does not fit in that.
 */
const VOLLEY_WARN_MIN = 0.85;
/** Ordinary rain thins out while a volley descends so the wall stays readable. */
const VOLLEY_RAIN_SCALE = 0.5;

const POOP_POOL = 240;
const POOP_LIMIT = 110;
const DECAL_POOL = 26;
const LABEL_POOL = 14;
const CLOUD_COUNT = 7;
const MOTE_COUNT = 34;

const SCORE_PER_SEC = 10;
const NEAR_MISS_SCORE = 15;

// --- Light-theme palette ----------------------------------------------------
/** Ink for canvas text and outlines. */
const INK = "#22252d";
const INK_DIM = "#6d7280";
const ACCENT = "#ffa62b";
/** Same hue, pushed darker so accent text still reads on a near-white sky. */
const ACCENT_DEEP = "#d97706";

/** Boost aura: layered gold, hottest at the centre. */
const AURA_HOT = "rgba(255, 244, 190, 0.85)";
const AURA_MID = "rgba(255, 196, 66, 0.55)";
const AURA_EDGE = "rgba(255, 196, 66, 0)";
const AURA_FLAME = "rgba(255, 214, 92, 0.62)";
const GROUND_FILL = "#f4e6d0";
const GROUND_TOP = "#fdf3e3";
const GROUND_EDGE = "rgba(255, 166, 43, 0.45)";
const PEBBLE = "rgba(122, 74, 36, 0.14)";
const DUST = "#c2a482";
const MOTE_COLOR = "#d8b48a";
const SOFT_SHADOW = "rgba(24, 28, 45, 0.10)";
const TEXT_HALO = "rgba(255, 255, 255, 0.85)";

const NICE_WORDS = ["NICE!", "PHEW!", "CLOSE!", "SMOOTH!", "WOW!"] as const;
const HYPE_WORDS = ["FILTHY!", "UNREAL!", "NASTY!", "LEGEND!"] as const;

/** Precomputed so the HUD and floating labels never build a string per frame. */
const COMBO_TEXT: string[] = [];
/** Same, for the overlay banner — concatenating it per frame would allocate. */
const COMBO_BANNER: string[] = [];
for (let i = 0; i < 64; i++) {
  COMBO_TEXT.push("x" + i);
  COMBO_BANNER.push("x" + i + " NEAR MISS");
}

/**
 * POOP STORM - comedic survival.
 *
 * Poop rains down; the player scuttles along the bottom of the screen. Every
 * drop telegraphs at the top edge before it enters, which is what lets the
 * spawn rate get silly without the game ever becoming unreadable or unfair.
 */
export class PoopGame extends BaseGame {
  private px = 500;
  private py = 580;
  private vx = 0;
  private vy = 0;
  private lastDir = 0;
  private squash = 0;
  private legPhase = 0;
  private blinkT = 2;
  /** 0..1 proximity of the nearest drop; drives the scream face. */
  private threat = 0;

  private combo = 0;
  private comboLeft = 0;

  private poops: Poop[] = [];
  private decals: Decal[] = [];
  private labels: Label[] = [];
  private clouds: Cloud[] = [];
  private motes: Mote[] = [];
  private poopCursor = 0;
  private live = 0;

  private spawnAcc = 0;
  private nextVolley = 0;
  /** Corridor the ordinary spawner must leave alone while a volley descends. */
  private guardX = 0;
  private guardHalf = 0;
  private guardLeft = 0;
  private warnSndCd = 0;
  private splatSndCd = 0;
  /** Seconds left on the "STORM INCOMING" banner; runs for the volley telegraph. */
  private stormT = 0;
  private killedX = 0;
  private killedY = 0;

  private skyGrad: CanvasGradient | null = null;
  private beamGrad: CanvasGradient | null = null;
  /** Soft light bloom replacing the old dark vignette. */
  private bloomGrad: CanvasGradient | null = null;
  /** Contact shadow sitting just above the ground strip. */
  private groundGrad: CanvasGradient | null = null;
  private sunGrad: CanvasGradient | null = null;

  private readonly pose = blankPose();
  private readonly pc: Circle = { x: 0, y: 0, r: PLAYER_R };
  /** Seconds the current direction has been held, per axis. */
  private holdX = 0;
  private holdY = 0;
  private holdDirX = 0;
  private holdDirY = 0;
  private readonly hc: Circle = { x: 0, y: 0, r: 1 };
  private readonly po: ParticleOptions = { x: 0, y: 0 };
  private readonly tLabel: TextOptions = { size: 22, align: "center", baseline: "middle" };
  private readonly tCombo: TextOptions = {
    size: 14,
    align: "center",
    baseline: "middle",
    shadow: TEXT_HALO,
    shadowBlur: 6,
  };
  private readonly tHint: TextOptions = { size: 15, align: "center", baseline: "middle" };
  private readonly tStorm: TextOptions = {
    size: 30,
    align: "center",
    baseline: "middle",
    letterSpacing: "5px",
    shadow: TEXT_HALO,
    shadowBlur: 14,
  };

  private readonly statTime: HudStat = { label: "TIME", value: "0.0s" };
  private readonly statCombo: HudStat = { label: "COMBO", value: "-", highlight: true };
  private readonly stats: HudStat[] = [this.statTime, this.statCombo];
  private timeTenths = -1;

  constructor(services: GameServices) {
    super(services, 720);
  }

  // --- Lifecycle ------------------------------------------------------------

  private readonly booster = new Booster(1.7);

  protected onReset(): void {
    this.booster.reset();
    this.holdX = 0;
    this.holdY = 0;
    this.holdDirX = 0;
    this.holdDirY = 0;
    if (this.poops.length === 0) {
      for (let i = 0; i < POOP_POOL; i++) this.poops.push(blankPoop());
      for (let i = 0; i < DECAL_POOL; i++) this.decals.push(blankDecal());
      for (let i = 0; i < LABEL_POOL; i++) this.labels.push(blankLabel());
      for (let i = 0; i < CLOUD_COUNT; i++) this.clouds.push(blankCloud());
      for (let i = 0; i < MOTE_COUNT; i++) this.motes.push(blankMote());
    }
    for (const p of this.poops) p.active = false;
    for (const d of this.decals) d.active = false;
    for (const l of this.labels) l.active = false;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = this.clouds[i];
      c.x = randRange(-150, this.width + 150);
      c.y = randRange(60, 400);
      c.s = randRange(0.55, 1.35);
      c.vx = randRange(-22, -7);
      c.alpha = randRange(0.05, 0.11);
    }
    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = this.motes[i];
      m.x = randRange(0, this.width);
      m.y = randRange(0, FLOOR_Y);
      m.r = randRange(0.8, 2.2);
      m.vy = randRange(6, 26);
      m.alpha = randRange(0.05, 0.16);
    }

    this.px = this.width / 2;
    this.py = PLAYER_MAX_Y_POS - 10;
    this.vx = 0;
    this.vy = 0;
    this.lastDir = 0;
    this.squash = 0;
    this.legPhase = 0;
    this.blinkT = 2.4;
    this.threat = 0;
    this.combo = 0;
    this.comboLeft = 0;
    this.poopCursor = 0;
    this.live = 0;
    this.spawnAcc = 0;
    // First volley lands a few seconds after volleys unlock.
    this.nextVolley = 3;
    this.guardLeft = 0;
    this.guardX = 0;
    this.guardHalf = 0;
    this.warnSndCd = 0;
    this.splatSndCd = 0;
    this.stormT = 0;
    this.killedX = this.px;
    this.killedY = this.py;
    this.timeTenths = -1;
    this.pose.dead = 0;
    this.updatePose(1);
  }

  protected onUpdate(dt: number): void {
    this.rawScore += dt * SCORE_PER_SEC;

    this.warnSndCd -= dt;
    this.splatSndCd -= dt;
    if (this.stormT > 0) this.stormT -= dt;
    if (this.comboLeft > 0) {
      this.comboLeft -= dt;
      if (this.comboLeft <= 0) {
        // A chain worth caring about should not evaporate silently — the
        // draining bar is the warning, this is the full stop.
        if (this.combo >= 3) this.audio.play("click", 0.45, 0.3);
        this.combo = 0;
      }
    }

    this.updateBackground(dt);
    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updatePoops(dt, true);
    this.updateDecals(dt);
    this.updateLabels(dt);
    // A hit inside updatePoops already ended the run; leave the pose alone so
    // the death animation owns it from this frame on.
    if (this.status === "playing") this.updatePose(dt);
  }

  protected onDeathUpdate(dt: number): void {
    this.warnSndCd -= dt;
    this.splatSndCd -= dt;
    this.updateBackground(dt);
    // Debris keeps flying and the sky finishes emptying itself onto the floor.
    this.updatePoops(dt, false);
    this.updateDecals(dt);
    this.updateLabels(dt);

    this.pose.dead = Math.min(1, this.pose.dead + dt * 5);
    const flat = this.pose.dead;
    this.py = damp(this.py, PLAYER_MAX_Y_POS + 12, 6, dt);
    this.pose.x = this.px;
    this.pose.y = this.py;
    this.pose.lean = 0;
    this.pose.squashX = 1 + flat * 0.85;
    this.pose.squashY = 1 - flat * 0.76;
    this.pose.run = 0;
    this.pose.eyes = 1;
    this.pose.scream = 0;

    // Lingering stink, emitted on a dt-driven cadence rather than a timer.
    if (this.deathTime > 0.4 && Math.random() < dt * 6) {
      this.po.x = this.killedX + randRange(-16, 16);
      this.po.y = this.killedY - randRange(0, 10);
      this.po.vx = randRange(-14, 14);
      this.po.vy = randRange(-46, -22);
      this.po.life = randRange(0.7, 1.3);
      this.po.size = randRange(2, 4.5);
      this.po.sizeEnd = 0;
      this.po.color = POOP_LIGHT;
      this.po.shape = "circle";
      this.po.drag = 0.5;
      this.po.gravity = -10;
      this.po.rotation = 0;
      this.po.spin = 0;
      this.po.additive = false;
      this.fx.emit(this.po);
    }
  }

  protected hudStats(): HudStat[] {
    const tenths = Math.floor(this.elapsed * 10);
    if (tenths !== this.timeTenths) {
      this.timeTenths = tenths;
      this.statTime.value = (tenths / 10).toFixed(1) + "s";
    }
    this.statCombo.value =
      this.combo >= 2 ? COMBO_TEXT[Math.min(this.combo, COMBO_TEXT.length - 1)] : "-";
    return this.stats;
  }

  // --- Difficulty curves ----------------------------------------------------

  /** Drops per second. The opening is thin, not empty, and thickens fast. */
  private spawnRate(): number {
    return rampEaseOut(this.elapsed, 2, 6.8, 42);
  }

  /** Telegraph lead time. Shrinks hard early but is floored well above zero. */
  private warnTime(): number {
    return rampEaseOut(this.elapsed, 0.95, 0.44, 45);
  }

  private sizeMin(): number {
    return rampLinear(this.elapsed, 15, 9, 70);
  }

  private sizeMax(): number {
    return rampLinear(this.elapsed, 23, 37, 70);
  }

  /**
   * Small ones drop like pebbles, heavy ones lumber. Readable at a glance.
   *
   * Linear rather than ease-in: a quadratic ramp is almost flat for its first
   * fifth, so the opening minute never felt like it was building.
   */
  private fallSpeed(r: number): number {
    return rampLinear(this.elapsed, 320, 620, 55) * clamp(26 / r, 0.7, 1.45);
  }

  // --- Simulation -----------------------------------------------------------

  private updateBackground(dt: number): void {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = this.clouds[i];
      c.x += c.vx * dt;
      if (c.x < -220) {
        c.x = this.width + 220;
        c.y = randRange(60, 400);
        c.s = randRange(0.55, 1.35);
      }
    }
    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = this.motes[i];
      m.y += m.vy * dt;
      if (m.y > FLOOR_Y) {
        m.y = -4;
        m.x = randRange(0, this.width);
      }
    }
  }

  private updatePlayer(dt: number): void {
    const boost = this.booster.update(dt, this.input.isBoosting());
    const ax = this.input.axisX();
    const ay = this.input.axisY();

    // Charge each axis separately: a player already sprinting right should not
    // lose their run because they tapped up to dodge.
    if (ax !== 0 && ax === this.holdDirX) this.holdX = Math.min(HOLD_RAMP, this.holdX + dt);
    else if (ax !== 0) { this.holdDirX = ax; this.holdX = 0; }
    else { this.holdDirX = 0; this.holdX = 0; }

    if (ay !== 0 && ay === this.holdDirY) this.holdY = Math.min(HOLD_RAMP, this.holdY + dt);
    else if (ay !== 0) { this.holdDirY = ay; this.holdY = 0; }
    else { this.holdDirY = 0; this.holdY = 0; }

    const chargeX = HOLD_BASE + (1 - HOLD_BASE) * (this.holdX / HOLD_RAMP);
    const chargeY = HOLD_BASE + (1 - HOLD_BASE) * (this.holdY / HOLD_RAMP);

    // Boost raises the target speed the damping chases, so the character
    // accelerates into it instead of snapping.
    this.vx = damp(this.vx, ax * PLAYER_MAX_X * boost * chargeX, ax !== 0 ? ACCEL_LAMBDA : BRAKE_LAMBDA, dt);
    this.vy = damp(this.vy, ay * PLAYER_MAX_Y * boost * chargeY, ay !== 0 ? ACCEL_LAMBDA : BRAKE_LAMBDA, dt);
    this.px += this.vx * dt;
    this.py += this.vy * dt;

    if (this.px < EDGE) {
      this.px = EDGE;
      this.vx = 0;
    } else if (this.px > this.width - EDGE) {
      this.px = this.width - EDGE;
      this.vx = 0;
    }
    if (this.py < PLAYER_MIN_Y) {
      this.py = PLAYER_MIN_Y;
      this.vy = 0;
    } else if (this.py > PLAYER_MAX_Y_POS) {
      this.py = PLAYER_MAX_Y_POS;
      this.vy = 0;
    }

    // A hard reversal at speed pops a squash frame - the cheapest way to say
    // "yes, the game heard your input".
    if (ax !== 0) {
      if (ax !== this.lastDir && Math.abs(this.vx) > 130) {
        this.squash = 1;
        this.puff(this.px, this.py + 26, 6, -Math.sign(this.vx));
      }
      this.lastDir = ax;
    }
    this.squash = Math.max(0, this.squash - dt * 4.5);

    const speedFrac = Math.abs(this.vx) / PLAYER_MAX_X;
    this.legPhase += (speedFrac * 15 + 1.5) * dt;

    this.blinkT -= dt;
    if (this.blinkT <= 0) this.blinkT = randRange(1.9, 4.6) + 0.12;

    this.pc.x = this.px;
    this.pc.y = this.py - 4;
  }

  private updateSpawning(dt: number): void {
    if (this.guardLeft > 0) this.guardLeft -= dt;
    if (this.elapsed < SPAWN_DELAY) return;

    // Volleys resolve first so the escape corridor they open is already guarded
    // when this frame's rain picks its columns.
    if (this.elapsed >= VOLLEY_START) {
      this.nextVolley -= dt;
      if (this.nextVolley <= 0) {
        this.spawnVolley();
        this.nextVolley =
          rampLinear(this.elapsed - VOLLEY_START, 7.5, 4.5, 80) * randRange(0.9, 1.15);
      }
    }

    // While a wall is on its way the sky is already full; adding a full rain
    // rate on top turns a set-piece into mush and buries the hole.
    const rate = this.spawnRate() * (this.guardLeft > 0 ? VOLLEY_RAIN_SCALE : 1);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawnRandom();
    }
  }

  private spawnRandom(): void {
    if (this.live >= POOP_LIMIT) return;
    // Squaring the roll biases toward small drops, so a fat one still lands as
    // an event rather than as routine traffic.
    const roll = Math.random();
    const lo = this.sizeMin();
    const r = lo + (this.sizeMax() - lo) * roll * roll;
    let x = randRange(EDGE + r, this.width - EDGE - r);

    if (this.guardLeft > 0 && Math.abs(x - this.guardX) < this.guardHalf) {
      // Never fill a volley escape corridor: push the drop out of it instead.
      const side = x < this.guardX ? -1 : 1;
      x = this.guardX + side * (this.guardHalf + r);
      if (x < EDGE + r || x > this.width - EDGE - r) return;
    }
    this.spawnPoop(x, r, this.fallSpeed(r), this.warnTime());
  }

  /**
   * A wall of drops with exactly one hole in it.
   *
   * Three things make it fair by construction:
   *  1. the hole center is picked inside the distance the player can actually
   *     cover between the telegraph appearing and the wall reaching his line;
   *  2. the hole is wide enough to fit him with real clearance either side;
   *  3. the wall itself is spaced tighter than he can squeeze through, so the
   *     hole is the only opening and there is never a second, unreadable one.
   */
  private spawnVolley(): void {
    const lo = this.sizeMin();
    // Fat, slow drops: fewer of them make a wall, and they splat spectacularly.
    const r = (lo + this.sizeMax()) * randRange(0.5, 0.7);
    // A wall needs more reading time than a lone drop: slower fall, longer tell.
    const speed = this.fallSpeed(r) * 0.92;
    const warn = Math.max(VOLLEY_WARN_MIN, this.warnTime() * 1.5);
    // Conservative: the drop actually starts at -1.2r, so the real lead is longer.
    const lead = warn + (this.py + r) / speed;
    const reach = PLAYER_MAX_X * lead * REACH_SAFETY;

    // Clearance from a wall drop's edge to the player's edge is exactly the
    // margin term below, so the corridor never narrows past 26px per side.
    const gapHalf = PLAYER_R + r + rampLinear(this.elapsed, 40, 26, 95);
    const minX = gapHalf + 10;
    const maxX = this.width - gapHalf - 10;
    const gapLo = Math.max(minX, this.px - reach);
    const gapHi = Math.min(maxX, this.px + reach);
    const gap = gapLo <= gapHi ? randRange(gapLo, gapHi) : clamp(this.px, minX, maxX);

    // Widest center-to-center spacing that still guarantees an overlap with the
    // player circle (mirrors the forgiveness the hit test grants him). The 0.85
    // is not just rounding slack: at 0.95 the drawn silhouettes leave ~12px of
    // daylight between neighbours, and a gap you can see but cannot fit through
    // is a lie. At 0.85 the wall reads as solid, so the hole is the only thing
    // that looks like a hole.
    const step = 2 * (PLAYER_R + r * 0.86 - FORGIVENESS) * 0.85;
    const leftSpan = gap - gapHalf - EDGE;
    const rightSpan = this.width - EDGE - (gap + gapHalf);
    this.spawnWallRun(EDGE, leftSpan, step, r, speed, warn);
    this.spawnWallRun(gap + gapHalf, rightSpan, step, r, speed, warn);

    this.guardX = gap;
    this.guardHalf = gapHalf;
    // The guard only keeps *new* rain out of the corridor. A stray already in
    // flight is fine: the corridor is ~150px against a 34px player, so even a
    // dead-center straggler still leaves a lane on either side of it.
    this.guardLeft = lead + 0.2;
    // The banner lives exactly as long as the telegraph, so it reads as "this
    // is the wall's fuse" rather than as decoration.
    this.stormT = warn;
    this.audio.play("warn", 0.6, 0.5);
    this.shake.add(3, 0.22);
  }

  /**
   * One sealed run of wall drops: endpoints land exactly on `x0` and
   * `x0 + span`, so the screen edge and the hole edge are both plugged, and the
   * spacing in between is never wider than `step`.
   */
  private spawnWallRun(
    x0: number,
    span: number,
    step: number,
    r: number,
    speed: number,
    warn: number
  ): void {
    if (span <= 0) return;
    const n = Math.max(2, Math.ceil(span / step) + 1);
    for (let i = 0; i < n; i++) {
      this.spawnPoop(x0 + (span * i) / (n - 1), r, speed, warn);
    }
  }

  private spawnPoop(x: number, r: number, speed: number, warn: number): void {
    const p = this.acquirePoop();
    if (!p) return;
    p.active = true;
    p.warning = true;
    p.x = x;
    p.y = -r * 1.2;
    p.vy = speed;
    p.r = r;
    p.warnTotal = warn;
    p.warnLeft = warn;
    p.phase = randRange(0, Math.PI * 2);
    p.wobble = randRange(1.6, 3.4);
    p.grazed = false;
    this.live++;

    if (this.warnSndCd <= 0) {
      // Pitch carries the payload size: high blip = pebble, low thud = boulder.
      this.audio.play("warn", clamp(30 / r, 0.7, 1.7), 0.14);
      this.warnSndCd = 0.11;
    }
  }

  private acquirePoop(): Poop | null {
    const n = this.poops.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.poopCursor + i) % n;
      const p = this.poops[idx];
      if (!p.active) {
        this.poopCursor = (idx + 1) % n;
        return p;
      }
    }
    return null;
  }

  private updatePoops(dt: number, lethal: boolean): void {
    const lethalNow = lethal && this.elapsed > OPENING_GRACE;
    let nearest = 999;

    for (let i = 0; i < this.poops.length; i++) {
      const p = this.poops[i];
      if (!p.active) continue;

      if (p.warning) {
        p.warnLeft -= dt;
        if (p.warnLeft <= 0) {
          p.warning = false;
          this.puff(p.x, 10, p.r * 0.5, 0);
        }
        continue;
      }

      p.phase += p.wobble * dt;
      const yPrev = p.y;
      p.y += p.vy * dt;

      // The drawn silhouette bottoms out at +1.0r, so this fires as it touches.
      if (p.y + p.r * 0.9 >= FLOOR_Y) {
        this.splat(p);
        p.active = false;
        this.live--;
        continue;
      }

      if (!lethalNow) continue;

      // The hitbox sits inside the drawn silhouette, and a drop never moves
      // sideways, so the top-edge marker always tells the truth about where it
      // will land. Only the wobble rotation is cosmetic.
      //
      // Swept, not sampled: GameLoop clamps dt at 1/20s, and the fastest pebble
      // covers 44px in one such step against a kill window only ~37px tall — a
      // discrete test would let it pass visibly through him and score a graze.
      // Motion is purely vertical, so the nearest point of this frame's travel
      // to the player is just his y clamped onto the swept span.
      this.hc.x = p.x;
      this.hc.y = clamp(this.pc.y, yPrev, p.y);
      this.hc.r = p.r * 0.86;

      if (circleHitForgiving(this.pc, this.hc, FORGIVENESS)) {
        this.kill(p);
        return;
      }

      const gap = edgeGap(this.pc, this.hc);
      if (gap < nearest) nearest = gap;
      // Only score the pass once the drop is level with him, so a shot that is
      // still on a collision course cannot pay out first and kill him after.
      if (!p.grazed && gap < GRAZE_MARGIN && p.y >= this.py - p.r * 0.3) {
        p.grazed = true;
        this.nearMiss(p);
      }
    }

    this.threat = clamp(1 - nearest / 150, 0, 1);
  }

  private nearMiss(p: Poop): void {
    this.combo++;
    this.comboLeft = COMBO_WINDOW;
    // Height pays. Without this the Up key is a pure downside — it only ever
    // buys you less reaction time — and the vertical axis may as well not
    // exist. Standing high is where the traffic is, so this is the risk it
    // settles for.
    const high = clamp(
      (PLAYER_MAX_Y_POS - this.py) / (PLAYER_MAX_Y_POS - PLAYER_MIN_Y),
      0,
      1
    );
    const mult = (1 + Math.min(this.combo - 1, 20) * 0.15) * (1 + high * 0.6);
    this.rawScore += NEAR_MISS_SCORE * mult;

    this.audio.play("graze", 1 + Math.min(this.combo, 14) * 0.055, 0.5);
    this.spawnLabel(
      (this.px + p.x) / 2,
      this.py - 46,
      this.combo >= 6 ? pick(HYPE_WORDS) : pick(NICE_WORDS),
      this.combo
    );

    // Confetti chips, not sparks: additive light is invisible on a pale sky.
    const dir = p.x < this.px ? -1 : 1;
    for (let i = 0; i < 5; i++) {
      this.po.x = p.x + dir * p.r * 0.6;
      this.po.y = p.y + randRange(-8, 8);
      this.po.vx = dir * randRange(30, 90);
      this.po.vy = randRange(-70, 10);
      this.po.life = randRange(0.18, 0.34);
      this.po.size = randRange(2.6, 4.4);
      this.po.sizeEnd = 0;
      this.po.color = pick(CONFETTI_COLORS);
      this.po.shape = "square";
      this.po.drag = 0.2;
      this.po.gravity = 0;
      this.po.rotation = randRange(0, Math.PI);
      this.po.spin = randRange(-14, 14);
      this.po.additive = false;
      this.fx.emit(this.po);
    }
  }

  private splat(p: Poop): void {
    const r = p.r;
    const y = FLOOR_Y + 2;
    this.addDecal(p.x, y + randRange(2, 12), r);

    const n = Math.min(24, 7 + Math.round(r * 0.55));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + randRange(-1.25, 1.25);
      const s = randRange(70, 230) * (0.65 + r / 34);
      this.po.x = p.x + randRange(-r * 0.5, r * 0.5);
      this.po.y = y;
      this.po.vx = Math.cos(a) * s;
      this.po.vy = Math.sin(a) * s;
      this.po.life = randRange(0.35, 0.85);
      this.po.size = randRange(1.8, 2.2 + r * 0.16);
      this.po.sizeEnd = 0;
      this.po.color = pick(SPLAT_COLORS);
      this.po.shape = i % 4 === 0 ? "square" : "circle";
      this.po.drag = 0.35;
      this.po.gravity = 950;
      this.po.rotation = a;
      this.po.spin = randRange(-10, 10);
      this.po.additive = false;
      this.fx.emit(this.po);
    }

    if (r > 22) {
      this.po.x = p.x;
      this.po.y = y;
      this.po.vx = 0;
      this.po.vy = 0;
      this.po.life = 0.32;
      this.po.size = r * 0.5;
      this.po.sizeEnd = r * 0.5;
      this.po.color = POOP_LIGHT;
      this.po.shape = "ring";
      this.po.drag = 1;
      this.po.gravity = 0;
      this.po.rotation = 0;
      this.po.spin = 0;
      this.po.additive = false;
      this.fx.emit(this.po);
      this.shake.add(clamp(r * 0.16, 2, 6), 0.18);
    }

    if (this.splatSndCd <= 0) {
      this.audio.play("hit", clamp(26 / r, 0.45, 1.5), clamp(r / 40, 0.16, 0.5));
      this.splatSndCd = 0.055;
    }
  }

  private kill(p: Poop): void {
    this.killedX = this.px;
    this.killedY = this.py;
    this.splat(p);
    p.active = false;
    this.live--;

    this.audio.play("death");
    this.shake.add(26, 0.7);

    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + randRange(-0.3, 0.3);
      const s = randRange(90, 420);
      this.po.x = this.px;
      this.po.y = this.py - 8;
      this.po.vx = Math.cos(a) * s;
      this.po.vy = Math.sin(a) * s - 120;
      this.po.life = randRange(0.5, 1.2);
      this.po.size = randRange(2.5, 8);
      this.po.sizeEnd = 0;
      this.po.color = pick(SPLAT_COLORS);
      this.po.shape = i % 3 === 0 ? "square" : "circle";
      this.po.drag = 0.45;
      this.po.gravity = 900;
      this.po.rotation = a;
      this.po.spin = randRange(-12, 12);
      this.po.additive = false;
      this.fx.emit(this.po);
    }
    for (let i = 0; i < 10; i++) {
      const a = randRange(0, Math.PI * 2);
      this.po.x = this.px;
      this.po.y = this.py - 8;
      this.po.vx = Math.cos(a) * randRange(120, 320);
      this.po.vy = Math.sin(a) * randRange(120, 320);
      this.po.life = randRange(0.2, 0.4);
      this.po.size = 4.5;
      this.po.sizeEnd = 0;
      this.po.color = pick(CONFETTI_COLORS);
      this.po.shape = "square";
      this.po.drag = 0.2;
      this.po.gravity = 0;
      this.po.rotation = a;
      this.po.spin = randRange(-16, 16);
      this.po.additive = false;
      this.fx.emit(this.po);
    }
    this.addDecal(this.px, PLAYER_MAX_Y_POS + 22, 26);
    this.die();
  }

  /** Small dust kick, reused for footwork and for a drop entering the screen. */
  private puff(x: number, y: number, r: number, dir: number): void {
    for (let i = 0; i < 4; i++) {
      this.po.x = x;
      this.po.y = y;
      this.po.vx = dir === 0 ? randRange(-30, 30) : dir * randRange(20, 70);
      this.po.vy = randRange(-24, 4);
      this.po.life = randRange(0.15, 0.32);
      this.po.size = randRange(1.5, 1.5 + r * 0.25);
      this.po.sizeEnd = 0;
      this.po.color = DUST;
      this.po.shape = "circle";
      this.po.drag = 0.25;
      this.po.gravity = 0;
      this.po.rotation = 0;
      this.po.spin = 0;
      this.po.additive = false;
      this.fx.emit(this.po);
    }
  }

  private addDecal(x: number, y: number, r: number): void {
    let target: Decal | null = null;
    let oldest = Infinity;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (!d.active) {
        target = d;
        break;
      }
      if (d.life < oldest) {
        oldest = d.life;
        target = d;
      }
    }
    if (!target) return;
    target.active = true;
    target.x = x;
    target.y = clamp(y, FLOOR_Y + 4, this.height - 8);
    target.r = r;
    // Bigger stains hang around longer; the capped pool keeps the floor from
    // turning into an unreadable brown carpet.
    target.maxLife = 2.6 + r * 0.055;
    target.life = target.maxLife;
    target.seed = randRange(0, 10);
  }

  private updateDecals(dt: number): void {
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) d.active = false;
    }
  }

  private spawnLabel(x: number, y: number, word: string, combo: number): void {
    let target: Label | null = null;
    let oldest = Infinity;
    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      if (!l.active) {
        target = l;
        break;
      }
      if (l.life < oldest) {
        oldest = l.life;
        target = l;
      }
    }
    if (!target) return;
    target.active = true;
    target.x = clamp(x, 60, this.width - 60);
    target.y = y;
    target.vy = -52;
    target.maxLife = 0.85;
    target.life = target.maxLife;
    target.word = word;
    target.combo = combo;
  }

  private updateLabels(dt: number): void {
    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      if (!l.active) continue;
      l.life -= dt;
      if (l.life <= 0) {
        l.active = false;
        continue;
      }
      l.y += l.vy * dt;
      l.vy *= Math.pow(0.02, dt);
    }
  }

  private updatePose(dt: number): void {
    const speedFrac = Math.abs(this.vx) / PLAYER_MAX_X;
    const s = this.squash;
    this.pose.x = this.px;
    this.pose.y = this.py;
    this.pose.lean = damp(this.pose.lean, (this.vx / PLAYER_MAX_X) * 0.26, 16, dt);
    this.pose.squashX = 1 + speedFrac * 0.1 + s * 0.3;
    this.pose.squashY = 1 - speedFrac * 0.07 - s * 0.26;
    this.pose.legPhase = this.legPhase;
    this.pose.run = clamp(speedFrac + Math.abs(this.vy) / PLAYER_MAX_Y / 2, 0, 1);
    this.pose.eyes = this.blinkT < 0.12 ? 0 : 1;
    this.pose.scream = clamp(speedFrac * 0.35 + this.threat * 0.8, 0, 1);
    this.pose.dead = 0;
  }

  // --- Render ---------------------------------------------------------------

  protected onRender(g: CanvasRenderingContext2D): void {
    if (!this.skyGrad) {
      // Sunny morning: warm cream at the top easing into a cool near-white.
      const sky = g.createLinearGradient(0, 0, 0, FLOOR_Y);
      sky.addColorStop(0, "#fff3dd");
      sky.addColorStop(0.55, "#fbf7f3");
      sky.addColorStop(1, "#f0f3fb");
      this.skyGrad = sky;
    }
    if (!this.beamGrad) {
      // Vertical-only gradient, so one cached object works at every x.
      const beam = g.createLinearGradient(0, 0, 0, 130);
      beam.addColorStop(0, "rgba(255, 166, 43, 0.42)");
      beam.addColorStop(1, "rgba(255, 166, 43, 0)");
      this.beamGrad = beam;
    }
    if (!this.sunGrad) {
      const sun = g.createRadialGradient(140, 152, 10, 140, 152, 150);
      sun.addColorStop(0, "rgba(255, 214, 140, 0.55)");
      sun.addColorStop(0.45, "rgba(255, 222, 163, 0.22)");
      sun.addColorStop(1, "rgba(255, 226, 180, 0)");
      this.sunGrad = sun;
    }
    if (!this.bloomGrad) {
      // Inverted vignette: the edges lift toward white instead of darkening.
      const bloom = g.createRadialGradient(
        this.width / 2,
        this.height * 0.45,
        this.height * 0.3,
        this.width / 2,
        this.height * 0.45,
        this.width * 0.72
      );
      // Kept weak on purpose: a heavier wash would eat into the contrast the
      // falling turds need at the screen edges.
      bloom.addColorStop(0, "rgba(255, 255, 255, 0)");
      bloom.addColorStop(0.65, "rgba(255, 255, 255, 0.06)");
      bloom.addColorStop(1, "rgba(255, 255, 255, 0.22)");
      this.bloomGrad = bloom;
    }
    // Held locally: the bloom is painted last, long after narrowing would lapse.
    const bloomGrad = this.bloomGrad;

    g.fillStyle = this.skyGrad;
    g.fillRect(0, 0, this.width, this.height);

    g.fillStyle = this.sunGrad;
    g.fillRect(0, 0, 300, 310);
    g.fillStyle = "rgba(255, 205, 112, 0.5)";
    g.beginPath();
    g.arc(140, 152, 34, 0, Math.PI * 2);
    g.fill();

    for (let i = 0; i < CLOUD_COUNT; i++) drawCloud(g, this.clouds[i]);

    // Warm pollen specks: round, not the old hard-edged sparks.
    g.fillStyle = MOTE_COLOR;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = this.motes[i];
      g.globalAlpha = m.alpha * 2.4;
      g.beginPath();
      g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    this.drawGround(g);

    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (d.active) drawDecal(g, d);
    }

    // Shadows sit on the floor above the stains but under everything airborne.
    for (let i = 0; i < this.poops.length; i++) {
      const p = this.poops[i];
      if (!p.active || p.warning) continue;
      drawImpactShadow(g, p.x, FLOOR_Y + 8, p.r, clamp(p.y / FLOOR_Y, 0, 1));
    }

    const pulse = Math.abs(Math.sin(this.elapsed * 14));
    for (let i = 0; i < this.poops.length; i++) {
      const p = this.poops[i];
      if (!p.active || !p.warning) continue;
      drawWarning(g, p.x, p.r, 1 - p.warnLeft / p.warnTotal, this.beamGrad, pulse);
    }

    for (let i = 0; i < this.poops.length; i++) {
      const p = this.poops[i];
      if (p.active && !p.warning) drawPoop(g, p);
    }

    this.drawPlayer(g);

    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      if (!l.active) continue;
      const t = l.life / l.maxLife;
      const alpha = Math.min(1, t * 2.2);
      // Bouncy pop-in: overshoot on the way in, settle, then drift up and fade.
      const pop = 1 + Math.sin(Math.min(1, (1 - t) * 4) * Math.PI) * 0.24;
      this.tLabel.alpha = alpha;
      this.tLabel.size = 21 * pop;
      this.tLabel.color = INK;
      this.tLabel.shadow = TEXT_HALO;
      this.tLabel.shadowBlur = 8;
      text(g, l.word, l.x, l.y, this.tLabel);
      if (l.combo >= 2) {
        this.tCombo.alpha = alpha * 0.9;
        this.tCombo.size = 13;
        this.tCombo.color = ACCENT_DEEP;
        text(g, COMBO_TEXT[Math.min(l.combo, COMBO_TEXT.length - 1)], l.x, l.y + 18, this.tCombo);
      }
    }

    // Soft light bloom instead of a dark vignette: airy edges, not a tunnel.
    g.fillStyle = bloomGrad;
    g.fillRect(0, 0, this.width, this.height);
  }

  private drawGround(g: CanvasRenderingContext2D): void {
    if (!this.groundGrad) {
      const gs = g.createLinearGradient(0, FLOOR_Y - 18, 0, FLOOR_Y);
      gs.addColorStop(0, "rgba(24, 28, 45, 0)");
      gs.addColorStop(1, SOFT_SHADOW);
      this.groundGrad = gs;
    }
    // Contact shadow where the sky meets the strip.
    g.fillStyle = this.groundGrad;
    g.fillRect(0, FLOOR_Y - 18, this.width, 18);

    // Rounded warm strip; the corners round off past the screen edges.
    g.fillStyle = GROUND_FILL;
    roundRect(g, -40, FLOOR_Y, this.width + 80, this.height - FLOOR_Y + 40, 30);
    g.fill();
    g.fillStyle = GROUND_TOP;
    roundRect(g, -40, FLOOR_Y, this.width + 80, 16, 8);
    g.fill();
    g.fillStyle = GROUND_EDGE;
    roundRect(g, -40, FLOOR_Y - 1, this.width + 80, 4, 2);
    g.fill();

    // Deterministic pebbles: no storage, no per-frame randomness.
    g.fillStyle = PEBBLE;
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.ellipse(
        i * 63 + ((i * i * 37) % 51),
        FLOOR_Y + 20 + ((i * 29) % 36),
        2.5 + (i % 3),
        1.8 + (i % 2) * 0.6,
        0,
        0,
        Math.PI * 2
      );
      g.fill();
    }
  }

  private drawPlayer(g: CanvasRenderingContext2D): void {
    const lift = clamp((PLAYER_MAX_Y_POS - this.py) / 140, 0, 1);
    // The squishy shadow smears wider and flatter the faster he scuttles.
    const speedFrac = Math.abs(this.vx) / PLAYER_MAX_X;
    g.save();
    g.globalAlpha = 0.22 - lift * 0.1;
    g.fillStyle = "#181c2d";
    g.beginPath();
    g.ellipse(
      this.px,
      FLOOR_Y + 6,
      18 - lift * 5 + speedFrac * 7,
      5 - lift * 1.5 - speedFrac * 1.6,
      0,
      0,
      Math.PI * 2
    );
    g.fill();
    g.restore();

    if (this.booster.active) this.drawAura(g);

    drawGuy(g, this.pose);
  }

  /**
   * Super-saiyan flare while boosting: a layered golden glow plus flame licks
   * rising off him. Drawn UNDER the character so it never hides his face, and
   * animated off elapsed time so it flickers instead of sitting still.
   */
  private drawAura(g: CanvasRenderingContext2D): void {
    const t = this.elapsed;
    const cx = this.px;
    const cy = this.py + 4;
    const pulse = 1 + Math.sin(t * 22) * 0.06;

    g.save();

    // Two soft haloes: a wide warm wash and a tighter hot core.
    for (let i = 0; i < 2; i++) {
      const rr = (i === 0 ? 52 : 34) * pulse;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      grad.addColorStop(0, i === 0 ? AURA_MID : AURA_HOT);
      grad.addColorStop(1, AURA_EDGE);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.fill();
    }

    // Flame licks. Fixed count, phase-offset per tongue, so this allocates
    // nothing per frame.
    g.fillStyle = AURA_FLAME;
    for (let i = 0; i < 7; i++) {
      const phase = t * 9 + i * 1.7;
      const sway = Math.sin(phase) * 5;
      const bx = cx + (i - 3) * 7.5;
      const h = 20 + (Math.sin(phase * 1.3) * 0.5 + 0.5) * 22;
      g.beginPath();
      g.moveTo(bx - 4.5, cy - 6);
      g.quadraticCurveTo(bx + sway, cy - 6 - h * 0.6, bx + sway * 0.4, cy - 6 - h);
      g.quadraticCurveTo(bx + sway - 1, cy - 6 - h * 0.5, bx + 4.5, cy - 6);
      g.closePath();
      g.fill();
    }

    g.restore();
  }

  protected onRenderOverlay(g: CanvasRenderingContext2D): void {
    if (this.status !== "playing") return;

    // Outside the shake transform, so the gauge never jitters.
    this.booster.render(g, this.width - 30, 200, 11, 300, ACCENT, INK);

    if (this.elapsed < 3.2) {
      this.tHint.alpha = clamp(3.2 - this.elapsed, 0, 1) * 0.9;
      this.tHint.color = INK_DIM;
      text(g, "ARROW KEYS  -  DO NOT GET POOPED ON", this.width / 2, PLAY_TOP - 34, this.tHint);
    }

    const cx = this.width / 2;

    if (this.stormT > 0) {
      // Sits below the chevron band and above the beams so it never hides the
      // one thing the player must read: which column the hole is in.
      const a = clamp(this.stormT * 3, 0, 1);
      this.tStorm.alpha = a * (0.72 + Math.abs(Math.sin(this.elapsed * 11)) * 0.28);
      this.tStorm.color = ACCENT_DEEP;
      text(g, "STORM INCOMING", cx, 172, this.tStorm);
    }

    if (this.combo >= 2) {
      const t = clamp(this.comboLeft / COMBO_WINDOW, 0, 1);
      // Parked on the ground strip, not the top edge: the top ~37px is the
      // telegraph band, and a HUD element there would sit on the chevrons.
      // Down here it is also inside the player's own field of view.
      g.fillStyle = "rgba(24, 28, 45, 0.14)";
      roundRect(g, cx - 60, 675, 120, 6, 3);
      g.fill();
      if (t > 0) {
        g.fillStyle = ACCENT;
        roundRect(g, cx - 60, 675, 120 * t, 6, 3);
        g.fill();
      }
      this.tCombo.alpha = 0.72 + t * 0.28;
      this.tCombo.size = 17;
      this.tCombo.color = ACCENT_DEEP;
      text(g, COMBO_BANNER[Math.min(this.combo, COMBO_BANNER.length - 1)], cx, 661, this.tCombo);
    }
  }

}
