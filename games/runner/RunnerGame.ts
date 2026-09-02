import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import { rectHit, type Rect } from "@/games/core/Collision";
import { OPENING_GRACE, rampAsymptotic, rampLinear, stage } from "@/games/core/curve";
import { roundRect, text } from "@/games/core/draw";
import type { ParticleOptions, ParticleShape } from "@/games/core/Particles";
import { clamp, randRange } from "@/games/core/Vector2";
import {
  BEAM_FILL,
  BEAM_LINE,
  BLOCK_FILL,
  BLOCK_LINE,
  createObstaclePool,
  KIND_BEAM,
  KIND_BLOCK,
  KIND_PIT,
  PIT_RIM,
  PIT_RIM_LINE,
  TAU,
  type Obstacle,
  type ObstacleKind,
} from "./entities";

const ACCENT = "#a77bff";
const ACCENT_DARK = "#6d45c4";
const BG = "#f7f8fc";
const PANEL = "#eef0f7";
const INK = "#22252d";
const INK_DIM = "#6d7280";
const GREEN = "#4ecb71";

// Every colour the renderer uses, written out once at module scope. Building an
// rgba string per shape has no business happening sixty times a second.
const C_HILL = "rgba(167,123,255,0.11)";
const C_MID = "rgba(91,95,221,0.10)";
const C_MID_LINE = "rgba(91,95,221,0.14)";
/** Stronger than the backdrop: a beam has to look bolted to the ceiling. */
const C_HANGER = "rgba(91,95,221,0.26)";
const C_FLOOR = "#e5e8f3";
const C_FLOOR_LINE = "rgba(34,37,45,0.5)";
const C_FLOOR_DASH = "rgba(91,95,221,0.11)";
const C_SHADOW = "rgba(24,28,45,0.13)";
const C_SHADOW_SOFT = "rgba(24,28,45,0.07)";
const C_FRAME = "rgba(91,95,221,0.10)";
const C_BLOOM = "rgba(255,255,255,0.55)";
const C_WHITE = "#ffffff";
const C_GLOSS = "rgba(255,255,255,0.55)";
const C_FLASH = "#fff3e6";
/** The void inside a pit: darker than the floor, so a hole reads as a hole. */
const C_PIT_VOID = "#c9cfe4";
const C_PIT_DEEP = "rgba(34,37,45,0.16)";
const C_DUST = "#c6cbe0";

// --- Layout of the drawn card. Cosmetic only; the arena is the full space. ---
const PANEL_PAD = 8;
const PANEL_R = 30;
/** Top surface of the floor. Everything vertical is measured from here. */
const GROUND_Y = 520;
/** The runner never moves horizontally; the world does. */
const RUN_X = 250;
/** Obstacles are born here, just off the right edge. */
const SPAWN_X = 1040;

// --- The runner -------------------------------------------------------------
/** Collision half-width. The drawn body is wider on purpose. */
const HW = 16;
const STAND_H = 78;
const SLIDE_H = 36;
/** Inset applied to the runner's box before every kill test. Cheap deaths
 *  feel rigged, and 4px is roughly one frame of travel at top speed. */
const FORGIVE = 4;

// --- Jump physics -----------------------------------------------------------
/**
 * The whole game is tuned around one arc. Rise and fall use different gravity
 * so the jump floats at the top and then commits: a symmetric arc reads as
 * slow, and slow is death in a runner.
 *
 * apex     = JUMP_V^2 / (2 * G_RISE)          = 192px
 * rise     = JUMP_V / G_RISE                  = 0.385s
 * fall     = sqrt(2 * apex / G_FALL)          = 0.331s
 * AIR_MAX  = rise + fall                      = 0.716s
 */
const JUMP_V = 1000;
const G_RISE = 2600;
const G_FALL = 3510;
/**
 * Extra gravity applied once the button is released while still rising. 2.6x
 * turns the full 192px arc into a 74px hop, which is the whole range of
 * expression a one-button jump has.
 */
const CUT_MUL = 2.6;
const APEX = (JUMP_V * JUMP_V) / (2 * G_RISE);
const AIR_MAX = JUMP_V / G_RISE + Math.sqrt((2 * APEX) / G_FALL);
/** A jump still registers this long after running off a ledge. */
const COYOTE = 0.1;
/** A jump pressed this long before landing fires the moment the feet touch. */
const JUMP_BUFFER = 0.12;
/** Downward kick from a dive. Roughly halves the remaining fall time. */
const DIVE_V = 900;
/** Extra downward pull while ArrowDown is held in the air. */
const DIVE_HOLD = 2600;
/**
 * A second action press within this long after take-off is a stomp rather than
 * a dive: it undoes the hop it just started, the rescue for jumping a beat
 * before a beam. It has to cost almost no height to be worth having.
 */
const DUCK_CANCEL = 0.14;
/** How long a stomp takes to put the feet back on the floor. Two frames. */
const STOMP_TIME = 0.05;

// --- Slide ------------------------------------------------------------------
/** Minimum held slide, so tapping down cannot become a crouch-walk. */
const SLIDE_MIN = 0.3;
/**
 * Maximum slide, held or not. Without a ceiling the dominant strategy is to
 * hold Down for the entire run — every beam pre-answered, nothing given up —
 * and the second verb stops existing. Headroom still extends it.
 */
const SLIDE_MAX = 0.85;
/**
 * Shortest slide a tap can buy, and every beam width is verified against it.
 * A press with a beam in range gets exactly the cover that beam needs instead
 * (see coverSlide); this is the floor under that, and what a duck with nothing
 * in particular to answer is worth.
 */
const SLIDE_TAP = 0.44;

// --- Speed ------------------------------------------------------------------
/**
 * Asymptotic: always climbing, never past 760px/s. At 760 an obstacle crosses
 * the 790px between its spawn point and the runner in 1.04s, which is the
 * floor of what stays readable.
 */
const SPEED_FROM = 350;
const SPEED_RANGE = 410;
const SPEED_HALF = 62;
/**
 * Sizes and gaps are computed against the speed the run will have by the time
 * the obstacle actually arrives, not the speed right now. Speed only climbs,
 * so using the current value would quietly shave the reaction window.
 */
const SPEED_LOOKAHEAD = 1.5;

// --- Spacing: the fairness rule --------------------------------------------
/**
 * Minimum reaction time the player is guaranteed between one obstacle leaving
 * and the next arriving. Everything else in this block is added on top of it.
 */
const REACT_MIN = 0.42;
/** Nothing may ever be spawned closer than this in time. See gapTimeFor(). */
const MIN_GAP_TIME = REACT_MIN + AIR_MAX;
/** Landing from the previous obstacle costs a beat before the next decision. */
const LAND_RECOVER = 0.12;
/** A slide has to be started from the floor, which needs its own beat. */
const SLIDE_SETUP = 0.18;
/**
 * Runway to a beam, in seconds, inside which the action button stops meaning
 * "jump" and starts meaning "get under it".
 *
 * It is MIN_GAP_TIME on purpose: a jump taken any later than a full arc plus a
 * reaction cannot land and still leave the player the reaction window the whole
 * game is built on, so inside it the press could only ever have been a death.
 * A beam is the one obstacle a jump can never clear, which is why it alone gets
 * to take the button over — the player is not losing a choice here, they never
 * had one.
 */
const BEAM_TAKEOVER = MIN_GAP_TIME;
/** Slack on a computed slide, so it is still down when the beam arrives. */
const SLIDE_COVER_PAD = 0.08;
const GAP_TIME_FROM = 2.15;
const GAP_TIME_TO = 1.2;
const GAP_TIME_SECONDS = 110;
const GAP_JITTER = 0.3;

// --- Obstacle sizing --------------------------------------------------------
const BLOCK_H_MIN = 40;
const BLOCK_H_MAX = 88;
const BLOCK_W_MIN = 38;
const BLOCK_W_MAX = 78;
/**
 * A block is only committed if the jump spends this fraction of its time-above
 * the block actually crossing it. 0.6 means the arc is nearly twice as long as
 * it needs to be — the margin is what lets a mistimed jump still clear.
 */
const BLOCK_CROSS_SAFETY = 0.6;
const BEAM_W_MIN = 56;
const BEAM_W_MAX = 150;
/** Slide clearance under a beam. Head-height sliding is 36, standing is 78. */
const BEAM_CLEAR_MIN = 50;
const BEAM_CLEAR_MAX = 58;
/** Fraction of a tap-slide that may be spent under a beam. */
const BEAM_CROSS_SAFETY = 0.75;
/** Height the beam hangs from. Above APEX, so it can never be jumped instead. */
const BEAM_TOP_H = 250;
const PIT_W_MIN = 84;
const PIT_W_MAX = 240;
/** Fraction of the full jump arc a pit may consume. */
const PIT_CROSS_SAFETY = 0.52;
/** The lip of a pit is still solid ground, which is what coyote time needs. */
const PIT_LIP = 6;
/** Falling this far below the floor line is unrecoverable. */
const PIT_DEATH = 42;

// --- Difficulty stages ------------------------------------------------------
const STAGE_SECONDS = 15;
const STAGE_BEAMS = 1;
const STAGE_PITS = 2;
const STAGE_NAMES: readonly string[] = [
  "DASH",
  "LOW BEAMS",
  "PITFALLS",
  "FULL SPEED",
  "NO MERCY",
];
const STAGE_SUBS: readonly string[] = [
  "JUMP: SPACE OR TAP - HOLD IT FOR HEIGHT",
  "SLIDE UNDER: DOWN ARROW, OR TAP AS IT NEARS",
  "MIND THE HOLES",
  "IT ONLY GETS FASTER",
  "STILL RUNNING",
];
const BANNER_TIME = 2.1;
const BANNER_W = 500;
const BANNER_H = 74;
const BANNER_Y = 74;

// --- Score ------------------------------------------------------------------
/** Floor pixels per point of distance score, i.e. 10px = 1m. */
const PX_PER_METER = 10;
/** Vertical gap over a block, or above a pit lip, that counts as a near miss. */
const NEAR_GAP = 26;
/** Runway still left when the slide started, for a beam near miss. */
const NEAR_LEAD = 70;
const NEAR_BASE = 25;
const NEAR_PER_COMBO = 6;
const NEAR_COMBO_CAP = 12;
/** Combo lapses if a whole obstacle goes by without a skim. */
const COMBO_DECAY = 4;

// --- Parallax ---------------------------------------------------------------
// Fixed tiling layers. Numbers only: a repeating skyline costs one path per
// layer per frame and never touches the allocator.
const HILL_PERIOD = 560;
const HILL_X: readonly number[] = [30, 190, 336, 452];
const HILL_R: readonly number[] = [142, 96, 168, 88];
const HILL_DROP: readonly number[] = [30, 48, 12, 54];
const HILL_RATE = 0.1;

const MID_PERIOD = 430;
const MID_X: readonly number[] = [36, 152, 262, 348];
const MID_W: readonly number[] = [78, 52, 96, 40];
const MID_H: readonly number[] = [88, 54, 120, 42];
const MID_RATE = 0.34;

const DASH_PERIOD = 62;

/**
 * Width roll that never exceeds the clearance budget it was given.
 *
 * If the budget ever came in under `min` the minimum would win, which is why
 * every kind is gated behind a stage: by the time a kind can be rolled at all,
 * the run speed already makes its budget comfortably wider than its minimum.
 */
function widthWithin(min: number, max: number, budget: number): number {
  return randRange(min, Math.max(min, Math.min(max, budget)));
}

/**
 * Slide long enough to still be down when a beam `lead` seconds away reaches
 * the runner. Headroom (see headBlocked) holds it down for the rest of the
 * crossing, so covering the arrival is all this has to buy.
 */
function coverSlide(lead: number): number {
  return clamp(lead + SLIDE_COVER_PAD, SLIDE_TAP, BEAM_TAKEOVER + SLIDE_COVER_PAD);
}

/**
 * Seconds the full jump arc spends with the soles above `h`.
 *
 * This is the number the block width clamp is built on: a block is only legal
 * if the runner can cross it inside the window the arc actually holds over it.
 * Rise and fall run different gravity, so both halves are solved separately
 * rather than assumed symmetric.
 */
function airTimeAbove(h: number): number {
  if (h >= APEX) return 0;
  const disc = JUMP_V * JUMP_V - 2 * G_RISE * h;
  const tUp = (JUMP_V - Math.sqrt(Math.max(0, disc))) / G_RISE;
  const riseAbove = JUMP_V / G_RISE - tUp;
  const fallAbove = Math.sqrt((2 * (APEX - h)) / G_FALL);
  return riseAbove + fallAbove;
}

/**
 * DASH RUN, endless side-scrolling runner.
 *
 * The runner is pinned at RUN_X and the world scrolls past. Everything the
 * game asks of the player is one of three answers — jump, slide, or jump a
 * hole — and the entire design effort is in guaranteeing that the answer is
 * always available in time. See gapTimeFor() and the three size clamps in
 * spawnObstacle(): no obstacle is ever committed that the current speed cannot
 * clear.
 */
export class RunnerGame extends BaseGame {
  private readonly obstacles = createObstaclePool(10);
  /** Scratch rects for the kill test. Mutated in place, never re-created. */
  private readonly rBody: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly rObs: Rect = { x: 0, y: 0, w: 0, h: 0 };
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
    { label: "DIST", value: "0m" },
    { label: "NEAR", value: "0" },
    { label: "COMBO", value: "-", highlight: true },
  ];

  // --- Runner state ---------------------------------------------------------
  /** y of the soles. The body is drawn upward from here. */
  private feetY = GROUND_Y;
  private vy = 0;
  private airborne = false;
  private airTime = 0;
  private jumpCut = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private sliding = false;
  /** Counts down the minimum the slide must last. */
  private slideTimer = 0;
  /** Counts up the total, so a slide still ends when it reaches slideCap. */
  private slideLife = 0;
  /** Press edge for the slide, consumed by the beam near-miss metric. */
  private slideStarted = false;
  /** Seconds of slide the next landing owes, booked when a duck commits. */
  private pendingSlide = 0;
  /**
   * Ceiling on the current slide's total length. SLIDE_MAX for anything the
   * player holds; a slide computed against a specific beam raises it to cover
   * that beam and not a frame more.
   */
  private slideCap = SLIDE_MAX;
  private legPhase = 0;
  /** 1 on touchdown, decaying: drives the landing squash. */
  private squash = 0;
  private stepDust = 0;
  private slideDust = 0;
  /** Index of the pit the runner is committed to falling into, or -1. */
  private pitFall = -1;

  // --- World ---------------------------------------------------------------
  private dist = 0;
  private speed = SPEED_FROM;
  private poolCursor = 0;
  /** Floor distance still to travel before the next obstacle is born. */
  private toNextSpawn = 0;
  private lastKind: ObstacleKind = KIND_BLOCK;
  /** Decided one spawn ahead: the gap being booked has two ends, not one. */
  private nextKind: ObstacleKind = KIND_BLOCK;

  // --- Score ---------------------------------------------------------------
  private bonus = 0;
  private nearCount = 0;
  private combo = 0;
  private comboTimer = 0;
  private comboLabel = "";
  private popText = "";
  private popTimer = 0;
  /** Last values the HUD strings were built from. See hudStats(). */
  private metersShown = -1;
  private nearShown = -1;

  // --- Presentation --------------------------------------------------------
  private curStage = -1;
  private bannerT = 0;
  private bannerTitle = "";
  private bannerSub = "";
  /** Index of whatever ended the run, or -1 when the runner fell in a pit. */
  private killer = -1;
  private killLabel = "";
  private killX = 0;
  /** True when the run ended down a pit rather than against something solid. */
  private fell = false;
  private tumble = 0;
  private tumbleSpin = 0;
  private deadVY = 0;
  /** Horizontal offset of the tumbling body after the crash. */
  private deadX = 0;

  constructor(services: GameServices) {
    super(services, 520);
  }

  protected onReset(): void {
    for (let i = 0; i < this.obstacles.length; i++) this.obstacles[i].active = false;
    this.poolCursor = 0;

    this.feetY = GROUND_Y;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.jumpCut = false;
    this.coyote = COYOTE;
    this.jumpBuffer = 0;
    this.sliding = false;
    this.slideTimer = 0;
    this.slideLife = 0;
    this.slideCap = SLIDE_MAX;
    this.slideStarted = false;
    this.pendingSlide = 0;
    this.legPhase = 0;
    this.squash = 0;
    this.stepDust = 0;
    this.slideDust = 0;
    this.pitFall = -1;

    this.dist = 0;
    this.speed = SPEED_FROM;
    // A short runway before the first spawn, on top of the ~2.2s an obstacle
    // needs to travel from SPAWN_X. OPENING_GRACE is covered several times over.
    this.toNextSpawn = SPEED_FROM * 0.7;
    this.lastKind = KIND_BLOCK;
    this.nextKind = KIND_BLOCK;

    this.bonus = 0;
    this.nearCount = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboLabel = "";
    this.popText = "";
    this.popTimer = 0;
    // -1 forces both labels to rebuild on the first frame of the new run.
    this.metersShown = -1;
    this.nearShown = -1;

    this.curStage = -1;
    this.bannerT = 0;
    this.bannerTitle = "";
    this.bannerSub = "";
    this.killer = -1;
    this.killLabel = "";
    this.killX = 0;
    this.fell = false;
    this.tumble = 0;
    this.tumbleSpin = 0;
    this.deadVY = 0;
    this.deadX = 0;
  }

  /**
   * Called every frame by the base class, so the strings are rebuilt only when
   * the value behind them actually moved — a live distance readout would
   * otherwise mint throwaway strings on the update path.
   */
  protected hudStats(): HudStat[] {
    const m = Math.floor(this.dist / PX_PER_METER);
    if (m !== this.metersShown) {
      this.metersShown = m;
      this.stats[0].value = m + "m";
    }
    if (this.nearCount !== this.nearShown) {
      this.nearShown = this.nearCount;
      this.stats[1].value = String(this.nearCount);
    }
    this.stats[2].value = this.combo > 1 ? this.comboLabel : "-";
    return this.stats;
  }

  // --- Simulation ----------------------------------------------------------

  protected onUpdate(dt: number): void {
    this.speed = this.speedAt(this.elapsed);
    this.dist += this.speed * dt;
    // Assigned rather than accumulated: distance is the source of truth, so a
    // near-miss bonus can never drift away from the metres actually run.
    this.rawScore = this.dist / PX_PER_METER + this.bonus;

    this.legPhase += this.speed * dt * 0.048;
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.popTimer > 0) this.popTimer -= dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 5.5);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo >= 3) {
        // Losing a run of skims is a real event and should not pass in silence.
        this.audio.play("hit", 0.5, 0.14);
        this.combo = 0;
      } else if (this.comboTimer <= 0) {
        this.combo = 0;
      }
    }

    this.checkStage();
    this.scrollWorld(dt);
    this.updateRunner(dt);
    // updateRunner ends the run down a pit; paying a near-miss bonus to a body
    // that is already falling would be scoring a corpse.
    if (this.status !== "playing") return;
    this.resolveObstacles();
    // resolveObstacles may have ended the run, and dust off a corpse reads wrong.
    if (this.status === "playing") this.trailFx(dt);
  }

  private speedAt(t: number): number {
    return rampAsymptotic(t, SPEED_FROM, SPEED_RANGE, SPEED_HALF);
  }

  private checkStage(): void {
    const st = stage(this.elapsed, STAGE_SECONDS);
    if (st === this.curStage) return;
    this.curStage = st;
    // Naming the new threat as it unlocks is the cheapest possible tutorial.
    this.bannerTitle =
      st < STAGE_NAMES.length ? STAGE_NAMES[st] : "SPEED +" + (st - STAGE_NAMES.length + 1);
    this.bannerSub = st < STAGE_SUBS.length ? STAGE_SUBS[st] : "STAGE " + st;
    this.bannerT = BANNER_TIME;
    if (st > 0) {
      this.audio.play("warn", 1 + st * 0.06, 0.75);
      this.shake.add(3.5, 0.28);
    }
  }

  // --- World scroll and spawning -------------------------------------------

  private scrollWorld(dt: number): void {
    const step = this.speed * dt;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active) continue;
      o.x -= step;
      // Kept alive well past the runner so the near-miss payout has already
      // resolved before the slot is recycled.
      if (o.x + o.w < -120) o.active = false;
    }

    this.toNextSpawn -= step;
    if (this.toNextSpawn <= 0) this.spawnObstacle();
  }

  /**
   * Picks a kind, sizes it against the speed it will actually be met at, and
   * books the runway the next one must wait for.
   *
   * Every clamp in here is a fairness guarantee, not decoration: the size
   * limits are derived from the real jump arc and the real slide duration, so
   * a shape that cannot be cleared is never committed in the first place.
   */
  private spawnObstacle(): void {
    const o = this.acquire();
    if (!o) {
      // Pool exhausted (impossible at these gaps, but a dropped spawn is
      // better than recycling something still on screen). Try again shortly.
      this.toNextSpawn = 300;
      return;
    }

    // The speed this obstacle will be met at, not the speed right now.
    const s = this.speedAt(this.elapsed + SPEED_LOOKAHEAD);
    const st = this.curStage;
    // Rolled one spawn early. The runway booked at the bottom is the gap
    // between THIS obstacle and the one after it, so both ends have to be known
    // before it can be measured — deciding only one end put the slide-setup
    // beat on the wrong gap, and "pit then beam" lost its 0.18s.
    const kind = this.nextKind;

    o.active = true;
    o.kind = kind;
    o.x = SPAWN_X;
    o.minClear = Infinity;
    o.scored = false;
    o.phase = randRange(0, TAU);
    o.tint = 0;

    if (kind === KIND_BLOCK) {
      // Taller blocks late, but never past BLOCK_H_MAX: the arc peaks at 192px
      // and a block that eats most of that stops being a jump and becomes a
      // pixel-perfect launch.
      const hMax = st >= 3 ? BLOCK_H_MAX : BLOCK_H_MAX - 16;
      o.h = randRange(BLOCK_H_MIN, hMax);
      // Width is capped by the time the jump actually spends above this block:
      // the crossing must fit inside it with BLOCK_CROSS_SAFETY to spare.
      const budget = airTimeAbove(o.h) * s * BLOCK_CROSS_SAFETY - 2 * HW;
      o.w = widthWithin(BLOCK_W_MIN, BLOCK_W_MAX, budget);
      o.tint = o.h > 66 ? 1 : 0;
    } else if (kind === KIND_BEAM) {
      o.h = randRange(BEAM_CLEAR_MIN, BEAM_CLEAR_MAX);
      // SLIDE_TAP is the shortest slide the game can hand out, so the beam has
      // to be crossable inside it. Held and computed slides only ever give more.
      const budget = SLIDE_TAP * BEAM_CROSS_SAFETY * s - 2 * HW;
      o.w = widthWithin(BEAM_W_MIN, BEAM_W_MAX, budget);
    } else {
      // A pit may only claim a slice of the arc, so the take-off point is a
      // window rather than a frame.
      const budget = AIR_MAX * s * PIT_CROSS_SAFETY;
      o.w = widthWithin(PIT_W_MIN, PIT_W_MAX, budget);
      o.h = 0;
    }

    // pickKind reads lastKind for its beam bias, so the roll happens after the
    // just-spawned kind is recorded, not before it.
    this.lastKind = kind;
    this.nextKind = this.pickKind(st);
    this.toNextSpawn = o.w + s * this.gapTimeFor(kind, this.nextKind);
  }

  /**
   * Runway, in seconds, between the obstacle just spawned and the next one.
   *
   * The ramp makes the run tighten over time; the floor underneath it is the
   * rule the ramp is never allowed to break — a full jump arc plus a reaction
   * window, plus whatever this particular pairing costs on top.
   */
  private gapTimeFor(prev: ObstacleKind, next: ObstacleKind): number {
    let floor = MIN_GAP_TIME;
    // After a block or a pit the player may still be in the air; they have to
    // land before they can answer the next thing at all.
    if (prev !== KIND_BEAM) floor += LAND_RECOVER;
    // A slide has to be started from the floor, so a beam needs its own beat
    // on top. This is what stops "pit then beam" from being unanswerable.
    if (next === KIND_BEAM) floor += SLIDE_SETUP;
    const ramp =
      rampLinear(this.elapsed, GAP_TIME_FROM, GAP_TIME_TO, GAP_TIME_SECONDS) +
      randRange(0, GAP_JITTER);
    return Math.max(floor, ramp);
  }

  /** Weighted kind roll. Variety unlocks in stages, like the other games. */
  private pickKind(st: number): ObstacleKind {
    const r = Math.random();
    if (st < STAGE_BEAMS) return KIND_BLOCK;
    if (st < STAGE_PITS) return r < 0.62 ? KIND_BLOCK : KIND_BEAM;
    // Two blocks in a row is fine; two beams in a row is a rhythm the player
    // solves once, so a beam biases the next roll away from itself.
    if (this.lastKind === KIND_BEAM) return r < 0.6 ? KIND_BLOCK : KIND_PIT;
    if (r < 0.44) return KIND_BLOCK;
    if (r < 0.74) return KIND_BEAM;
    return KIND_PIT;
  }

  private acquire(): Obstacle | null {
    const n = this.obstacles.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.poolCursor + i) % n;
      const o = this.obstacles[idx];
      if (!o.active) {
        this.poolCursor = (idx + 1) % n;
        return o;
      }
    }
    return null;
  }

  // --- Runner --------------------------------------------------------------

  private bodyH(): number {
    return this.sliding ? SLIDE_H : STAND_H;
  }

  /** Floor height under the runner, or a value below the arena when over a pit. */
  private groundY(): number {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind !== KIND_PIT) continue;
      if (RUN_X > o.x + PIT_LIP && RUN_X < o.x + o.w - PIT_LIP) return this.height + 400;
    }
    return GROUND_Y;
  }

  /** Index of the pit the runner is falling into, for the death marker. */
  private pitUnder(): number {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind !== KIND_PIT) continue;
      if (RUN_X > o.x - 40 && RUN_X < o.x + o.w + 40) return i;
    }
    return -1;
  }

  /**
   * Seconds of runway to the beam the player has to answer next, or -1 when
   * the next thing ahead is not a beam within BEAM_TAKEOVER.
   *
   * Only the NEAREST obstacle may own the button. A beam sitting behind a pit
   * must never turn the jump that clears the pit into a slide into it.
   */
  private beamLead(): number {
    let lead = Infinity;
    let kind = -1;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active) continue;
      // Ahead while any part of it is still in front of the runner's box.
      if (o.x + o.w <= RUN_X - HW) continue;
      const d = o.x - (RUN_X + HW);
      if (d < lead) {
        lead = d;
        kind = o.kind;
      }
    }
    if (kind !== KIND_BEAM) return -1;
    // Already underneath it counts as zero rather than as negative runway.
    const t = Math.max(0, lead) / this.speed;
    return t <= BEAM_TAKEOVER ? t : -1;
  }

  /**
   * Spends a buffered action press: a jump normally, a slide when a beam owns
   * the button. Called twice a frame — before physics and again after a
   * landing — so it has to be safe to run with an empty buffer.
   */
  private answerBuffer(beam: number): void {
    if (this.jumpBuffer <= 0) return;
    if (this.airborne && this.coyote <= 0) return;
    if (beam >= 0) {
      this.jumpBuffer = 0;
      // Airborne off a ledge with a beam this close is unreachable by design
      // (the gap floor puts a beam 1.44s behind a pit), so the press is simply
      // spent rather than turned into a jump that could only end in the slab.
      if (!this.airborne) this.startSlide(coverSlide(beam));
      return;
    }
    if (this.headBlocked()) return;
    this.startJump();
  }

  /** True when standing up right now would put the head inside a beam. */
  private headBlocked(): boolean {
    const top = this.feetY - STAND_H + FORGIVE;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind !== KIND_BEAM) continue;
      if (RUN_X + HW < o.x || RUN_X - HW > o.x + o.w) continue;
      if (top < GROUND_Y - o.h) return true;
    }
    return false;
  }

  private updateRunner(dt: number): void {
    const action = this.input.justActioned();
    const downHeld = this.input.isDown("ArrowDown");
    const downEdge = this.input.justPressed("ArrowDown");
    // Resolved once a frame: every branch below has to agree about which verb
    // the button currently means, or one press ends up meaning two things.
    const beam = this.beamLead();
    const rising = this.airborne && this.vy < 0;

    // ArrowDown is unambiguous, so it ducks whenever it is pressed in the air.
    // The action button only ducks when a beam is actually there to answer:
    // without that test a stray double tap — the way half the world tries to
    // jump higher — slams the runner into the block they are mid-way over.
    if (rising && downEdge) {
      this.duck(beam >= 0 ? coverSlide(beam) : SLIDE_TAP);
    } else if (rising && action && beam >= 0) {
      this.duck(coverSlide(beam));
    } else if (action) {
      this.jumpBuffer = JUMP_BUFFER;
    }

    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.coyote > 0) this.coyote -= dt;

    // Buffer plus coyote: a jump lands if it was asked for slightly early, or
    // slightly late off a ledge. Without both, a runner feels broken.
    this.answerBuffer(beam);

    // Variable height: releasing while rising loads extra gravity for the rest
    // of the climb. Latched, so re-pressing mid-air cannot restore the float.
    if (this.airborne && this.vy < 0 && !this.input.isBoosting()) this.jumpCut = true;

    if (this.airborne) {
      if (downHeld && this.vy > -80) {
        // Held fast-fall. land() reads the key again on touchdown rather than
        // latching a slide here, so tapping Down in the air and releasing it
        // cannot buy a slide the player stopped asking for.
        this.vy += DIVE_HOLD * dt;
      }
      const g = this.vy < 0 ? (this.jumpCut ? G_RISE * CUT_MUL : G_RISE) : G_FALL;
      this.vy += g * dt;
      this.feetY += this.vy * dt;
      this.airTime += dt;

      const gy = this.groundY();
      // Soles under the floor line with a hole beneath them: the fall is
      // committed from here. Without the latch the pit scrolls out from under
      // a falling runner and drops them back onto the floor on the far side —
      // at 500px/s that is every pit narrower than ~80px, i.e. most of them.
      if (this.pitFall < 0 && this.feetY > GROUND_Y && gy > GROUND_Y) {
        this.pitFall = this.pitUnder();
      }
      if (this.pitFall < 0 && this.vy > 0 && this.feetY >= gy) {
        this.feetY = gy;
        this.land();
      } else if (this.feetY > GROUND_Y + PIT_DEATH) {
        this.crash(this.pitFall, "FELL IN", true);
        return;
      }
    } else {
      this.feetY = GROUND_Y;
      if (this.groundY() > GROUND_Y) {
        // Ran off the lip of a pit. Coyote time starts here, not at the jump.
        this.airborne = true;
        this.airTime = 0;
        this.vy = 0;
        this.coyote = COYOTE;
      } else {
        this.coyote = COYOTE;
      }
    }

    // Second look at the buffer, now that a landing may have happened this
    // frame: a jump asked for just before touchdown has to fire on the frame
    // the feet land, not on the one after it.
    if (!this.airborne) this.answerBuffer(beam);

    if (!this.airborne) {
      // Started on the press edge, never on the held state. Holding Down would
      // otherwise be a free permanent crouch that answers every beam in the run
      // before it exists, and the slide would stop being a decision.
      // With a beam in range the press buys exactly the cover that beam needs,
      // so both input channels answer it the same way and neither can stand the
      // runner up a few pixels short of the slab.
      if (downEdge && !this.sliding) {
        this.startSlide(beam >= 0 ? coverSlide(beam) : SLIDE_MIN);
      }
      if (this.sliding) {
        this.slideTimer -= dt;
        this.slideLife += dt;
        // Minimum length so it cannot be tapped into a crouch-walk, maximum
        // length so it cannot be held into one either. Two things outrank the
        // cap: headroom, because standing up mid-beam is a death nobody asked
        // for, and a player still holding the key with a beam already inside
        // its takeover window. A held key produces no fresh press edge, so
        // without that second clause the cap can stand the runner up four
        // frames short of the slab while they are holding exactly the right
        // key — and the cap is there to deny a free permanent crouch, not that.
        const up = this.slideLife >= this.slideCap || (this.slideTimer <= 0 && !downHeld);
        if (up && !this.headBlocked() && !(downHeld && beam >= 0)) this.endSlide();
      }
    }
  }

  private startJump(): void {
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.airborne = true;
    this.airTime = 0;
    this.jumpCut = false;
    this.vy = -JUMP_V;
    if (this.sliding) this.endSlide();
    this.squash = 0;

    // Dust kicked backward out of the take-off, so the leap has a direction.
    for (let i = 0; i < 7; i++) {
      this.puff(
        RUN_X + randRange(-10, 6),
        GROUND_Y - randRange(0, 5),
        randRange(-230, -70),
        randRange(-70, 10),
        randRange(0.22, 0.4),
        randRange(3, 6),
        0,
        C_DUST,
        "circle",
        0.25
      );
    }
    this.audio.play("click", 1.35, 0.45);
  }

  private land(): void {
    const hard = this.vy > 620;
    this.airborne = false;
    this.vy = 0;
    this.jumpCut = false;
    this.airTime = 0;
    this.squash = 1;
    // A duck books its slide the moment it commits; holding Down through the
    // landing asks for one too, but only while the key is still actually down.
    const owed =
      this.pendingSlide > 0 ? this.pendingSlide : this.input.isDown("ArrowDown") ? SLIDE_TAP : 0;
    this.pendingSlide = 0;
    if (owed > 0) this.startSlide(owed);

    for (let i = 0; i < (hard ? 9 : 5); i++) {
      this.puff(
        RUN_X + randRange(-14, 14),
        GROUND_Y - randRange(0, 4),
        randRange(-200, 60),
        randRange(-90, -10),
        randRange(0.18, 0.36),
        randRange(2.5, 5.5),
        0,
        C_DUST,
        "circle",
        0.22
      );
    }
    this.audio.play("hit", 0.55, hard ? 0.22 : 0.14);
    if (hard) this.shake.add(2.2, 0.14);
  }

  private startSlide(duration: number): void {
    if (!this.sliding) {
      this.slideLife = 0;
      this.slideCap = SLIDE_MAX;
      this.slideStarted = true;
      this.audio.play("shoot", 0.6, 0.28);
      for (let i = 0; i < 6; i++) {
        this.puff(
          RUN_X + randRange(-8, 10),
          GROUND_Y - randRange(0, 6),
          randRange(-260, -90),
          randRange(-60, 5),
          randRange(0.18, 0.34),
          randRange(2.5, 5),
          0,
          C_DUST,
          "circle",
          0.24
        );
      }
    }
    this.sliding = true;
    this.slideTimer = Math.max(this.slideTimer, duration);
    // A slide measured against a specific beam may legitimately outlast the
    // hold cap: SLIDE_MAX is there to stop a permanent crouch, and this one
    // ends on the beam it was cut for.
    this.slideCap = Math.max(this.slideCap, duration);
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideTimer = 0;
    this.slideLife = 0;
    this.slideCap = SLIDE_MAX;
  }

  /**
   * The airborne duck: slam down now and slide the moment the feet land.
   *
   * Caught in the first instants of a jump it becomes a stomp, strong enough to
   * undo the hop it just started inside two frames — the rescue for a jump
   * taken a beat before the beam claimed the button. Later in the rise it is an
   * ordinary dive. Neither ever teleports: a body that jumps to the floor reads
   * as a bug, and the player has to be able to see where they are.
   */
  private duck(duration: number): void {
    this.jumpBuffer = 0;
    const air = Math.max(0, GROUND_Y - this.feetY);
    const stomp = this.airTime < DUCK_CANCEL;
    this.vy = Math.max(this.vy, stomp ? Math.max(DIVE_V, air / STOMP_TIME) : DIVE_V);
    this.pendingSlide = duration;
    this.audio.play("shoot", stomp ? 0.9 : 0.75, 0.3);
    for (let i = 0; i < 5; i++) {
      this.puff(
        RUN_X + randRange(-8, 8),
        this.feetY - randRange(4, 26),
        randRange(-140, -30),
        randRange(-120, -40),
        randRange(0.16, 0.3),
        randRange(2, 4),
        0,
        ACCENT,
        "circle",
        0.3
      );
    }
  }

  /** Running dust and slide sparks. Cadence tracks speed, so pace is readable. */
  private trailFx(dt: number): void {
    if (this.sliding && !this.airborne) {
      this.slideDust -= dt;
      if (this.slideDust <= 0) {
        this.slideDust = 0.035;
        this.puff(
          RUN_X - 12,
          GROUND_Y - randRange(1, 7),
          randRange(-320, -140),
          randRange(-90, -20),
          randRange(0.2, 0.36),
          randRange(2.4, 4.6),
          0,
          Math.random() < 0.35 ? ACCENT : C_DUST,
          "circle",
          0.24
        );
      }
      return;
    }
    if (this.airborne) return;
    this.stepDust -= dt;
    if (this.stepDust > 0) return;
    // One puff per footfall rather than a constant stream.
    this.stepDust = clamp(28 / this.speed, 0.05, 0.16);
    this.puff(
      RUN_X - 8 + randRange(-4, 4),
      GROUND_Y - randRange(0, 3),
      randRange(-150, -50),
      randRange(-40, -5),
      randRange(0.16, 0.3),
      randRange(2, 4),
      0,
      C_DUST,
      "circle",
      0.25
    );
  }

  // --- Collision and near misses -------------------------------------------

  private resolveObstacles(): void {
    const grace = this.elapsed <= OPENING_GRACE;
    const h = this.bodyH();
    const body = this.rBody;
    // Inset on all four sides. The soles matter as much as the head: a block
    // cleared by three pixels should read as cleared, not as a hit.
    body.x = RUN_X - HW + FORGIVE;
    body.w = (HW - FORGIVE) * 2;
    body.y = this.feetY - h + FORGIVE;
    body.h = h - FORGIVE * 2;
    const bodyBottom = body.y + body.h;
    const obs = this.rObs;

    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active) continue;

      if (o.kind !== KIND_PIT) {
        if (o.kind === KIND_BLOCK) {
          obs.x = o.x;
          obs.y = GROUND_Y - o.h;
          obs.w = o.w;
          obs.h = o.h;
        } else {
          obs.x = o.x;
          obs.y = GROUND_Y - BEAM_TOP_H;
          obs.w = o.w;
          obs.h = BEAM_TOP_H - o.h;
        }
        if (!grace && rectHit(body, obs)) {
          this.crash(i, o.kind === KIND_BLOCK ? "HIT A BLOCK" : "HIT A BEAM");
          return;
        }
      }

      if (o.kind === KIND_BEAM) {
        // Clearance under a beam is a constant — the slide pose is always 36
        // tall — so height measures nothing here. What is actually skilful is
        // how late the slide was committed, so the metric is the runway that
        // was still left when it started.
        // Measured on the slide's press edge, and re-measured on every later
        // one, so what counts is the last commitment before the beam arrived
        // rather than some unrelated slide from earlier in the run.
        if (this.slideStarted && o.x > RUN_X) o.minClear = Math.max(0, o.x - (RUN_X + HW));
      } else if (body.x < o.x + o.w && body.x + body.w > o.x) {
        // Smallest vertical gap seen while the two boxes overlapped: over the
        // top of a block, or above the lip of a pit.
        const clear = o.kind === KIND_BLOCK ? GROUND_Y - o.h - bodyBottom : GROUND_Y - bodyBottom;
        if (clear < o.minClear) o.minClear = clear;
      }

      if (!o.scored && o.x + o.w < RUN_X - HW) {
        o.scored = true;
        const limit = o.kind === KIND_BEAM ? NEAR_LEAD : NEAR_GAP;
        if (o.minClear >= 0 && o.minClear < limit) this.nearMiss(o);
      }
    }
    this.slideStarted = false;
  }

  private nearMiss(o: Obstacle): void {
    this.nearCount++;
    this.combo++;
    this.comboTimer = COMBO_DECAY;
    this.comboLabel = "x" + this.combo;
    const gain = NEAR_BASE + NEAR_PER_COMBO * Math.min(this.combo - 1, NEAR_COMBO_CAP);
    this.bonus += gain;
    this.popText = "+" + gain;
    this.popTimer = 0.75;

    // Chips thrown backward along the obstacle, so the skim reads as the thing
    // passing the runner rather than as an impact.
    const y = o.kind === KIND_BEAM ? this.feetY - this.bodyH() : this.feetY;
    for (let i = 0; i < 7; i++) {
      this.puff(
        RUN_X + randRange(-6, 14),
        y + randRange(-6, 6),
        randRange(-380, -140),
        randRange(-120, 120),
        randRange(0.2, 0.38),
        randRange(2.2, 4),
        0.6,
        i % 2 === 0 ? ACCENT : GREEN,
        "circle",
        0.25
      );
    }
    this.puff(RUN_X, y, 0, 0, 0.3, 6, 0, ACCENT, "ring", 1);
    this.audio.play("graze", 1 + Math.min(this.combo, 20) * 0.04, 0.7);
    this.shake.add(1.2 + Math.min(this.combo, 10) * 0.14, 0.12);
  }

  // --- Death ---------------------------------------------------------------

  private crash(index: number, label: string, fell = false): void {
    if (this.status !== "playing") return;
    this.killer = index;
    this.killLabel = label;
    this.killX = RUN_X;
    this.fell = fell;
    // Tumble: thrown back and up off whatever was hit, spinning the way the
    // impact would have turned them. Falling into a pit gets no bounce — the
    // body keeps going down the hole, which is the whole point of the hole.
    this.tumble = 0;
    this.tumbleSpin = randRange(6.5, 9);
    this.deadX = 0;
    this.deadVY = fell ? 60 : -430;

    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU + randRange(-0.25, 0.25);
      const s = randRange(90, 400);
      this.puff(
        RUN_X,
        this.feetY - this.bodyH() * 0.5,
        Math.cos(a) * s,
        Math.sin(a) * s,
        randRange(0.45, 1),
        randRange(2.5, 5.5),
        1,
        i % 3 === 0 ? ACCENT : i % 3 === 1 ? BEAM_FILL : C_DUST,
        i % 2 === 0 ? "circle" : "square",
        0.4,
        randRange(0, TAU)
      );
    }
    this.puff(RUN_X, this.feetY - 30, 0, 0, 0.6, 9, 0, ACCENT, "ring", 1);

    this.shake.add(15, 0.7);
    this.audio.play("death");
    this.audio.play("hit", 0.7, 0.9);
    this.die();
  }

  protected onDeathUpdate(dt: number): void {
    // The world is frozen because onUpdate stopped; only the runner keeps
    // moving, which is what makes the crash read as a crash rather than a
    // pause. Clamped so the body settles instead of falling forever.
    if (this.deathTime > 2) return;
    this.tumble += this.tumbleSpin * dt;
    this.deadVY += 1900 * dt;
    this.feetY += this.deadVY * dt;
    // Carried backwards at a fraction of the run speed. The world stopped, so
    // the only motion left in the frame has to come from the body itself.
    this.deadX -= this.speed * 0.55 * dt;
    if (this.feetY > GROUND_Y && !this.fell) {
      this.feetY = GROUND_Y;
      this.deadVY *= -0.32;
      this.tumbleSpin *= 0.5;
      if (Math.abs(this.deadVY) < 60) this.tumbleSpin = 0;
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
    p.drag = drag;
    p.rotation = rotation;
    this.fx.emit(p);
  }

  // --- Render --------------------------------------------------------------

  protected onRender(g: CanvasRenderingContext2D): void {
    g.fillStyle = BG;
    g.fillRect(0, 0, this.width, this.height);

    g.save();
    // The run happens on a rounded card lying on the page, not a hard screen.
    roundRect(g, PANEL_PAD, PANEL_PAD, this.width - PANEL_PAD * 2, this.height - PANEL_PAD * 2, PANEL_R);
    g.fillStyle = PANEL;
    g.fill();
    g.clip();

    this.drawHills(g);
    this.drawMid(g);
    this.drawFloor(g);
    this.drawObstacles(g);
    this.drawRunner(g);
    if (this.status === "gameover") this.drawKillMark(g);
    g.restore();

    this.drawFrame(g);

    if (this.status === "gameover") {
      const flash = Math.max(0, 1 - this.deathTime * 3.2);
      if (flash > 0) {
        // A soft warm white, laid on normally. "lighter" over a near-white
        // floor would blow the whole card out to blank paper.
        g.save();
        g.globalAlpha = flash * 0.55;
        g.fillStyle = C_FLASH;
        g.fillRect(0, 0, this.width, this.height);
        g.restore();
      }
    }
  }

  /** Furthest layer: soft purple caps, most of each circle buried by the floor. */
  private drawHills(g: CanvasRenderingContext2D): void {
    const off = -((this.dist * HILL_RATE) % HILL_PERIOD);
    g.save();
    g.fillStyle = C_HILL;
    g.beginPath();
    for (let base = off - HILL_PERIOD; base < this.width + HILL_PERIOD; base += HILL_PERIOD) {
      for (let i = 0; i < HILL_X.length; i++) {
        g.moveTo(base + HILL_X[i] + HILL_R[i], GROUND_Y + HILL_DROP[i]);
        g.arc(base + HILL_X[i], GROUND_Y + HILL_DROP[i], HILL_R[i], 0, TAU);
      }
    }
    g.fill();
    g.restore();
  }

  /** Mid layer: blocky skyline. Faster than the hills, slower than the floor. */
  private drawMid(g: CanvasRenderingContext2D): void {
    const off = -((this.dist * MID_RATE) % MID_PERIOD);
    g.save();
    g.fillStyle = C_MID;
    g.strokeStyle = C_MID_LINE;
    g.lineWidth = 2;
    for (let base = off - MID_PERIOD; base < this.width + MID_PERIOD; base += MID_PERIOD) {
      for (let i = 0; i < MID_X.length; i++) {
        const x = base + MID_X[i];
        if (x > this.width + 40 || x + MID_W[i] < -40) continue;
        roundRect(g, x, GROUND_Y - MID_H[i], MID_W[i], MID_H[i], 12);
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  private drawFloor(g: CanvasRenderingContext2D): void {
    const bottom = this.height - PANEL_PAD;
    g.save();
    g.fillStyle = C_FLOOR;
    g.fillRect(0, GROUND_Y, this.width, bottom - GROUND_Y);

    // Scrolling ticks at the true world rate: the only layer that tells the
    // player how fast they are actually going.
    const off = -(this.dist % DASH_PERIOD);
    g.strokeStyle = C_FLOOR_DASH;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    for (let x = off - DASH_PERIOD; x < this.width + DASH_PERIOD; x += DASH_PERIOD) {
      g.moveTo(x, GROUND_Y + 26);
      g.lineTo(x + 26, GROUND_Y + 26);
      g.moveTo(x + 31, GROUND_Y + 58);
      g.lineTo(x + 57, GROUND_Y + 58);
    }
    g.stroke();

    // The floor line itself, chunky and dark: it is the reference every jump
    // is judged against, so it has to be the strongest line in the backdrop.
    g.strokeStyle = C_FLOOR_LINE;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(0, GROUND_Y + 1.75);
    g.lineTo(this.width, GROUND_Y + 1.75);
    g.stroke();
    g.restore();

    // Pits are punched through afterwards so they cut the line and the ticks.
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind !== KIND_PIT) continue;
      this.drawPit(g, o, bottom);
    }
  }

  private drawPit(g: CanvasRenderingContext2D, o: Obstacle, bottom: number): void {
    g.save();
    g.fillStyle = C_PIT_VOID;
    g.fillRect(o.x, GROUND_Y, o.w, bottom - GROUND_Y);
    // Inner shadow under the lip: without it the hole reads as a flat patch.
    g.fillStyle = C_PIT_DEEP;
    g.fillRect(o.x, GROUND_Y, o.w, 16);
    g.fillRect(o.x, GROUND_Y, 10, bottom - GROUND_Y);
    g.fillRect(o.x + o.w - 10, GROUND_Y, 10, bottom - GROUND_Y);

    // Two purple lips. They are the take-off and landing marks, so they get the
    // hazard treatment: saturated fill, dark outline, no wash.
    g.fillStyle = PIT_RIM;
    g.strokeStyle = PIT_RIM_LINE;
    g.lineWidth = 2.5;
    roundRect(g, o.x - 12, GROUND_Y - 9, 22, 13, 5);
    g.fill();
    g.stroke();
    roundRect(g, o.x + o.w - 10, GROUND_Y - 9, 22, 13, 5);
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawObstacles(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;
    // Cues only while the verbs are still new. A permanent arrow over every
    // block would be noise by the second minute.
    const cue = clamp(1 - (this.elapsed - 18) / 8, 0, 1);

    g.save();
    g.globalAlpha = fade;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind === KIND_PIT) continue;
      if (o.x > this.width + 60 || o.x + o.w < -60) continue;
      if (o.kind === KIND_BLOCK) this.drawBlock(g, o, cue, fade);
      else this.drawBeam(g, o, cue, fade);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  private drawBlock(g: CanvasRenderingContext2D, o: Obstacle, cue: number, fade: number): void {
    const fill = BLOCK_FILL[o.tint];
    const line = BLOCK_LINE[o.tint];
    const top = GROUND_Y - o.h;

    // Contact shadow on the floor: what lifts a candy shape off a light panel.
    g.fillStyle = C_SHADOW;
    g.beginPath();
    g.ellipse(o.x + o.w / 2 + 4, GROUND_Y + 5, o.w * 0.56, 8, 0, 0, TAU);
    g.fill();

    g.fillStyle = fill;
    roundRect(g, o.x, top, o.w, o.h + 4, Math.min(12, o.w * 0.3));
    g.fill();
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.stroke();

    g.fillStyle = C_GLOSS;
    roundRect(g, o.x + 5, top + 5, Math.max(6, o.w * 0.3), Math.max(5, o.h * 0.22), 4);
    g.fill();

    // A grumpy little face, so the thing that ends the run has a character
    // rather than being an anonymous rectangle.
    const cx = o.x + o.w / 2;
    const ey = top + Math.min(24, o.h * 0.36);
    const eye = Math.max(2.2, Math.min(3.4, o.w * 0.055));
    g.fillStyle = line;
    g.beginPath();
    g.arc(cx - o.w * 0.17, ey, eye, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(cx + o.w * 0.17, ey, eye, 0, TAU);
    g.fill();
    g.lineWidth = Math.max(2, eye * 0.8);
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx, ey + 16, o.w * 0.2, Math.PI + 0.5, TAU - 0.5);
    g.stroke();

    if (cue > 0) {
      // "Go over this" — drawn above the block, never across it.
      g.globalAlpha = cue * 0.75 * fade;
      g.strokeStyle = INK_DIM;
      g.lineWidth = 3;
      g.lineJoin = "round";
      const ay = top - 20 - Math.sin(this.elapsed * 5 + o.phase) * 4;
      g.beginPath();
      g.moveTo(cx - 9, ay + 9);
      g.lineTo(cx, ay);
      g.lineTo(cx + 9, ay + 9);
      g.stroke();
      g.globalAlpha = fade;
    }
  }

  private drawBeam(g: CanvasRenderingContext2D, o: Obstacle, cue: number, fade: number): void {
    const top = GROUND_Y - BEAM_TOP_H;
    const bottom = GROUND_Y - o.h;
    const cx = o.x + o.w / 2;

    // Hangers up to the ceiling. Cosmetic, but they are why a beam reads as
    // impossible to jump instead of as a floating slab.
    g.strokeStyle = C_HANGER;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(o.x + 12, PANEL_PAD);
    g.lineTo(o.x + 12, top + 6);
    g.moveTo(o.x + o.w - 12, PANEL_PAD);
    g.lineTo(o.x + o.w - 12, top + 6);
    g.stroke();

    g.fillStyle = C_SHADOW_SOFT;
    roundRect(g, o.x + 4, top + 6, o.w, bottom - top, 14);
    g.fill();

    g.fillStyle = BEAM_FILL;
    roundRect(g, o.x, top, o.w, bottom - top, 14);
    g.fill();
    g.strokeStyle = BEAM_LINE;
    g.lineWidth = 3;
    g.stroke();

    // The lower edge is the part that actually kills, so it gets the darkest
    // band on the whole shape.
    g.fillStyle = BEAM_LINE;
    roundRect(g, o.x + 4, bottom - 14, o.w - 8, 10, 5);
    g.fill();

    g.fillStyle = C_GLOSS;
    roundRect(g, o.x + 7, top + 10, Math.max(8, o.w * 0.22), 12, 5);
    g.fill();

    const ey = bottom - 44;
    const eye = 3.2;
    g.fillStyle = BEAM_LINE;
    g.beginPath();
    g.arc(cx - 11, ey, eye, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(cx + 11, ey, eye, 0, TAU);
    g.fill();

    if (cue > 0) {
      // "Go under this" — drawn in the slot the player has to fit through.
      g.globalAlpha = cue * 0.8 * fade;
      g.strokeStyle = INK_DIM;
      g.lineWidth = 3;
      g.lineJoin = "round";
      const ay = bottom + 14 + Math.sin(this.elapsed * 5 + o.phase) * 3;
      g.beginPath();
      g.moveTo(cx - 9, ay);
      g.lineTo(cx, ay + 9);
      g.lineTo(cx + 9, ay);
      g.stroke();
      g.globalAlpha = fade;
    }
  }

  /**
   * Everything the run owns fades out together after death; the exponent makes
   * the tail linger, which is where the slow-motion feel comes from without
   * touching real time.
   */
  private runFade(): number {
    if (this.status !== "gameover") return 1;
    return Math.max(0, 1 - Math.pow(Math.min(1, this.deathTime / 1.6), 1.6));
  }

  private drawRunner(g: CanvasRenderingContext2D): void {
    const h = this.bodyH();
    // Matches bodyH() exactly, including the rare case of sliding off a pit
    // lip: what is drawn and what is collided against must never disagree.
    const slide = this.sliding;
    const air = Math.max(0, GROUND_Y - this.feetY);
    const dead = this.status === "gameover";
    const fade = this.runFade();
    if (fade <= 0) return;

    // Contact shadow tracks height, so the arc is readable even at the apex.
    const k = clamp(1 - air / 210, 0.16, 1);
    g.save();
    g.globalAlpha = 0.55 * k * fade;
    g.fillStyle = C_SHADOW;
    g.beginPath();
    g.ellipse(RUN_X + this.deadX, GROUND_Y + 4, 26 * k + 8, 7 * k + 2, 0, 0, TAU);
    g.fill();
    g.restore();

    // Squash on landing, stretch while climbing: the two frames that sell
    // weight in a runner.
    let sx = 1;
    let sy = 1;
    if (this.squash > 0) {
      sx = 1 + 0.26 * this.squash;
      sy = 1 - 0.3 * this.squash;
    } else if (this.airborne && this.vy < 0) {
      const s = clamp(-this.vy / JUMP_V, 0, 1) * 0.2;
      sx = 1 - s;
      sy = 1 + s;
    }

    g.save();
    g.globalAlpha = fade;
    g.translate(RUN_X + this.deadX, this.feetY);
    if (dead) g.rotate(this.tumble);
    g.scale(sx, sy);

    // Drawn wider than the 16px collision half-width on purpose: the body may
    // look like it grazed something it did not, never the other way round.
    const hw = slide ? 23 : 20;

    if (!slide) this.drawLegs(g, h, air > 1 || dead);

    g.fillStyle = ACCENT;
    roundRect(g, -hw, -h, hw * 2, h, hw);
    g.fill();
    g.strokeStyle = ACCENT_DARK;
    g.lineWidth = 3.2;
    g.stroke();

    // Gloss up-left, so the capsule is a solid object and not a flat sticker.
    g.fillStyle = C_GLOSS;
    roundRect(g, -hw + 5, -h + 6, hw * 0.8, h * 0.34, 6);
    g.fill();

    // Dot eyes, forward on the body. They are the only thing giving the runner
    // a direction, which is why they sit hard against the leading edge.
    const eyeY = slide ? -h * 0.55 : -h + 24;
    g.fillStyle = C_WHITE;
    g.beginPath();
    g.arc(1, eyeY, 6.5, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(12.5, eyeY, 5.5, 0, TAU);
    g.fill();
    // Pupils sit low while running and roll up on the crash frame.
    g.fillStyle = INK;
    g.beginPath();
    g.arc(2.5, eyeY + (dead ? -1.5 : 1), 3, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(13.5, eyeY + (dead ? -1.5 : 1), 2.6, 0, TAU);
    g.fill();

    if (slide) {
      // Legs tucked out front while sliding, so the pose reads instantly at a
      // glance rather than being "the capsule, but shorter".
      g.strokeStyle = ACCENT_DARK;
      g.lineWidth = 8;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(hw - 4, -10);
      g.lineTo(hw + 12, -6);
      g.stroke();
    }
    g.restore();

    if (this.elapsed < OPENING_GRACE && !dead) {
      // Spell the grace window out; an invulnerable second the player cannot
      // see is an invulnerable second they will not trust.
      const t = this.elapsed / OPENING_GRACE;
      text(g, "SAFE", RUN_X, GROUND_Y - STAND_H - 26, {
        size: 11,
        color: GREEN,
        alpha: 0.9 * (1 - t),
        letterSpacing: "3px",
      });
    }

    if (this.popTimer > 0 && !dead) {
      const t = this.popTimer / 0.75;
      text(g, this.popText, RUN_X, this.feetY - h - 22 - (1 - t) * 26, {
        size: 17,
        color: ACCENT,
        alpha: Math.min(1, t * 1.6),
        shadow: C_SHADOW,
        shadowBlur: 6,
      });
    }
    if (this.combo >= 3 && this.status === "playing") {
      text(g, this.comboLabel, RUN_X, this.feetY - h - 46, {
        size: 14,
        color: ACCENT_DARK,
        alpha: Math.min(1, this.comboTimer / COMBO_DECAY) * 0.95,
      });
    }
  }

  /** Two capsule legs cycling off distance travelled, tucked while airborne. */
  private drawLegs(g: CanvasRenderingContext2D, bodyH: number, airborne: boolean): void {
    g.save();
    g.strokeStyle = ACCENT_DARK;
    g.lineWidth = 9;
    g.lineCap = "round";
    const hipY = -bodyH * 0.34;
    for (let i = 0; i < 2; i++) {
      const a = this.legPhase + i * Math.PI;
      const swing = airborne ? (i === 0 ? 0.9 : -0.35) : Math.sin(a) * 1.05;
      const lift = airborne ? 10 : Math.max(0, Math.cos(a)) * 12;
      g.beginPath();
      g.moveTo(0, hipY);
      g.lineTo(Math.sin(swing) * 17, -lift);
      g.stroke();
    }
    g.restore();
  }

  /** Says WHAT was hit. A death the player cannot explain is a death they blame. */
  private drawKillMark(g: CanvasRenderingContext2D): void {
    const t = this.deathTime;
    const fade = this.runFade();
    if (fade <= 0) return;
    // Pulsing so the eye is pulled to it even while the scene is fading out.
    const pulse = 0.5 + 0.5 * Math.sin(t * 9);
    let x = this.killX;
    let y = GROUND_Y - 70;

    if (this.killer >= 0) {
      const o = this.obstacles[this.killer];
      x = o.x + o.w / 2;
      g.save();
      g.globalAlpha = (0.4 + 0.4 * pulse) * fade;
      g.strokeStyle = o.kind === KIND_PIT ? PIT_RIM_LINE : BEAM_LINE;
      g.lineWidth = 4;
      if (o.kind === KIND_BLOCK) {
        y = GROUND_Y - o.h - 32;
        roundRect(g, o.x - 6, GROUND_Y - o.h - 6, o.w + 12, o.h + 12, 14);
      } else if (o.kind === KIND_BEAM) {
        y = GROUND_Y - o.h + 34;
        roundRect(g, o.x - 6, GROUND_Y - BEAM_TOP_H - 6, o.w + 12, BEAM_TOP_H - o.h + 12, 18);
      } else {
        y = GROUND_Y - 44;
        roundRect(g, o.x - 6, GROUND_Y - 6, o.w + 12, 96, 12);
      }
      g.stroke();
      g.restore();
    }

    text(g, this.killLabel, clamp(x, 90, this.width - 90), clamp(y, 40, GROUND_Y - 16), {
      size: 15,
      color: INK,
      alpha: Math.min(1, t * 4) * 0.9 * fade,
      letterSpacing: "3px",
      shadow: C_BLOOM,
      shadowBlur: 10,
    });
  }

  /**
   * The old dark vignette, inverted: a wide white stroke feathering the rim
   * into the page plus a hairline frame. Darkening the edges of a light card
   * would fight the theme and eat the obstacles nearest the border.
   */
  private drawFrame(g: CanvasRenderingContext2D): void {
    g.save();
    roundRect(g, PANEL_PAD, PANEL_PAD, this.width - PANEL_PAD * 2, this.height - PANEL_PAD * 2, PANEL_R);
    g.strokeStyle = C_BLOOM;
    g.lineWidth = 16;
    g.stroke();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  protected onRenderOverlay(g: CanvasRenderingContext2D): void {
    if (this.bannerT <= 0) return;
    const k = this.bannerT / BANNER_TIME;
    // Snap in, hold, drift out. onUpdate stops at death, so bannerT freezes —
    // without the runFade term a banner caught mid-hold would sit on the
    // game-over screen at full brightness forever.
    const alpha = (k > 0.85 ? (1 - k) / 0.15 : Math.min(1, k / 0.3)) * this.runFade();
    if (alpha <= 0) return;

    const bx = (this.width - BANNER_W) / 2;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = C_SHADOW_SOFT;
    roundRect(g, bx, BANNER_Y + 4, BANNER_W, BANNER_H, BANNER_H / 2);
    g.fill();
    g.fillStyle = C_WHITE;
    roundRect(g, bx, BANNER_Y, BANNER_W, BANNER_H, BANNER_H / 2);
    g.fill();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.restore();

    text(g, this.bannerTitle, this.width / 2, BANNER_Y + 29, {
      size: 26,
      color: ACCENT,
      alpha,
      letterSpacing: "6px",
    });
    text(g, this.bannerSub, this.width / 2, BANNER_Y + 55, {
      size: 11,
      color: INK_DIM,
      alpha: alpha * 0.9,
      letterSpacing: "3px",
    });
  }
}
