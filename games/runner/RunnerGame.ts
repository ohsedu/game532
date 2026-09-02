import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import { circleRectHit, rectHit, type Circle, type Rect } from "@/games/core/Collision";
import { OPENING_GRACE, rampAsymptotic, rampLinear, stage } from "@/games/core/curve";
import { roundRect, text } from "@/games/core/draw";
import type { ParticleOptions, ParticleShape } from "@/games/core/Particles";
import { clamp, randRange } from "@/games/core/Vector2";
import {
  BEAM_FILL,
  BEAM_LINE,
  BLOCK_FILL,
  BLOCK_LINE,
  CEIL_FILL,
  CEIL_LINE,
  CEIL_TAPE,
  COIN_CORE,
  COIN_FILL,
  COIN_LINE,
  createCoinPool,
  createObstaclePool,
  KIND_BEAM,
  KIND_BLOCK,
  KIND_CEIL,
  KIND_PIT,
  LINK_LEAD,
  LINK_NONE,
  LINK_TAIL,
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
/** The rail that ties a compound pair together, and its chevrons. */
const C_LINK = "rgba(109,69,196,0.6)";
const C_LINK_SOFT = "rgba(109,69,196,0.13)";
/** Floor paint under a roof: the ground half of the no-jump telegraph. */
const C_ROOF_ZONE = "rgba(255,180,67,0.2)";
const C_ROOF_ZONE_LINE = "rgba(176,112,13,0.45)";
const C_GAUGE_TRACK = "rgba(34,37,45,0.09)";

// --- Layout of the drawn card. Cosmetic only; the arena is the full space. ---
const PANEL_PAD = 8;
const PANEL_R = 30;
/** Top surface of the floor. Everything vertical is measured from here. */
const GROUND_Y = 520;
/** The runner never moves horizontally; the world does. */
const RUN_X = 250;
/**
 * Obstacles are born here, off the right edge. Nothing is readable before it
 * crosses the card edge at 1000, so the runway the player actually gets to
 * read is 750px whatever this is; the extra margin exists so a compound pair
 * can be committed as one unit with its tail already placed.
 */
const SPAWN_X = 1120;

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
const T_RISE = JUMP_V / G_RISE;
const AIR_MAX = T_RISE + Math.sqrt((2 * APEX) / G_FALL);
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
 * Asymptotic: always climbing, never past 900px/s.
 *
 * 380 at the gun, 598 at 30s, 726 at 60s, 841 at two minutes — where the old
 * curve was still at 604 after a full minute. 900 is where the ramp is not
 * allowed to go: an obstacle is legible for the 750px it spends on the card,
 * which at 900px/s is 0.83s, and that is REACT_MIN plus the 0.4s a hop needs
 * with nothing left over. The asymptote is never reached, so the tail of the
 * run keeps tightening without ever crossing the line.
 */
const SPEED_FROM = 380;
const SPEED_RANGE = 520;
const SPEED_HALF = 55;

// --- Spacing: the fairness rule --------------------------------------------
/**
 * Minimum reaction time the player is guaranteed between one obstacle leaving
 * and the next arriving. Everything else in this block is added on top of it.
 */
const REACT_MIN = 0.42;
/** Nothing may ever be spawned closer than this in time. See gapTimeFor(). */
const MIN_GAP_TIME = REACT_MIN + AIR_MAX;
/**
 * The runner is 2 * HW wide, so the world distance between two obstacles buys
 * 32px less free time than it looks like it does: the box is still overlapping
 * the first one after its trailing edge passes the nose. Every booked gap adds
 * this on top of the time floor, which is what makes the floor a floor on the
 * window the player actually gets rather than on a measurement between edges
 * nobody occupies.
 */
const BODY_SPAN = 2 * HW;
/**
 * Every floor is padded by this before it is booked.
 *
 * A gap is decided in seconds, committed in pixels, and then spent at whatever
 * speed the run has grown to by the time it reaches the player — which is a
 * hair faster than the estimate it was converted with. The drift is under half
 * a percent, but a floor that is only nearly held is not a floor.
 */
const GAP_DRIFT_PAD = 0.02;
/** Landing from the previous obstacle costs a beat before the next decision. */
const LAND_RECOVER = 0.12;
/** A slide has to be started from the floor, which needs its own beat. */
const SLIDE_SETUP = 0.18;
/** A no-jump stretch is only fair off a settled runway, never off a landing. */
const ROOF_SETTLE = 0.15;
/**
 * Runway to a beam, in seconds, inside which the action button stops meaning
 * "jump" and starts meaning "get under it".
 *
 * It is MIN_GAP_TIME on purpose: a jump taken any later than a full arc plus a
 * reaction cannot land and still leave the player the reaction window the whole
 * game is built on, so inside it the press could only ever have been a death.
 * A beam is the one obstacle a jump can never clear, which is why it alone gets
 * to take the button over — the player is not losing a choice here, they never
 * had one. The roof deliberately does not take it: a press under a roof has to
 * be able to kill, or restraint is not a skill.
 */
const BEAM_TAKEOVER = MIN_GAP_TIME;
/** Slack on a computed slide, so it is still down when the beam arrives. */
const SLIDE_COVER_PAD = 0.08;
/**
 * The spacing ramp, and the floor it converges onto rather than through. By
 * 95s the requested gap is 0.95s, which is under every floor gapTimeFor() can
 * produce (1.14s to 1.47s depending on the pairing), so from there on the run
 * is spaced at exactly the reaction floor and not one frame tighter.
 */
const GAP_TIME_FROM = 2.05;
const GAP_TIME_TO = 0.95;
const GAP_TIME_SECONDS = 95;
/** Jitter shrinks with the ramp: a late run is relentless, not random. */
const JITTER_FROM = 0.42;
const JITTER_TO = 0.08;

// --- Compound pairs ---------------------------------------------------------
/**
 * Execution slack inside a pair, standing in for REACT_MIN.
 *
 * A pair is not a surprise. Both halves are committed in the same spawn, they
 * share a rail on the floor, and the lead carries a badge of the verb that
 * follows it, so this window is not paying for recognition — only for the
 * second press. That is why it is allowed to be shorter than a cold reaction,
 * and why nothing else in the game is.
 */
const PAIR_REACT = 0.3;
/** Getting out of the slide pose before the jump. */
const PAIR_SLIDE_EXIT = 0.12;
/** Winding up the jump once standing. */
const PAIR_JUMP_PREP = 0.1;
/** No pair is ever tighter than this, whatever the arithmetic says. */
const PAIR_MIN_TIME = 0.5;
const PAIR_CHANCE_FROM = 0.3;
const PAIR_CHANCE_TO = 0.52;
const PAIR_CHANCE_SECONDS = 60;

// --- Obstacle sizing --------------------------------------------------------
const BLOCK_H_MIN = 40;
const BLOCK_H_MAX = 88;
const BLOCK_W_MIN = 38;
const BLOCK_W_MAX = 78;
/**
 * Time the rise needs to lift the soles over the tallest block the game may
 * commit. A block is cleared from above, so the press that answers one has to
 * happen this far ahead of its leading edge — the reaction window is only what
 * is left after paying it, which is why every gap that ends in a block books
 * it separately instead of hoping REACT_MIN absorbs it.
 */
const BLOCK_RISE_MAX = riseTimeTo(BLOCK_H_MAX);
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
/**
 * Roof clearance, and the whole idea of the third answer.
 *
 * A standing runner is 78 tall and goes under with 18px to spare, so doing
 * nothing is free. The jump leaves the floor at 1000px/s and spends that 18px
 * in under two frames, so any jump at all is fatal — there is no half-measure
 * to hunt for. The skill is keeping the thumb still while a wall of amber
 * comes at you, which costs no new input and is the only thing in the game
 * that punishes acting instead of failing to act.
 */
const ROOF_CLEAR = 96;
/** Sized in seconds spent underneath, so it stays a stretch and not a slab. */
const ROOF_TIME_MIN = 0.55;
const ROOF_TIME_MAX = 1;
const ROOF_W_MIN = 220;
const ROOF_W_MAX = 620;
/** Runway ahead of a roof at which the approach warning fires, in seconds. */
const ROOF_WARN_LEAD = 0.9;

// --- Coins ------------------------------------------------------------------
const COIN_R = 11;
/** Added to the radius for the pickup test. Being on the line is enough. */
const COIN_GRAB = 8;
/** Coins ride this far above the soles: dead centre of a standing body. */
const COIN_RIDE = 38;
const COIN_ARC_MAX = 8;
/** Fewer than this and the line is a stub not worth committing a jump to. */
const COIN_ARC_MIN = 4;
/**
 * First sample on an arc. By 0.09s the soles are already 80px up, so no part
 * of an arc can be swept up by simply running underneath it — an arc is only
 * ever paid to a jump that was actually committed.
 */
const COIN_T0 = 0.09;
const COIN_LINE_STEP = 62;
/** Coins stop this far short of the next obstacle's leading edge. */
const COIN_GATE_PAD = 70;
/**
 * Runway an arc must leave between where it puts the runner back on the floor
 * and the next obstacle: a landing, the slide setup in case that obstacle is a
 * beam, and a full reaction on top.
 *
 * Without it a coin line could be laid across a gap that is long enough to fly
 * but not long enough to fly AND answer what comes next, which is the one way
 * an optional pickup could still take a run — the player did nothing wrong, the
 * line did.
 */
const COIN_LAND_MARGIN = LAND_RECOVER + SLIDE_SETUP + REACT_MIN;
/** Obstacles are inflated by this before an arc is tested against them. */
const COIN_SAFE_PAD = 14;
const COIN_ARC_CHANCE = 0.62;
const COIN_OPEN_CHANCE = 0.22;
const COIN_BEAM_CHANCE = 0.5;
const COIN_VALUE = 22;
/** Multiplier band. Every skim and every coin is scaled by it. */
const MULT_MAX = 3;
const MULT_GAIN = 0.16;
/** Per second, once the hold has lapsed. Two skipped arcs and it is gone. */
const MULT_DECAY = 0.26;
/** Grace after a pickup, so an arc is not already bleeding as it is collected. */
const MULT_HOLD = 0.9;

// --- Difficulty stages ------------------------------------------------------
const STAGE_SECONDS = 15;
const STAGE_BEAMS = 1;
const STAGE_PITS = 2;
const STAGE_ROOFS = 3;
const STAGE_PAIRS = 4;
const ROOF_CHANCE = 0.16;
const STAGE_NAMES: readonly string[] = [
  "DASH",
  "LOW BEAMS",
  "PITFALLS",
  "LOW ROOF",
  "LINKED",
  "FULL SPEED",
  "NO MERCY",
];
const STAGE_SUBS: readonly string[] = [
  "HOLD THE JUMP FOR HEIGHT - COINS RIDE THE FULL ARC",
  "SLIDE UNDER: DOWN ARROW, OR TAP AS IT NEARS",
  "MIND THE HOLES",
  "AMBER ROOF - DO NOT JUMP, JUST RUN",
  "TWO IN A ROW - THE RAIL MARKS THE PAIR",
  "IT ONLY GETS FASTER",
  "STILL RUNNING",
];
const BANNER_TIME = 2.1;
const BANNER_W = 560;
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
/** Paid for running a whole roof out without flinching. */
const NERVE_BONUS = 30;
/** Paid for clearing both halves of a compound pair. */
const LINK_BONUS = 40;
/** Combo lapses if a whole obstacle goes by without a skim. */
const COMBO_DECAY = 4;

// --- Multiplier gauge -------------------------------------------------------
const GAUGE_X = 44;
const GAUGE_Y = 638;
const GAUGE_W = 190;
const GAUGE_H = 10;

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
  const riseAbove = T_RISE - tUp;
  const fallAbove = Math.sqrt((2 * (APEX - h)) / G_FALL);
  return riseAbove + fallAbove;
}

/** Seconds the rise takes to put the soles above `h`. Solves the same quadratic
 *  as airTimeAbove, but for the near edge of the window rather than its width. */
function riseTimeTo(h: number): number {
  const disc = JUMP_V * JUMP_V - 2 * G_RISE * h;
  return (JUMP_V - Math.sqrt(Math.max(0, disc))) / G_RISE;
}

/**
 * Height of the soles above the floor `t` seconds into a full, uncut jump.
 *
 * Coin arcs are sampled straight off this, which is the whole trick behind
 * them: a coin line is a drawing of a trajectory the runner can actually fly,
 * not a decoration laid over one.
 */
function arcHeight(t: number): number {
  if (t <= T_RISE) return JUMP_V * t - 0.5 * G_RISE * t * t;
  const f = t - T_RISE;
  return APEX - 0.5 * G_FALL * f * f;
}

/**
 * DASH RUN, endless side-scrolling runner.
 *
 * The runner is pinned at RUN_X and the world scrolls past. There are three
 * answers — jump it, slide under it, or hold still and let the roof pass over
 * you — plus one optional question, the coin arcs, which are the only thing in
 * the game that asks for a bigger jump than survival needs.
 *
 * The entire design effort is in guaranteeing the answer is available in time.
 * See gapTimeFor() and pairGapTime() for the spacing floors, the size clamps in
 * shapeObstacle() for the shapes, and bodySafeAt() for the coins: nothing is
 * ever committed that the speed it arrives at cannot clear.
 */
export class RunnerGame extends BaseGame {
  private readonly obstacles = createObstaclePool(12);
  private readonly coins = createCoinPool(48);
  /** Scratch rects for the kill test. Mutated in place, never re-created. */
  private readonly rBody: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly rObs: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** Full body box, no forgiveness inset: pickups should be generous. */
  private readonly rPick: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly cCoin: Circle = { x: 0, y: 0, r: COIN_R + COIN_GRAB };
  /** Candidate coin line, held here until every sample has been verified. */
  private readonly arcX = new Float64Array(COIN_ARC_MAX);
  private readonly arcY = new Float64Array(COIN_ARC_MAX);
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
    { label: "MULT", value: "x1.0", highlight: true },
    { label: "COMBO", value: "-" },
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
  private coinCursor = 0;
  /** Floor distance still to travel before the next obstacle is born. */
  private toNextSpawn = 0;
  private lastKind: ObstacleKind = KIND_BLOCK;
  /** Decided one spawn ahead: the gap being booked has two ends, not one. */
  private nextKind: ObstacleKind = KIND_BLOCK;
  /** Rolling id so a pair lead can find its own tail without a map. */
  private group = 0;

  // --- Score ---------------------------------------------------------------
  private bonus = 0;
  private combo = 0;
  private comboTimer = 0;
  private comboLabel = "";
  private popText = "";
  private popTimer = 0;
  /** Live score multiplier, fed by coins and bled by ignoring them. */
  private mult = 1;
  private multHold = 0;
  private multLabel = "x1.0";
  /** Last values the HUD strings were built from. See hudStats(). */
  private metersShown = -1;
  private multShown = -1;

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
    super(services, 560);
  }

  protected onReset(): void {
    for (let i = 0; i < this.obstacles.length; i++) this.obstacles[i].active = false;
    for (let i = 0; i < this.coins.length; i++) this.coins[i].active = false;
    this.poolCursor = 0;
    this.coinCursor = 0;
    this.group = 0;

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
    // A short runway on top of the ~2.3s an obstacle needs to travel in from
    // SPAWN_X. OPENING_GRACE is covered several times over.
    this.toNextSpawn = SPEED_FROM * 0.35;
    this.lastKind = KIND_BLOCK;
    this.nextKind = KIND_BLOCK;

    this.bonus = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboLabel = "";
    this.popText = "";
    this.popTimer = 0;
    this.mult = 1;
    this.multHold = 0;
    this.multLabel = "x1.0";
    // -1 forces both labels to rebuild on the first frame of the new run.
    this.metersShown = -1;
    this.multShown = -1;

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
    this.stats[1].value = this.multLabel;
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
    this.decayMult(dt);
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

  /**
   * The speed the obstacle being spawned right now will actually be met at.
   *
   * Sizing against the current speed would quietly shave the reaction window,
   * because the run is faster by the time the shape arrives. `extra` pushes the
   * estimate further out for the second half of a pair.
   */
  private arrivalSpeed(extra: number): number {
    const travel = (SPAWN_X - RUN_X) / this.speed;
    return this.speedAt(this.elapsed + travel + extra);
  }

  /**
   * Speed used for every size clamp, deliberately shaded low. Under-estimating
   * narrows blocks, beams and pits, so the error can only ever make a shape
   * easier to clear than the arithmetic promised.
   */
  private sizingSpeed(): number {
    return this.arrivalSpeed(0) * 0.97;
  }

  /**
   * Speed used to turn gap times into pixels, deliberately shaded high: a gap
   * measured against a faster run is a longer gap, so the error can only ever
   * hand the player more room than the floor demands.
   */
  private gapSpeed(): number {
    return this.arrivalSpeed(1.2);
  }

  private decayMult(dt: number): void {
    if (this.multHold > 0) {
      this.multHold -= dt;
    } else if (this.mult > 1) {
      this.mult = Math.max(1, this.mult - MULT_DECAY * dt);
    }
    const shown = Math.round(this.mult * 10);
    if (shown !== this.multShown) {
      this.multShown = shown;
      this.multLabel = "x" + (shown / 10).toFixed(1);
    }
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
    const warnAt = RUN_X + this.speed * ROOF_WARN_LEAD;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active) continue;
      o.x -= step;
      // The roof is the only obstacle whose answer is to do nothing, so it is
      // the only one that gets a sound of its own on approach: by the time it
      // is close enough to read, the instinct has already fired.
      if (o.kind === KIND_CEIL && !o.warned && o.x < warnAt) {
        o.warned = true;
        this.audio.play("warn", 0.62, 0.5);
      }
      // Kept alive well past the runner so the near-miss payout has already
      // resolved before the slot is recycled.
      if (o.x + o.w < -120) o.active = false;
    }
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (!c.active) continue;
      c.x -= step;
      if (c.x < -40) c.active = false;
    }

    this.toNextSpawn -= step;
    if (this.toNextSpawn <= 0) this.spawnObstacle();
  }

  /**
   * Spawns the next challenge: one obstacle, or a compound pair committed as a
   * single unit, plus whatever coin line decorates it.
   *
   * Both halves of a pair are placed here rather than one now and one later,
   * because the gap between them is derived from the speed at this instant —
   * deciding the tail separately would measure it against a different number.
   */
  private spawnObstacle(): void {
    const lead = this.acquire();
    if (!lead) {
      // Pool exhausted (impossible at these gaps, but a dropped spawn is
      // better than recycling something still on screen). Try again shortly.
      this.toNextSpawn = 300;
      return;
    }

    const sw = this.sizingSpeed();
    const sg = this.gapSpeed();
    const st = this.curStage;
    // Rolled one spawn early. The runway booked at the bottom is the gap
    // between THIS obstacle and the one after it, so both ends have to be known
    // before it can be measured — deciding only one end put the slide-setup
    // beat on the wrong gap, and "pit then beam" lost its 0.18s.
    const kind = this.nextKind;
    this.shapeObstacle(lead, kind, sw, st);

    const tailKind = this.pairPartner(kind, st);
    if (tailKind !== -1) {
      const tail = this.acquire();
      if (tail) {
        const gapT = this.pairGapTime(kind, tailKind, lead.w, sg);
        this.shapeObstacle(tail, tailKind, sw, st);
        tail.x = SPAWN_X + lead.w + BODY_SPAN + sg * gapT;
        this.group++;
        lead.link = LINK_LEAD;
        lead.group = this.group;
        lead.linkKind = tailKind;
        tail.link = LINK_TAIL;
        tail.group = this.group;
        tail.linkKind = kind;
        this.lastKind = tailKind;
        this.nextKind = this.pickKind(st);
        this.toNextSpawn =
          tail.x - SPAWN_X + tail.w + BODY_SPAN + sg * this.gapTimeFor(tailKind, this.nextKind);
        this.spawnCoinsFor(lead, sw, tail.x);
        this.spawnCoinsFor(tail, sw, SPAWN_X + this.toNextSpawn);
        return;
      }
    }

    // pickKind reads lastKind for its beam bias, so the roll happens after the
    // just-spawned kind is recorded, not before it.
    this.lastKind = kind;
    this.nextKind = this.pickKind(st);
    this.toNextSpawn = lead.w + BODY_SPAN + sg * this.gapTimeFor(kind, this.nextKind);
    this.spawnCoinsFor(lead, sw, SPAWN_X + this.toNextSpawn);
  }

  /**
   * Sizes one obstacle against the speed it will actually be met at.
   *
   * Every clamp in here is a fairness guarantee, not decoration: the limits are
   * derived from the real jump arc, the real slide duration and the real
   * standing height, so a shape that cannot be answered is never committed.
   */
  private shapeObstacle(o: Obstacle, kind: ObstacleKind, s: number, st: number): void {
    o.active = true;
    o.kind = kind;
    o.x = SPAWN_X;
    o.minClear = Infinity;
    o.scored = false;
    o.phase = randRange(0, TAU);
    o.tint = 0;
    o.link = LINK_NONE;
    o.group = 0;
    o.linkKind = kind;
    o.warned = false;

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
    } else if (kind === KIND_CEIL) {
      o.h = ROOF_CLEAR;
      // Length is a duration, not a distance: at any speed a roof is the same
      // number of seconds of holding still, which is what it actually costs.
      o.w = clamp(s * randRange(ROOF_TIME_MIN, ROOF_TIME_MAX), ROOF_W_MIN, ROOF_W_MAX);
    } else {
      // A pit may only claim a slice of the arc, so the take-off point is a
      // window rather than a frame.
      const budget = AIR_MAX * s * PIT_CROSS_SAFETY;
      o.w = widthWithin(PIT_W_MIN, PIT_W_MAX, budget);
      o.h = 0;
    }
  }

  /**
   * Runway, in seconds, between the obstacle just spawned and the next one.
   *
   * The ramp makes the run tighten over time; the floor underneath it is the
   * rule the ramp is never allowed to break — a full jump arc plus a reaction
   * window, plus whatever this particular pairing costs on top.
   */
  private gapTimeFor(prev: ObstacleKind, next: ObstacleKind): number {
    let floor = MIN_GAP_TIME + GAP_DRIFT_PAD;
    // After a block or a pit the player may still be in the air; they have to
    // land before they can answer the next thing at all. A beam or a roof is
    // run through on the floor, so neither owes that beat.
    if (prev === KIND_BLOCK || prev === KIND_PIT) floor += LAND_RECOVER;
    // A pit is the one obstacle whose answer may legally be a whole coyote
    // window late — off the lip the jump still registers, and the entire arc
    // shifts with it. MIN_GAP_TIME measures from an obstacle's edge, so that
    // shift is unpaid for unless it is booked here. pairGapTime has always
    // charged it; the singles path silently did not, which put the tightest
    // "pit then block" a frame or two inside the reaction floor it advertises.
    if (prev === KIND_PIT) floor += COYOTE;
    // A block has to be crossed from above, so the answer has to be in the air
    // before the leading edge arrives, not merely decided by then.
    if (next === KIND_BLOCK) floor += BLOCK_RISE_MAX;
    // A slide has to be started from the floor, so a beam needs its own beat
    // on top. This is what stops "pit then beam" from being unanswerable.
    if (next === KIND_BEAM) floor += SLIDE_SETUP;
    // A roof has to be entered already settled: arriving mid-arc would kill a
    // player who did everything right on the obstacle before it.
    if (next === KIND_CEIL) floor += ROOF_SETTLE;
    const ramp =
      rampLinear(this.elapsed, GAP_TIME_FROM, GAP_TIME_TO, GAP_TIME_SECONDS) +
      randRange(0, rampLinear(this.elapsed, JITTER_FROM, JITTER_TO, GAP_TIME_SECONDS));
    return Math.max(floor, ramp);
  }

  /**
   * Gap inside a compound pair, in seconds from the lead's trailing edge to the
   * tail's leading edge. Tighter than gapTimeFor, and derived rather than
   * guessed.
   *
   * Jump first: the worst case is a take-off at the very leading edge of the
   * lead, so the runner is airborne for the whole AIR_MAX and lands
   * AIR_MAX * s further on, having already spent `leadW` of the gap in the air.
   * What is left has to cover the landing, the pose change if the tail is a
   * beam, and the press:
   *     leadW / s + T - AIR_MAX - COYOTE >= LAND_RECOVER + SLIDE_SETUP + PAIR_REACT
   * COYOTE is in there because the latest take-off is not the leading edge: off
   * a pit lip the jump still registers a tenth of a second later, and the whole
   * arc shifts with it. Charging every jump-first pair for it costs one frame
   * of tension on the blocks and removes an entire class of unclearable pit
   * pairs, which is a trade worth making twice over.
   *
   * Slide first: a jump can be taken straight out of the slide pose (startJump
   * ends the slide), so all the gap has to buy is the pose change and the press.
   */
  private pairGapTime(lead: ObstacleKind, tail: ObstacleKind, leadW: number, s: number): number {
    if (lead === KIND_BEAM) {
      return Math.max(
        PAIR_MIN_TIME,
        PAIR_SLIDE_EXIT + PAIR_REACT + PAIR_JUMP_PREP + GAP_DRIFT_PAD
      );
    }
    const t =
      AIR_MAX +
      COYOTE +
      GAP_DRIFT_PAD +
      LAND_RECOVER +
      PAIR_REACT +
      (tail === KIND_BEAM ? SLIDE_SETUP : 0) +
      // The second press is not the end of it when the tail is a block: the
      // arc still has to be above it before its leading edge lands, and that
      // rise is the difference between a tight pair and an uncrossable one.
      // The slide-first branch already pays this as PAIR_JUMP_PREP; this one
      // was reading the tail's kind for the beam beat and not for this.
      (tail === KIND_BLOCK ? BLOCK_RISE_MAX : 0) -
      leadW / s;
    return Math.max(PAIR_MIN_TIME, t);
  }

  /**
   * Partner kind for a compound pair, or -1 for a plain single.
   *
   * Pairs only ever chain two different verbs or two different shapes; two
   * identical blocks back to back is a rhythm, not a decision. The roof is
   * never part of one: its whole content is a long stretch of doing nothing,
   * and bolting a second beat onto it would just be a normal gap.
   */
  private pairPartner(lead: ObstacleKind, st: number): ObstacleKind | -1 {
    if (st < STAGE_PAIRS || lead === KIND_CEIL) return -1;
    const chance = rampLinear(
      this.elapsed - STAGE_PAIRS * STAGE_SECONDS,
      PAIR_CHANCE_FROM,
      PAIR_CHANCE_TO,
      PAIR_CHANCE_SECONDS
    );
    if (Math.random() > chance) return -1;
    // Slide then jump: the tightest pair in the game, and the only one whose
    // two halves are on screen together.
    if (lead === KIND_BEAM) return Math.random() < 0.6 ? KIND_BLOCK : KIND_PIT;
    // Jump then slide, or two hops off different shapes.
    if (Math.random() < 0.55) return KIND_BEAM;
    return lead === KIND_BLOCK ? KIND_PIT : KIND_BLOCK;
  }

  /** Weighted kind roll. Variety unlocks in stages, like the other games. */
  private pickKind(st: number): ObstacleKind {
    if (st < STAGE_BEAMS) return KIND_BLOCK;
    if (st < STAGE_PITS) return Math.random() < 0.62 ? KIND_BLOCK : KIND_BEAM;
    // Two roofs in a row would be one long roof with a seam in it.
    if (st >= STAGE_ROOFS && this.lastKind !== KIND_CEIL && Math.random() < ROOF_CHANCE) {
      return KIND_CEIL;
    }
    const r = Math.random();
    // Two blocks in a row is fine; two beams in a row is a rhythm the player
    // solves once, so a beam biases the next roll away from itself.
    if (this.lastKind === KIND_BEAM) return r < 0.6 ? KIND_BLOCK : KIND_PIT;
    if (r < 0.42) return KIND_BLOCK;
    if (r < 0.72) return KIND_BEAM;
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

  // --- Coins ---------------------------------------------------------------

  /**
   * Decides what, if anything, a freshly spawned obstacle is worth collecting
   * over. `gateX` is where the next obstacle's leading edge will be, in today's
   * screen coordinates — coin lines are not allowed to reach it.
   */
  private spawnCoinsFor(o: Obstacle, s: number, gateX: number): void {
    const r = Math.random();
    if (o.kind === KIND_CEIL) {
      // The reward for restraint, and a second telegraph: the coins sit at
      // running height, so the line itself says the answer is to keep running.
      this.spawnLine(o.x + 40, o.x + o.w - 40, STAND_H);
      return;
    }
    if (o.kind === KIND_BEAM) {
      if (r < COIN_BEAM_CHANCE) this.spawnLine(o.x + 24, o.x + o.w - 24, SLIDE_H);
      return;
    }
    if (r < COIN_ARC_CHANCE) {
      // Apex over the middle of the shape. Both halves of the arc then hang
      // outside it, which is exactly the line a committed jump flies.
      this.spawnArc(o.x + o.w * 0.5 - s * T_RISE, s, gateX);
      return;
    }
    if (r < COIN_ARC_CHANCE + COIN_OPEN_CHANCE) {
      // Out in the open, where nothing forces a jump at all. This is the only
      // coin line in the game that is pure appetite, so it is also the one that
      // has to prove it fits: the take-off window runs from a landing beat
      // after the obstacle behind it to the last point whose whole arc still
      // clears COIN_LAND_MARGIN before the obstacle ahead.
      const from = o.x + o.w + s * LAND_RECOVER;
      const to = gateX - s * (COIN_LAND_MARGIN + AIR_MAX);
      if (to > from) this.spawnArc((from + to) * 0.5, s, gateX);
    }
  }

  /**
   * Lays coins along the real jump arc from a take-off at `takeoffX`.
   *
   * Every sample is checked as a body, not as a point: bodySafeAt asks whether
   * a runner whose soles are on the arc at that instant clears everything on
   * the field. One failed sample throws the whole line away rather than
   * trimming it, because a coin the player takes is a commitment to the rest of
   * the arc — half a safe line is an invitation into the half that is not.
   */
  private spawnArc(takeoffX: number, s: number, gateX: number): void {
    if (takeoffX < RUN_X + 200) return;
    // The line advertises a full arc, so the full arc has to end early enough
    // to answer whatever comes next. Enforced here rather than at each call
    // site, so no future caller can route around it.
    if (takeoffX + s * (AIR_MAX + COIN_LAND_MARGIN) > gateX) return;
    const step = (AIR_MAX - COIN_T0 * 2) / (COIN_ARC_MAX - 1);
    let n = 0;
    for (let i = 0; i < COIN_ARC_MAX; i++) {
      const t = COIN_T0 + i * step;
      const x = takeoffX + s * t;
      if (x > gateX - COIN_GATE_PAD) break;
      const feet = GROUND_Y - arcHeight(t);
      if (!this.bodySafeAt(x, feet, STAND_H)) return;
      this.arcX[n] = x;
      this.arcY[n] = feet - COIN_RIDE;
      n++;
    }
    if (n < COIN_ARC_MIN) return;
    for (let i = 0; i < n; i++) this.placeCoin(this.arcX[i], this.arcY[i]);
  }

  /**
   * Flat line of coins at body height on the floor, for the two obstacles that
   * are answered without leaving it. Same verification as an arc: the pose that
   * collects them has to fit everywhere the line goes.
   */
  private spawnLine(from: number, to: number, bodyH: number): void {
    const span = to - from;
    if (span < COIN_LINE_STEP) return;
    const n = Math.min(COIN_ARC_MAX, Math.max(2, Math.round(span / COIN_LINE_STEP) + 1));
    const step = span / (n - 1);
    const y = GROUND_Y - bodyH * 0.5;
    for (let i = 0; i < n; i++) {
      const x = from + i * step;
      if (!this.bodySafeAt(x, GROUND_Y, bodyH)) return;
      this.arcX[i] = x;
    }
    for (let i = 0; i < n; i++) this.placeCoin(this.arcX[i], y);
  }

  /**
   * True when a runner of `bodyH` with its soles at `feetY` would be clear of
   * everything on the field at `x`, with COIN_SAFE_PAD to spare.
   *
   * This is the guarantee behind every coin: the line is only laid where the
   * body that would be collecting it fits. Obstacles are inflated rather than
   * measured exactly, so "just barely fits" never becomes a coin.
   */
  private bodySafeAt(x: number, feetY: number, bodyH: number): boolean {
    const left = x - HW - COIN_SAFE_PAD;
    const right = x + HW + COIN_SAFE_PAD;
    const top = feetY - bodyH - COIN_SAFE_PAD;
    const bottom = feetY + COIN_SAFE_PAD;
    if (top < PANEL_PAD + 12) return false;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active) continue;
      if (right < o.x || left > o.x + o.w) continue;
      if (o.kind === KIND_BLOCK) {
        if (bottom > GROUND_Y - o.h) return false;
      } else if (o.kind === KIND_BEAM || o.kind === KIND_CEIL) {
        if (top < GROUND_Y - o.h) return false;
      } else if (bottom > GROUND_Y - 24) {
        // Floor height over a hole: the line would be drawing a run into it.
        return false;
      }
    }
    return true;
  }

  private placeCoin(x: number, y: number): void {
    const n = this.coins.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.coinCursor + i) % n;
      const c = this.coins[idx];
      if (c.active) continue;
      this.coinCursor = (idx + 1) % n;
      c.active = true;
      c.x = x;
      c.y = y;
      c.phase = randRange(0, TAU);
      return;
    }
  }

  /** Uses the un-inset body box: a pickup should be easier than a hit. */
  private collectCoins(): void {
    const c = this.cCoin;
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      if (!coin.active) continue;
      if (coin.x < RUN_X - 60 || coin.x > RUN_X + 60) continue;
      c.x = coin.x;
      c.y = coin.y;
      if (!circleRectHit(c, this.rPick)) continue;
      coin.active = false;
      this.takeCoin(coin.x, coin.y);
    }
  }

  private takeCoin(x: number, y: number): void {
    this.mult = Math.min(MULT_MAX, this.mult + MULT_GAIN);
    this.multHold = MULT_HOLD;
    const gain = Math.round(COIN_VALUE * this.mult);
    this.bonus += gain;
    this.popText = "+" + gain;
    this.popTimer = 0.6;
    // Pitch rides the multiplier, so a full arc audibly climbs as it is eaten.
    this.audio.play("score", 0.85 + this.mult * 0.3, 0.38);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + randRange(-0.3, 0.3);
      const sp = randRange(80, 210);
      this.puff(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp - 40,
        randRange(0.22, 0.4),
        randRange(2, 3.6),
        0,
        i % 2 === 0 ? COIN_FILL : COIN_CORE,
        "circle",
        0.22
      );
    }
    this.puff(x, y, 0, 0, 0.26, 5, 0, COIN_FILL, "ring", 1);
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
   * must never turn the jump that clears the pit into a slide into it — and a
   * beam behind a roof must never be the reason a press under the roof was
   * survivable, because under a roof a press has to mean what it says.
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
      //
      // The hold is admitted as a press once a beam owns the button, and only
      // then. A held key produces no further edges, so a player who pressed
      // Down before the beam existed is stood up by the cap below and can never
      // get back down without releasing first — they hold SLIDE, watch the slab
      // arrive, and die with the right key under their thumb. Inside the
      // takeover window the hold means what it obviously means; outside it the
      // cap still denies a permanent crouch, which is the only thing the cap
      // was ever for.
      if ((downEdge || (downHeld && beam >= 0)) && !this.sliding) {
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
    // Leaving under your own power un-commits the fall. The latch is armed by
    // the first frame the soles dip below the floor line over a hole, which is
    // one frame after running off the lip — so without this every coyote-time
    // jump off a pit but the very first frame's was fatal: the leap read as
    // clean, cleared the hole, and then died in mid-air over solid ground
    // because the land test is gated on the latch. Coyote time exists to make
    // exactly that press work.
    this.pitFall = -1;
    // A duck books its slide for the next landing. Jumping instead retracts
    // that request: off a pit lip the coyote window lets a duck and a jump both
    // land inside the same airborne stretch, and the landing should not then
    // owe a slide nobody is still asking for.
    this.pendingSlide = 0;
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

  // --- Collision, near misses and payouts ----------------------------------

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
    // The pickup box is the body as drawn, not as collided: coins are the one
    // thing the player should get the benefit of the doubt on.
    const pick = this.rPick;
    pick.x = RUN_X - HW;
    pick.w = HW * 2;
    pick.y = this.feetY - h;
    pick.h = h;
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
        } else if (o.kind === KIND_BEAM) {
          obs.x = o.x;
          obs.y = GROUND_Y - BEAM_TOP_H;
          obs.w = o.w;
          obs.h = BEAM_TOP_H - o.h;
        } else {
          // The roof goes all the way to the top of the card: there is no
          // going over it, which is the entire reason it exists.
          obs.x = o.x;
          obs.y = PANEL_PAD;
          obs.w = o.w;
          obs.h = GROUND_Y - o.h - PANEL_PAD;
        }
        if (!grace && rectHit(body, obs)) {
          this.crash(
            i,
            o.kind === KIND_BLOCK
              ? "HIT A BLOCK"
              : o.kind === KIND_BEAM
                ? "HIT A BEAM"
                : "JUMPED INTO THE ROOF"
          );
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
      } else if (o.kind !== KIND_CEIL && body.x < o.x + o.w && body.x + body.w > o.x) {
        // Smallest vertical gap seen while the two boxes overlapped: over the
        // top of a block, or above the lip of a pit.
        const clear = o.kind === KIND_BLOCK ? GROUND_Y - o.h - bodyBottom : GROUND_Y - bodyBottom;
        if (clear < o.minClear) o.minClear = clear;
      }

      if (!o.scored && o.x + o.w < RUN_X - HW) {
        o.scored = true;
        if (o.kind === KIND_CEIL) {
          // Nothing to skim: the whole skill was in the press that never came,
          // so surviving the stretch is the payout condition.
          this.payClear(o, "NERVE", NERVE_BONUS);
        } else {
          const limit = o.kind === KIND_BEAM ? NEAR_LEAD : NEAR_GAP;
          if (o.minClear >= 0 && o.minClear < limit) this.payClear(o, "", 0);
        }
        if (o.link === LINK_TAIL) this.payLink();
      }
    }
    this.slideStarted = false;
    this.collectCoins();
  }

  /**
   * Single payout path for a clean pass, so the combo has one owner.
   * `flat` overrides the near-miss scale for rewards that are not about
   * millimetres, i.e. the roof.
   */
  private payClear(o: Obstacle, label: string, flat: number): void {
    this.combo++;
    this.comboTimer = COMBO_DECAY;
    this.comboLabel = "x" + this.combo;
    const base =
      flat > 0 ? flat : NEAR_BASE + NEAR_PER_COMBO * Math.min(this.combo - 1, NEAR_COMBO_CAP);
    const gain = Math.round(base * this.mult);
    this.bonus += gain;
    this.popText = label ? label + " +" + gain : "+" + gain;
    this.popTimer = 0.75;

    // Chips thrown backward along the obstacle, so the skim reads as the thing
    // passing the runner rather than as an impact.
    const y = o.kind === KIND_BLOCK || o.kind === KIND_PIT ? this.feetY : this.feetY - this.bodyH();
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

  /** Paid once, on the tail of a pair, for solving both halves of it. */
  private payLink(): void {
    const gain = Math.round(LINK_BONUS * this.mult);
    this.bonus += gain;
    this.popText = "LINK +" + gain;
    this.popTimer = 0.85;
    this.audio.play("success", 1.1, 0.5);
    for (let i = 0; i < 10; i++) {
      this.puff(
        RUN_X + randRange(-16, 16),
        this.feetY - this.bodyH() * 0.5,
        randRange(-260, -60),
        randRange(-170, 30),
        randRange(0.3, 0.5),
        randRange(2.4, 4.4),
        0,
        i % 2 === 0 ? ACCENT : ACCENT_DARK,
        "square",
        0.3,
        randRange(0, TAU)
      );
    }
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
    this.drawLinks(g);
    this.drawObstacles(g);
    this.drawCoins(g);
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

    const fade = this.runFade();
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active) continue;
      // Pits are punched through afterwards so they cut the line and the ticks,
      // and the roof paints its floor band the same way — the ground half of
      // the no-jump telegraph, so the warning is under the feet as well as
      // over the head.
      if (o.kind === KIND_PIT) this.drawPit(g, o, bottom);
      else if (o.kind === KIND_CEIL && fade > 0) this.drawRoofZone(g, o, fade);
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

  /** Amber hatching painted on the floor for the length of a roof stretch. */
  private drawRoofZone(g: CanvasRenderingContext2D, o: Obstacle, fade: number): void {
    g.save();
    g.globalAlpha = fade;
    g.fillStyle = C_ROOF_ZONE;
    g.fillRect(o.x, GROUND_Y + 4, o.w, 22);
    g.save();
    g.beginPath();
    g.rect(o.x, GROUND_Y + 4, o.w, 22);
    g.clip();
    g.strokeStyle = C_ROOF_ZONE_LINE;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = o.x - 22; x < o.x + o.w + 22; x += 22) {
      g.moveTo(x, GROUND_Y + 28);
      g.lineTo(x + 18, GROUND_Y + 2);
    }
    g.stroke();
    g.restore();
    g.restore();
  }

  /**
   * The rail that says two obstacles are one challenge.
   *
   * Drawn in the floor band under both halves, with a verb glyph on each: an up
   * arrow for the ones you leave the ground for, a down arrow for the beam. The
   * tail of a pair is often still off the right edge when the lead arrives —
   * the gap is longer than the visible runway at speed — so the rail running
   * off the edge with a glyph on its end IS the telegraph, not a decoration of
   * one.
   */
  private drawLinks(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;
    // Anchored on the tail, not the lead. The lead is recycled once it is well
    // behind the runner, and that happens before the far half of a wide pair
    // has even arrived — a rail that vanished there would drop the marking off
    // the exact obstacle it was drawn to warn about.
    for (let i = 0; i < this.obstacles.length; i++) {
      const tail = this.obstacles[i];
      if (!tail.active || tail.link !== LINK_TAIL) continue;
      const endX = tail.x + tail.w;
      // Off the left edge when the lead is already gone, so the rail still
      // reads as something that started before the visible half.
      let startX = -200;
      let leadX = -1;
      for (let j = 0; j < this.obstacles.length; j++) {
        const lead = this.obstacles[j];
        if (lead.active && lead.link === LINK_LEAD && lead.group === tail.group) {
          startX = lead.x;
          leadX = lead.x + lead.w * 0.5;
          break;
        }
      }
      if (endX < -60 || startX > this.width + 60) continue;
      // The tail is usually still off the right edge: at speed the pair gap is
      // longer than the visible runway, so the badge is parked at the border
      // and that is what announces the second half before it can be seen.
      const glyphX = Math.min(tail.x + tail.w * 0.5, this.width - 34);

      g.save();
      g.globalAlpha = fade;
      g.fillStyle = C_LINK_SOFT;
      roundRect(g, startX, GROUND_Y + 30, endX - startX, 22, 11);
      g.fill();

      // Chevrons pointing at the second half, skipped over any open hole. The
      // rail can be twice the width of the card while the tail is still out
      // there, so the run is clipped to what can actually be seen.
      g.strokeStyle = C_LINK;
      g.lineWidth = 2.5;
      g.lineJoin = "round";
      g.beginPath();
      const from = Math.max(startX + 22, -20);
      const to = Math.min(endX - 14, this.width + 20);
      for (let x = from; x < to; x += 34) {
        if (this.overPit(x)) continue;
        g.moveTo(x - 4, GROUND_Y + 35);
        g.lineTo(x + 4, GROUND_Y + 41);
        g.lineTo(x - 4, GROUND_Y + 47);
      }
      g.stroke();
      g.restore();

      if (leadX >= 0) this.drawVerbGlyph(g, leadX, tail.linkKind, fade);
      this.drawVerbGlyph(g, glyphX, tail.kind, fade);
    }
  }

  /** True when x sits over an open pit, so the rail can skip it. */
  private overPit(x: number): boolean {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind !== KIND_PIT) continue;
      if (x > o.x - 6 && x < o.x + o.w + 6) return true;
    }
    return false;
  }

  /** Small disc on the rail: up arrow to leave the floor, down arrow to hug it. */
  private drawVerbGlyph(
    g: CanvasRenderingContext2D,
    x: number,
    kind: ObstacleKind,
    fade: number
  ): void {
    const y = GROUND_Y + 41;
    g.save();
    g.globalAlpha = fade;
    g.fillStyle = C_WHITE;
    g.beginPath();
    g.arc(x, y, 12, 0, TAU);
    g.fill();
    g.strokeStyle = C_LINK;
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = ACCENT_DARK;
    g.lineWidth = 3;
    g.lineCap = "round";
    g.lineJoin = "round";
    const dir = kind === KIND_BEAM ? 1 : -1;
    g.beginPath();
    g.moveTo(x - 6, y + 2 * dir);
    g.lineTo(x, y - 4 * dir);
    g.lineTo(x + 6, y + 2 * dir);
    g.stroke();
    g.restore();
  }

  private drawObstacles(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;
    // Cues only while the verbs are still new. A permanent arrow over every
    // block would be noise by the second minute. The roof is the exception:
    // its cue never fades, because the instinct it is fighting never does.
    const cue = clamp(1 - (this.elapsed - 18) / 8, 0, 1);

    g.save();
    g.globalAlpha = fade;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (!o.active || o.kind === KIND_PIT) continue;
      if (o.x > this.width + 60 || o.x + o.w < -60) continue;
      if (o.kind === KIND_BLOCK) this.drawBlock(g, o, cue, fade);
      else if (o.kind === KIND_BEAM) this.drawBeam(g, o, cue, fade);
      else this.drawRoof(g, o, fade);
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
   * The roof. Everything about it is deliberately unlike the other three: no
   * candy gloss, no face, no rounded friendliness — a flat amber slab wearing
   * ink hazard tape on the edge that kills, hanging off the top of the card so
   * there is visibly nothing above it to clear. The crossed-out jump arrows
   * spell out the one thing the shape has to communicate before it arrives.
   */
  private drawRoof(g: CanvasRenderingContext2D, o: Obstacle, fade: number): void {
    const bottom = GROUND_Y - o.h;
    const top = PANEL_PAD - 24;

    g.fillStyle = C_SHADOW_SOFT;
    g.fillRect(o.x + 5, top, o.w, bottom - top + 7);

    g.fillStyle = CEIL_FILL;
    roundRect(g, o.x, top, o.w, bottom - top, 10);
    g.fill();
    g.strokeStyle = CEIL_LINE;
    g.lineWidth = 3;
    g.stroke();

    // Ink diagonals along the underside. Nothing else in the run is striped,
    // so this is the fastest read on the card.
    g.save();
    g.beginPath();
    g.rect(o.x + 2, bottom - 24, o.w - 4, 22);
    g.clip();
    g.strokeStyle = CEIL_TAPE;
    g.lineWidth = 10;
    g.beginPath();
    for (let x = o.x - 30; x < o.x + o.w + 30; x += 28) {
      g.moveTo(x, bottom + 4);
      g.lineTo(x + 26, bottom - 28);
    }
    g.stroke();
    g.restore();

    g.strokeStyle = CEIL_LINE;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(o.x, bottom);
    g.lineTo(o.x + o.w, bottom);
    g.stroke();

    const marks = Math.max(2, Math.round(o.w / 190));
    for (let i = 0; i < marks; i++) {
      this.drawNoJump(g, o.x + (o.w * (i + 0.5)) / marks, bottom + 40, o.phase + i, fade);
    }
    if (o.w > 300) {
      text(g, "DO NOT JUMP", o.x + o.w / 2, bottom - 44, {
        size: 15,
        color: INK,
        alpha: 0.85 * fade,
        letterSpacing: "4px",
      });
    }
  }

  /** Up arrow with a bar through it, pulsing under the slab. */
  private drawNoJump(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    phase: number,
    fade: number
  ): void {
    const pulse = 0.75 + 0.25 * Math.sin(this.elapsed * 6 + phase);
    g.save();
    // Multiplied rather than assigned: this is the one cue drawn at its own
    // alpha, and assigning would leave it burning at full strength over a
    // scene that has already faded out from under it.
    g.globalAlpha = pulse * fade;
    g.strokeStyle = CEIL_LINE;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(x, y + 12);
    g.lineTo(x, y - 10);
    g.moveTo(x - 9, y - 1);
    g.lineTo(x, y - 11);
    g.lineTo(x + 9, y - 1);
    g.stroke();
    g.strokeStyle = INK;
    g.lineWidth = 4.5;
    g.beginPath();
    g.moveTo(x - 14, y + 10);
    g.lineTo(x + 14, y - 12);
    g.stroke();
    g.restore();
  }

  /** Spinning discs. The only circles in the run, so they never read as hazard. */
  private drawCoins(g: CanvasRenderingContext2D): void {
    const fade = this.runFade();
    if (fade <= 0) return;
    g.save();
    g.globalAlpha = fade;
    g.strokeStyle = COIN_LINE;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (!c.active) continue;
      if (c.x < -30 || c.x > this.width + 30) continue;
      const spin = Math.abs(Math.cos(c.phase + this.elapsed * 5));
      const w = COIN_R * (0.26 + 0.74 * spin);
      g.fillStyle = COIN_FILL;
      g.beginPath();
      g.ellipse(c.x, c.y, w, COIN_R, 0, 0, TAU);
      g.fill();
      g.lineWidth = 2.5;
      g.stroke();
      if (w > 4.5) {
        g.fillStyle = COIN_CORE;
        g.beginPath();
        g.ellipse(c.x - w * 0.18, c.y - 2.5, w * 0.34, COIN_R * 0.4, 0, 0, TAU);
        g.fill();
      }
    }
    g.restore();
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
      g.strokeStyle =
        o.kind === KIND_PIT ? PIT_RIM_LINE : o.kind === KIND_CEIL ? CEIL_LINE : BEAM_LINE;
      g.lineWidth = 4;
      if (o.kind === KIND_BLOCK) {
        y = GROUND_Y - o.h - 32;
        roundRect(g, o.x - 6, GROUND_Y - o.h - 6, o.w + 12, o.h + 12, 14);
      } else if (o.kind === KIND_BEAM) {
        y = GROUND_Y - o.h + 34;
        roundRect(g, o.x - 6, GROUND_Y - BEAM_TOP_H - 6, o.w + 12, BEAM_TOP_H - o.h + 12, 18);
      } else if (o.kind === KIND_CEIL) {
        y = GROUND_Y - o.h + 40;
        roundRect(g, o.x - 6, PANEL_PAD - 6, o.w + 12, GROUND_Y - o.h - PANEL_PAD + 12, 14);
      } else {
        y = GROUND_Y - 44;
        roundRect(g, o.x - 6, GROUND_Y - 6, o.w + 12, 96, 12);
      }
      g.stroke();
      g.restore();
    }

    text(g, this.killLabel, clamp(x, 110, this.width - 110), clamp(y, 40, GROUND_Y - 16), {
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
    this.drawGauge(g);
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

  /**
   * The multiplier, draining in real time.
   *
   * A number in the HUD says what the multiplier is; the bar says what it is
   * doing, which is the part the player is actually deciding against when they
   * choose whether the next arc is worth a committed jump.
   */
  private drawGauge(g: CanvasRenderingContext2D): void {
    const k = (this.mult - 1) / (MULT_MAX - 1);
    const alpha = clamp(k * 6, 0, 1) * this.runFade();
    if (alpha <= 0.01) return;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = C_GAUGE_TRACK;
    roundRect(g, GAUGE_X, GAUGE_Y, GAUGE_W, GAUGE_H, GAUGE_H / 2);
    g.fill();
    g.fillStyle = COIN_FILL;
    roundRect(g, GAUGE_X, GAUGE_Y, Math.max(GAUGE_H, GAUGE_W * k), GAUGE_H, GAUGE_H / 2);
    g.fill();
    g.strokeStyle = COIN_LINE;
    g.lineWidth = 1.5;
    roundRect(g, GAUGE_X, GAUGE_Y, GAUGE_W, GAUGE_H, GAUGE_H / 2);
    g.stroke();
    g.restore();
    text(g, this.multLabel, GAUGE_X, GAUGE_Y - 14, {
      size: 15,
      color: COIN_LINE,
      align: "left",
      alpha,
      letterSpacing: "1px",
    });
    text(g, "COINS", GAUGE_X + GAUGE_W, GAUGE_Y - 14, {
      size: 10,
      color: INK_DIM,
      align: "right",
      alpha: alpha * 0.8,
      letterSpacing: "3px",
    });
  }
}
