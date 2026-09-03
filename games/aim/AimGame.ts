import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";
import { rampAsymptotic, rampLinear, stage } from "@/games/core/curve";
import type { ParticleOptions, ParticleShape } from "@/games/core/Particles";
import { MONO_FONT, drawGrid, roundRect, text, withAlpha } from "@/games/core/draw";
import { clamp, randRange } from "@/games/core/Vector2";
import {
  DECOY_FILL,
  DECOY_LINE,
  RING_LOW,
  RING_LOW_AT,
  RING_MID,
  RING_MID_AT,
  RING_OK,
  TARGET_BAND,
  TARGET_FILL,
  TARGET_LINE,
  TAU,
  createMarkerPool,
  createPopupPool,
  createTargetPool,
  type Target,
} from "./entities";

const ACCENT = "#14b8c4";
const BG = "#f7f8fc";
const FLOOR = "#eef0f7";
const INK = "#22252d";
const INK_DIM = "#6d7280";
const INK_FAINT = "#a3a8b5";

// Every constant colour string is built once. withAlpha() parses hex and
// concatenates, which has no business happening sixty times a second.
const C_GRID = "rgba(91,95,221,0.06)";
const C_GRID_FINE = "rgba(91,95,221,0.035)";
const C_SHADOW = "rgba(24,28,45,0.10)";
const C_FRAME = "rgba(91,95,221,0.10)";
const C_BLOOM = "rgba(255,255,255,0.55)";
const C_WHITE = "#ffffff";
const C_GLOSS = "rgba(255,255,255,0.55)";
const C_TRACK = "rgba(34,37,45,0.09)";
/**
 * The crosshair IS the cursor — the canvas hides the OS pointer in this mode —
 * so it has to be found in a glance against a light floor, over a target the
 * same colour as itself, and over the dark ink of the HUD. A 34%-ink hairline,
 * which is what it was, vanished on all three. Solid accent over a white halo
 * survives every one: the halo separates it from a teal target, the accent
 * from the floor and the ink.
 */
const C_CROSS = ACCENT;
const C_CROSS_HALO = "rgba(255,255,255,0.92)";
const C_CROSS_SOFT = withAlpha(ACCENT, 0.5);
const C_DIM = "rgba(22,25,36,0.42)";
const C_BAD_WASH = withAlpha(ACCENT, 0.1);
const C_DECOY_SOFT = withAlpha(DECOY_LINE, 0.5);
const C_PIP_EMPTY = withAlpha(INK, 0.13);
const C_CHIP = "rgba(255,255,255,0.86)";

// Fonts are strings too, and building one per popup per frame would be the
// most expensive thing in the render loop.
const F_POP = "700 21px " + MONO_FONT;
const F_POP_BIG = "700 29px " + MONO_FONT;
const F_CHIP = "700 18px " + MONO_FONT;

const CANDY: readonly string[] = ["#ff6b8a", "#ffb443", "#4ecb71", "#4f8cff", "#a77bff"];

// --- Layout. Cosmetic card, exactly as the other games draw it. -------------
const PANEL_PAD = 8;
const PANEL_R = 30;
/**
 * The React HUD floats over the top of the board. Clicks pass through the card
 * but not through the pause/mute buttons, and in either case a target behind
 * the translucent card cannot be *read* — an unseen target is an unavoidable
 * expiration, which is the one way this game must never take a life.
 *
 * Re-measured from GameHUD.tsx: the card is 4px hud padding (globals.css
 * landscape override) + 10 py + 10 label + 4 + 30 score (text-3xl applies, the
 * `sm:` breakpoint is on the viewport, not the board) + 6 + 11 best = ~87 CSS
 * px. The board is `(100dvh - 0.75rem) * 10/7` wide, so on a 375px-tall
 * landscape phone one logical unit is 0.518 CSS px and those 87 px eat 168
 * logical units. 172 covers that with a little margin; anything less and the
 * shortest phones start hiding targets under the score.
 */
const TOP_UI = 172;
/** Same idea at the foot of the board, for the lives pips and the combo chip. */
const BOTTOM_UI = 52;
/** Clearance from the panel edge to the outermost pixel of a target. */
const ARENA_PAD = 22;
/** Gap between the target edge and the countdown ring, plus the ring's width. */
const RING_GAP = 11;
const RING_W = 5;
/** Baseline for the pips and the combo chip, measured up from the board foot. */
const FOOT_Y = 30;

// --- Difficulty -------------------------------------------------------------
/**
 * Lifetime shrinks asymptotically toward LIFE_FLOOR and mathematically never
 * reaches it. 0.62s is the hard floor on purpose: a trained human visual
 * reaction is ~0.25s, and the remaining ~0.35s is the time to actually travel
 * to the target. Anything under this stops being an aim test and becomes a
 * lottery, so the difficulty has to keep climbing through concurrency and
 * radius instead.
 */
const LIFE_START = 2.3;
const LIFE_FLOOR = 0.62;
const LIFE_HALFLIFE = 55;

/**
 * Radius floor. 1000x700 logical maps to roughly a 540px-wide board on a
 * phone, i.e. 0.54 CSS px per logical unit. A 22px radius is ~12 CSS px, which
 * alone would be a thumb-sized problem — GRAB_TOUCH below is what makes it
 * honest, taking the effective tap circle to ~39 CSS px across.
 */
const RADIUS_START = 46;
const RADIUS_FLOOR = 22;
const RADIUS_SECONDS = 75;

/**
 * Concurrent live targets. Required click rate is roughly count/lifetime, so
 * these two ramps multiply: at 4 targets and a 0.8s lifetime the range is
 * already asking for five clicks a second. Capping at 4 is what keeps the late
 * game merely brutal rather than arithmetically impossible.
 */
const CONCURRENT_BASE = 2;
const CONCURRENT_STAGE_SECONDS = 26;
const CONCURRENT_MAX_STAGE = 2;
/** Targets arrive one at a time so a new wave never pops in as a wall. */
const SPAWN_STAGGER = 0.13;
/** Retry delay when the sampler could not find a legal spot. */
const SPAWN_RETRY = 0.22;
/**
 * First target. Deliberately later than nothing and far earlier than
 * OPENING_GRACE matters here: the earliest possible expiration is
 * 0.55 + 2.3 = 2.85s, so the opening second can never cost a life.
 */
const FIRST_SPAWN = 0.55;

/** The variation: decoys. They sit on top of the real target budget. */
const DECOY_AT = 34;
const DECOY_CHANCE_FROM = 0.18;
const DECOY_CHANCE_TO = 0.36;
const DECOY_CHANCE_SECONDS = 80;
const MAX_DECOYS = 2;
/** Keeps two decoys from arriving inside a third of a second of each other. */
const DECOY_CD = 1.3;

// --- Fairness ---------------------------------------------------------------
/**
 * Slack added to the drawn radius when testing a click. A click that visually
 * clipped the target has to count, or the player learns to distrust their own
 * eyes. Touch gets far more because a fingertip has no pixel to point with —
 * see `hover` for how the two devices are told apart.
 */
const GRAB_MOUSE = 9;
const GRAB_TOUCH = 17;
/**
 * A decoy's punish box is a *square*, matching its drawn silhouette, and inset
 * inside it: the drawn half-side is 0.81 of the radius, the punished half-side
 * 0.76. Testing a decoy as a circle of the drawn radius — as this did — put a
 * band of punished pixels outside the purple square on all four edges, which is
 * a penalty for clicking bare floor. Every ambiguous click has to resolve in
 * the player's favour: a clipped decoy costs the small miss, never the big one.
 */
const DECOY_BOX = 0.76;
/**
 * Distance a press may land from the previous frame's pointer sample and still
 * be believed to be a mouse. A cursor slides to what it clicks; a fingertip
 * teleports. See trackPointer() — this is what stops one stray hover sample
 * from handing a phone the mouse-sized grab radius for the rest of a run.
 */
const TOUCH_JUMP = 60;
/** Hover travel, while not pressed, before the pointer is believed to be a mouse. */
const HOVER_PROOF = 12;
/** Targets never spawn this close to where the pointer already is. */
const POINTER_CLEAR = 84;
/**
 * Minimum gap between the *discs* of two live targets. It has to beat twice
 * the ring offset (RING_GAP + RING_W = 16), or two countdown rings cross each
 * other and the one piece of information the player triages on — how much time
 * is left on which target — becomes a tangle. 34 leaves the rings 2px apart;
 * the relaxed value, used only when the sampler is running out of attempts,
 * lets them touch but never overlap.
 */
const TARGET_GAP = 34;
const TARGET_GAP_TIGHT = 2 * (RING_GAP + RING_W);
/** Sampler budget, and the attempt counts at which each rule is relaxed. */
const SPOT_TRIES = 30;
const SPOT_DROP_POINTER = 18;
const SPOT_DROP_GAP = 25;

// --- Scoring ----------------------------------------------------------------
const BASE_POINTS = 10;
const SPEED_WEIGHT = 1;
const CENTER_WEIGHT = 0.55;
/** Reaction times, seconds. Faster than BEST is all the same — it is the limit. */
const REACT_BEST = 0.16;
const REACT_WORST = 1.05;
const COMBO_STEP = 0.1;
const COMBO_CAP = 30;
/** Fraction of the radius that counts as a bullseye. */
const BULLSEYE = 0.34;

const PENALTY_MISS = 25;
const PENALTY_DECOY = 40;
const PENALTY_EXPIRE = 70;
const LIVES = 3;

const HINT_TIME = 2.1;
const HINT_Y = 344;
/**
 * Nothing spawns under the opening hint while it is still up. The chip is
 * 380x64, so its half-diagonal is 193 — the keep-out has to beat that *plus*
 * the target's own outer extent, or a first target can sit half under the hint
 * for two seconds of its two-and-a-bit second life.
 */
const HINT_CLEAR = 200;

const MARKER_LIFE = 1.5;
const POPUP_LIFE = 0.85;
const POPUP_RISE = 46;

/**
 * Spawn-in animation. Capped in absolute time so it stays snappy early, and
 * capped again as a share of the lifetime so a late-game target is never
 * scaling up through a fifth of the window the player has to shoot it in.
 */
const POP_TIME = 0.11;
const POP_SHARE = 0.08;

/**
 * "About to expire" tick. Fires when the ring goes red, but never later than
 * DANGER_MIN seconds of life left — late in a run the red tier is only ~0.2s
 * wide, which is inside a human reaction, so the ear has to be told first.
 *
 * Gated by one shared cooldown rather than per target: at four concurrent
 * targets a per-target tick becomes a texture, and a warning that plays
 * constantly is not a warning. Playing well silences it entirely, since a
 * target that is shot early never reaches the tier.
 */
const DANGER_MIN = 0.3;
const DANGER_CD = 0.45;

/**
 * Breathing room granted to every surviving target when one expires.
 *
 * Late in a run four timers are draining at once and they correlate: look away
 * for a second at 90s and all four go red together, so a single lapse takes all
 * three lives inside half a second and the run does not end so much as vanish.
 * That is the "no readable chance to react" failure this game promised not to
 * have — the life system is supposed to make a lapse dent a score, not erase a
 * run. So a life lost resets anything about to follow it to a full ring: the
 * rings visibly snap back to green, which reads as the range giving you a beat,
 * and 0.55s is enough to acquire and take one shot (reaction ~0.25s plus the
 * travel) without being enough to farm.
 */
const MERCY = 0.55;

/**
 * AIM LAB — a pointer-only aim trainer.
 *
 * Targets appear, drain a countdown ring, and cost a life if they expire.
 * Three expirations end the run, so a single lapse of attention dents a score
 * instead of erasing a two-minute run. Missing a click never ends anything;
 * it only breaks the combo, because a game that kills you for a twitch teaches
 * you to stop moving.
 */
export class AimGame extends BaseGame {
  private readonly targets = createTargetPool(10);
  private readonly markers = createMarkerPool(18);
  private readonly popups = createPopupPool(12);
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
    { label: "ACC", value: "-" },
    { label: "COMBO", value: "0", highlight: true },
    { label: "LIVES", value: "3" },
  ];

  private hits = 0;
  private shots = 0;
  private combo = 0;
  private bestCombo = 0;
  private lives = LIVES;

  private spawnCd = FIRST_SPAWN;
  private decoyCd = 0;
  private dangerCd = 0;
  private colorI = 0;
  private confettiI = 0;

  /** Recounted every frame inside stepTargets, so spawn() never walks the pool. */
  private liveReal = 0;
  private liveDecoy = 0;

  /**
   * True once the pointer has hovered — moved while NOT pressed, something a
   * fingertip cannot do — and not since been caught teleporting into a press,
   * which only a fingertip does. See trackPointer(); the engine never says
   * which device it is, so this is inferred without asking the DOM anything.
   */
  private hover = false;
  private hoverRun = 0;
  private seenPtr = false;
  private lastPx = -1;
  private lastPy = -1;
  /** Decays after every click; drives the crosshair's recoil ring. */
  private clickPulse = 0;

  private badFlash = 0;
  private lifePulse = 0;
  private hintT = HINT_TIME;

  /** Scratch for findSpot(); avoids returning a fresh point object. */
  private sx = 0;
  private sy = 0;

  /** Last values the HUD strings were built from. See hudStats(). */
  private accLabelFor = -1;
  private comboLabelFor = -1;
  private livesLabelFor = -1;
  /** Chip text, rebuilt only when the combo moves rather than once a frame. */
  private comboChip = "";
  private comboChipFor = -1;
  /** Death-screen strings, built once when the run ends. */
  private finalAcc = "";
  private finalShots = "";
  private finalCombo = "";

  constructor(services: GameServices) {
    super(services, 520);
  }

  protected onReset(): void {
    for (let i = 0; i < this.targets.length; i++) this.targets[i].active = false;
    for (let i = 0; i < this.markers.length; i++) this.markers[i].active = false;
    for (let i = 0; i < this.popups.length; i++) this.popups[i].active = false;

    this.hits = 0;
    this.shots = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lives = LIVES;

    this.spawnCd = FIRST_SPAWN;
    this.decoyCd = 0;
    this.dangerCd = 0;
    this.colorI = 0;
    this.confettiI = 0;
    this.liveReal = 0;
    this.liveDecoy = 0;

    // The pointer channel survives a restart, but "have we seen a hover yet"
    // must not: a stale true would hand a phone the mouse-sized grab radius.
    this.hover = false;
    this.hoverRun = 0;
    this.seenPtr = false;
    this.lastPx = -1;
    this.lastPy = -1;
    this.clickPulse = 0;

    this.badFlash = 0;
    this.lifePulse = 0;
    this.hintT = HINT_TIME;

    this.accLabelFor = -1;
    this.comboLabelFor = -1;
    this.livesLabelFor = -1;
    this.comboChip = "";
    this.comboChipFor = -1;
    this.finalAcc = "";
    this.finalShots = "";
    this.finalCombo = "";
  }

  // --- HUD -------------------------------------------------------------------

  /**
   * Called every frame by the base class, so each string is rebuilt only when
   * the number behind it actually moved.
   */
  protected hudStats(): HudStat[] {
    const acc = this.shots === 0 ? -1 : Math.round((this.hits / this.shots) * 100);
    if (acc !== this.accLabelFor) {
      this.accLabelFor = acc;
      this.stats[0].value = acc < 0 ? "-" : acc + "%";
    }
    if (this.combo !== this.comboLabelFor) {
      this.comboLabelFor = this.combo;
      this.stats[1].value = String(this.combo);
    }
    if (this.lives !== this.livesLabelFor) {
      this.livesLabelFor = this.lives;
      this.stats[2].value = String(this.lives);
    }
    return this.stats;
  }

  // --- Difficulty ------------------------------------------------------------

  /** Never dips below LIFE_FLOOR; rampAsymptotic only approaches its limit. */
  private lifetime(): number {
    return rampAsymptotic(this.elapsed, LIFE_START, LIFE_FLOOR - LIFE_START, LIFE_HALFLIFE);
  }

  private radius(): number {
    return rampLinear(this.elapsed, RADIUS_START, RADIUS_FLOOR, RADIUS_SECONDS);
  }

  private wantReal(): number {
    return CONCURRENT_BASE + stage(this.elapsed, CONCURRENT_STAGE_SECONDS, CONCURRENT_MAX_STAGE);
  }

  // --- Simulation ------------------------------------------------------------

  protected onUpdate(dt: number): void {
    if (this.hintT > 0) this.hintT -= dt;
    if (this.badFlash > 0) this.badFlash = Math.max(0, this.badFlash - dt * 2.6);
    if (this.lifePulse > 0) this.lifePulse = Math.max(0, this.lifePulse - dt * 2.2);
    if (this.clickPulse > 0) this.clickPulse = Math.max(0, this.clickPulse - dt * 5.5);
    if (this.decoyCd > 0) this.decoyCd -= dt;
    if (this.dangerCd > 0) this.dangerCd -= dt;

    this.trackPointer();
    // Clicks resolve BEFORE the timers tick. A shot that lands on the same
    // frame a target would run out has to count: the other order charges the
    // player a life for a click they already made, which is the single most
    // enraging thing an aim trainer can do. It also means the live counts
    // stepTargets produces are post-click, so a hit frees its slot at once.
    this.handleClick();
    this.stepTargets(dt);
    this.spawn(dt);
    this.stepMarkers(dt);
    this.stepPopups(dt);
  }

  /**
   * Decides, every frame, whether the thing pointing at the board is a cursor
   * or a fingertip — which is only ever used to pick the grab slack and to
   * decide whether a crosshair is drawn.
   *
   * Two signals, and they are deliberately asymmetric, because the costly
   * mistake is one-sided: giving a phone the tight mouse slack makes targets
   * genuinely unhittable, while giving a mouse the loose one merely makes a
   * near miss count.
   *
   *   - hover: travel while not pressed. A fingertip cannot report that, so it
   *     is evidence of a mouse — but it takes HOVER_PROOF units of it, since a
   *     single stray sample is not a mouse.
   *   - teleport: a press landing more than TOUCH_JUMP from the previous
   *     sample. A cursor slides to what it clicks, so this is a fingertip, and
   *     it *revokes* the verdict. Without it, either of two ordinary touch
   *     accidents — a second finger resting on the glass while the first taps,
   *     or a drag off the board edge and back — reports movement with the
   *     engine's pressed flag already cleared, and silently halves the tap
   *     target for the rest of the run.
   */
  private trackPointer(): void {
    const px = this.input.pointerX;
    if (px < 0) return;
    const py = this.input.pointerY;
    const travel = this.seenPtr ? Math.hypot(px - this.lastPx, py - this.lastPy) : 0;

    if (this.input.pointerJustDown()) {
      if (this.seenPtr && travel > TOUCH_JUMP) {
        this.hover = false;
        this.hoverRun = 0;
      }
    } else if (travel > 0 && !this.hover && !this.input.pointerDown()) {
      this.hoverRun += travel;
      if (this.hoverRun > HOVER_PROOF) this.hover = true;
    }

    this.seenPtr = true;
    this.lastPx = px;
    this.lastPy = py;
  }

  private stepTargets(dt: number): void {
    let real = 0;
    let decoy = 0;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.active) continue;
      if (t.pop < 1) t.pop = Math.min(1, t.pop + dt * t.popRate);
      t.life -= dt;
      if (t.life <= 0) {
        this.expire(t);
        // The third expiry ends the run from inside this loop, and endRun
        // clears the range. Bail rather than publish half-counted live totals.
        if (this.status !== "playing") return;
        continue;
      }
      if (t.decoy) {
        decoy++;
      } else {
        real++;
        if (!t.warned && t.life <= Math.max(t.maxLife * RING_LOW_AT, DANGER_MIN)) {
          t.warned = true;
          if (this.dangerCd <= 0) {
            this.dangerCd = DANGER_CD;
            // Same timbre as the expiry sting, a fifth higher: the ear should
            // hear the penalty coming, not a new unrelated noise.
            this.audio.play("warn", 1.6, 0.45);
          }
        }
      }
    }
    this.liveReal = real;
    this.liveDecoy = decoy;
  }

  private stepMarkers(dt: number): void {
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      if (!m.active) continue;
      m.life -= dt;
      if (m.life <= 0) m.active = false;
    }
  }

  private stepPopups(dt: number): void {
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.y -= POPUP_RISE * dt * (p.life / p.maxLife);
    }
  }

  // --- Clicking --------------------------------------------------------------

  private grabSlack(): number {
    return this.hover ? GRAB_MOUSE : GRAB_TOUCH;
  }

  /** Drawn radius. Shrinks slightly as the timer drains, so a stale target is
   *  visibly a harder shot. Hit tests use exactly this: you click what you see. */
  private drawRadius(t: Target): number {
    return t.r * (0.88 + 0.12 * (t.life / t.maxLife));
  }

  /** Spawn-in scale, with a little overshoot so a target lands rather than appears. */
  private popScale(t: Target): number {
    return t.pop < 1 ? 0.45 + 0.55 * t.pop + Math.sin(t.pop * Math.PI) * 0.14 : 1;
  }

  /** Half-side of a decoy's punish box; strictly inside the purple square. */
  private decoyHalf(t: Target, dr: number): number {
    return dr * this.popScale(t) * DECOY_BOX;
  }

  private handleClick(): void {
    if (!this.input.pointerJustDown()) return;
    const x = this.input.pointerX;
    const y = this.input.pointerY;
    if (x < 0) return;

    this.clickPulse = 1;
    this.shots++;

    // Pick the target the click most clearly belongs to: smallest distance
    // relative to its own size, so a small target the player actually aimed
    // at beats a fat one whose slack happens to overlap the same pixel.
    let best: Target | null = null;
    let bestRel = Infinity;
    let bestDist = 0;
    let bestDraw = 0;
    const slack = this.grabSlack();
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.active) continue;
      const dx = x - t.x;
      const dy = y - t.y;
      const dr = this.drawRadius(t);
      let rel: number;
      if (t.decoy) {
        // Square, to match the drawn silhouette, and no slack: a decoy may
        // only punish a click that landed inside the shape the player saw.
        const h = this.decoyHalf(t, dr);
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        if (m > h) continue;
        rel = m / h;
      } else {
        const d = Math.hypot(dx, dy);
        if (d > dr + slack) continue;
        rel = d / dr;
      }
      if (rel < bestRel) {
        bestRel = rel;
        best = t;
        bestDist = Math.hypot(dx, dy);
        bestDraw = dr;
      }
    }

    if (!best) {
      this.missClick(x, y);
      return;
    }
    if (best.decoy) this.hitDecoy(best, x, y);
    else this.hitTarget(best, bestDist, bestDraw, x, y);
  }

  private hitTarget(t: Target, d: number, dr: number, cx: number, cy: number): void {
    const age = t.maxLife - t.life;
    const speedK = clamp((REACT_WORST - age) / (REACT_WORST - REACT_BEST), 0, 1);
    const centerK = clamp(1 - d / dr, 0, 1);
    const bull = d <= dr * BULLSEYE;
    // The multiplier is read before the increment, so the first hit of a streak
    // pays 1.0x and the reward is for the streak already earned.
    const mult = 1 + Math.min(this.combo, COMBO_CAP) * COMBO_STEP;
    const pts = Math.round(
      BASE_POINTS * (1 + SPEED_WEIGHT * speedK + CENTER_WEIGHT * centerK) * mult
    );

    this.rawScore += pts;
    this.hits++;
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;

    const color = TARGET_FILL[t.colorI];
    t.active = false;

    // Ring burst, then confetti chips. No screen shake, ever, on a hit: the
    // whole game is pointing at a spot, and jolting the arena the instant the
    // player succeeds would throw off the very next shot.
    this.puff(t.x, t.y, 0, 0, 0.34, dr * 0.9, dr * 1.9, color, "ring", 1);
    if (bull) this.puff(t.x, t.y, 0, 0, 0.5, dr * 0.5, dr * 2.4, RING_OK, "ring", 1);
    const chips = bull ? 14 : 9;
    for (let i = 0; i < chips; i++) {
      const a = (i / chips) * TAU + randRange(-0.35, 0.35);
      const s = randRange(90, 260);
      this.puff(
        t.x,
        t.y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        randRange(0.3, 0.62),
        randRange(2.4, 4.6),
        0.6,
        this.candy(),
        i % 3 === 0 ? "square" : "circle",
        0.3
      );
    }
    this.mark(cx, cy, true, color);
    this.popup(t.x, t.y - dr * 0.6, "+" + pts, bull ? RING_MID : color, bull);

    // Pitch climbs with the combo — the audible ladder is most of what makes a
    // long streak feel like it is going somewhere.
    const detune = 1 + Math.min(this.combo, 24) * 0.035;
    this.audio.play("hit", detune, 0.5);
    if (bull) this.audio.play("score", detune, 0.42);
  }

  private hitDecoy(t: Target, cx: number, cy: number): void {
    this.rawScore = Math.max(0, this.rawScore - PENALTY_DECOY);
    this.combo = 0;
    t.active = false;
    this.badFlash = Math.max(this.badFlash, 0.7);
    // A small jolt, unlike a plain miss: clicking the one thing marked "do not
    // click" should land as a mistake you feel, not just a number going down.
    this.shake.add(6, 0.22);
    this.puff(t.x, t.y, 0, 0, 0.4, t.r * 0.8, t.r * 2.1, DECOY_LINE, "ring", 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + randRange(-0.3, 0.3);
      const s = randRange(70, 200);
      this.puff(
        t.x,
        t.y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        randRange(0.28, 0.5),
        3.2,
        0.6,
        DECOY_FILL,
        "circle",
        0.32
      );
    }
    this.mark(cx, cy, false, DECOY_LINE);
    this.popup(t.x, t.y - t.r * 0.6, "-" + PENALTY_DECOY, DECOY_LINE, false);
    this.audio.play("warn", 0.55, 0.5);
  }

  private missClick(x: number, y: number): void {
    this.rawScore = Math.max(0, this.rawScore - PENALTY_MISS);
    this.combo = 0;
    this.badFlash = Math.max(this.badFlash, 0.4);
    // No shake and no sting here on purpose. A missed click is a twitch, and
    // punishing a twitch by moving the arena punishes the next shot too.
    this.mark(x, y, false, INK_FAINT);
    this.popup(x, y - 16, "-" + PENALTY_MISS, INK_DIM, false);
    for (let i = 0; i < 5; i++) {
      const a = randRange(0, TAU);
      const s = randRange(30, 90);
      this.puff(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.24, 2.2, 0, INK_FAINT, "circle", 0.3);
    }
    this.audio.play("click", 0.6, 0.28);
  }

  /** Timer ran out. Real targets cost a life; letting a decoy die is correct play. */
  private expire(t: Target): void {
    t.active = false;
    if (t.decoy) {
      // Quiet confirmation that ignoring it was right — silence would read as
      // "nothing happened", which is exactly the wrong lesson.
      this.puff(t.x, t.y, 0, 0, 0.3, t.r * 0.7, t.r * 0.2, C_DECOY_SOFT, "ring", 1);
      this.audio.play("click", 1.5, 0.12);
      return;
    }

    this.rawScore = Math.max(0, this.rawScore - PENALTY_EXPIRE);
    this.combo = 0;
    this.lives = Math.max(0, this.lives - 1);
    this.badFlash = 1;
    this.lifePulse = 1;
    this.shake.add(8, 0.34);
    this.grantMercy();

    this.puff(t.x, t.y, 0, 0, 0.55, t.r * 2.2, t.r * 0.3, RING_LOW, "ring", 1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const s = randRange(40, 120);
      this.puff(
        t.x,
        t.y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        randRange(0.3, 0.55),
        3,
        0.5,
        RING_LOW,
        "circle",
        0.3
      );
    }
    this.popup(t.x, t.y - t.r * 0.6, "-" + PENALTY_EXPIRE, RING_LOW, true);
    this.audio.play("warn", 0.42, 0.75);

    if (this.lives <= 0) this.endRun();
  }

  /**
   * Refills any target that was about to follow the one just lost. maxLife is
   * rewritten to match, because the ring is a *relative* gauge: leaving a 2.3s
   * maxLife in place would show 0.55s of life as a quarter-full red ring, which
   * is the lie that the extension exists to avoid. `warned` is cleared so the
   * danger tick fires again on the new timer.
   */
  private grantMercy(): void {
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.active || t.decoy || t.life >= MERCY) continue;
      t.life = MERCY;
      t.maxLife = MERCY;
      t.warned = false;
    }
  }

  private endRun(): void {
    // die() is idempotent, but the sting and the death strings are not: guard
    // the whole thing so a run can only ever end once.
    if (this.status !== "playing") return;
    // Clearing the range first means the death frame shows the score, not a
    // half-drained ring the player can no longer do anything about.
    for (let i = 0; i < this.targets.length; i++) this.targets[i].active = false;
    this.liveReal = 0;
    this.liveDecoy = 0;
    this.shake.add(14, 0.6);
    this.audio.play("death");
    // Built here, once, so the death overlay never formats a string per frame.
    const acc = this.shots === 0 ? 0 : Math.round((this.hits / this.shots) * 100);
    this.finalAcc = acc + "%";
    this.finalShots = this.hits + " / " + this.shots + " SHOTS";
    this.finalCombo = "BEST COMBO " + this.bestCombo;
    this.die();
  }

  // --- Spawning --------------------------------------------------------------

  private spawn(dt: number): void {
    // die() can land earlier in this same onUpdate, via a third expiration in
    // stepTargets. Without this a fresh target would pop onto the death screen.
    if (this.status !== "playing") return;
    if (this.spawnCd > 0) {
      this.spawnCd -= dt;
      return;
    }
    if (this.liveReal >= this.wantReal()) return;

    // Decoys sit on top of the real-target budget: spawning one does not raise
    // liveReal, so the next stagger tick still delivers the real target the
    // difficulty asked for. They add reading load, never click load.
    const wantDecoy =
      this.elapsed >= DECOY_AT &&
      this.decoyCd <= 0 &&
      this.liveDecoy < MAX_DECOYS &&
      Math.random() < this.decoyChance();

    if (this.place(wantDecoy)) {
      this.spawnCd = SPAWN_STAGGER;
      if (wantDecoy) {
        this.decoyCd = DECOY_CD;
        this.liveDecoy++;
      } else {
        this.liveReal++;
      }
    } else {
      this.spawnCd = SPAWN_RETRY;
    }
  }

  private decoyChance(): number {
    return rampLinear(
      this.elapsed - DECOY_AT,
      DECOY_CHANCE_FROM,
      DECOY_CHANCE_TO,
      DECOY_CHANCE_SECONDS
    );
  }

  private place(decoy: boolean): boolean {
    const r = this.radius();
    if (!this.findSpot(r)) return false;
    const t = this.freeTarget();
    if (!t) return false;
    t.active = true;
    t.x = this.sx;
    t.y = this.sy;
    t.r = r;
    t.maxLife = this.lifetime();
    t.life = t.maxLife;
    t.decoy = decoy;
    t.pop = 0;
    t.popRate = 1 / Math.min(POP_TIME, t.maxLife * POP_SHARE);
    t.warned = false;
    if (decoy) {
      t.colorI = 0;
      this.audio.play("spawn", 0.7, 0.16);
    } else {
      // Cycled rather than random so two neighbours are never the same hue.
      this.colorI = (this.colorI + 1) % TARGET_FILL.length;
      t.colorI = this.colorI;
      this.audio.play("spawn", 1.25, 0.14);
    }
    return true;
  }

  private freeTarget(): Target | null {
    for (let i = 0; i < this.targets.length; i++) {
      if (!this.targets[i].active) return this.targets[i];
    }
    return null;
  }

  /**
   * Rejection sampler. Rules relax in a fixed order as attempts run out —
   * overlap is the last thing surrendered, because two stacked targets are
   * unclickable while a target near the cursor is merely a cheap point.
   */
  private findSpot(r: number): boolean {
    // Bounds are driven by the target's full drawn extent, ring included, so a
    // countdown ring is never clipped by the frame or hidden under the HUD.
    // The arena therefore *opens up* as targets shrink, which is a small mercy
    // exactly when the shots get hard.
    const outer = r + RING_GAP + RING_W;
    const minX = ARENA_PAD + outer;
    const maxX = this.width - minX;
    const minY = TOP_UI + outer;
    const maxY = this.height - BOTTOM_UI - outer;
    if (maxX <= minX || maxY <= minY) return false;

    const px = this.input.pointerX;
    const py = this.input.pointerY;
    const hintUp = this.hintT > 0;

    for (let attempt = 0; attempt < SPOT_TRIES; attempt++) {
      const x = randRange(minX, maxX);
      const y = randRange(minY, maxY);

      if (hintUp && Math.hypot(x - this.width / 2, y - HINT_Y) < HINT_CLEAR + outer) continue;

      // A target under the cursor is a free point and teaches nothing.
      if (attempt < SPOT_DROP_POINTER && px >= 0) {
        if (Math.hypot(x - px, y - py) < r + POINTER_CLEAR) continue;
      }

      const gap = attempt < SPOT_DROP_GAP ? TARGET_GAP : TARGET_GAP_TIGHT;
      let clear = true;
      for (let i = 0; i < this.targets.length; i++) {
        const o = this.targets[i];
        if (!o.active) continue;
        if (Math.hypot(x - o.x, y - o.y) < r + o.r + gap) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      this.sx = x;
      this.sy = y;
      return true;
    }
    return false;
  }

  // --- Pooled effects --------------------------------------------------------

  /** Next confetti colour. Pure cycling: no allocation, no Math.random cost. */
  private candy(): string {
    this.confettiI = (this.confettiI + 1) % CANDY.length;
    return CANDY[this.confettiI];
  }

  /**
   * Emits one particle through a single reused options object. The engine
   * copies every field out of it, so mutating one object per emit keeps the hot
   * loop allocation-free while still going through the pooled API.
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
    drag = 1
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
    // Only squares read their rotation, and confetti that never tumbles looks
    // like a spreadsheet. Rings and circles ignore both fields.
    p.rotation = shape === "square" ? randRange(0, TAU) : 0;
    p.spin = shape === "square" ? randRange(-9, 9) : 0;
    this.fx.emit(p);
  }

  private mark(x: number, y: number, hit: boolean, color: string): void {
    let slot = this.markers[0];
    // Oldest-first recycling, so the freshest grouping always survives.
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      if (!m.active) {
        slot = m;
        break;
      }
      if (m.life < slot.life) slot = m;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.maxLife = MARKER_LIFE;
    slot.life = MARKER_LIFE;
    slot.hit = hit;
    slot.color = color;
  }

  /**
   * The label string is built here, on an event, not in the render loop — a few
   * per second is bounded and unavoidable for a number that has to be drawn.
   */
  private popup(x: number, y: number, label: string, color: string, big: boolean): void {
    let slot = this.popups[0];
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (!p.active) {
        slot = p;
        break;
      }
      if (p.life < slot.life) slot = p;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.maxLife = POPUP_LIFE;
    slot.life = POPUP_LIFE;
    slot.label = label;
    slot.color = color;
    slot.big = big;
  }

  protected onDeathUpdate(dt: number): void {
    // Markers and popups keep resolving after death so the last shot of the run
    // finishes its animation instead of freezing mid-air.
    this.stepMarkers(dt);
    this.stepPopups(dt);
    if (this.badFlash > 0) this.badFlash = Math.max(0, this.badFlash - dt * 2.6);
  }

  // --- Render ----------------------------------------------------------------

  protected onRender(g: CanvasRenderingContext2D): void {
    this.drawBackdrop(g);
    this.drawFrame(g);
    // Markers sit under the targets: a record of past clicks may never obscure
    // the thing that is currently costing you a life.
    this.drawMarkers(g);
    this.drawTargets(g);
    this.drawPopups(g);
    if (this.status === "playing" && this.hover) this.drawCrosshair(g);
  }

  private drawBackdrop(g: CanvasRenderingContext2D): void {
    g.fillStyle = BG;
    g.fillRect(0, 0, this.width, this.height);

    g.save();
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
    // The grid never scrolls. Every other game parallaxes its floor to prove it
    // is alive; under a precision-aiming task moving background lines actively
    // drag the eye off the target, and a range should feel nailed down.
    drawGrid(g, this.width, this.height, 100, 0, C_GRID);
    drawGrid(g, this.width, this.height, 50, 0, C_GRID_FINE);
    this.drawBrackets(g);
    g.restore();

    if (this.badFlash > 0) {
      g.save();
      g.globalAlpha = this.badFlash;
      g.fillStyle = C_BAD_WASH;
      g.fillRect(0, 0, this.width, this.height);
      g.restore();
    }
  }

  /** Corner brackets and a centre tick. Range furniture, deliberately faint. */
  private drawBrackets(g: CanvasRenderingContext2D): void {
    const pad = 40;
    const len = 30;
    g.save();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const left = i % 2 === 0;
      const top = i < 2;
      const x = left ? pad : this.width - pad;
      // The brackets frame the band targets actually spawn in — under the HUD
      // card, above the pips — so the keep-outs read as a deliberate range
      // rather than as targets mysteriously avoiding the top of the board.
      const y = top ? TOP_UI - 16 : this.height - BOTTOM_UI - 14;
      const sx = left ? 1 : -1;
      const sy = top ? 1 : -1;
      g.moveTo(x, y + len * sy);
      g.lineTo(x, y);
      g.lineTo(x + len * sx, y);
    }
    const cx = this.width / 2;
    const cy = this.height / 2;
    g.moveTo(cx - 9, cy);
    g.lineTo(cx + 9, cy);
    g.moveTo(cx, cy - 9);
    g.lineTo(cx, cy + 9);
    g.stroke();
    g.restore();
  }

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
    // A white bloom feathering the rim into the page. Darkening the edges of a
    // light arena would eat the targets nearest the border.
    g.strokeStyle = C_BLOOM;
    g.lineWidth = 16;
    g.stroke();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();

    if (this.badFlash > 0) {
      g.globalAlpha = this.badFlash * 0.75;
      g.strokeStyle = RING_LOW;
      g.lineWidth = 7;
      g.stroke();
    }
    g.restore();
  }

  private drawMarkers(g: CanvasRenderingContext2D): void {
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      if (!m.active) continue;
      const k = m.life / m.maxLife;
      g.globalAlpha = k * 0.55;
      g.strokeStyle = m.color;
      if (m.hit) {
        // A hit reads as a tight ring plus its centre dot: the grouping of
        // those dots is the feedback an aim trainer exists to give.
        g.lineWidth = 2;
        g.beginPath();
        g.arc(m.x, m.y, 5 + (1 - k) * 4, 0, TAU);
        g.stroke();
        g.fillStyle = m.color;
        g.beginPath();
        g.arc(m.x, m.y, 1.8, 0, TAU);
        g.fill();
      } else {
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(m.x - 6, m.y - 6);
        g.lineTo(m.x + 6, m.y + 6);
        g.moveTo(m.x + 6, m.y - 6);
        g.lineTo(m.x - 6, m.y + 6);
        g.stroke();
      }
    }
    g.restore();
  }

  private drawTargets(g: CanvasRenderingContext2D): void {
    g.save();
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.active) continue;
      const dr = this.drawRadius(t) * this.popScale(t);
      const frac = t.life / t.maxLife;

      g.fillStyle = C_SHADOW;
      g.beginPath();
      g.arc(t.x + 1.8, t.y + 3, dr * 1.04, 0, TAU);
      g.fill();

      if (t.decoy) this.drawDecoy(g, t, dr);
      else this.drawBullseye(g, t, dr, frac);

      this.drawCountdown(g, t, dr, frac);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  private drawBullseye(g: CanvasRenderingContext2D, t: Target, dr: number, frac: number): void {
    const fill = TARGET_FILL[t.colorI];
    const line = TARGET_LINE[t.colorI];

    g.fillStyle = fill;
    g.beginPath();
    g.arc(t.x, t.y, dr, 0, TAU);
    g.fill();
    g.fillStyle = TARGET_BAND;
    g.beginPath();
    g.arc(t.x, t.y, dr * 0.66, 0, TAU);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.arc(t.x, t.y, dr * 0.38, 0, TAU);
    g.fill();
    g.fillStyle = TARGET_BAND;
    g.beginPath();
    g.arc(t.x, t.y, dr * 0.13, 0, TAU);
    g.fill();

    // The outline thickens as the timer drains, so the target about to cost a
    // life is always the highest-contrast thing on the range.
    g.strokeStyle = line;
    g.lineWidth = 2.5 + (1 - frac) * 1.8;
    g.beginPath();
    g.arc(t.x, t.y, dr, 0, TAU);
    g.stroke();

    if (dr > 17) {
      g.save();
      g.globalAlpha = g.globalAlpha * 0.5;
      g.fillStyle = C_GLOSS;
      g.beginPath();
      g.arc(t.x - dr * 0.34, t.y - dr * 0.36, dr * 0.2, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  /**
   * The decoy differs in hue AND in silhouette. Colour alone would fail the
   * one player in twelve who cannot separate purple from pink at speed, and
   * this is the single read the whole variation hangs on.
   */
  private drawDecoy(g: CanvasRenderingContext2D, t: Target, dr: number): void {
    const s = dr * 1.62;
    g.fillStyle = DECOY_FILL;
    roundRect(g, t.x - s / 2, t.y - s / 2, s, s, s * 0.26);
    g.fill();
    g.strokeStyle = DECOY_LINE;
    g.lineWidth = 3;
    g.stroke();

    const k = s * 0.22;
    g.strokeStyle = TARGET_BAND;
    g.lineWidth = Math.max(3, s * 0.1);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(t.x - k, t.y - k);
    g.lineTo(t.x + k, t.y + k);
    g.moveTo(t.x + k, t.y - k);
    g.lineTo(t.x - k, t.y + k);
    g.stroke();
    g.lineCap = "butt";
  }

  private drawCountdown(
    g: CanvasRenderingContext2D,
    t: Target,
    dr: number,
    frac: number
  ): void {
    const rr = dr + RING_GAP;
    g.beginPath();
    g.arc(t.x, t.y, rr, 0, TAU);
    g.strokeStyle = C_TRACK;
    g.lineWidth = RING_W;
    g.stroke();

    // A decoy's timer is information, not a threat: it stays grey so the eye
    // never triages toward the one target it must leave alone.
    let color = C_DECOY_SOFT;
    let width = RING_W;
    if (!t.decoy) {
      color = frac > RING_MID_AT ? RING_OK : frac > RING_LOW_AT ? RING_MID : RING_LOW;
      if (frac <= RING_LOW_AT) {
        // Pulse only in the last quarter, where it means "take this one now".
        const p = 0.5 + 0.5 * Math.sin(this.elapsed * 19);
        width = RING_W + p * 2.4;
        g.globalAlpha = 0.75 + 0.25 * p;
      }
    }
    // Drains clockwise from twelve o'clock.
    g.beginPath();
    g.arc(t.x, t.y, rr, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = "round";
    g.stroke();
    g.lineCap = "butt";
    g.globalAlpha = 1;
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      const k = p.life / p.maxLife;
      g.globalAlpha = Math.min(1, k * 2.2);
      g.font = p.big ? F_POP_BIG : F_POP;
      g.fillStyle = p.color;
      g.fillText(p.label, p.x, p.y);
    }
    g.restore();
  }

  private drawCrosshair(g: CanvasRenderingContext2D): void {
    const x = this.lastPx;
    const y = this.lastPy;
    if (x < 0) return;
    g.save();
    g.lineCap = "round";
    // One path, stroked twice: a wide white halo underneath, the accent on
    // top. Two strokes of the same geometry is what gives a line an outline.
    g.beginPath();
    g.arc(x, y, 14, 0, TAU);
    g.moveTo(x - 24, y);
    g.lineTo(x - 8, y);
    g.moveTo(x + 8, y);
    g.lineTo(x + 24, y);
    g.moveTo(x, y - 24);
    g.lineTo(x, y - 8);
    g.moveTo(x, y + 8);
    g.lineTo(x, y + 24);
    g.strokeStyle = C_CROSS_HALO;
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = C_CROSS;
    g.lineWidth = 2.6;
    g.stroke();
    // Centre dot, haloed the same way, so the exact aim point reads over a
    // target of the same colour.
    g.fillStyle = C_CROSS_HALO;
    g.beginPath();
    g.arc(x, y, 4.2, 0, TAU);
    g.fill();
    g.fillStyle = C_CROSS;
    g.beginPath();
    g.arc(x, y, 2.6, 0, TAU);
    g.fill();

    // Recoil ring: the click is confirmed at the cursor even when it hit
    // nothing, so input never feels dropped.
    if (this.clickPulse > 0) {
      g.globalAlpha = this.clickPulse * 0.6;
      g.strokeStyle = C_CROSS_SOFT;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 13 + (1 - this.clickPulse) * 16, 0, TAU);
      g.stroke();
    }
    g.restore();
  }

  // --- Overlay ---------------------------------------------------------------

  protected onRenderOverlay(g: CanvasRenderingContext2D): void {
    this.drawLives(g);
    this.drawComboChip(g);
    this.drawHint(g);
    if (this.status === "gameover") this.drawDeath(g);
  }

  private drawLives(g: CanvasRenderingContext2D): void {
    const y = this.height - FOOT_Y;
    let x = 44;
    g.save();
    for (let i = 0; i < LIVES; i++) {
      const alive = i < this.lives;
      // The pip that just died is the one that pulses, so the loss is legible
      // without reading the HUD.
      const lost = i === this.lives && this.lifePulse > 0;
      const r = 8 + (lost ? this.lifePulse * 5 : 0);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      if (alive) {
        g.fillStyle = ACCENT;
        g.fill();
        g.strokeStyle = TARGET_LINE[0];
        g.lineWidth = 2;
        g.stroke();
      } else {
        g.fillStyle = C_PIP_EMPTY;
        g.fill();
        if (lost) {
          g.strokeStyle = RING_LOW;
          g.lineWidth = 2.5;
          g.globalAlpha = this.lifePulse;
          g.stroke();
          g.globalAlpha = 1;
        }
      }
      x += 26;
    }
    g.restore();
  }

  private drawComboChip(g: CanvasRenderingContext2D): void {
    if (this.combo < 3 || this.status !== "playing") return;
    if (this.combo !== this.comboChipFor) {
      this.comboChipFor = this.combo;
      this.comboChip = "x" + (1 + Math.min(this.combo, COMBO_CAP) * COMBO_STEP).toFixed(1);
    }
    const cx = this.width / 2;
    const cy = this.height - FOOT_Y;
    g.save();
    g.fillStyle = C_CHIP;
    roundRect(g, cx - 52, cy - 17, 104, 34, 17);
    g.fill();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.font = F_CHIP;
    g.fillStyle = ACCENT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(this.comboChip, cx, cy + 1);
    g.restore();
  }

  private drawHint(g: CanvasRenderingContext2D): void {
    if (this.hintT <= 0 || this.status !== "playing") return;
    const alpha = Math.min(1, this.hintT / 0.6);
    const cx = this.width / 2;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = C_CHIP;
    roundRect(g, cx - 190, HINT_Y - 32, 380, 64, 32);
    g.fill();
    g.strokeStyle = C_FRAME;
    g.lineWidth = 2;
    g.stroke();
    g.restore();
    text(g, "CLICK THE TARGETS", cx, HINT_Y - 8, {
      size: 21,
      color: ACCENT,
      alpha,
      letterSpacing: "4px",
    });
    text(g, "3 MISSES AND THE RUN ENDS", cx, HINT_Y + 15, {
      size: 11,
      color: INK_DIM,
      alpha: alpha * 0.9,
      letterSpacing: "3px",
    });
  }

  /**
   * The React game-over panel arrives 620ms after death, so this has to land
   * its whole read inside about a third of a second.
   */
  private drawDeath(g: CanvasRenderingContext2D): void {
    const k = Math.min(1, this.deathTime / 0.22);
    g.save();
    g.globalAlpha = k;
    roundRect(
      g,
      PANEL_PAD,
      PANEL_PAD,
      this.width - PANEL_PAD * 2,
      this.height - PANEL_PAD * 2,
      PANEL_R
    );
    g.fillStyle = C_DIM;
    g.fill();
    g.restore();

    const cx = this.width / 2;
    text(g, "ACCURACY", cx, 258, {
      size: 13,
      color: C_WHITE,
      alpha: k * 0.7,
      letterSpacing: "8px",
    });
    text(g, this.finalAcc, cx, 322, {
      size: 86,
      color: ACCENT,
      alpha: k,
      shadow: "rgba(0,0,0,0.35)",
      shadowBlur: 22,
    });
    text(g, this.finalShots, cx, 382, {
      size: 16,
      color: C_WHITE,
      alpha: k * 0.85,
      letterSpacing: "3px",
    });
    text(g, this.finalCombo, cx, 410, {
      size: 13,
      color: C_WHITE,
      alpha: k * 0.6,
      letterSpacing: "3px",
    });
  }
}
