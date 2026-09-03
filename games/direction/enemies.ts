import { roundRect, text, type TextOptions, withAlpha } from "@/games/core/draw";
import { GAME_HEIGHT, GAME_WIDTH } from "@/types/game";
import {
  dropShadow,
  INK,
  PLAYER_X,
  PLAYER_Y,
  ROSE,
  ROSE_DARK,
  ROSE_DEEP,
  ROSE_SOFT,
  softHalo,
  SPAWN_DIST,
  TAU,
} from "./arena";
import { DIR_INFO, type Dir } from "./facing";

export type EnemyPhase = "telegraph" | "approach" | "strike";

/**
 * Seconds the directional flare stays at full strength, and the fade that ends
 * it.
 *
 * The flare is a tutorial, not a permanent crutch. It names the side before the
 * enemy is even moving, so while it is up the player answers a marker rather
 * than an enemy — exactly what is wanted for the first dozen seconds, when all
 * eight sides have to be learned at once, and exactly what made the rest of the
 * run free. Past the fade the only thing that says where a strike comes from is
 * the enemy itself, closing.
 *
 * A fade, not a switch: a cue that vanishes between one spawn and the next
 * reads as a bug, and two seconds of visibly weakening flare are what let the
 * player feel the rule change while both halves of it are still on screen. The
 * caller announces it in words at the same moment.
 */
export const FLARE_FULL = 12;
export const FLARE_FADE = 2;

/** 1 while the flare is the answer, 0 once the player is on their own. */
export function flareAlpha(elapsed: number): number {
  if (elapsed <= FLARE_FULL) return 1;
  const k = (elapsed - FLARE_FULL) / FLARE_FADE;
  return k >= 1 ? 0 : 1 - k;
}

export interface Enemy {
  active: boolean;
  phase: EnemyPhase;
  /** Side the strike really comes from; the facing that parries it. */
  dir: Dir;
  /** Telegraph phase: seconds left. Strike phase: seconds of grace left. */
  t: number;
  /** Full telegraph length, kept for the flare's urgency ramp. */
  telegraph: number;
  speed: number;
  /** Distance from the player along the approach axis. */
  d: number;
  x: number;
  y: number;
  /** Scheduled sim-time of the strike. The spawn guard reasons about this. */
  strikeAt: number;
  /**
   * Sim-time the facing last became correct for this enemy, or -1 while it is
   * wrong. `strikeAt - correctSince` is the time the player had left when they
   * got their guard round, which is the only thing clutch is measured against.
   */
  correctSince: number;
  /**
   * Whether this enemy has already spent its one mid-diagonal grace. Once per
   * enemy: a window re-armed by every turn could be held open forever by
   * alternating between the two cardinals a diagonal is made of, and that
   * diagonal would then never be able to land.
   */
  composeUsed: boolean;
}

export function blankEnemy(): Enemy {
  return {
    active: false,
    phase: "telegraph",
    dir: "left",
    t: 0,
    telegraph: 1,
    speed: 0,
    d: SPAWN_DIST,
    x: 0,
    y: 0,
    strikeAt: 0,
    correctSince: -1,
    composeUsed: false,
  };
}

const BAR_THICK = 14;
/** Distance of the edge capsule from the arena edge. */
const BAR_INSET = 6;
/** A cardinal owns the middle of its edge; a diagonal gets a shorter capsule
 *  on BOTH edges of its corner, which is what makes eight sides readable in
 *  peripheral vision without eight separate shapes to learn. */
const BAR_MAIN = 240;
const BAR_SIDE = 150;
const EDGE_L = BAR_INSET;
const EDGE_R = GAME_WIDTH - BAR_THICK - BAR_INSET;
const EDGE_T = BAR_INSET;
const EDGE_B = GAME_HEIGHT - BAR_THICK - BAR_INSET;
/** Offsets of the diagonal capsules from the cardinal ones. Roughly where the
 *  diagonal's own ray leaves the arena, and clear of the cardinal capsule so
 *  "up" and "up-left" are never the same silhouette. */
const DIAG_OFF_X = 330;
const DIAG_OFF_Y = 200;

interface EdgeBar {
  x: number;
  y: number;
  w: number;
  h: number;
}

function vBar(x: number, cy: number, span: number): EdgeBar {
  return { x, y: cy - span / 2, w: BAR_THICK, h: span };
}

function hBar(cx: number, y: number, span: number): EdgeBar {
  return { x: cx - span / 2, y, w: span, h: BAR_THICK };
}

/** Built once at module load; the render loop only ever reads it. */
const EDGE_BARS: Record<Dir, readonly EdgeBar[]> = {
  right: [vBar(EDGE_R, PLAYER_Y, BAR_MAIN)],
  left: [vBar(EDGE_L, PLAYER_Y, BAR_MAIN)],
  up: [hBar(PLAYER_X, EDGE_T, BAR_MAIN)],
  down: [hBar(PLAYER_X, EDGE_B, BAR_MAIN)],
  upRight: [
    hBar(PLAYER_X + DIAG_OFF_X, EDGE_T, BAR_SIDE),
    vBar(EDGE_R, PLAYER_Y - DIAG_OFF_Y, BAR_SIDE),
  ],
  upLeft: [
    hBar(PLAYER_X - DIAG_OFF_X, EDGE_T, BAR_SIDE),
    vBar(EDGE_L, PLAYER_Y - DIAG_OFF_Y, BAR_SIDE),
  ],
  downRight: [
    hBar(PLAYER_X + DIAG_OFF_X, EDGE_B, BAR_SIDE),
    vBar(EDGE_R, PLAYER_Y + DIAG_OFF_Y, BAR_SIDE),
  ],
  downLeft: [
    hBar(PLAYER_X - DIAG_OFF_X, EDGE_B, BAR_SIDE),
    vBar(EDGE_L, PLAYER_Y + DIAG_OFF_Y, BAR_SIDE),
  ],
};

/** Reused so the flare's glyph never allocates an options literal per frame. */
const MARK_OPT: TextOptions = { size: 26, color: "#ffffff", alpha: 1 };
/** Fixed-alpha fills, resolved once: `withAlpha` builds an rgba string, and
 *  these two sit on a per-enemy path inside onRender. */
const BUBBLE_FILL = withAlpha(ROSE_DEEP, 0.94);
const EMPHASIS_RIM = withAlpha(ROSE_SOFT, 0.9);
/** Fixed wobble for the trail chips: a trail, not a straight hard streak. */
const TRAIL_WOBBLE = [3.2, -3.6, 2.4, -1.8];

/** Distance from the spawn point to the arena edge along its own ray. The
 *  chip group is scaled to this, or the top flare draws itself off-screen. */
function edgeRoom(sx: number, sy: number, vx: number, vy: number): number {
  let room = Infinity;
  if (vx > 0) room = Math.min(room, (GAME_WIDTH - sx) / vx);
  else if (vx < 0) room = Math.min(room, sx / -vx);
  if (vy > 0) room = Math.min(room, (GAME_HEIGHT - sy) / vy);
  else if (vy < 0) room = Math.min(room, sy / -vy);
  return room;
}

/**
 * Warning flare: rounded capsules at the arena edges for peripheral vision, a
 * warning bubble that swells at the exact point the enemy will appear, and a
 * ring around it that unwinds like a fuse.
 *
 * Opening window only. The caller passes the fade in through `globalAlpha` and
 * stops calling this at all once it reaches zero.
 */
export function drawTelegraph(
  g: CanvasRenderingContext2D,
  e: Enemy,
  px: number,
  py: number
): void {
  // The caller hands its own alpha in through globalAlpha — the fade, and the
  // dimming of every flare that is no longer the story once the run is over —
  // so the three alphas that SET themselves instead of multiplying have to fold
  // that in by hand.
  const base = g.globalAlpha;
  const info = DIR_INFO[e.dir];
  // Urgency: brighter and faster as the strike nears. Squaring the phase makes
  // the flicker accelerate, which reads as "now" without needing a number.
  const k = 1 - Math.max(0, e.t) / Math.max(0.01, e.telegraph);
  const pulse = 0.5 + 0.5 * Math.sin(k * k * 30 + k * 9);
  const alpha = (0.25 + 0.55 * pulse) * (0.5 + 0.5 * k);

  g.save();

  // Edge capsules — visible even when the player is staring at another side.
  const bars = EDGE_BARS[e.dir];
  const pad = 9;
  g.fillStyle = withAlpha(ROSE_DEEP, alpha * 0.2);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    roundRect(g, b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, (BAR_THICK + pad * 2) / 2);
    g.fill();
  }
  g.fillStyle = withAlpha(ROSE_DEEP, Math.min(1, 0.35 + alpha * 0.65));
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    roundRect(g, b.x, b.y, b.w, b.h, BAR_THICK / 2);
    g.fill();
  }

  const sx = px + info.vx * SPAWN_DIST;
  const sy = py + info.vy * SPAWN_DIST;

  // Rounded chips live OUTSIDE the spawn point and slide inward as the fuse
  // burns, scaled to the room that side actually has to draw them in.
  const span = Math.max(30, Math.min(72, edgeRoom(sx, sy, info.vx, info.vy) - 4));
  const step = span * 0.236;
  const slide = span * 0.361;
  const nose = span * 0.153;
  const half = span * 0.236;

  g.save();
  g.translate(sx, sy);
  g.rotate(info.angle + Math.PI);
  for (let i = 0; i < 3; i++) {
    const off = -span * 0.639 + i * step - (1 - k) * slide;
    const a = alpha * (1 - i * 0.24);
    const cw = nose * 1.5;
    const ch = half * 1.6;
    roundRect(g, off - cw * 0.5, -ch * 0.5, cw, ch, Math.min(cw, ch) * 0.5);
    g.fillStyle = withAlpha(ROSE_DEEP, a);
    g.fill();
  }
  g.restore();

  // Warning bubble: swells toward the strike so "soon" is a size, not a hue.
  const r = 15 + 13 * k;
  dropShadow(g, sx, sy + r * 0.6, r * 0.85, r * 0.3, 0.1 * base);
  softHalo(g, sx, sy, r + 9, ROSE_DEEP, (0.16 + 0.14 * pulse) * base);
  g.fillStyle = BUBBLE_FILL;
  g.beginPath();
  g.arc(sx, sy, r, 0, TAU);
  g.fill();
  g.lineWidth = 3.5;
  g.strokeStyle = "#ffffff";
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = withAlpha(ROSE_DARK, 0.4 + 0.4 * k);
  g.beginPath();
  g.arc(sx, sy, r + 3, 0, TAU);
  g.stroke();

  // Fuse ring: unwinds to nothing exactly when the enemy appears.
  g.lineCap = "round";
  g.lineWidth = 5;
  g.strokeStyle = withAlpha(ROSE_DEEP, 0.4 + 0.5 * k);
  g.beginPath();
  g.arc(sx, sy, r + 10, -Math.PI / 2, -Math.PI / 2 + (1 - k) * TAU);
  g.stroke();
  g.lineCap = "butt";
  g.restore();

  MARK_OPT.size = r * 1.15;
  MARK_OPT.alpha = 0.85 * base;
  text(g, "!", sx, sy + 1, MARK_OPT);
}

/**
 * Round blobby rusher: a stretched body along its travel axis, a trail of
 * rounded chips behind it, and a small angry face that stays upright on screen
 * so it reads the same whichever side the rush comes from. `emphasis` hardens
 * the outline for the strike frame and for the enemy that ends the run.
 */
export function drawEnemy(g: CanvasRenderingContext2D, e: Enemy, emphasis: number): void {
  const info = DIR_INFO[e.dir];
  // The caller fades non-fatal enemies out after a death, so every alpha here
  // is relative to whatever it handed us rather than absolute.
  const base = g.globalAlpha;
  // Screen-space direction of travel: always toward the player.
  const mx = -info.vx;
  const my = -info.vy;
  // Squash along the travel axis: fast things stretch.
  const stretch = 1 + Math.min(0.24, e.speed * 0.0008);
  const rx = 18.5 * stretch;
  const ry = 15.5 / (1 + (stretch - 1) * 0.5);

  g.save();
  g.translate(e.x, e.y);

  // Trail chips. Spacing tracks speed, so late-game rushers read as faster.
  const gap = 13 + e.speed * 0.05;
  for (let i = 0; i < 4; i++) {
    const back = 18 + i * gap;
    g.globalAlpha = base * (0.3 - i * 0.062);
    g.fillStyle = ROSE;
    g.beginPath();
    g.arc(-mx * back - my * TRAIL_WOBBLE[i], -my * back + mx * TRAIL_WOBBLE[i], 11 - i * 2.1, 0, TAU);
    g.fill();
  }
  g.globalAlpha = base;

  dropShadow(g, 2, ry + 6, rx * 0.8, 4.2, 0.13 * base);
  softHalo(g, 0, 0, rx + 7, ROSE, 0.2 * base);

  g.save();
  g.rotate(info.angle + Math.PI);
  g.fillStyle = ROSE_DEEP;
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, TAU);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = ROSE_DARK;
  g.stroke();
  if (emphasis > 0) {
    // Hardens rather than blows out: on a light ground, "louder" is darker.
    g.globalAlpha = base * Math.min(1, emphasis);
    g.lineWidth = 3.5;
    g.strokeStyle = ROSE_DARK;
    g.beginPath();
    g.ellipse(0, 0, rx + 6, ry + 6, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = EMPHASIS_RIM;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, 0, rx + 11, ry + 11, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = base;
  }
  g.restore();

  // Angry little face, leaning the way it is charging.
  const fx = mx * 3.2;
  const fy = my * 3.2;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(fx - 6, fy - 2.5, 4.5, 0, TAU);
  g.arc(fx + 6, fy - 2.5, 4.5, 0, TAU);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(fx - 6 + mx * 1.5, fy - 2.5 + my * 1.5, 2.5, 0, TAU);
  g.arc(fx + 6 + mx * 1.5, fy - 2.5 + my * 1.5, 2.5, 0, TAU);
  g.fill();

  g.lineCap = "round";
  g.strokeStyle = ROSE_DARK;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(fx - 11, fy - 9.5);
  g.lineTo(fx - 2, fy - 6.5);
  g.moveTo(fx + 11, fy - 9.5);
  g.lineTo(fx + 2, fy - 6.5);
  g.stroke();

  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(fx, fy + 8.5, 4.6, Math.PI + 0.35, TAU - 0.35);
  g.stroke();
  g.lineCap = "butt";

  g.restore();
}
