import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import {
  OPENING_GRACE,
  rampAsymptotic,
  rampEaseOut,
  rampLinear,
} from "@/games/core/curve";
import { drawGrid, roundRect, text, type TextOptions, withAlpha } from "@/games/core/draw";
import type { ParticleOptions } from "@/games/core/Particles";
import { randInt, randRange } from "@/games/core/Vector2";
import {
  AMBER,
  AMBER_DARK,
  BASE,
  CANDY,
  CARD,
  CARD_H,
  CARD_R,
  CARD_W,
  CARD_X,
  CARD_Y,
  dropShadow,
  FLOOR,
  FLOOR_Y,
  GRID,
  GRID_ROSE,
  INK,
  INK_DIM,
  INK_FAINT,
  PLAYER_X,
  PLAYER_Y,
  ROSE,
  ROSE_DARK,
  ROSE_DEEP,
  ROSE_SOFT,
  SHADOW,
  softHalo,
  SPAWN_DIST,
  STRIKE_DIST,
  TAU,
  TRAVEL,
} from "./arena";
import {
  blankEnemy,
  drawEnemy,
  drawTelegraph,
  FEINT_REVEAL,
  type Enemy,
} from "./enemies";
import {
  DIR_INFO,
  type Dir,
  isVertical,
  KEY_TO_DIR,
  pickSpawnDir,
  pickSpawnDirExcept,
  verticalWeight,
} from "./facing";

const POOL = 24;
/** Purely a legibility cap; the strike guard already bounds real difficulty. */
const MAX_INFLIGHT = 6;

/** Turn tween. Short enough to feel instant, long enough to read as a snap. */
const TURN_TIME = 0.09;
const OVERSHOOT_C1 = 2.2;
const OVERSHOOT_C3 = OVERSHOOT_C1 + 1;

/**
 * Grace after a missed strike. Four frames at 60Hz: invisible as a delay, but
 * it rescues the "I pressed it!" inputs that land a frame late. It costs the
 * combo, so it can never be played for instead of parrying properly.
 */
const CLUTCH_WINDOW = 0.07;
/** Impact pause on a parry. Input keeps running through it. */
const HITSTOP = 0.05;

/**
 * Minimum spacing between two strikes that need DIFFERENT facings. Starts far
 * above human reaction time and only ever approaches 0.32s, never reaches it.
 */
const TURN_GAP_START = 0.62;
const TURN_GAP_RANGE = -0.3;
const TURN_GAP_HALFLIFE = 50;
/** Two strikes from the same side need no turn — only enough gap to read. */
const SAME_DIR_GAP = 0.16;

/** How much a spawn may be pushed later to satisfy the guard before it is
 *  dropped. Stretching the telegraph is always fair; crowding is not. */
const MAX_TELEGRAPH_STRETCH = 0.85;
const RETRY_DELAY = 0.16;
const FIRST_SPAWN_DELAY = 0.5;
/** No strike may resolve before this, on top of the engine-wide grace. */
const GRACE_MARGIN = 0.45;

const CHAIN_START = 22;
const CHAIN_SAME_GAP = 0.3;
const CHAIN_ALT_GAP = 0.46;

const FEINT_START = 45;
/** A feint always gets a long telegraph; the reveal is what must be fair. */
const FEINT_TELEGRAPH_MIN = 0.72;

/**
 * The very first strike from a newly opened axis gets a full-length telegraph.
 * The player has spent half a minute being taught that only left and right
 * exist; the moment that stops being true must not also be the moment they die.
 */
const FIRST_VERTICAL_TELEGRAPH = 1.05;

const MAX_MULT = 8;
/** Pre-built so a parry never allocates a string mid-frame. */
const PARRY_LABELS = ["+100", "+200", "+300", "+400", "+500", "+600", "+700", "+800"];
const COMBO_LABELS = ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"];

const OPENING_HINT = "ARROW KEYS TURN — FACE THE STRIKE";
/** Shown once, on the first vertical spawn. A rule that changes mid-run and
 *  says nothing is indistinguishable from a rule that was never fair. */
const VERTICAL_HINT = "UP AND DOWN ARE LIVE NOW";

const RING_DASH = [7, 12];
const NO_DASH: number[] = [];

interface Popup {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  label: string;
  color: string;
}

function blankPopup(): Popup {
  return { active: false, x: 0, y: 0, life: 0, maxLife: 0.62, label: "", color: ROSE_DEEP };
}

/** Overshooting ease so the body snaps past the new facing and settles back. */
function backOut(k: number): number {
  const p = k - 1;
  return 1 + OVERSHOOT_C3 * p * p * p + OVERSHOOT_C1 * p * p;
}

/**
 * FACE OFF — a pure reaction duel. The player is rooted in the centre and only
 * chooses a facing; enemies rush in and resolve the moment they touch the
 * strike ring. Everything here exists to make one question readable in under a
 * second: which side is about to hit me, and am I looking at it?
 */
export class DirectionGame extends BaseGame {
  private readonly enemies: Enemy[] = [];
  private readonly popups: Popup[] = [];

  private facing: Dir = "right";
  private facingAngle = 0;
  private turnFrom = 0;
  private turnDelta = 0;
  private turnT = TURN_TIME;

  /** Scheduling clock. Unlike `elapsed` it stops during hitstop, so predicted
   *  strike times stay exact no matter how many parries pause the scene. */
  private simTime = 0;
  private hitstop = 0;

  private spawnTimer = FIRST_SPAWN_DELAY;
  private forcedDir: Dir | null = null;
  private chainLeft = 0;
  private chainAlt = false;
  private verticalSeen = false;

  private combo = 0;
  private multiplier = 1;
  private parries = 0;
  private parryText = "0";

  private guardFlash = 0;
  private whiteFlash = 0;
  private ringFlash = 0;
  private multPop = 0;
  private hint = 3.4;
  private hintText = OPENING_HINT;

  private killer: Enemy | null = null;
  private deathFacing: Dir = "right";
  private deathLine = "";
  private deathSub = "";
  private deathKo = "";

  /** Built once against the live context; a gradient per frame would allocate. */
  private wash: CanvasGradient | null = null;
  private spot: CanvasGradient | null = null;

  private readonly stats: HudStat[] = [
    { label: "COMBO", value: "x1", highlight: true },
    { label: "PARRY", value: "0" },
  ];

  // Reused so particle and text calls never build an options literal per frame.
  private readonly emitOpt: ParticleOptions = { x: 0, y: 0 };
  private readonly fanOpt: Omit<ParticleOptions, "x" | "y" | "vx" | "vy"> = {};
  private readonly ghostOpt: TextOptions = { size: 170, color: ROSE, alpha: 0.08 };
  private readonly popOpt: TextOptions = { size: 21, color: ROSE_DEEP, alpha: 1 };
  private readonly hintOpt: TextOptions = {
    size: 15,
    color: INK_DIM,
    alpha: 1,
    letterSpacing: "3px",
  };
  private readonly deathOpt: TextOptions = {
    size: 30,
    color: ROSE_DEEP,
    alpha: 1,
    letterSpacing: "3px",
  };
  private readonly subOpt: TextOptions = { size: 15, color: INK_DIM, alpha: 1 };
  private readonly koOpt: TextOptions = { size: 14, color: INK_FAINT, alpha: 1 };

  constructor(services: GameServices) {
    super(services, 700);
    // Pools are built once and only reset between runs; a restart must never
    // hand the collector 24 fresh objects mid-session.
    for (let i = 0; i < POOL; i++) this.enemies.push(blankEnemy());
    for (let i = 0; i < 10; i++) this.popups.push(blankPopup());
  }

  protected onReset(): void {
    // Every field, not just the ones the next spawn happens to overwrite — a
    // restart must not be able to inherit a pose or a schedule from last run.
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.active = false;
      e.phase = "telegraph";
      e.dir = "left";
      e.flareDir = "left";
      e.feint = false;
      e.t = 0;
      e.telegraph = 1;
      e.speed = 0;
      e.d = SPAWN_DIST;
      e.x = PLAYER_X;
      e.y = PLAYER_Y;
      e.strikeAt = 0;
    }
    for (let i = 0; i < this.popups.length; i++) this.popups[i].active = false;

    this.facing = "right";
    this.facingAngle = 0;
    this.turnFrom = 0;
    this.turnDelta = 0;
    this.turnT = TURN_TIME;

    this.simTime = 0;
    this.hitstop = 0;
    this.spawnTimer = FIRST_SPAWN_DELAY;
    // The player starts facing right, so the opening threat comes from the left
    // on purpose: the first thing a run ever asks for is a turn, in the widest
    // reaction window the game will ever offer.
    this.forcedDir = "left";
    this.chainLeft = 0;
    this.chainAlt = false;
    this.verticalSeen = false;

    this.combo = 0;
    this.multiplier = 1;
    this.parries = 0;
    this.parryText = "0";

    this.guardFlash = 0;
    this.whiteFlash = 0;
    this.ringFlash = 0;
    this.multPop = 0;
    this.hint = 3.4;
    this.hintText = OPENING_HINT;

    this.killer = null;
    this.deathFacing = "right";
    this.deathLine = "";
    this.deathSub = "";
    this.deathKo = "";
  }

  // --- Update ---------------------------------------------------------------

  protected onUpdate(dt: number): void {
    // Facing first, always: an arrow pressed on the same frame a strike lands
    // must count. Latency here is the entire game.
    this.updateFacing(dt);

    let sim = dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      sim = 0;
    }
    this.simTime += sim;

    this.decayFlashes(dt);
    this.hint = Math.max(0, this.hint - dt);

    this.updateEnemies(sim);
    this.updatePopups(dt);

    if (sim > 0) {
      this.spawnTimer -= sim;
      if (this.spawnTimer <= 0) this.trySpawn();
    }

    // Survival trickle — present, but never competitive with parrying.
    this.rawScore += dt * 2;
  }

  private decayFlashes(dt: number): void {
    this.guardFlash = Math.max(0, this.guardFlash - dt * 5.5);
    this.whiteFlash = Math.max(0, this.whiteFlash - dt);
    this.ringFlash = Math.max(0, this.ringFlash - dt * 2.6);
    this.multPop = Math.max(0, this.multPop - dt * 1.8);
  }

  /**
   * The run stops but the frame does not. Without this the last parry's
   * full-screen wash and its floating "+400" freeze on top of the death
   * readout for as long as the panel takes to appear, and the one thing the
   * player needs to read — which side killed them — is behind a rose wash.
   */
  protected onDeathUpdate(dt: number): void {
    this.decayFlashes(dt);
    this.updatePopups(dt);
  }

  private updateFacing(dt: number): void {
    const key = this.input.anyJustPressed();
    if (key) {
      const d = KEY_TO_DIR[key];
      if (d !== this.facing) this.turnTo(d);
      // A re-press on the side already held still lights the guard, so the
      // input is never silently swallowed.
      else this.guardFlash = Math.max(this.guardFlash, 0.4);
    }

    if (this.turnT < TURN_TIME) {
      this.turnT = Math.min(TURN_TIME, this.turnT + dt);
      this.facingAngle = this.turnFrom + this.turnDelta * backOut(this.turnT / TURN_TIME);
    }
  }

  private turnTo(d: Dir): void {
    const info = DIR_INFO[d];
    let delta = info.angle - this.facingAngle;
    // Shortest arc. A dead-on 180 resolves clockwise so it is always the same
    // motion, which matters when the player is reading their own body.
    while (delta > Math.PI) delta -= TAU;
    while (delta <= -Math.PI) delta += TAU;

    this.facing = d;
    this.turnFrom = this.facingAngle;
    this.turnDelta = delta;
    this.turnT = 0;
    this.guardFlash = Math.max(this.guardFlash, 0.45);
    this.audio.play("click", info.detune * 1.15, 0.3);

    this.fanOpt.life = 0.24;
    this.fanOpt.size = 3;
    this.fanOpt.sizeEnd = 0.6;
    this.fanOpt.color = ROSE;
    this.fanOpt.shape = "circle";
    this.fanOpt.drag = 0.1;
    this.fanOpt.spin = 0;
    this.fanOpt.additive = false;
    this.fx.spray(
      PLAYER_X + info.vx * 44,
      PLAYER_Y + info.vy * 44,
      4,
      info.angle,
      0.9,
      110,
      this.fanOpt
    );
  }

  private updateEnemies(sim: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      // die() lands mid-loop when a strike resolves. Everything after it in the
      // pool must freeze on the spot, or a later index can still score a parry
      // (and its hitstop and sparks) on a run that is already over.
      if (this.status !== "playing") return;
      const e = this.enemies[i];
      if (!e.active) continue;

      if (e.phase === "telegraph") {
        const before = e.t;
        e.t -= sim;
        if (e.feint && before > FEINT_REVEAL && e.t <= FEINT_REVEAL) this.revealFeint(e);
        if (e.t <= 0) this.beginApproach(e);
        continue;
      }

      if (e.phase === "approach") {
        e.d -= e.speed * sim;
        if (e.d <= STRIKE_DIST) {
          e.d = STRIKE_DIST;
          this.place(e);
          this.beginStrike(e);
        } else {
          this.place(e);
        }
        continue;
      }

      // Strike phase = the clutch window. The facing test runs before the
      // timer so a turn landing inside the window always wins the tie.
      if (this.facing === e.dir) {
        this.parry(e, true);
        continue;
      }
      e.t -= sim;
      if (e.t <= 0) this.killedBy(e);
    }
  }

  private place(e: Enemy): void {
    const info = DIR_INFO[e.dir];
    e.x = PLAYER_X + info.vx * e.d;
    e.y = PLAYER_Y + info.vy * e.d;
  }

  private revealFeint(e: Enemy): void {
    const info = DIR_INFO[e.dir];
    this.audio.play("warn", info.detune, 1);
    this.audio.play("spawn", 1, 0.5);
    this.fanOpt.life = 0.34;
    this.fanOpt.size = 4;
    this.fanOpt.sizeEnd = 0.8;
    this.fanOpt.color = AMBER;
    this.fanOpt.shape = "circle";
    this.fanOpt.drag = 0.2;
    this.fanOpt.spin = 0;
    this.fanOpt.additive = false;
    this.fx.burst(
      PLAYER_X + info.vx * SPAWN_DIST,
      PLAYER_Y + info.vy * SPAWN_DIST,
      10,
      170,
      this.fanOpt
    );
  }

  private beginApproach(e: Enemy): void {
    const info = DIR_INFO[e.dir];
    e.phase = "approach";
    // Carry the frame's telegraph overshoot into the travel so the predicted
    // strike time the scheduler guaranteed stays exact.
    e.d = SPAWN_DIST + e.speed * e.t;
    this.place(e);
    this.audio.play("spawn", info.detune, 0.55);

    this.fanOpt.life = 0.3;
    this.fanOpt.size = 4.2;
    this.fanOpt.sizeEnd = 0.8;
    this.fanOpt.color = ROSE_DEEP;
    this.fanOpt.shape = "circle";
    this.fanOpt.drag = 0.15;
    this.fanOpt.spin = 0;
    this.fanOpt.additive = false;
    this.fx.spray(e.x, e.y, 7, info.angle, 0.7, 190, this.fanOpt);
  }

  private beginStrike(e: Enemy): void {
    // The opening grace is absolute: nothing may kill during it.
    if (this.facing === e.dir || this.elapsed < OPENING_GRACE) {
      this.parry(e, false);
      return;
    }
    e.phase = "strike";
    e.t = CLUTCH_WINDOW;
  }

  /** Candy confetti. Loops rather than calling burst so each chip can carry its
   *  own colour without building an options object per particle. */
  private confetti(
    x: number,
    y: number,
    count: number,
    angle: number,
    spread: number,
    speed: number
  ): void {
    for (let i = 0; i < count; i++) {
      const a = angle + randRange(-spread, spread);
      const s = speed * randRange(0.45, 1.25);
      this.emitOpt.x = x;
      this.emitOpt.y = y;
      this.emitOpt.vx = Math.cos(a) * s;
      this.emitOpt.vy = Math.sin(a) * s;
      this.emitOpt.life = randRange(0.42, 0.78);
      this.emitOpt.size = randRange(2.6, 4.6);
      this.emitOpt.sizeEnd = 1.2;
      this.emitOpt.color = CANDY[i % CANDY.length];
      this.emitOpt.shape = (i & 1) === 0 ? "square" : "circle";
      this.emitOpt.drag = 0.25;
      this.emitOpt.gravity = 300;
      this.emitOpt.rotation = a;
      this.emitOpt.spin = randRange(-11, 11);
      this.emitOpt.additive = false;
      this.fx.emit(this.emitOpt);
    }
  }

  private parry(e: Enemy, clutch: boolean): void {
    e.active = false;
    const info = DIR_INFO[e.dir];

    let stepped = false;
    if (clutch) {
      // Survived, but sloppily: the multiplier is the price of the save.
      const lost = this.multiplier;
      this.combo = 0;
      this.multiplier = 1;
      this.rawScore += 50;
      this.audio.play("graze", 1.35, 1);
      // A dropped multiplier needs its own sound. Without it "saved" and "saved
      // but it cost you eight runs' worth of stacking" are the same event.
      if (lost > 1) this.audio.play("hit", 0.6, 0.5);
      this.shake.add(7, 0.22);
      this.pushPopup("CLUTCH", AMBER_DARK, info.vx, info.vy);
    } else {
      const prev = this.multiplier;
      this.combo++;
      this.multiplier = Math.min(MAX_MULT, 1 + Math.floor((this.combo - 1) / 3));
      this.rawScore += 100 * this.multiplier;
      // Pitch rises with the multiplier so the combo is audible without looking.
      this.audio.play("success", 1 + (this.multiplier - 1) * 0.14, 0.95);
      this.shake.add(3.2 + this.multiplier * 0.4, 0.16);
      this.pushPopup(PARRY_LABELS[this.multiplier - 1], ROSE_DEEP, info.vx, info.vy);
      stepped = this.multiplier > prev;
      if (stepped) {
        // The multiplier step is the only thing a combo actually pays out, and
        // it lands in the same frame as a parry. It gets its own chime and its
        // own ring or it vanishes inside the parry's feedback entirely.
        this.multPop = 1;
        this.audio.play("score", 1 + (this.multiplier - 1) * 0.08, 0.7);
      }
    }

    this.parries++;
    this.parryText = String(this.parries);
    this.hitstop = HITSTOP;
    this.guardFlash = 1;
    this.ringFlash = 1;
    this.whiteFlash = Math.max(this.whiteFlash, 0.05);

    // Confetti fires back out along the enemy's own axis, so the burst reads as
    // "that one, from there" rather than as decoration.
    this.confetti(e.x, e.y, 16, info.angle, 0.6, 420);
    this.confetti(e.x, e.y, 8, info.angle, 1.5, 180);

    this.emitOpt.x = PLAYER_X;
    this.emitOpt.y = PLAYER_Y;
    this.emitOpt.vx = 0;
    this.emitOpt.vy = 0;
    this.emitOpt.life = 0.38;
    this.emitOpt.size = 7;
    this.emitOpt.sizeEnd = 0;
    this.emitOpt.color = ROSE;
    this.emitOpt.shape = "ring";
    this.emitOpt.drag = 1;
    this.emitOpt.gravity = 0;
    this.emitOpt.spin = 0;
    this.emitOpt.additive = false;
    this.fx.emit(this.emitOpt);

    if (stepped) {
      this.emitOpt.life = 0.6;
      this.emitOpt.size = 14;
      this.emitOpt.color = ROSE_DEEP;
      this.fx.emit(this.emitOpt);
    }
  }

  private killedBy(e: Enemy): void {
    // Two enemies can land on the same frame; only the first one is the story.
    if (this.status !== "playing") return;
    const info = DIR_INFO[e.dir];
    this.killer = e;
    this.deathFacing = this.facing;
    this.deathLine = "STRUCK FROM " + info.from;
    this.deathSub = "YOU WERE FACING " + DIR_INFO[this.facing].label;
    this.deathKo = info.labelKo + "에서 베였다";

    this.whiteFlash = 0.13;
    this.shake.add(30, 0.62);
    this.audio.play("hit", 0.55, 1);
    this.audio.play("death");

    this.fanOpt.life = 0.75;
    this.fanOpt.size = 5;
    this.fanOpt.sizeEnd = 1;
    this.fanOpt.color = ROSE_DEEP;
    this.fanOpt.shape = "circle";
    this.fanOpt.drag = 0.25;
    this.fanOpt.spin = 0;
    this.fanOpt.additive = false;
    this.fx.burst(PLAYER_X, PLAYER_Y, 26, 340, this.fanOpt);

    this.confetti(PLAYER_X, PLAYER_Y, 16, info.angle + Math.PI, Math.PI, 220);

    this.die();
  }

  // --- Scheduling -----------------------------------------------------------

  /**
   * Pushes `at` later until it clears every scheduled strike by the required
   * gap. Only ever moves forward, so it terminates, and a later strike means a
   * longer telegraph — more warning, never less.
   */
  private deconflict(at: number, dir: Dir, turnGap: number): number {
    let strikeAt = at;
    for (let pass = 0; pass < 8; pass++) {
      let pushed = false;
      for (let i = 0; i < this.enemies.length; i++) {
        const o = this.enemies[i];
        if (!o.active || o.phase === "strike") continue;
        const gap = o.dir === dir ? SAME_DIR_GAP : turnGap;
        if (Math.abs(strikeAt - o.strikeAt) < gap) {
          strikeAt = o.strikeAt + gap;
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    return strikeAt;
  }

  private trySpawn(): void {
    let slot = -1;
    let inflight = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].active) inflight++;
      else if (slot < 0) slot = i;
    }
    if (slot < 0 || inflight >= MAX_INFLIGHT) {
      this.spawnTimer = RETRY_DELAY;
      return;
    }

    // Linear, not ease-in: the quadratic version sat within 3% of its start
    // speed for the whole first 15 seconds, so the opening never escalated.
    const speed = rampLinear(this.elapsed, 300, 580, 65);
    const approach = TRAVEL / speed;
    const turnGap = rampAsymptotic(
      this.elapsed,
      TURN_GAP_START,
      TURN_GAP_RANGE,
      TURN_GAP_HALFLIFE
    );

    const vert = verticalWeight(this.elapsed);
    let dir = this.forcedDir ?? pickSpawnDir(vert);
    // Halves toward a 0.30s floor twice as fast as before. The floor is what
    // guarantees fairness, so it went UP while the approach to it got steeper.
    let tele = rampAsymptotic(this.elapsed, 0.85, -0.55, 13);
    const wantFeint =
      this.forcedDir === null &&
      this.chainLeft === 0 &&
      this.elapsed >= FEINT_START &&
      Math.random() < rampAsymptotic(this.elapsed - FEINT_START, 0, 0.3, 40);
    if (wantFeint) tele = Math.max(tele, FEINT_TELEGRAPH_MIN);

    const base = Math.max(this.simTime + tele + approach, OPENING_GRACE + GRACE_MARGIN);
    let strikeAt = this.deconflict(base, dir, turnGap);
    let stretch = strikeAt - base;

    if (stretch > MAX_TELEGRAPH_STRETCH && this.forcedDir === null) {
      // This side is congested; the other one may have a clean slot.
      const alt = pickSpawnDirExcept(dir, vert);
      if (alt !== dir) {
        const altAt = this.deconflict(base, alt, turnGap);
        if (altAt - base < stretch) {
          dir = alt;
          strikeAt = altAt;
          stretch = altAt - base;
        }
      }
    }
    if (stretch > MAX_TELEGRAPH_STRETCH) {
      // Refuse rather than crowd. Density is capped by the guard, not by luck.
      this.spawnTimer = RETRY_DELAY;
      return;
    }

    // A one-time stretch past the usual cap for the run's first vertical
    // strike. Re-run the guard afterwards: pushing later can clear one
    // neighbour and land inside another one's window.
    const firstVertical = !this.verticalSeen && isVertical(dir);
    if (firstVertical) {
      const want = this.simTime + FIRST_VERTICAL_TELEGRAPH + approach;
      if (strikeAt < want) strikeAt = this.deconflict(want, dir, turnGap);
    }

    const finalTele = strikeAt - this.simTime - approach;
    const e = this.enemies[slot];
    e.active = true;
    e.phase = "telegraph";
    e.dir = dir;
    e.feint = wantFeint && finalTele >= FEINT_REVEAL + 0.3;
    // An uncommitted flare picks its side freely — including the true one — so
    // "amber means the opposite side" is never a shortcut around reading it.
    e.flareDir = e.feint && Math.random() < 0.5 ? DIR_INFO[dir].opposite : dir;
    e.t = finalTele;
    e.telegraph = finalTele;
    e.speed = speed;
    e.d = SPAWN_DIST;
    e.strikeAt = strikeAt;
    this.place(e);
    this.audio.play("warn", DIR_INFO[e.flareDir].detune, e.feint ? 0.5 : 0.9);
    if (firstVertical) {
      this.verticalSeen = true;
      // Double-struck warn: the axis itself is the news, not just this enemy.
      this.audio.play("spawn", DIR_INFO[dir].detune, 0.6);
      this.hint = 2.8;
      this.hintText = VERTICAL_HINT;
    }

    this.scheduleNext(dir);
  }

  private scheduleNext(dir: Dir): void {
    if (this.chainLeft <= 0 && this.elapsed >= CHAIN_START) {
      const chance = rampAsymptotic(this.elapsed - CHAIN_START, 0, 0.5, 30);
      if (Math.random() < chance) {
        this.chainLeft = randInt(1, 2); // 2-3 enemies in the burst
        this.chainAlt = Math.random() < 0.4;
      }
    }

    if (this.chainLeft > 0) {
      this.chainLeft--;
      this.forcedDir = this.chainAlt ? DIR_INFO[dir].opposite : dir;
      this.spawnTimer = this.chainAlt ? CHAIN_ALT_GAP : CHAIN_SAME_GAP;
      return;
    }

    this.forcedDir = null;
    const interval =
      rampEaseOut(this.elapsed, 1.2, 0.6, 28) * rampAsymptotic(this.elapsed, 1, -0.28, 140);
    this.spawnTimer = interval * randRange(0.86, 1.14);
  }

  // --- Popups ---------------------------------------------------------------

  private pushPopup(label: string, color: string, vx: number, vy: number): void {
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (p.active) continue;
      p.active = true;
      p.x = PLAYER_X + vx * 132;
      p.y = PLAYER_Y + vy * 132 - 34;
      p.life = p.maxLife;
      p.label = label;
      p.color = color;
      return;
    }
  }

  private updatePopups(dt: number): void {
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      p.life -= dt;
      p.y -= 48 * dt;
      if (p.life <= 0) p.active = false;
    }
  }

  // --- Render ---------------------------------------------------------------

  protected onRender(g: CanvasRenderingContext2D): void {
    this.drawStage(g);
    this.drawMultiplierGhost(g);
    this.drawLanes(g);

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.active && e.phase === "telegraph") {
        drawTelegraph(g, e, PLAYER_X, PLAYER_Y, this.width, this.height);
      }
    }

    const dead = this.status === "gameover";
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active || e.phase === "telegraph") continue;
      // After death everything but the fatal enemy recedes.
      if (dead && e !== this.killer) g.globalAlpha = 0.22;
      drawEnemy(g, e, e.phase === "strike" ? 0.55 : 0);
      g.globalAlpha = 1;
    }

    this.drawPlayer(g);
  }

  /** Light stage: a white card on a cool near-white ground, a pink floor slab,
   *  and a warm spotlight laid on as a light wash instead of a dark vignette. */
  private drawStage(g: CanvasRenderingContext2D): void {
    if (!this.wash) {
      const w = g.createLinearGradient(0, CARD_Y, 0, CARD_Y + CARD_H);
      w.addColorStop(0, "#fffafc");
      w.addColorStop(0.5, "#f9fbff");
      w.addColorStop(1, "#eef0f7");
      this.wash = w;
    }
    if (!this.spot) {
      const s = g.createRadialGradient(PLAYER_X, PLAYER_Y - 20, 12, PLAYER_X, PLAYER_Y - 20, 340);
      s.addColorStop(0, "rgba(255,236,242,0.85)");
      s.addColorStop(0.55, "rgba(255,224,235,0.42)");
      s.addColorStop(1, "rgba(255,224,235,0)");
      this.spot = s;
    }

    // Overscan: screen shake must never expose the page behind the canvas.
    g.fillStyle = BASE;
    g.fillRect(-60, -60, this.width + 120, this.height + 120);

    g.save();
    g.shadowColor = SHADOW;
    g.shadowBlur = 28;
    g.shadowOffsetY = 9;
    g.fillStyle = CARD;
    roundRect(g, CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R);
    g.fill();
    g.restore();

    g.save();
    roundRect(g, CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R);
    g.clip();
    g.fillStyle = this.wash;
    g.fillRect(CARD_X, CARD_Y, CARD_W, CARD_H);
    drawGrid(g, this.width, this.height, 50, 0, GRID);
    drawGrid(g, this.width, this.height, 200, 0, GRID_ROSE);
    this.drawFloor(g);
    g.fillStyle = this.spot;
    g.fillRect(CARD_X, CARD_Y, CARD_W, CARD_H);
    if (this.ringFlash > 0) {
      softHalo(g, PLAYER_X, PLAYER_Y, 150, ROSE, 0.1 * this.ringFlash);
    }
    g.restore();
  }

  private drawFloor(g: CanvasRenderingContext2D): void {
    g.fillStyle = FLOOR;
    g.fillRect(CARD_X, FLOOR_Y, CARD_W, CARD_Y + CARD_H - FLOOR_Y);
    g.fillStyle = withAlpha(ROSE, 0.18);
    g.fillRect(CARD_X, FLOOR_Y, CARD_W, 3);
    g.fillStyle = withAlpha(ROSE, 0.07);
    g.fillRect(CARD_X, FLOOR_Y + 3, CARD_W, 12);
    // The player's contact shadow. Everything else floats above it.
    dropShadow(g, PLAYER_X, FLOOR_Y - 7, 44, 11, 0.13);
  }

  private drawMultiplierGhost(g: CanvasRenderingContext2D): void {
    if (this.multiplier < 2) return;
    // The pop is what makes a multiplier step an event; the rest of the time
    // the ghost is deliberately almost invisible so it never fights the enemies.
    this.ghostOpt.alpha = 0.1 + 0.05 * this.ringFlash + 0.32 * this.multPop;
    this.ghostOpt.size = 170 + 52 * this.multPop;
    text(g, COMBO_LABELS[this.multiplier - 1], PLAYER_X, PLAYER_Y, this.ghostOpt);
  }

  private drawLanes(g: CanvasRenderingContext2D): void {
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active || e.phase !== "approach") continue;
      const info = DIR_INFO[e.dir];
      g.lineWidth = 3;
      g.strokeStyle = withAlpha(ROSE, 0.13);
      g.beginPath();
      g.moveTo(PLAYER_X + info.vx * SPAWN_DIST, PLAYER_Y + info.vy * SPAWN_DIST);
      g.lineTo(PLAYER_X + info.vx * STRIKE_DIST, PLAYER_Y + info.vy * STRIKE_DIST);
      g.stroke();

      // Arrival marker, just outside the strike ring. The edge flare dies the
      // instant the enemy appears, so from then on this is the only cue sitting
      // where the player's eyes already are — which is what makes a four-way
      // read possible at all once the spawn interval drops under a second.
      const near = 1 - Math.min(1, Math.max(0, (e.d - STRIKE_DIST) / TRAVEL));
      // Darkest ink on the stage, so the "it lands HERE" cue outranks the
      // player's own guard arc rather than competing with it.
      g.lineWidth = 3 + 5 * near * near;
      g.strokeStyle = withAlpha(ROSE_DARK, 0.12 + 0.8 * near * near);
      g.beginPath();
      g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + 18, info.angle - 0.34, info.angle + 0.34);
      g.stroke();
    }
    g.restore();
  }

  private drawPlayer(g: CanvasRenderingContext2D): void {
    const a = this.facingAngle;
    const fx = Math.cos(a);
    const fy = Math.sin(a);

    // The strike ring is the contract with the player: everything resolves here.
    g.save();
    g.lineCap = "round";
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST, 0, TAU);
    g.stroke();
    g.setLineDash(RING_DASH);
    g.lineWidth = 3;
    g.strokeStyle = withAlpha(ROSE, 0.45);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST, 0, TAU);
    g.stroke();
    g.setLineDash(NO_DASH);
    g.lineWidth = 8;
    g.strokeStyle = withAlpha(ROSE_DEEP, 0.5 + 0.5 * this.guardFlash);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST, a - 0.8, a + 0.8);
    g.stroke();

    if (this.ringFlash > 0) {
      g.strokeStyle = withAlpha(ROSE, this.ringFlash * 0.55);
      g.lineWidth = 5 * this.ringFlash + 1;
      g.beginPath();
      g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + (1 - this.ringFlash) * 130, 0, TAU);
      g.stroke();
    }
    g.restore();

    const turn = this.turnT < TURN_TIME ? Math.sin((this.turnT / TURN_TIME) * Math.PI) : 0;
    const pop = 1 + 0.2 * this.ringFlash * this.ringFlash;
    const bob = Math.sin(this.elapsed * 2.6) * 1.5;

    g.save();
    g.translate(PLAYER_X, PLAYER_Y + bob);
    g.scale(pop, pop);
    // Squash along the facing axis while the body snaps around.
    g.rotate(a);
    g.scale(1 - 0.15 * turn, 1 + 0.15 * turn);
    g.rotate(-a);
    g.lineCap = "round";

    // Guard. Reading this arc is the whole game, so it is the chunkiest, most
    // saturated thing anywhere near the centre of the screen.
    g.strokeStyle = withAlpha(ROSE, 0.32 + 0.22 * this.guardFlash);
    g.lineWidth = 22;
    g.beginPath();
    g.arc(0, 0, 37, a - 0.88, a + 0.88);
    g.stroke();
    g.strokeStyle = ROSE_DEEP;
    g.lineWidth = 13;
    g.beginPath();
    g.arc(0, 0, 37, a - 0.8, a + 0.8);
    g.stroke();
    if (this.guardFlash > 0) {
      g.strokeStyle = withAlpha("#ffffff", 0.75 * this.guardFlash);
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, 37, a - 0.6, a + 0.6);
      g.stroke();
    }

    // Body: chunky white puck with a dark outline so it reads on the pale floor.
    g.fillStyle = CARD;
    g.beginPath();
    g.arc(0, 0, 25, 0, TAU);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();

    // The face stays upright and slides toward the guard: dot eyes looking the
    // way the guard points, blush on that cheek. Second cue, same answer.
    const hx = fx * 6;
    const hy = fy * 6;
    g.fillStyle = ROSE_SOFT;
    g.beginPath();
    g.arc(hx - 14, hy + 4, 5.4, 0, TAU);
    g.arc(hx + 14, hy + 4, 5.4, 0, TAU);
    g.fill();

    g.fillStyle = INK;
    g.beginPath();
    g.arc(hx - 7.5, hy - 3, 4.2, 0, TAU);
    g.arc(hx + 7.5, hy - 3, 4.2, 0, TAU);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(hx - 7.5 + fx * 1.6 - 1, hy - 3 + fy * 1.6 - 1, 1.4, 0, TAU);
    g.arc(hx + 7.5 + fx * 1.6 - 1, hy - 3 + fy * 1.6 - 1, 1.4, 0, TAU);
    g.fill();

    g.strokeStyle = INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(hx, hy + 5, 5.4, 0.3 * Math.PI, 0.7 * Math.PI);
    g.stroke();
    g.restore();
  }

  protected onRenderOverlay(g: CanvasRenderingContext2D): void {
    if (this.status === "gameover" && this.killer) this.drawDeath(g, this.killer);

    if (this.whiteFlash > 0) {
      // A pink wash, not a white-out: on a light stage a white flash is a hole.
      g.fillStyle = withAlpha(ROSE, Math.min(0.3, this.whiteFlash * 2.2));
      g.fillRect(0, 0, this.width, this.height);
    }

    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      const k = p.life / p.maxLife;
      const alpha = Math.min(1, k * 1.8);
      // Rounded pill behind the label; width from the length so measureText
      // never allocates a TextMetrics object mid-frame.
      const w = 26 + p.label.length * 13;
      g.save();
      g.globalAlpha = alpha;
      g.shadowColor = SHADOW;
      g.shadowBlur = 12;
      g.shadowOffsetY = 3;
      g.fillStyle = CARD;
      roundRect(g, p.x - w / 2, p.y - 17, w, 34, 17);
      g.fill();
      g.restore();
      this.popOpt.color = p.color;
      this.popOpt.alpha = alpha;
      text(g, p.label, p.x, p.y, this.popOpt);
    }

    if (this.hint > 0 && this.status === "playing") {
      this.hintOpt.alpha = Math.min(1, this.hint);
      text(g, this.hintText, PLAYER_X, 618, this.hintOpt);
    }
  }

  private drawDeath(g: CanvasRenderingContext2D, killer: Enemy): void {
    const k = Math.min(1, this.deathTime * 3);

    // Bleach the stage and lay a soft pink over it. Everything stays light;
    // only the fatal side keeps its saturation.
    g.fillStyle = "rgba(255,255,255," + 0.52 * k + ")";
    g.fillRect(0, 0, this.width, this.height);
    g.fillStyle = withAlpha(ROSE, 0.2 * k);
    g.fillRect(0, 0, this.width, this.height);

    const info = DIR_INFO[killer.dir];
    g.save();
    g.translate(this.shake.x, this.shake.y);
    g.lineCap = "round";

    const lx = PLAYER_X + info.vx * SPAWN_DIST;
    const ly = PLAYER_Y + info.vy * SPAWN_DIST;
    g.strokeStyle = withAlpha(ROSE, 0.4);
    g.lineWidth = 14 + 4 * Math.sin(this.deathTime * 6);
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(PLAYER_X, PLAYER_Y);
    g.stroke();
    g.strokeStyle = withAlpha(ROSE_DEEP, 0.85);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(PLAYER_X, PLAYER_Y);
    g.stroke();

    drawEnemy(g, killer, 0.85);

    // Deep rose arc = where the strike came from. Grey arc = where you looked.
    g.lineWidth = 10;
    g.strokeStyle = withAlpha(ROSE_DARK, 0.9);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + 14, info.angle - 0.8, info.angle + 0.8);
    g.stroke();

    const fa = DIR_INFO[this.deathFacing].angle;
    g.lineWidth = 7;
    g.strokeStyle = withAlpha(INK_FAINT, 0.85);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + 14, fa - 0.8, fa + 0.8);
    g.stroke();
    g.restore();

    const a = Math.min(1, this.deathTime * 2.2);
    g.save();
    g.globalAlpha = a;
    g.shadowColor = SHADOW;
    g.shadowBlur = 22;
    g.shadowOffsetY = 6;
    g.fillStyle = "rgba(255,255,255,0.88)";
    roundRect(g, PLAYER_X - 285, 498, 570, 120, 30);
    g.fill();
    g.restore();

    this.deathOpt.alpha = a;
    this.subOpt.alpha = a;
    this.koOpt.alpha = a;
    text(g, this.deathLine, PLAYER_X, 528, this.deathOpt);
    text(g, this.deathSub, PLAYER_X, 566, this.subOpt);
    text(g, this.deathKo, PLAYER_X, 596, this.koOpt);
  }

  protected hudStats(): HudStat[] {
    this.stats[0].value = COMBO_LABELS[this.multiplier - 1];
    this.stats[1].value = this.parryText;
    return this.stats;
  }
}
