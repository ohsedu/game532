import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import { Booster } from "@/games/core/Booster";
import { circleHitForgiving, edgeGap, outOfBounds, type Circle } from "@/games/core/Collision";
import {
  OPENING_GRACE,
  rampEaseIn,
  rampEaseOut,
  rampLinear,
  stage,
} from "@/games/core/curve";
import type { ParticleOptions, ParticleShape } from "@/games/core/Particles";
import { drawGrid, roundRect, text, withAlpha } from "@/games/core/draw";
import { clamp, damp, dist, randInt, randRange } from "@/games/core/Vector2";
import {
  createBulletPool,
  createSpiral,
  createWallCue,
  KIND_AIMED,
  KIND_COLOR,
  KIND_HEAVY,
  KIND_OUTLINE,
  KIND_SPIRAL,
  KIND_SPREAD,
  KIND_WALL,
  TAU,
  type Bullet,
  type BulletKind,
} from "./entities";

const ACCENT = "#4f8cff";
/** Deeper blue for the core, so the hitbox out-saturates its own outline. */
const CORE_BLUE = "#2563eb";
const BG = "#f7f8fc";
const FLOOR = "#eef0f7";
const INK = "#22252d";
const INK_DIM = "#6d7280";
const SAFE_GREEN = "#4ecb71";
const DANGER_PINK = "#ff6b8a";

// Colors that never change are built once. withAlpha() parses a hex string and
// concatenates an rgba string, which has no business happening 60 times a second.
const C_GRID_FAR = "rgba(91,95,221,0.06)";
const C_GRID_NEAR = "rgba(91,95,221,0.035)";
const C_SHADOW = "rgba(24,28,45,0.10)";
const C_SHADOW_SOFT = "rgba(24,28,45,0.07)";
const C_FRAME = "rgba(91,95,221,0.10)";
const C_PLAYER_GLOW = withAlpha(ACCENT, 0.1);
const C_PLAYER_GLOW_IN = withAlpha(ACCENT, 0.14);
const C_BODY_FILL = "#ffffff";
const C_CORE_RING = withAlpha(INK, 0.75);
const C_CORE_HALO = withAlpha(CORE_BLUE, 0.2);
const C_GLOSS = "rgba(255,255,255,0.55)";
const C_BLOOM = "rgba(255,255,255,0.55)";
const C_FLASH = "#fff3e6";

/** Confetti. Indexed with a rolling counter so no run ever allocates a color. */
/** Boost livery. Red is otherwise unused by the player, so it reads instantly. */
const BOOST_RED = "#ef3f52";
const C_BOOST_HALO = withAlpha(BOOST_RED, 0.22);

const CANDY: readonly string[] = ["#ff6b8a", "#ffb443", "#4ecb71", "#4f8cff", "#a77bff"];

// --- Layout of the drawn card. Cosmetic only: nothing here is ever collided
// against, and the arena is still the full 1000x700 logical space.
const PANEL_PAD = 8;
const PANEL_R = 30;
const BANNER_W = 460;
const BANNER_H = 74;
const BANNER_Y = 92;

// --- Player ----------------------------------------------------------------
/** Drawn body radius. Purely cosmetic: it never kills. */
const BODY_R = 11;
/** The hitbox. Small enough that threading a 3-way spread is a real skill. */
const CORE_R = 5;
const MAX_SPEED = 330;
/** 0 to full speed in ~0.14s. Any slower and dodging feels like steering a boat. */
const ACCEL = 2400;
/**
 * Reversing gets extra authority. Symmetric acceleration makes direction
 * changes, which are the entire verb of a bullet hell, feel mushy; a full
 * reversal gets 90% more push and lands in about the time of a standing start.
 */
const BRAKE_BONUS = 0.9;
/** Per-second smoothing lambdas: light while steering, hard on key release. */
const DRAG_MOVING = 1.6;
const DRAG_IDLE = 13;
/** Keeps the body off the wall so edge-hugging still reads as a position. */
const EDGE_MARGIN = 16;
const INV_SQRT2 = 0.7071067811865476;

// --- Difficulty ------------------------------------------------------------
const STAGE_SECONDS = 18;
/** Main stream, shots/sec. Ease-out: the screen fills fast, then plateaus. */
const RATE_FROM = 1.4;
const RATE_TO = 4.4;
const RATE_SECONDS = 70;
/**
 * Base bullet speed. Ease-in: nearly flat for the first 30s so the opening is
 * survivable while the player is still learning where the core is, then steep.
 */
const SPEED_FROM = 170;
const SPEED_TO = 355;
const SPEED_SECONDS = 110;
/** Per-kind multipliers on the base speed. */
const SPEED_MUL_AIMED = 1;
const SPEED_MUL_SPREAD = 0.92;
const SPEED_MUL_WALL = 0.8;
const SPEED_MUL_SPIRAL = 0.85;
/** Slow enough that MAX_SPEED always wins a footrace against a heavy orb. */
const SPEED_MUL_HEAVY = 0.42;

/** Nothing fires before this, and the first bullet still needs its flight time. */
const FIRST_SHOT_AT = 0.8;
/** Aimed shots never originate this close to the player. */
const MIN_SPAWN_DIST = 250;
/**
 * A spread has to be sidestepped, not just leaned away from, so it buys itself
 * more runway than a single aimed shot: at 340px even the fastest late-game
 * arm gives ~1.0s, which is the width of a considered dodge.
 */
const MIN_SPAWN_DIST_SPREAD = 340;
const SPAWN_OUT = 30;
const DESPAWN_MARGIN = 80;
/** Aim wobble, radians. Enough that a parked player is not perfectly safe. */
const AIM_JITTER = 0.06;
const SPREAD_ANGLE = 0.18;

const WALL_TELEGRAPH = 1;
/**
 * Bullet centers along the wall. The kill radius of a wall bullet against the
 * core is 7 + 5 - FORGIVE = 9.5px, so a 36px spacing left a 17px slot between
 * every pair — the wall was porous everywhere while its glow read as solid,
 * which made the telegraphed gap decorative. 26 leaves ~7px, so slipping
 * through the body of a wall is a genuine expert line rather than the norm.
 */
const WALL_SPACING = 26;
const WALL_GAP_FROM = 76;
const WALL_GAP_TO = 54;
const WALL_COOLDOWN_FROM = 8.5;
const WALL_COOLDOWN_TO = 5.2;
/** How far the gap may sit from the lane the player is in. See armWall(). */
const WALL_GAP_BIAS = 260;
/**
 * The nearest wall bullet sits exactly `gapHalf` from the gap center and kills
 * within 9.5px of that, so the *passable* opening is narrower than the nominal
 * gap. The telegraph is drawn inset by this much: a cue may promise less than
 * it delivers, never more.
 */
const WALL_GAP_INSET = 10;

const SPIRAL_DRIFT = 0.16;
const SPIRAL_SPIN = 2.2;
const SPIRAL_INTERVAL = 0.085;
const SPIRAL_BURST = 3.2;
const SPIRAL_REST = 2.6;
/** The emitter holds fire while the player is this close to it. */
const SPIRAL_SAFE = 155;
/**
 * Hold-fire alone would let a player park on the emitter and mute the whole
 * pattern, so a crowded emitter bolts along the border at ~610px/s — faster
 * than the player's 330 — and camping stops being a strategy at all.
 */
const SPIRAL_FLEE = 4.5;

const HEAVY_TURN = 0.55;
const HEAVY_HOME_TIME = 8;
const HEAVY_COOLDOWN_FROM = 5;
const HEAVY_COOLDOWN_TO = 3;
/**
 * Heavies live 10-18s each and deny area rather than threaten directly. Past
 * three the arena stops having a readable shape, so the spawner waits instead.
 */
const MAX_HEAVY = 3;
/**
 * From stage 5 aimed shots lead the player's velocity by this fraction of the
 * flight time. A partial lead is the point: holding one direction stops being
 * a free dodge, but a reversal still beats the prediction outright.
 */
const LEAD_FACTOR = 0.55;

// --- Scoring / graze -------------------------------------------------------
const SCORE_PER_SECOND = 10;
const SCORE_PER_GRAZE = 25;
const SCORE_PER_MILESTONE = 100;
const MILESTONE_EVERY = 10;
/** Gap between core edge and bullet edge that counts as a graze. */
const GRAZE_GAP = 16;
const STREAK_DECAY = 1.5;
/** Grazes arrive in clumps; without a cooldown the sound turns into a buzz. */
const GRAZE_SFX_CD = 0.035;
/** Subtracted from the summed radii on the kill test. Cheap deaths feel rigged. */
const FORGIVE = 2.5;
const FORGIVE_HEAVY = 4;

const BANNER_TIME = 1.8;
const STAGE_NAMES: readonly string[] = [
  "SURVIVE",
  "SPREAD SHOT",
  "WALL BREACH",
  "SPIRAL FAN",
  "HEAVY ORBS",
  "LEAD FIRE",
];

/**
 * BULLET DODGE, bullet-hell survival.
 *
 * Bullets converge from every edge and never materialize on top of the player.
 * The whole game hangs off the gap between the 11px body and the 5px core:
 * everything that is not the core exists to be skimmed for score.
 */
export class DodgeGame extends BaseGame {
  private readonly bullets = createBulletPool(480);
  private readonly cue = createWallCue();
  private readonly spiral = createSpiral();
  /** The kill/graze circle. Mutated in place, never re-created. */
  private readonly core: Circle = { x: 0, y: 0, r: CORE_R };
  /** Scratch circle holding a bullet at its closest approach this frame. */
  private readonly probe: Circle = { x: 0, y: 0, r: 0 };
  /** One reused options object behind every particle. See puff(). */
  private readonly po: ParticleOptions = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0.5,
    size: 3,
    sizeEnd: 0,
    color: "#ffffff",
    shape: "circle",
    drag: 1,
    gravity: 0,
    rotation: 0,
    spin: 0,
    additive: false,
  };
  private readonly stats: HudStat[] = [
    { label: "TIME", value: "0.0" },
    { label: "GRAZE", value: "0" },
    { label: "STREAK", value: "-", highlight: true },
  ];

  private px = 0;
  private py = 0;
  private pvx = 0;
  private pvy = 0;
  private ringRot = 0;
  private trailCd = 0;

  private poolCursor = 0;
  private fireCd = 0.4;
  private wallCd = 0;
  private heavyCd = 0;
  /** Live heavy count, recounted every frame in stepBullets. */
  private heavyAlive = 0;

  private grazeCount = 0;
  private streak = 0;
  private streakTimer = 0;
  private streakLabel = "";
  private grazeSfxCd = 0;
  /** 1 on a graze, decaying: drives the ring that shows where the graze band is. */
  private grazeFlash = 0;
  /** Last values the HUD strings were built from. See hudStats(). */
  private timeTenths = -1;
  private grazeLabelFor = -1;

  private curStage = -1;
  private bannerT = 0;
  private bannerTitle = "";
  private bannerSub = "";
  private gridOffset = 0;
  private emberCd = 0;
  /** Rolling index into CANDY, so confetti cycles hues without allocating. */
  private confettiI = 0;

  /** Scratch for the edge sampler: a point plus its inward normal. */
  private ex = 0;
  private ey = 0;
  private enx = 0;
  private eny = 0;

  constructor(services: GameServices) {
    super(services, 640);
  }

  private readonly booster = new Booster(1.7);

  protected onReset(): void {
    this.booster.reset();
    for (let i = 0; i < this.bullets.length; i++) this.bullets[i].active = false;
    this.poolCursor = 0;

    this.px = this.width / 2;
    this.py = this.height / 2;
    this.pvx = 0;
    this.pvy = 0;
    this.core.x = this.px;
    this.core.y = this.py;
    this.ringRot = 0;
    this.trailCd = 0;

    this.cue.active = false;
    this.spiral.p = randRange(0, 4);
    this.spiral.angle = randRange(0, TAU);
    this.spiral.spinDir = 1;
    this.spiral.fireCd = 0;
    this.spiral.phase = SPIRAL_REST;
    this.spiral.firing = false;

    this.fireCd = 0.4;
    this.wallCd = 2.2;
    this.heavyCd = 2.6;
    this.heavyAlive = 0;

    this.grazeCount = 0;
    this.streak = 0;
    this.streakTimer = 0;
    this.streakLabel = "";
    this.grazeSfxCd = 0;
    this.grazeFlash = 0;
    // -1 forces both labels to rebuild on the first frame of the new run.
    this.timeTenths = -1;
    this.grazeLabelFor = -1;

    this.curStage = -1;
    this.bannerT = 0;
    this.bannerTitle = "";
    this.bannerSub = "";
    this.gridOffset = 0;
    this.emberCd = 0;
    this.confettiI = 0;
  }

  /** Next confetti color. Pure cycling, no allocation, no Math.random cost. */
  private candy(): string {
    this.confettiI = (this.confettiI + 1) % CANDY.length;
    return CANDY[this.confettiI];
  }

  /**
   * Called every frame by the base class, so the strings are rebuilt only when
   * the value behind them actually moved — a live 0.1s timer would otherwise
   * mint three throwaway strings per frame on the update path.
   */
  protected hudStats(): HudStat[] {
    const tenths = Math.floor(this.elapsed * 10);
    if (tenths !== this.timeTenths) {
      this.timeTenths = tenths;
      this.stats[0].value = (tenths / 10).toFixed(1);
    }
    if (this.grazeCount !== this.grazeLabelFor) {
      this.grazeLabelFor = this.grazeCount;
      this.stats[1].value = String(this.grazeCount);
    }
    this.stats[2].value = this.streak > 0 ? this.streakLabel : "-";
    return this.stats;
  }

  // --- Simulation ----------------------------------------------------------

  protected onUpdate(dt: number): void {
    this.rawScore += dt * SCORE_PER_SECOND;
    this.gridOffset += 9 * dt;
    this.ringRot += 1.7 * dt;
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.grazeSfxCd > 0) this.grazeSfxCd -= dt;
    if (this.grazeFlash > 0) this.grazeFlash = Math.max(0, this.grazeFlash - dt * 3.4);

    if (this.streakTimer > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) {
        // Losing a run of grazes is a real event and used to pass in silence.
        if (this.streak >= 5) this.audio.play("hit", 0.5, 0.16);
        this.streak = 0;
      }
    }

    this.checkStage();
    this.movePlayer(dt);
    this.spawn(dt);
    this.stepBullets(dt);
  }

  private checkStage(): void {
    const st = stage(this.elapsed, STAGE_SECONDS);
    if (st === this.curStage) return;
    this.curStage = st;
    // Naming the new threat as it unlocks is the cheapest possible tutorial.
    this.bannerTitle =
      st < STAGE_NAMES.length
        ? STAGE_NAMES[st]
        : "PRESSURE +" + (st - STAGE_NAMES.length + 1);
    this.bannerSub = st === 0 ? "ARROW KEYS TO MOVE" : "STAGE " + st;
    this.bannerT = BANNER_TIME;
    if (st > 0) {
      this.audio.play("warn", 1 + st * 0.06, 0.8);
      this.shake.add(4, 0.3);
    }
  }

  private movePlayer(dt: number): void {
    // Boost scales both thrust and the speed cap, so it feels like extra power
    // rather than the same acceleration against a higher ceiling.
    const boost = this.booster.update(dt, this.input.isBoosting());
    const ix = this.input.axisX();
    const iy = this.input.axisY();
    let dx = ix;
    let dy = iy;
    // Normalize diagonals so corner runs are not a free 41% speed bonus.
    if (ix !== 0 && iy !== 0) {
      dx *= INV_SQRT2;
      dy *= INV_SQRT2;
    }

    if (ix !== 0 || iy !== 0) {
      let accel = ACCEL * boost;
      const sp = Math.hypot(this.pvx, this.pvy);
      if (sp > 1) {
        const opposing = -(dx * this.pvx + dy * this.pvy) / sp;
        if (opposing > 0) accel += ACCEL * boost * BRAKE_BONUS * opposing;
      }
      this.pvx += dx * accel * dt;
      this.pvy += dy * accel * dt;
      this.pvx = damp(this.pvx, 0, DRAG_MOVING, dt);
      this.pvy = damp(this.pvy, 0, DRAG_MOVING, dt);
    } else {
      this.pvx = damp(this.pvx, 0, DRAG_IDLE, dt);
      this.pvy = damp(this.pvy, 0, DRAG_IDLE, dt);
    }

    const speed = Math.hypot(this.pvx, this.pvy);
    const cap = MAX_SPEED * boost;
    if (speed > cap) {
      const k = cap / speed;
      this.pvx *= k;
      this.pvy *= k;
    }

    this.px += this.pvx * dt;
    this.py += this.pvy * dt;

    // Zero the component into the wall so speed does not stay loaded against it.
    if (this.px < EDGE_MARGIN) {
      this.px = EDGE_MARGIN;
      if (this.pvx < 0) this.pvx = 0;
    } else if (this.px > this.width - EDGE_MARGIN) {
      this.px = this.width - EDGE_MARGIN;
      if (this.pvx > 0) this.pvx = 0;
    }
    if (this.py < EDGE_MARGIN) {
      this.py = EDGE_MARGIN;
      if (this.pvy < 0) this.pvy = 0;
    } else if (this.py > this.height - EDGE_MARGIN) {
      this.py = this.height - EDGE_MARGIN;
      if (this.pvy > 0) this.pvy = 0;
    }

    this.core.x = this.px;
    this.core.y = this.py;

    // Trail density and length track speed, so velocity is readable at a glance.
    this.trailCd -= dt;
    if (this.trailCd <= 0 && speed > 40) {
      const k = speed / MAX_SPEED;
      this.trailCd = 0.018;
      this.puff(
        this.px + randRange(-2, 2),
        this.py + randRange(-2, 2),
        this.pvx * -0.12,
        this.pvy * -0.12,
        0.18 + 0.2 * k,
        2 + 3.4 * k,
        0,
        ACCENT,
        "circle",
        false,
        0.25
      );
    }
  }

  // --- Spawning ------------------------------------------------------------

  private bulletSpeed(): number {
    return rampEaseIn(this.elapsed, SPEED_FROM, SPEED_TO, SPEED_SECONDS);
  }

  private spawn(dt: number): void {
    const st = this.curStage;

    if (this.elapsed > FIRST_SHOT_AT) {
      // The countdown runs in "shots" units so the rate ramp is a plain factor.
      const rate = rampEaseOut(this.elapsed, RATE_FROM, RATE_TO, RATE_SECONDS);
      this.fireCd -= rate * dt;
      if (this.fireCd <= 0) {
        // Jittered so the stream never settles into a metronome you can hum.
        this.fireCd = randRange(0.72, 1.28);
        this.fireStream(st);
      }
    }

    if (st >= 2) {
      if (this.cue.active) {
        this.cue.timer -= dt;
        if (this.cue.timer <= 0) this.fireWall();
      } else {
        this.wallCd -= dt;
        if (this.wallCd <= 0) this.armWall();
      }
    }

    if (st >= 3) this.updateSpiral(dt);

    if (st >= 4) {
      this.heavyCd -= dt;
      if (this.heavyCd <= 0) {
        if (this.heavyAlive < MAX_HEAVY) {
          this.spawnHeavy();
          // A second orb only once the player has had two stages to learn one.
          if (st >= 6 && this.heavyAlive < MAX_HEAVY && Math.random() < 0.35) this.spawnHeavy();
        }
        this.heavyCd =
          rampLinear(this.elapsed, HEAVY_COOLDOWN_FROM, HEAVY_COOLDOWN_TO, 140) +
          randRange(-0.5, 0.5);
      }
    }
  }

  /** Aimed shots, plus spreads once stage 1 unlocks them. */
  private fireStream(st: number): void {
    // Weighted mix: aimed shots keep firing forever, spreads are layered on top.
    // The pattern is chosen before the spawn point because a spread claims a
    // longer minimum runway than a single shot.
    const spread = st >= 1 && Math.random() < 0.38;
    this.pickEdge(spread ? MIN_SPAWN_DIST_SPREAD : MIN_SPAWN_DIST);
    const x = this.ex;
    const y = this.ey;
    const speed = this.bulletSpeed();
    const kindSpeed = speed * (spread ? SPEED_MUL_SPREAD : SPEED_MUL_AIMED);

    // Stage 5 starts leading the player's velocity instead of aiming where they
    // stand. Only the single aimed shot leads: a leading spread would cover the
    // reversal too and there would be nothing left to do about it.
    let aimX = this.px;
    let aimY = this.py;
    if (!spread && st >= 5) {
      const lead = (dist(x, y, this.px, this.py) / kindSpeed) * LEAD_FACTOR;
      aimX = clamp(this.px + this.pvx * lead, EDGE_MARGIN, this.width - EDGE_MARGIN);
      aimY = clamp(this.py + this.pvy * lead, EDGE_MARGIN, this.height - EDGE_MARGIN);
    }
    const base = Math.atan2(aimY - y, aimX - x) + randRange(-AIM_JITTER, AIM_JITTER);

    if (spread) {
      // Five arms only very late, when three stops covering enough screen.
      const arms = st >= 6 ? 5 : 3;
      const half = (arms - 1) / 2;
      for (let i = 0; i < arms; i++) {
        this.launch(
          KIND_SPREAD,
          x,
          y,
          base + (i - half) * SPREAD_ANGLE,
          kindSpeed,
          5.5,
          randRange(-3, 3),
          0
        );
      }
    } else {
      this.launch(KIND_AIMED, x, y, base, kindSpeed, 6, randRange(-3, 3), 0);
    }
    this.muzzle(x, y, base, KIND_COLOR[spread ? KIND_SPREAD : KIND_AIMED], spread ? 3.4 : 2.6);
    this.audio.play("shoot", randRange(0.85, 1.15), 0.22);
  }

  private armWall(): void {
    const cue = this.cue;
    cue.active = true;
    cue.axis = randInt(0, 1) === 0 ? 0 : 1;
    cue.dir = Math.random() < 0.5 ? 1 : -1;
    cue.spacing = WALL_SPACING;
    cue.speed = this.bulletSpeed() * SPEED_MUL_WALL;
    cue.total = WALL_TELEGRAPH;
    cue.timer = WALL_TELEGRAPH;
    cue.gapHalf = rampLinear(this.elapsed, WALL_GAP_FROM, WALL_GAP_TO, 150);

    // The gap is biased toward the lane the player is already in. A wall should
    // demand a committed run, not a coin flip on whether the opening was even
    // reachable through the rest of the traffic.
    const span = cue.axis === 0 ? this.height : this.width;
    const here = cue.axis === 0 ? this.py : this.px;
    const inset = cue.gapHalf + 26;
    cue.gapCenter = clamp(here + randRange(-WALL_GAP_BIAS, WALL_GAP_BIAS), inset, span - inset);

    this.audio.play("warn", 0.9, 0.9);
  }

  private fireWall(): void {
    const cue = this.cue;
    cue.active = false;
    const vertical = cue.axis === 0;
    const span = vertical ? this.height : this.width;
    const outside =
      cue.dir > 0 ? -SPAWN_OUT : (vertical ? this.width : this.height) + SPAWN_OUT;
    // Overhang both ends by one slot. A wall that started half a slot in and
    // stopped short of the far edge left a permanent free lane hugging that
    // wall — on the 700px axis the last bullet landed at 666 and the player
    // could sit at 684 and ignore every wall in the run.
    for (let s = -cue.spacing * 0.5; s < span + cue.spacing; s += cue.spacing) {
      if (Math.abs(s - cue.gapCenter) < cue.gapHalf) continue;
      const b = this.acquire();
      if (!b) break;
      b.x = vertical ? outside : s;
      b.y = vertical ? s : outside;
      b.vx = vertical ? cue.dir * cue.speed : 0;
      b.vy = vertical ? 0 : cue.dir * cue.speed;
      this.dress(b, KIND_WALL, 7, randRange(-2, 2), 0);
    }
    this.wallCd =
      rampLinear(this.elapsed, WALL_COOLDOWN_FROM, WALL_COOLDOWN_TO, 120) + randRange(-0.6, 0.6);
    this.audio.play("shoot", 0.55, 0.5);
    this.shake.add(3, 0.25);
  }

  private updateSpiral(dt: number): void {
    const sp = this.spiral;

    // Standing on the emitter used to mute it outright, because it holds fire
    // at point-blank range (below). Instead of tolerating that, a crowded
    // emitter sprints along the border faster than the player can follow, so
    // camping buys a second of quiet and then costs position.
    this.edgeAt(sp.p);
    const crowded = dist(this.ex, this.ey, this.px, this.py) < SPIRAL_SAFE * 1.35;
    sp.p = (sp.p + SPIRAL_DRIFT * (crowded ? SPIRAL_FLEE : 1) * dt) % 4;
    sp.angle += sp.spinDir * SPIRAL_SPIN * dt;
    sp.phase -= dt;
    if (sp.phase <= 0) {
      sp.firing = !sp.firing;
      sp.phase = sp.firing ? SPIRAL_BURST : SPIRAL_REST;
      if (sp.firing) {
        // Flipping the sweep each burst stops the fan from becoming a rhythm
        // the player solves once and then ignores.
        sp.spinDir = sp.spinDir === 1 ? -1 : 1;
        this.audio.play("spawn", 1, 0.5);
      }
    }
    if (!sp.firing) return;

    sp.fireCd -= dt;
    if (sp.fireCd > 0) return;
    // Reset rather than accumulate: only one bullet leaves per frame, so a debt
    // built up during a frame hitch would come back as a machine-gun catch-up.
    sp.fireCd = SPIRAL_INTERVAL;

    this.edgeAt(sp.p);
    const dirX = Math.cos(sp.angle);
    const dirY = Math.sin(sp.angle);
    // Half of every sweep points out of the arena. Skipping it costs nothing
    // and reads as the fan flicking on and off.
    if (dirX * this.enx + dirY * this.eny < 0.12) return;
    // The emitter rides the border, so it can drift alongside an edge-hugging
    // player. It holds fire instead of spawning point-blank.
    if (dist(this.ex, this.ey, this.px, this.py) < SPIRAL_SAFE) return;

    this.launch(
      KIND_SPIRAL,
      this.ex - this.enx * 18,
      this.ey - this.eny * 18,
      sp.angle,
      this.bulletSpeed() * SPEED_MUL_SPIRAL,
      5,
      randRange(-4, 4),
      0
    );
  }

  private spawnHeavy(): void {
    this.pickEdge(360);
    const angle = Math.atan2(this.py - this.ey, this.px - this.ex);
    this.launch(
      KIND_HEAVY,
      this.ex,
      this.ey,
      angle,
      this.bulletSpeed() * SPEED_MUL_HEAVY,
      randRange(15, 19),
      randRange(-1.4, 1.4),
      HEAVY_TURN
    );
    // Counted here as well as recounted in stepBullets, so a double spawn in one
    // frame cannot slip past MAX_HEAVY on a stale count.
    this.heavyAlive++;
    this.muzzle(this.ex, this.ey, angle, KIND_COLOR[KIND_HEAVY], 5.5);
    this.audio.play("spawn", 0.6, 0.7);
    this.audio.play("warn", 0.7, 0.35);
  }

  // --- Bullet pool ---------------------------------------------------------

  private acquire(): Bullet | null {
    const n = this.bullets.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.poolCursor + i) % n;
      const b = this.bullets[idx];
      if (!b.active) {
        this.poolCursor = (idx + 1) % n;
        return b;
      }
    }
    // Pool exhausted: drop the shot rather than recycling a bullet mid-flight,
    // which would look like one teleporting across the arena.
    return null;
  }

  private launch(
    kind: BulletKind,
    x: number,
    y: number,
    angle: number,
    speed: number,
    r: number,
    spin: number,
    turn: number
  ): void {
    const b = this.acquire();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    this.dress(b, kind, r, spin, turn);
  }

  /** Shared tail of every spawn: identity plus per-bullet visual phase. */
  private dress(b: Bullet, kind: BulletKind, r: number, spin: number, turn: number): void {
    b.active = true;
    b.kind = kind;
    b.color = KIND_COLOR[kind];
    b.r = r;
    b.spin = spin;
    b.turn = turn;
    b.age = 0;
    b.rot = randRange(0, TAU);
    b.pulse = randRange(0, TAU);
    b.grazed = false;
  }

  /**
   * Samples a spawn point just outside the border, retrying until it is far
   * enough from the player. Nothing may appear on top of you.
   */
  private pickEdge(minDist: number): void {
    for (let attempt = 0; attempt < 8; attempt++) {
      this.edgeSide(randInt(0, 3), Math.random());
      if (dist(this.ex, this.ey, this.px, this.py) >= minDist) return;
    }
    // Every sample landed close, so the player is cornered: fall back to the
    // edge they are furthest from instead of firing point-blank.
    const d0 = this.py;
    const d1 = this.width - this.px;
    const d2 = this.height - this.py;
    const d3 = this.px;
    let side = 0;
    let best = d0;
    if (d1 > best) {
      best = d1;
      side = 1;
    }
    if (d2 > best) {
      best = d2;
      side = 2;
    }
    if (d3 > best) side = 3;
    this.edgeSide(side, Math.random());
  }

  /** Point on side 0-3 (top, right, bottom, left) at parameter t, pushed outward. */
  private edgeSide(side: number, t: number): void {
    const along = 0.06 + t * 0.88;
    if (side === 0) {
      this.ex = along * this.width;
      this.ey = -SPAWN_OUT;
      this.enx = 0;
      this.eny = 1;
    } else if (side === 1) {
      this.ex = this.width + SPAWN_OUT;
      this.ey = along * this.height;
      this.enx = -1;
      this.eny = 0;
    } else if (side === 2) {
      this.ex = along * this.width;
      this.ey = this.height + SPAWN_OUT;
      this.enx = 0;
      this.eny = -1;
    } else {
      this.ex = -SPAWN_OUT;
      this.ey = along * this.height;
      this.enx = 1;
      this.eny = 0;
    }
  }

  /** Continuous walk of the border: one unit of `p` per side, clockwise. */
  private edgeAt(p: number): void {
    const w = this.width;
    const h = this.height;
    if (p < 1) {
      this.ex = p * w;
      this.ey = 0;
      this.enx = 0;
      this.eny = 1;
    } else if (p < 2) {
      this.ex = w;
      this.ey = (p - 1) * h;
      this.enx = -1;
      this.eny = 0;
    } else if (p < 3) {
      this.ex = (3 - p) * w;
      this.ey = h;
      this.enx = 0;
      this.eny = -1;
    } else {
      this.ex = 0;
      this.ey = (4 - p) * h;
      this.enx = 1;
      this.eny = 0;
    }
  }

  // --- Bullets, collision and graze in one pass ----------------------------

  private stepBullets(dt: number): void {
    const grace = this.elapsed <= OPENING_GRACE;
    const core = this.core;
    const probe = this.probe;
    const n = this.bullets.length;
    // Widest step any bullet can take this frame. On a slow frame that is more
    // than the core is wide, so both tests below run against the swept path.
    const sweep = SPEED_TO * dt;
    let heavies = 0;

    for (let i = 0; i < n; i++) {
      const b = this.bullets[i];
      if (!b.active) continue;

      b.age += dt;
      b.rot += b.spin * dt;

      if (b.turn > 0) {
        // Heavies stop tracking after a while so they always leave eventually
        // instead of orbiting the player forever.
        if (b.age > HEAVY_HOME_TIME) b.turn = 0;
        else this.steer(b, dt);
      }

      const stepX = b.vx * dt;
      const stepY = b.vy * dt;
      b.x += stepX;
      b.y += stepY;

      if (outOfBounds(b.x, b.y, this.width, this.height, DESPAWN_MARGIN)) {
        b.active = false;
        continue;
      }
      // Counted after the despawn test so the cap never reserves a slot for an
      // orb that has already left the arena this frame.
      if (b.kind === KIND_HEAVY) heavies++;

      // Cheap square reject first: graze detection then costs nothing on the
      // hundred-plus bullets that are nowhere near the player.
      const dx = b.x - core.x;
      const dy = b.y - core.y;
      const reach = b.r + CORE_R + GRAZE_GAP + sweep;
      if (dx * dx + dy * dy > reach * reach) continue;

      // Closest approach along the path actually travelled this frame. Without
      // it a 355 px/s bullet on a 20 fps frame steps straight over the core:
      // the player sees a direct hit and survives, and loses the graze too.
      probe.r = b.r;
      const seg = stepX * stepX + stepY * stepY;
      if (seg > 0) {
        const along = (core.x - b.x + stepX) * stepX + (core.y - b.y + stepY) * stepY;
        const t = clamp(along / seg, 0, 1);
        probe.x = b.x - stepX + stepX * t;
        probe.y = b.y - stepY + stepY * t;
      } else {
        probe.x = b.x;
        probe.y = b.y;
      }

      const forgive = b.kind === KIND_HEAVY ? FORGIVE_HEAVY : FORGIVE;
      if (circleHitForgiving(core, probe, forgive)) {
        if (grace) {
          // The opening window has to be truly safe, so anything that reaches
          // the player early is vaporized rather than merely ignored: a bullet
          // passing straight through the core would teach the wrong hitbox.
          b.active = false;
          this.burstAt(b.x, b.y, 8, 90, 0.3, 3, b.color);
          this.audio.play("hit", 1.6, 0.25);
          continue;
        }
        this.explode();
        return;
      }

      if (!b.grazed && edgeGap(core, probe) < GRAZE_GAP) this.graze(b, probe.x, probe.y);
    }

    this.heavyAlive = heavies;
  }

  /** Weak homing with a hard cap on turn rate, so a heavy can always be outrun. */
  private steer(b: Bullet, dt: number): void {
    const target = Math.atan2(this.py - b.y, this.px - b.x);
    const cur = Math.atan2(b.vy, b.vx);
    let delta = target - cur;
    if (delta > Math.PI) delta -= TAU;
    else if (delta < -Math.PI) delta += TAU;
    const maxTurn = b.turn * dt;
    const a = cur + clamp(delta, -maxTurn, maxTurn);
    const speed = Math.hypot(b.vx, b.vy);
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
  }

  /** `gx`/`gy` are the closest approach, which is where the skim looked. */
  private graze(b: Bullet, gx: number, gy: number): void {
    b.grazed = true;
    this.grazeCount++;
    this.streak++;
    this.streakTimer = STREAK_DECAY;
    this.streakLabel = "x" + this.streak;
    this.rawScore += SCORE_PER_GRAZE;
    // Flashing the graze band itself is the only way the player ever learns how
    // wide it is; the body ring sits 10px inside it and would otherwise lie.
    this.grazeFlash = 1;

    // Chips fly along the bullet, not away from the player: the eye reads the
    // near-miss as the bullet being skimmed rather than as an impact. Confetti
    // colors rather than the bullet's own, so a skim reads as a reward.
    const speed = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / speed;
    const uy = b.vy / speed;
    for (let i = 0; i < 3; i++) {
      const j = randRange(-0.5, 0.5);
      this.puff(
        gx,
        gy,
        ux * randRange(40, 130) - uy * j * 90,
        uy * randRange(40, 130) + ux * j * 90,
        randRange(0.14, 0.26),
        2.4,
        0.8,
        this.candy(),
        "circle",
        false,
        0.2
      );
    }

    if (this.grazeSfxCd <= 0) {
      this.grazeSfxCd = GRAZE_SFX_CD;
      // Pitch climbs with the streak: the ear tracks the run without looking.
      this.audio.play("graze", 1 + Math.min(this.streak, 24) * 0.038, 0.7);
    }
    // Just enough shake to feel the bullet pass; it stacks by max, not by sum.
    this.shake.add(0.7 + Math.min(this.streak, 20) * 0.05, 0.1);

    if (this.streak % MILESTONE_EVERY === 0) {
      this.rawScore += SCORE_PER_MILESTONE;
      this.audio.play("score", 1 + this.streak * 0.01, 0.8);
      this.burstAt(this.px, this.py, 14, 190, 0.45, 3, ACCENT);
      this.shake.add(3, 0.2);
    }
  }

  // --- Death ---------------------------------------------------------------

  private explode(): void {
    if (this.status !== "playing") return;

    // Confetti, not a fireball: a party popper going off where the player was.
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU + randRange(-0.25, 0.25);
      const s = randRange(90, 420);
      this.puff(
        this.px,
        this.py,
        Math.cos(a) * s,
        Math.sin(a) * s,
        randRange(0.5, 1.1),
        randRange(2.5, 5.5),
        1,
        this.candy(),
        i % 2 === 0 ? "circle" : "square",
        false,
        0.4,
        randRange(0, TAU)
      );
    }
    for (let i = 0; i < 10; i++) {
      const a = randRange(0, TAU);
      this.puff(
        this.px,
        this.py,
        Math.cos(a) * randRange(30, 120),
        Math.sin(a) * randRange(30, 120),
        randRange(0.9, 1.6),
        3.2,
        1.2,
        this.candy(),
        "circle",
        false,
        0.5
      );
    }
    // A single expanding ring sells the pop better than more debris.
    this.puff(this.px, this.py, 0, 0, 0.7, 9, 0, ACCENT, "ring", false, 1);

    this.shake.add(15, 0.75);
    this.audio.play("death");
    this.audio.play("hit", 0.7, 0.9);
    this.die();
  }

  protected onDeathUpdate(dt: number): void {
    // Bullets are already frozen because onUpdate stops running. Embers keep
    // ticking off them for the first moment, which reads as slow motion rather
    // than as the game having simply stopped.
    if (this.deathTime > 0.9) return;
    this.emberCd -= dt;
    if (this.emberCd > 0) return;
    this.emberCd = 0.05;
    for (let k = 0; k < 2; k++) {
      const b = this.bullets[randInt(0, this.bullets.length - 1)];
      if (!b.active) continue;
      this.puff(
        b.x,
        b.y,
        randRange(-24, 24),
        randRange(-24, 24),
        randRange(0.3, 0.7),
        2.4,
        0.6,
        b.color,
        "circle",
        false,
        0.4
      );
    }
  }

  // --- Particles -----------------------------------------------------------

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
    shape: ParticleShape,
    additive: boolean,
    drag = 1,
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
    p.additive = additive;
    p.drag = drag;
    p.rotation = rotation;
    this.fx.emit(p);
  }

  private burstAt(
    x: number,
    y: number,
    count: number,
    speed: number,
    life: number,
    size: number,
    color: string
  ): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + randRange(-0.3, 0.3);
      const s = speed * randRange(0.6, 1.4);
      this.puff(x, y, Math.cos(a) * s, Math.sin(a) * s, life, size, 0.6, color, "circle", false, 0.35);
    }
  }

  /**
   * Flash on the border where a shot came from. Spawn points sit SPAWN_OUT past
   * the edge, so drawing this at the literal spawn point put it off-canvas and
   * bullets appeared to be conjured out of nothing — the flash is pulled back
   * onto the visible border, which is the only warning a stream shot ever gets.
   */
  private muzzle(x: number, y: number, angle: number, color: string, size: number): void {
    const mx = clamp(x, 3, this.width - 3);
    const my = clamp(y, 3, this.height - 3);
    // A ring reads as an impulse at a glance; the chips give it direction.
    this.puff(mx, my, 0, 0, 0.26, size, 0, color, "ring", false, 1);
    for (let i = 0; i < 5; i++) {
      const a = angle + randRange(-0.45, 0.45);
      const s = randRange(70, 210);
      this.puff(mx, my, Math.cos(a) * s, Math.sin(a) * s, 0.24, 2.6, 0.8, color, "circle", false, 0.3);
    }
  }

  // --- Render --------------------------------------------------------------

  protected onRender(g: CanvasRenderingContext2D): void {
    this.drawBackdrop(g);
    // The rim treatment goes under everything: nothing that can kill the player
    // may ever be drawn through a wash, however soft.
    this.drawFrame(g);
    if (this.cue.active) this.drawWallCue(g);
    if (this.curStage >= 3) this.drawEmitter(g);
    this.drawBullets(g);
    if (this.status === "playing") this.drawPlayer(g);

    if (this.status === "gameover") {
      const flash = Math.max(0, 1 - this.deathTime * 3.2);
      if (flash > 0) {
        // A soft warm white, laid on normally. "lighter" over a near-white
        // floor would blow the whole arena out to blank paper.
        g.save();
        g.globalAlpha = flash * 0.6;
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
    // The arena is a rounded card lying on the page, not a hard screen edge.
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
    // Two grids at different rates: the parallax is what keeps an empty arena
    // from reading as a frozen screenshot between waves.
    drawGrid(g, this.width, this.height, 100, this.gridOffset * 0.45, C_GRID_FAR);
    drawGrid(g, this.width, this.height, 50, this.gridOffset, C_GRID_NEAR);
    // Pool of accent light under the player, built from two flat translucent
    // discs. An additive gradient here would only wash the floor out to white.
    g.fillStyle = C_PLAYER_GLOW;
    g.beginPath();
    g.arc(this.px, this.py, 120, 0, TAU);
    g.fill();
    g.fillStyle = C_PLAYER_GLOW_IN;
    g.beginPath();
    g.arc(this.px, this.py, 62, 0, TAU);
    g.fill();
    g.restore();
  }

  /**
   * The old dark vignette, inverted: a wide white stroke feathering the rim
   * into the page plus a hairline frame. Darkening the edges of a light arena
   * would fight the theme and eat the bullets nearest the border.
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

  /**
   * Everything the run owns fades out together after death. The exponent makes
   * the tail linger, which is where the slow-motion feel comes from without
   * touching real time.
   */
  private runFade(): number {
    if (this.status !== "gameover") return 1;
    return Math.max(0, 1 - Math.pow(Math.min(1, this.deathTime / 1.5), 1.6));
  }

  private drawBullets(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;

    g.save();
    const n = this.bullets.length;
    for (let i = 0; i < n; i++) {
      const b = this.bullets[i];
      if (!b.active) continue;
      const pulse = 1 + 0.08 * Math.sin(b.age * 8 + b.pulse);
      const r = b.r * pulse;
      const outline = KIND_OUTLINE[b.kind];

      // Soft drop shadow. A flat ink disc nudged down-right does the job of
      // shadowBlur at a fraction of the cost with a hundred bullets up, and
      // depth is what stops candy circles reading as flat stickers.
      g.globalAlpha = fade;
      g.fillStyle = C_SHADOW;
      g.beginPath();
      g.arc(b.x + 1.6, b.y + 2.6, r * 1.06, 0, TAU);
      g.fill();

      // Solid saturated body plus a darker ring: on a near-white floor the
      // hazard has to be the darkest, most saturated thing in the frame.
      g.fillStyle = b.color;
      g.beginPath();
      g.arc(b.x, b.y, r, 0, TAU);
      g.fill();
      g.strokeStyle = outline;
      g.lineWidth = 2;
      g.stroke();

      if (b.kind === KIND_HEAVY) {
        this.drawHeavyFace(g, b, r, outline, fade);
      } else {
        // One gloss highlight up-left. Without it a flat disc reads as a hole
        // punched in the floor rather than a candy sitting on it.
        g.globalAlpha = 0.8 * fade;
        g.fillStyle = C_GLOSS;
        g.beginPath();
        g.arc(b.x - r * 0.32, b.y - r * 0.34, r * 0.3, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    g.restore();
  }

  /** Heavies are big enough to carry a face, which is what sells them as blobs. */
  private drawHeavyFace(
    g: CanvasRenderingContext2D,
    b: Bullet,
    r: number,
    outline: string,
    fade: number
  ): void {
    g.save();
    g.translate(b.x, b.y);
    // A slow head-tilt read off the spin the orb already had. Cosmetic only.
    g.rotate(Math.sin(b.rot) * 0.16);
    g.globalAlpha = 0.8 * fade;
    g.fillStyle = C_GLOSS;
    g.beginPath();
    g.arc(-r * 0.36, -r * 0.42, r * 0.24, 0, TAU);
    g.fill();

    g.globalAlpha = fade;
    g.fillStyle = outline;
    const eye = Math.max(1.7, r * 0.13);
    g.beginPath();
    g.arc(-r * 0.33, -r * 0.02, eye, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(r * 0.33, -r * 0.02, eye, 0, TAU);
    g.fill();

    g.strokeStyle = outline;
    g.lineWidth = Math.max(1.7, r * 0.1);
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, r * 0.12, r * 0.32, 0.55, Math.PI - 0.55);
    g.stroke();
    g.restore();
  }

  private drawWallCue(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;
    const cue = this.cue;
    const k = 1 - cue.timer / cue.total;
    const blink = (0.55 + 0.45 * Math.sin(this.elapsed * 26)) * fade;
    const vertical = cue.axis === 0;
    // Inset from the nominal gap by the kill radius of the bullets flanking it,
    // so every pixel the cue paints as safe really is.
    const half = cue.gapHalf - WALL_GAP_INSET;
    const lo = cue.gapCenter - half;
    const hi = cue.gapCenter + half;
    const inner = PANEL_PAD + 4;

    g.save();
    // The safe lane as a friendly green highlight across the whole arena: the
    // difference between a wall that tests nerve and one that is a guessing
    // game. Green is used for nothing else, so it can only mean "go here".
    g.globalAlpha = (0.14 + 0.16 * k) * fade;
    g.fillStyle = SAFE_GREEN;
    const laneR = Math.min(24, half);
    if (vertical) roundRect(g, inner, lo, this.width - inner * 2, half * 2, laneR);
    else roundRect(g, lo, inner, half * 2, this.height - inner * 2, laneR);
    g.fill();

    // Danger band on the edge the wall will come from, gap left open. Rounded
    // caps so it reads as a soft bar rather than a blade.
    const thick = 4 + 10 * k;
    const cap = thick * 0.5;
    g.globalAlpha = (0.3 + 0.6 * k) * blink;
    g.fillStyle = DANGER_PINK;
    if (vertical) {
      const x = cue.dir > 0 ? inner : this.width - inner - thick;
      roundRect(g, x, inner, thick, Math.max(0, lo - inner - 6), cap);
      g.fill();
      roundRect(g, x, hi + 6, thick, Math.max(0, this.height - inner - hi - 6), cap);
      g.fill();
    } else {
      const y = cue.dir > 0 ? inner : this.height - inner - thick;
      roundRect(g, inner, y, Math.max(0, lo - inner - 6), thick, cap);
      g.fill();
      roundRect(g, hi + 6, y, Math.max(0, this.width - inner - hi - 6), thick, cap);
      g.fill();
    }

    // Green pills on the two gap edges so the opening itself is unmissable.
    g.globalAlpha = (0.5 + 0.45 * k) * fade;
    g.fillStyle = SAFE_GREEN;
    const t = thick + 12;
    if (vertical) {
      const x = cue.dir > 0 ? inner : this.width - inner - t;
      roundRect(g, x, lo - 6, t, 5, 2.5);
      g.fill();
      roundRect(g, x, hi + 1, t, 5, 2.5);
      g.fill();
    } else {
      const y = cue.dir > 0 ? inner : this.height - inner - t;
      roundRect(g, lo - 6, y, 5, t, 2.5);
      g.fill();
      roundRect(g, hi + 1, y, 5, t, 2.5);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  private drawEmitter(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;
    const sp = this.spiral;
    this.edgeAt(sp.p);
    const x = this.ex + this.enx * 12;
    const y = this.ey + this.eny * 12;
    const color = KIND_COLOR[KIND_SPIRAL];
    const outline = KIND_OUTLINE[KIND_SPIRAL];
    const hot = sp.firing ? 1 : 0.35;

    g.save();
    // Flat translucent pool instead of an additive light.
    g.globalAlpha = (0.08 + 0.12 * hot) * fade;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, 34 + 26 * hot, 0, TAU);
    g.fill();

    g.globalAlpha = fade;
    g.fillStyle = C_SHADOW;
    g.beginPath();
    g.ellipse(x + 1.5, y + 3.5, 11, 9.5, 0, 0, TAU);
    g.fill();

    g.translate(x, y);
    g.rotate(sp.angle);
    // A stub barrel pointing down the current fire line: you can see where the
    // next bullet is going before it exists.
    g.fillStyle = outline;
    roundRect(g, 5, -3, 10 + 16 * hot, 6, 3);
    g.fill();
    // Rounded body with a chunky outline.
    g.fillStyle = color;
    roundRect(g, -9, -9, 18, 18, 7);
    g.fill();
    g.strokeStyle = outline;
    g.lineWidth = 2.2;
    g.stroke();
    g.restore();

    // Eyes drawn outside the rotation so the little face stays upright.
    g.save();
    g.globalAlpha = fade;
    g.fillStyle = outline;
    g.beginPath();
    g.arc(x - 3.2, y - 0.5, 1.7, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(x + 3.2, y - 0.5, 1.7, 0, TAU);
    g.fill();
    g.restore();
  }

  private drawPlayer(g: CanvasRenderingContext2D): void {
    const speed = Math.hypot(this.pvx, this.pvy) / MAX_SPEED;
    const hot = this.booster.active;
    const skin = hot ? BOOST_RED : ACCENT;

    g.save();
    // Soft shadow: on a light floor this is what lifts the player off the panel.
    g.fillStyle = C_SHADOW_SOFT;
    g.beginPath();
    g.ellipse(this.px + 1.5, this.py + 3.5, BODY_R * 1.02, BODY_R * 0.9, 0, 0, TAU);
    g.fill();

    // Body: white and hollow. It is not what kills you, so it must not look
    // like the thing to protect — but on a near-white floor a hollow shape
    // needs a chunky blue outline or it simply is not there.
    g.fillStyle = C_BODY_FILL;
    g.beginPath();
    g.arc(this.px, this.py, BODY_R, 0, TAU);
    g.fill();
    g.strokeStyle = skin;
    g.lineWidth = hot ? 3.4 : 2.6;
    g.globalAlpha = 0.5 + 0.3 * speed;
    g.stroke();
    // Three rotating arcs riding the outline: motion the eye can pick up even
    // while the player is standing still.
    g.globalAlpha = 0.9;
    g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const a = this.ringRot + (i / 3) * TAU;
      g.beginPath();
      g.arc(this.px, this.py, BODY_R, a, a + 1.15);
      g.stroke();
    }
    g.restore();

    // The graze band, shown only in the moment it pays out. A permanent ring
    // would be one more circle to parse on a full screen; a flash on contact
    // teaches the same radius and then gets out of the way.
    if (this.grazeFlash > 0) {
      const f = this.grazeFlash;
      g.save();
      g.strokeStyle = ACCENT;
      g.globalAlpha = f * 0.5;
      g.lineWidth = 1.5 + f * 1.5;
      g.beginPath();
      g.arc(this.px, this.py, CORE_R + GRAZE_GAP * (0.8 + 0.3 * (1 - f)), 0, TAU);
      g.stroke();
      g.restore();
    }

    // Core: the actual hitbox. A solid saturated blue disc with a thin ink
    // ring, and the single highest-contrast mark on the screen. Never a glow —
    // on a light floor a halo is the first thing to disappear.
    g.save();
    g.fillStyle = hot ? C_BOOST_HALO : C_CORE_HALO;
    g.beginPath();
    g.arc(this.px, this.py, CORE_R + (hot ? 7 : 4.5), 0, TAU);
    g.fill();
    g.fillStyle = hot ? BOOST_RED : CORE_BLUE;
    g.beginPath();
    g.arc(this.px, this.py, CORE_R, 0, TAU);
    g.fill();
    g.strokeStyle = C_CORE_RING;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(this.px, this.py, CORE_R + 1.5, 0, TAU);
    g.stroke();
    g.restore();

    if (this.elapsed < OPENING_GRACE) {
      // Spell the grace window out; an invulnerable second the player cannot
      // see is an invulnerable second they will not trust.
      const k = this.elapsed / OPENING_GRACE;
      g.save();
      g.strokeStyle = SAFE_GREEN;
      g.globalAlpha = 0.7 * (1 - k);
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(this.px, this.py, 20 + 34 * k, 0, TAU);
      g.stroke();
      g.restore();
      text(g, "SAFE", this.px, this.py - 34, {
        size: 11,
        color: SAFE_GREEN,
        alpha: 0.9 * (1 - k),
        letterSpacing: "3px",
      });
    }

    if (this.streak >= 3) {
      text(g, this.streakLabel, this.px, this.py - 30, {
        size: 15,
        color: ACCENT,
        alpha: Math.min(1, this.streakTimer / STREAK_DECAY) * 0.95,
        shadow: C_SHADOW,
        shadowBlur: 6,
      });
    }
  }

  protected onRenderOverlay(g: CanvasRenderingContext2D): void {
    this.booster.render(g, this.width - 30, 214, 11, 300, ACCENT);

    if (this.bannerT <= 0) return;
    const k = this.bannerT / BANNER_TIME;
    // Snap in, hold, drift out. onUpdate stops at death, so bannerT freezes —
    // without the runFade term a stage banner caught mid-hold would sit on the
    // game-over screen at full brightness forever.
    const alpha = (k > 0.85 ? (1 - k) / 0.15 : Math.min(1, k / 0.3)) * this.runFade();
    if (alpha <= 0) return;

    // A white pill behind the words. Text alone on a busy light floor loses to
    // the bullets crossing it, and a card is the friendlier read anyway.
    const bx = (this.width - BANNER_W) / 2;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = C_SHADOW_SOFT;
    roundRect(g, bx, BANNER_Y + 4, BANNER_W, BANNER_H, BANNER_H / 2);
    g.fill();
    g.fillStyle = C_BODY_FILL;
    roundRect(g, bx, BANNER_Y, BANNER_W, BANNER_H, BANNER_H / 2);
    g.fill();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.restore();

    text(g, this.bannerTitle, this.width / 2, BANNER_Y + 30, {
      size: 26,
      color: ACCENT,
      alpha,
      letterSpacing: "6px",
    });
    text(g, this.bannerSub, this.width / 2, BANNER_Y + 56, {
      size: 12,
      color: INK_DIM,
      alpha: alpha * 0.9,
      letterSpacing: "4px",
    });
  }
}
