/** Stage geometry and palette. The player never moves, so these are constants. */

export const PLAYER_X = 500;
/** Above the vertical centre so the floor line and its shadow have room. */
export const PLAYER_Y = 340;
export const FLOOR_Y = PLAYER_Y + 88;

/**
 * Distance from the player at which an enemy materializes. Identical for every
 * side so approach time — and therefore the reaction window — never depends on
 * which direction the strike comes from.
 *
 * This is the board's ceiling rather than a preference. The player stands 322px
 * below the top of the stage card, so a spawn ring any wider than this puts the
 * "up" enemy off the board, and an enemy that is invisible for the first slice
 * of its approach is worse than no warning at all — which is exactly what the
 * flare fade cannot afford. The rest of the reading window is therefore bought
 * with approach SPEED (see SPEED_START / SPEED_TOP in DirectionGame), not with
 * more distance.
 */
export const SPAWN_DIST = 306;
/**
 * Enemies resolve the instant they cross this radius. It is drawn as a ring so
 * the timing is something the player learns rather than guesses. It cannot
 * shrink to buy more travel: the player's own blade already reaches 71px, and a
 * strike ring inside the guard would resolve hits behind the thing meant to
 * stop them.
 */
export const STRIKE_DIST = 76;
export const TRAVEL = SPAWN_DIST - STRIKE_DIST;

export const TAU = Math.PI * 2;

/* --- Light theme palette ---------------------------------------------------
 * Everything reads dark-on-light. Hazards are the most saturated thing on the
 * screen; the stage itself never goes past a pastel.
 */

/** Page ground, just outside the stage card. */
export const BASE = "#f7f8fc";
/** The stage card the duel happens on. */
export const CARD = "#ffffff";
/** Pink-tinted floor slab under the fighters. */
export const FLOOR = "#fdeef3";
export const GRID = "rgba(91,95,221,0.06)";
export const GRID_ROSE = "rgba(255,107,138,0.07)";
export const SHADOW = "rgba(24,28,45,0.10)";

export const INK = "#22252d";
export const INK_DIM = "#6d7280";
export const INK_FAINT = "#a3a8b5";

/**
 * The accent, in three weights. ROSE is the friendly one used for rings, washes
 * and trails; ROSE_DEEP is what anything that can kill you wears; ROSE_DARK is
 * the outline that makes it pop off a near-white floor.
 */
export const ROSE = "#ff6b8a";
export const ROSE_DEEP = "#e12a55";
export const ROSE_DARK = "#8e1233";
export const ROSE_SOFT = "#ffd9e2";

/** Reward accent: clutch banners, clutch confetti, the clutch wash. Nothing
 *  that can end the run is ever amber. */
export const AMBER = "#ffa62b";
export const AMBER_DARK = "#a35a00";

/** Confetti / variety. Hoisted so a burst never builds an array mid-frame. */
export const CANDY: readonly string[] = [
  "#ff6b8a",
  "#ffb443",
  "#4ecb71",
  "#4f8cff",
  "#a77bff",
];

/** Stage card. Inset far enough that the edge flares live in the margin. */
export const CARD_X = 22;
export const CARD_Y = 18;
export const CARD_W = 1000 - CARD_X * 2;
export const CARD_H = 700 - CARD_Y * 2;
export const CARD_R = 36;

/**
 * Translucent disc used in place of an additive halo. Source-over, so it stays
 * a visible tint on a near-white ground instead of blowing out to white.
 */
export function softHalo(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number
): void {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.restore();
}

/** Soft dark ellipse. Cheap depth cue for anything floating over the floor. */
export function dropShadow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number
): void {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "#181c2d";
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fill();
  g.restore();
}
