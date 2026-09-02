import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import {
  OPENING_GRACE,
  rampAsymptotic,
  rampEaseOut,
  rampLinear,
} from "@/games/core/curve";
import { drawGrid, roundRect, text, type TextOptions, withAlpha } from "@/games/core/draw";
import { ARROW_KEYS, type ArrowKey } from "@/games/core/InputManager";
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
  diagonalWeight,
  DIR_INFO,
  type Dir,
  dirFromAxes,
  isDiagonal,
  isVertical,
  octantDist,
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
 * it rescues the "I pressed it!" inputs that land a frame late.
 */
const MISS_GRACE = 0.07;
/** Impact pause on a parry. Input keeps running through it. */
const HITSTOP = 0.05;

/**
 * A parry counts as CLUTCH when the guard came round with no more than this
 * left on the clock.
 *
 * Taken from the approach timings rather than picked: the rush from spawn ring
 * to strike ring lasts TRAVEL/speed, which is 0.75s at the opening 300px/s and
 * bottoms out at 0.39s once speed maxes at 580. 0.28s sits under even that
 * floor, so a clutch is always a guard that arrived after the enemy was
 * already visibly closing — the last third of the rush, never the telegraph.
 * It is also roughly one human reaction time, so it is the latest a player can
 * commit and still be doing it on purpose.
 *
 * In practice a competent opening run lands a third of them: the safe play is
 * to turn on the flare (~1.2s of lead, nowhere near clutch), so every clutch is
 * a deliberate wait, and waiting out ~75% of a 1.6s window is a real gamble.
 */
const CLUTCH_LEAD = 0.28;

/**
 * How long after a turn a strike one octant off will wait rather than kill.
 *
 * A diagonal is two keys and they never land on the same frame, so the roll
 * shows an intermediate facing for a frame or two either way: Up-then-Left
 * reads as "up" before "up-left", and Left-pressed-while-Up-is-still-held
 * reads as "up-left" before "left". Both are the same one-octant ambiguity and
 * dying inside either is a coin flip, not a mistake. Bounded and small: the
 * player still has to finish the input, they just get to finish.
 */
const DIAGONAL_COMPOSE = 0.12;
/**
 * Grace after a RELEASE before the facing is allowed to fall back.
 *
 * Rolling off a diagonal releases its two arrows a few frames apart, and
 * re-reading the held set in between drops the guard to a cardinal the player
 * never asked for. Waiting this long means a genuine roll-off finds nothing
 * held and leaves the guard put, while deliberately letting go of one arrow and
 * keeping the other still commits to the cardinal.
 */
const RELEASE_GRACE = 0.14;

/** Small and flat. A parry with time to spare keeps you alive, nothing more. */
const NORMAL_SCORE = 25;
/** Multiplied by the clutch multiplier. Only clutches are worth chasing. */
const CLUTCH_BASE = 120;
const MAX_MULT = 8;

/**
 * Minimum spacing between two strikes that need the SAME facing — enough to
 * read two arrivals apart, no turn required. Raised alongside the turn gap:
 * with eight sides live, "same side twice" is now a genuine read rather than
 * the default assumption.
 */
const SAME_DIR_GAP = 0.2;
/**
 * Spacing for two strikes needing OPPOSITE facings, i.e. the most expensive
 * turn on the compass. Asymptotic to 0.36 — raised from the four-way tuning,
 * because an eight-way choice is a slower decision and shipping the old floor
 * would have made the late game a coin flip.
 */
const TURN_GAP_START = 0.62;
const TURN_GAP_RANGE = -0.26;
const TURN_GAP_HALFLIFE = 50;

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
const FEINT_TELEGRAPH_MIN = 0.85;

/**
 * The very first strike from a newly opened tier gets a full-length telegraph.
 * The player has spent half a minute being taught which sides exist; the moment
 * that stops being true must not also be the moment they die. The diagonals get
 * the longer one — they are the only tier that changes the input, not just the
 * answer.
 */
const FIRST_VERTICAL_TELEGRAPH = 1.05;
const FIRST_DIAGONAL_TELEGRAPH = 1.2;

/** Pre-built so a parry never allocates a string mid-frame. */
const CLUTCH_LABELS = ["+120", "+240", "+360", "+480", "+600", "+720", "+840", "+960"];
const LOST_LABELS = [
  "LOST x1",
  "LOST x2",
  "LOST x3",
  "LOST x4",
  "LOST x5",
  "LOST x6",
  "LOST x7",
  "LOST x8",
];
const COMBO_LABELS = ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"];
const SAFE_LABEL = "SAFE +25";
const CLUTCH_BANNER = "CLUTCH";
const BREAK_BANNER = "COMBO BROKEN";
/** Just outside the strike ring, where the eye already is during a parry. */
const BANNER_Y = PLAYER_Y + 122;

const OPENING_HINT = "ARROW KEYS TURN — FACE THE STRIKE";
const OPENING_HINT_TOUCH = "TAP TOWARD THE STRIKE";
/** The scoring rule is not discoverable by playing safely, so it is stated. */
const CLUTCH_HINT = "PARRY LATE FOR CLUTCH — ONLY CLUTCH BUILDS COMBO";
/** Shown once per tier. A rule that changes mid-run and says nothing is
 *  indistinguishable from a rule that was never fair. */
const VERTICAL_HINT = "UP AND DOWN ARE LIVE NOW";
const DIAGONAL_HINT = "DIAGONALS ARE LIVE — HOLD TWO ARROWS";
const DIAGONAL_HINT_TOUCH = "DIAGONALS ARE LIVE — TAP THE CORNERS";

const RING_DASH = [7, 12];
const NO_DASH: number[] = [];
/** Eight notches, one per facing. Hoisted: the render loop only reads it. */
const OCTANT_ANGLE = Math.PI / 4;

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
 * chooses one of eight facings; enemies rush in and resolve the moment they
 * touch the strike ring. Everything here exists to make one question readable
 * in under a second: which side is about to hit me, and am I looking at it?
 *
 * Score comes from answering it LATE. A parry with time to spare only keeps you
 * alive; the combo counts consecutive last-moment saves and nothing else.
 */
export class DirectionGame extends BaseGame {
  private readonly enemies: Enemy[] = [];
  private readonly popups: Popup[] = [];

  private facing: Dir = "right";
  /** The facing the held arrows currently spell, or null while none are held.
   *  Turns fire on changes to THIS, which is what latches the last facing. */
  private heldDir: Dir | null = null;
  /** Last resolved value of each axis, so a held pair keeps its answer. */
  private axisX = 0;
  private axisY = 0;
  private facingAngle = 0;
  private turnFrom = 0;
  private turnDelta = 0;
  private turnT = TURN_TIME;
  /** Seconds left of the mid-diagonal grace. See `composing`. */
  private composeLeft = 0;
  /** Counts down after a release; 0 means nothing pending. */
  private releaseLeft = 0;

  /** Scheduling clock. Unlike `elapsed` it stops during hitstop, so predicted
   *  strike times stay exact no matter how many parries pause the scene. */
  private simTime = 0;
  private hitstop = 0;

  private spawnTimer = FIRST_SPAWN_DELAY;
  private forcedDir: Dir | null = null;
  private chainLeft = 0;
  private chainAlt = false;
  private verticalSeen = false;
  private diagonalSeen = false;

  /** Consecutive clutches. One relaxed parry sets it back to zero. */
  private clutchStreak = 0;
  private multiplier = 1;
  private parries = 0;
  private streakText = "0";
  private parryText = "0";

  private guardFlash = 0;
  private whiteFlash = 0;
  private ringFlash = 0;
  private multPop = 0;
  private clutchFlash = 0;
  private breakFlash = 0;
  /** Multiplier the broken streak was worth, so the loss has a number on it. */
  private lostMult = 1;
  private hint = 3.4;
  private hintStage = 0;
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
    { label: "CLUTCH", value: "0", highlight: true },
    { label: "COMBO", value: "x1" },
    { label: "PARRY", value: "0" },
  ];

  // Reused so particle and text calls never build an options literal per frame.
  private readonly emitOpt: ParticleOptions = { x: 0, y: 0 };
  private readonly fanOpt: Omit<ParticleOptions, "x" | "y" | "vx" | "vy"> = {};
  private readonly ghostOpt: TextOptions = { size: 170, color: ROSE, alpha: 0.08 };
  private readonly popOpt: TextOptions = { size: 21, color: ROSE_DEEP, alpha: 1 };
  private readonly bannerOpt: TextOptions = {
    size: 34,
    color: AMBER_DARK,
    alpha: 1,
    letterSpacing: "5px",
  };
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
      e.correctSince = -1;
      e.composeUsed = false;
    }
    for (let i = 0; i < this.popups.length; i++) this.popups[i].active = false;

    this.facing = "right";
    this.heldDir = null;
    this.axisX = 0;
    this.axisY = 0;
    this.facingAngle = 0;
    this.turnFrom = 0;
    this.turnDelta = 0;
    this.turnT = TURN_TIME;
    this.composeLeft = 0;
    this.releaseLeft = 0;

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
    this.diagonalSeen = false;

    this.clutchStreak = 0;
    this.multiplier = 1;
    this.parries = 0;
    this.streakText = "0";
    this.parryText = "0";

    this.guardFlash = 0;
    this.whiteFlash = 0;
    this.ringFlash = 0;
    this.multPop = 0;
    this.clutchFlash = 0;
    this.breakFlash = 0;
    this.lostMult = 1;
    this.hint = 3.4;
    this.hintStage = 0;
    this.hintText = this.isTouch ? OPENING_HINT_TOUCH : OPENING_HINT;

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
    this.updateHint(dt);

    this.updateEnemies(sim);
    this.updatePopups(dt);

    if (sim > 0) {
      this.spawnTimer -= sim;
      if (this.spawnTimer <= 0) this.trySpawn();
    }
  }

  private updateHint(dt: number): void {
    this.hint = Math.max(0, this.hint - dt);
    // The clutch rule is the one thing a player cannot infer from a safe run,
    // so it follows the control hint instead of waiting to be discovered.
    if (this.hint === 0 && this.hintStage === 0) {
      this.hintStage = 1;
      this.hint = 3.6;
      this.hintText = CLUTCH_HINT;
    }
  }

  private decayFlashes(dt: number): void {
    this.guardFlash = Math.max(0, this.guardFlash - dt * 5.5);
    this.whiteFlash = Math.max(0, this.whiteFlash - dt);
    this.ringFlash = Math.max(0, this.ringFlash - dt * 2.6);
    this.multPop = Math.max(0, this.multPop - dt * 1.8);
    this.clutchFlash = Math.max(0, this.clutchFlash - dt * 1.5);
    this.breakFlash = Math.max(0, this.breakFlash - dt * 1.3);
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
    // Ages before the read, so a turn made this frame gets the whole window
    // rather than the whole window minus one frame.
    this.composeLeft = Math.max(0, this.composeLeft - dt);

    // Derived from what is HELD, not from a press edge: a diagonal is two
    // arrows down together on the keyboard and two taps delivered on the same
    // frame on touch, so one read serves both. Turning fires on changes to the
    // held combination, which also latches — letting go leaves the guard put.
    // A PRESS commits immediately — this is a reaction game and any delay here
    // is latency the player pays for. A RELEASE never commits directly: it only
    // arms a short grace, because letting go of a diagonal releases its two
    // arrows a few frames apart and re-reading in between would drop the guard
    // to a cardinal nobody asked for.
    let pressed = false;
    for (let i = 0; i < ARROW_KEYS.length; i++) {
      if (this.input.justPressed(ARROW_KEYS[i])) {
        pressed = true;
        break;
      }
    }

    this.axisX = this.resolveAxis("ArrowRight", "ArrowLeft", this.axisX);
    this.axisY = this.resolveAxis("ArrowDown", "ArrowUp", this.axisY);
    const d = dirFromAxes(this.axisX, this.axisY);

    if (pressed) {
      this.releaseLeft = 0;
      this.heldDir = d;
      if (d !== null) {
        if (d !== this.facing) this.turnTo(d);
        // A re-press on the side already held still lights the guard, so the
        // input is never silently swallowed.
        else this.guardFlash = Math.max(this.guardFlash, 0.4);
      }
    } else if (d !== this.heldDir) {
      // Only releases can have caused this. Wait it out.
      if (this.releaseLeft === 0) this.releaseLeft = RELEASE_GRACE;
      this.releaseLeft -= dt;
      if (this.releaseLeft <= 0) {
        this.releaseLeft = 0;
        this.heldDir = d;
        // Everything let go: the guard stays where the player left it. Only a
        // combination the player is still holding may pull it somewhere new.
        if (d !== null && d !== this.facing) this.turnTo(d);
      }
    } else {
      this.releaseLeft = 0;
    }

    if (this.turnT < TURN_TIME) {
      this.turnT = Math.min(TURN_TIME, this.turnT + dt);
      this.facingAngle = this.turnFrom + this.turnDelta * backOut(this.turnT / TURN_TIME);
    }
  }

  /**
   * One axis of the facing, with both of its arrows held resolved by recency.
   *
   * The raw axis read cancels a held pair to zero, and against a facing that
   * LATCHES that reads as "I pressed Right and the guard never moved" — the one
   * death in this game with nothing on screen to explain it. The arrow pressed
   * last is the answer the player is giving, so it wins. If a third arrow went
   * down after the pair then neither of them is the newest key, and the axis
   * keeps what it last resolved to rather than snapping back through the
   * cancelled state in the middle of a turn.
   */
  private resolveAxis(pos: ArrowKey, neg: ArrowKey, last: number): number {
    const p = this.input.isDown(pos);
    const n = this.input.isDown(neg);
    if (p !== n) return p ? 1 : -1;
    if (!p) return 0;
    const latest = this.input.latestHeld();
    if (latest === pos) return 1;
    if (latest === neg) return -1;
    return last;
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
    // Every turn opens it, because the half-typed state cuts both ways: a
    // cardinal can be the first key of a diagonal, and a diagonal can be a
    // cardinal whose old arrow has not been let go of yet. Both are one octant
    // wide and neither is distinguishable from the finished pose.
    this.composeLeft = DIAGONAL_COMPOSE;
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

  /**
   * True while the player is plausibly mid-roll: they turned a few frames ago
   * and the strike wants the facing one notch over. One octant is always a
   * cardinal and the diagonal it is half of, in whichever order the two keys
   * happen to land, so this covers both halves of the roll with one test —
   * no cardinal is ever one octant from another.
   */
  private composing(dir: Dir): boolean {
    return this.composeLeft > 0 && octantDist(this.facing, dir) === 1;
  }

  private updateEnemies(sim: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      // die() lands mid-loop when a strike resolves. Everything after it in the
      // pool must freeze on the spot, or a later index can still score a parry
      // (and its hitstop and sparks) on a run that is already over.
      if (this.status !== "playing") return;
      const e = this.enemies[i];
      if (!e.active) continue;

      // Clutch is measured from when the GUARD came round, so the moment it
      // does is stamped here, for every phase — including a facing that was
      // already correct when this enemy spawned, which is the least clutch a
      // parry can possibly be.
      if (this.facing === e.dir) {
        if (e.correctSince < 0) e.correctSince = this.simTime;
      } else if (e.correctSince >= 0) {
        e.correctSince = -1;
      }

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

      // Strike phase = the miss grace. The facing test runs before the timer so
      // a turn landing inside the window always wins the tie.
      if (this.facing === e.dir) {
        this.parry(e);
        continue;
      }
      e.t -= sim;
      if (e.t > 0) continue;
      // Halfway through typing a diagonal: this strike waits out the rest of
      // the compose window instead of resolving. Once, and only once.
      if (!e.composeUsed && this.composing(e.dir)) {
        e.composeUsed = true;
        e.t = this.composeLeft;
        continue;
      }
      this.killedBy(e);
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
      this.parry(e);
      return;
    }
    e.phase = "strike";
    e.t = MISS_GRACE;
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

  /**
   * One parry, sorted into the only two categories that exist.
   *
   * `correctSince` is the sim-time the guard came round for THIS enemy, so the
   * lead is the time the player still had on the clock when they solved it —
   * not when a key moved. A player already facing the right way scores the
   * maximum lead and therefore the minimum reward, which is the point.
   */
  private parry(e: Enemy): void {
    e.active = false;
    const info = DIR_INFO[e.dir];
    const lead = e.correctSince < 0 ? Infinity : e.strikeAt - e.correctSince;

    if (lead <= CLUTCH_LEAD) {
      this.clutchStreak++;
      this.multiplier = Math.max(1, Math.min(MAX_MULT, this.clutchStreak));
      this.rawScore += CLUTCH_BASE * this.multiplier;
      this.streakText = String(this.clutchStreak);
      this.clutchFlash = 1;
      this.breakFlash = 0;
      this.multPop = 1;
      // Two notes, not one: the chime says "clutch", the pitch says how deep
      // the streak is, and neither is the flat tick a safe parry gets.
      this.audio.play("success", 1 + (this.multiplier - 1) * 0.13, 1);
      this.audio.play("score", 1.25 + this.multiplier * 0.07, 0.75);
      this.shake.add(5 + this.multiplier * 0.7, 0.2);
      this.whiteFlash = Math.max(this.whiteFlash, 0.09);
      this.pushPopup(CLUTCH_LABELS[this.multiplier - 1], AMBER_DARK, info.vx, info.vy);
      // Confetti fires back out along the enemy's own axis, so the burst reads
      // as "that one, from there" rather than as decoration.
      this.confetti(e.x, e.y, 16, info.angle, 0.6, 430);
      this.confetti(e.x, e.y, 8, info.angle, 1.5, 190);
    } else {
      const broke = this.clutchStreak > 0;
      this.lostMult = this.multiplier;
      this.clutchStreak = 0;
      this.multiplier = 1;
      this.streakText = "0";
      this.rawScore += NORMAL_SCORE;
      this.clutchFlash = 0;
      this.audio.play("graze", 0.85, 0.4);
      this.shake.add(2.6, 0.12);
      if (broke) {
        // Losing a streak has to be an event with a number on it, or the
        // player never learns which parry cost them the run's whole score.
        this.breakFlash = 1;
        this.audio.play("hit", 0.5, 0.6);
        this.pushPopup(LOST_LABELS[this.lostMult - 1], INK_DIM, info.vx, info.vy);
      } else {
        this.pushPopup(SAFE_LABEL, INK_DIM, info.vx, info.vy);
      }
      this.confetti(e.x, e.y, 6, info.angle, 0.8, 240);
    }

    this.parries++;
    this.parryText = String(this.parries);
    this.hitstop = HITSTOP;
    this.guardFlash = 1;
    this.ringFlash = 1;

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

    if (this.clutchFlash > 0) {
      this.emitOpt.life = 0.6;
      this.emitOpt.size = 14;
      this.emitOpt.color = AMBER;
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

    // Kill the scoring feedback outright. The death readout has one job, and a
    // half-faded CLUTCH banner sitting over it — or an amber death wash — is
    // the previous parry arguing with the thing that actually ended the run.
    this.clutchFlash = 0;
    this.breakFlash = 0;
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
   * Required spacing between two strikes, taken from how far apart the facings
   * they demand sit on the compass rather than from a table of named pairs.
   * Zero steps needs only enough gap to read two arrivals apart; four steps
   * (opposite) needs the whole turn budget; the diagonals fall out of the same
   * rule with nothing added for them.
   *
   * sqrt, not linear: one octant is only one extra key, but it is also the pose
   * the compose ambiguity lives in, so the small end is deliberately lifted.
   */
  private gapFor(a: Dir, b: Dir, turnGap: number): number {
    if (a === b) return SAME_DIR_GAP;
    return SAME_DIR_GAP + (turnGap - SAME_DIR_GAP) * Math.sqrt(octantDist(a, b) / 4);
  }

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
        const gap = this.gapFor(o.dir, dir, turnGap);
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
    const diag = diagonalWeight(this.elapsed);
    let dir = this.forcedDir ?? pickSpawnDir(vert, diag);
    // Halves toward a 0.40s floor. Eight answers is a slower decision than
    // four, so the floor went UP with the diagonals rather than the approach
    // to it getting gentler — a tight window is fine, a coin flip is not.
    let tele = rampAsymptotic(this.elapsed, 0.85, -0.45, 13);
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
      // This side is congested; another one may have a clean slot.
      const alt = pickSpawnDirExcept(dir, vert, diag);
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

    // A one-time stretch past the usual cap for the run's first strike from a
    // newly opened tier. Re-run the guard afterwards: pushing later can clear
    // one neighbour and land inside another one's window.
    const firstVertical = !this.verticalSeen && isVertical(dir);
    const firstDiagonal = !this.diagonalSeen && isDiagonal(dir);
    if (firstVertical || firstDiagonal) {
      const lead = firstDiagonal ? FIRST_DIAGONAL_TELEGRAPH : FIRST_VERTICAL_TELEGRAPH;
      const want = this.simTime + lead + approach;
      if (strikeAt < want) strikeAt = this.deconflict(want, dir, turnGap);
    }

    const finalTele = strikeAt - this.simTime - approach;
    const e = this.enemies[slot];
    e.active = true;
    e.phase = "telegraph";
    e.dir = dir;
    // A spawn that announces a rule change is never also a lie.
    e.feint = wantFeint && !firstVertical && !firstDiagonal && finalTele >= FEINT_REVEAL + 0.3;
    // An uncommitted flare picks any live side — including the true one — so
    // "amber means somewhere else" is never a shortcut around reading it.
    e.flareDir = e.feint ? pickSpawnDir(vert, diag) : dir;
    e.t = finalTele;
    e.telegraph = finalTele;
    e.speed = speed;
    e.d = SPAWN_DIST;
    e.strikeAt = strikeAt;
    // Stamped now rather than next frame: standing on the answer before the
    // flare even appears is the largest possible lead, and so the least clutch.
    e.correctSince = this.facing === dir ? this.simTime : -1;
    e.composeUsed = false;
    this.place(e);
    this.audio.play("warn", DIR_INFO[e.flareDir].detune, e.feint ? 0.5 : 0.9);
    if (firstVertical || firstDiagonal) {
      // Double-struck warn: the tier itself is the news, not just this enemy.
      this.audio.play("spawn", DIR_INFO[dir].detune, 0.6);
      this.hintStage = 1;
      this.hint = 3;
      if (firstDiagonal) {
        this.diagonalSeen = true;
        this.hintText = this.isTouch ? DIAGONAL_HINT_TOUCH : DIAGONAL_HINT;
      } else {
        this.verticalSeen = true;
        this.hintText = VERTICAL_HINT;
      }
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
    const dead = this.status === "gameover";
    this.drawStage(g);
    this.drawMultiplierGhost(g);
    this.drawLanes(g, dead);

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active || e.phase !== "telegraph") continue;
      // Warnings recede with the enemies once the run is over. A flare left at
      // full strength is a side still shouting "here" over the readout that
      // names the side which actually landed.
      if (dead) g.globalAlpha = 0.22;
      drawTelegraph(g, e, PLAYER_X, PLAYER_Y);
      g.globalAlpha = 1;
    }

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
      softHalo(g, PLAYER_X, PLAYER_Y, 150, this.clutchFlash > 0 ? AMBER : ROSE, 0.1 * this.ringFlash);
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
    // A broken streak leaves its own ghost behind, greyed and swelling as it
    // fades: the number that just stopped existing, where it used to live.
    if (this.breakFlash > 0 && this.lostMult >= 2) {
      this.ghostOpt.color = INK_FAINT;
      this.ghostOpt.alpha = 0.3 * this.breakFlash;
      this.ghostOpt.size = 170 + 70 * (1 - this.breakFlash);
      text(g, COMBO_LABELS[this.lostMult - 1], PLAYER_X, PLAYER_Y, this.ghostOpt);
      return;
    }
    if (this.multiplier < 2) return;
    // The pop is what makes a clutch step an event; the rest of the time the
    // ghost is deliberately almost invisible so it never fights the enemies.
    this.ghostOpt.color = this.clutchFlash > 0 ? AMBER : ROSE;
    this.ghostOpt.alpha = 0.1 + 0.05 * this.ringFlash + 0.32 * this.multPop;
    this.ghostOpt.size = 170 + 52 * this.multPop;
    text(g, COMBO_LABELS[this.multiplier - 1], PLAYER_X, PLAYER_Y, this.ghostOpt);
  }

  private drawLanes(g: CanvasRenderingContext2D, dead: boolean): void {
    g.save();
    g.lineCap = "round";
    // The arrival arcs sit exactly where the death readout draws its own two
    // arcs, so they have to get out of the way rather than compete.
    if (dead) g.globalAlpha = 0.22;
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
      // where the player's eyes already are — which is what makes an eight-way
      // read possible at all once the spawn interval drops under a second. It
      // is narrower than the 45 degrees between facings, so two neighbouring
      // lanes never merge into one blur.
      const near = 1 - Math.min(1, Math.max(0, (e.d - STRIKE_DIST) / TRAVEL));
      // Darkest ink on the stage, so the "it lands HERE" cue outranks the
      // player's own guard arc rather than competing with it.
      g.lineWidth = 3 + 5 * near * near;
      g.strokeStyle = withAlpha(ROSE_DARK, 0.12 + 0.8 * near * near);
      g.beginPath();
      g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + 18, info.angle - 0.3, info.angle + 0.3);
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

    // Eight notches, one per facing. With only 45 degrees between answers the
    // guard needs a fixed scale to be read against, or "up" and "up-left" are
    // the same picture until the strike lands.
    g.lineWidth = 3;
    g.strokeStyle = withAlpha(INK_FAINT, 0.45);
    for (let i = 0; i < 8; i++) {
      const na = i * OCTANT_ANGLE;
      const c = Math.cos(na);
      const s = Math.sin(na);
      g.beginPath();
      g.moveTo(PLAYER_X + c * (STRIKE_DIST - 5), PLAYER_Y + s * (STRIKE_DIST - 5));
      g.lineTo(PLAYER_X + c * (STRIKE_DIST + 5), PLAYER_Y + s * (STRIKE_DIST + 5));
      g.stroke();
    }

    g.lineWidth = 8;
    g.strokeStyle = withAlpha(ROSE_DEEP, 0.5 + 0.5 * this.guardFlash);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST, a - 0.38, a + 0.38);
    g.stroke();

    if (this.ringFlash > 0) {
      g.strokeStyle = withAlpha(
        this.clutchFlash > 0 ? AMBER_DARK : ROSE,
        this.ringFlash * 0.55
      );
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

    // Guard. Reading this is the whole game, and with eight facings 45 degrees
    // apart the old 92-degree arc covered its own neighbours. It is now
    // narrower than the spacing, and a blade carries the exact axis: an arc
    // says "roughly there", a point says which notch.
    g.strokeStyle = withAlpha(ROSE, 0.32 + 0.22 * this.guardFlash);
    g.lineWidth = 20;
    g.beginPath();
    g.arc(0, 0, 37, a - 0.42, a + 0.42);
    g.stroke();
    g.strokeStyle = ROSE_DEEP;
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, 37, a - 0.34, a + 0.34);
    g.stroke();
    if (this.guardFlash > 0) {
      g.strokeStyle = withAlpha("#ffffff", 0.75 * this.guardFlash);
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, 37, a - 0.24, a + 0.24);
      g.stroke();
    }

    g.save();
    g.rotate(a);
    g.beginPath();
    g.moveTo(71, 0);
    g.lineTo(46, -12);
    g.lineTo(52, 0);
    g.lineTo(46, 12);
    g.closePath();
    g.fillStyle = ROSE_DEEP;
    g.fill();
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = ROSE_DARK;
    g.stroke();
    g.restore();

    // Body: chunky white puck with a dark outline so it reads on the pale floor.
    g.fillStyle = CARD;
    g.beginPath();
    g.arc(0, 0, 25, 0, TAU);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();

    // The face stays upright and slides toward the guard: dot eyes looking the
    // way the blade points, blush on that cheek. Third cue, same answer.
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
      g.fillStyle = withAlpha(
        this.clutchFlash > 0 ? AMBER : ROSE,
        Math.min(0.3, this.whiteFlash * 2.2)
      );
      g.fillRect(0, 0, this.width, this.height);
    }

    this.drawBanner(g);

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

  /**
   * CLUTCH and COMBO BROKEN share one slot just under the strike ring, because
   * they are the same news read two ways and the player only ever needs the
   * latest one. Amber for the reward, plain ink for the loss — the run-ending
   * rose stays reserved for the things that can actually kill.
   */
  private drawBanner(g: CanvasRenderingContext2D): void {
    const clutch = this.clutchFlash > 0;
    const k = clutch ? this.clutchFlash : this.breakFlash;
    if (k <= 0) return;
    const label = clutch ? CLUTCH_BANNER : BREAK_BANNER;
    const alpha = Math.min(1, k * 1.7);
    const w = 54 + label.length * 24;

    g.save();
    g.globalAlpha = alpha * 0.92;
    g.shadowColor = SHADOW;
    g.shadowBlur = 16;
    g.shadowOffsetY = 4;
    g.fillStyle = CARD;
    roundRect(g, PLAYER_X - w / 2, BANNER_Y - 27, w, 54, 27);
    g.fill();
    g.restore();

    this.bannerOpt.color = clutch ? AMBER_DARK : INK_DIM;
    this.bannerOpt.alpha = alpha;
    this.bannerOpt.size = clutch ? 30 + 10 * k : 24;
    text(g, label, PLAYER_X, BANNER_Y, this.bannerOpt);
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
    // Both are narrower than the 45 degrees between facings and sit on
    // different radii, so a one-octant miss still reads as two separate arcs.
    g.lineWidth = 10;
    g.strokeStyle = withAlpha(ROSE_DARK, 0.9);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + 14, info.angle - 0.32, info.angle + 0.32);
    g.stroke();

    const fa = DIR_INFO[this.deathFacing].angle;
    g.lineWidth = 7;
    g.strokeStyle = withAlpha(INK_FAINT, 0.85);
    g.beginPath();
    g.arc(PLAYER_X, PLAYER_Y, STRIKE_DIST + 32, fa - 0.32, fa + 0.32);
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
    this.stats[0].value = this.streakText;
    this.stats[1].value = COMBO_LABELS[this.multiplier - 1];
    this.stats[2].value = this.parryText;
    return this.stats;
  }
}
