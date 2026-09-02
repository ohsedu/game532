/**
 * Cartoon rendering primitives for POOP STORM. Pure drawing: no game state,
 * no allocation (every value passed in lives on a pooled record).
 *
 * Light theme: everything renders dark-on-light. No additive blending anywhere —
 * "lighter" over a near-white sky washes out to nothing, so depth comes from
 * chunky dark outlines, soft ink drop shadows and saturated fills instead.
 */

import { roundRect } from "@/games/core/draw";
import type { Cloud, Decal, GuyPose, Poop } from "./entities";

const TAU = Math.PI * 2;

/** The hazard is the darkest, most saturated thing on screen. Deliberately so. */
export const POOP_BODY = "#7a4a24";
export const POOP_DARK = "#54301a";
export const POOP_OUTLINE = "#3a2011";
export const POOP_LIGHT = "#a9713f";
/** Palette for splat debris, sampled per particle. All dark enough to read. */
export const SPLAT_COLORS = ["#7a4a24", "#54301a", "#9c6236", "#3a2011"] as const;
/** Candy confetti for near-miss chips and the death pop. */
export const CONFETTI_COLORS = ["#ff6b8a", "#ffb443", "#4ecb71", "#4f8cff", "#a77bff"] as const;

const ACCENT = "#ffa62b";
const ACCENT_DEEP = "#e07a12";
const SKIN = "#ffd2a0";
const SKIN_SHADE = "#f0b880";
const PANTS = "#3a4a78";
const HAIR = "#4a2f1c";
const INK = "#26221d";
const OUTLINE = "#2f2a24";
const SHADOW_INK = "rgba(24, 28, 45, 0.20)";
const CLOUD_TOP = "#ffffff";
const CLOUD_UNDER = "#e6ebfa";
/** Cloud alphas on the pooled records were tuned for a dark sky; lift them here. */
const CLOUD_ALPHA_GAIN = 7;

/** Three stacked lobes plus the swirl tip, as one path so the fill has no seams. */
function lobePath(g: CanvasRenderingContext2D, r: number): void {
  g.beginPath();
  g.ellipse(0, r * 0.52, r, r * 0.48, 0, 0, TAU);
  g.ellipse(0, r * 0.04, r * 0.7, r * 0.4, 0, 0, TAU);
  g.ellipse(0, -r * 0.44, r * 0.46, r * 0.34, 0, 0, TAU);
  g.ellipse(r * 0.11, -r * 0.74, r * 0.15, r * 0.14, 0, 0, TAU);
}

/**
 * The hazard. Everything else on screen is deliberately lighter and less
 * saturated than this: on a near-white sky the chunky dark-brown outline plus
 * a soft drop shadow is what makes a falling turd unmistakable at speed.
 */
export function drawPoop(g: CanvasRenderingContext2D, p: Poop): void {
  const r = p.r;
  const pulse = Math.sin(p.phase * 1.7) * 0.05;

  g.save();
  g.translate(p.x, p.y);
  g.rotate(Math.sin(p.phase) * 0.22);
  g.scale(1 + pulse, 1 - pulse * 0.8);

  // Solid body first, carrying the soft drop shadow for the whole silhouette.
  g.shadowColor = SHADOW_INK;
  g.shadowBlur = Math.max(6, r * 0.5);
  g.shadowOffsetY = Math.max(3, r * 0.18);
  lobePath(g, r);
  g.fillStyle = POOP_BODY;
  g.fill();
  g.shadowColor = "rgba(0,0,0,0)";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;

  // Chunky outline. Stroking the combined path also draws the lobe seams, which
  // is exactly the cartoon read we want.
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = POOP_OUTLINE;
  g.lineWidth = Math.max(2, r * 0.13);
  g.stroke();

  // Soft belly shading and a fat highlight blob, both inside the silhouette.
  g.globalAlpha = 0.5;
  g.fillStyle = POOP_DARK;
  g.beginPath();
  g.ellipse(r * 0.3, r * 0.66, r * 0.5, r * 0.2, 0, 0, TAU);
  g.fill();
  g.globalAlpha = 0.32;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(-r * 0.42, r * 0.4, r * 0.19, r * 0.11, -0.4, 0, TAU);
  g.ellipse(-r * 0.24, -r * 0.56, r * 0.12, r * 0.07, -0.5, 0, TAU);
  g.fill();
  g.globalAlpha = 1;

  // Big googly eyes staring down at whoever is about to get hit.
  const ex = r * 0.22;
  const ey = -r * 0.5;
  const er = r * 0.2;
  g.fillStyle = "#ffffff";
  g.strokeStyle = POOP_OUTLINE;
  g.lineWidth = Math.max(1.2, r * 0.07);
  g.beginPath();
  g.ellipse(-ex, ey, er, er * 1.1, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(ex, ey, er, er * 1.1, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(-ex, ey + r * 0.06, er * 0.5, 0, TAU);
  g.arc(ex, ey + r * 0.06, er * 0.5, 0, TAU);
  g.fill();

  // Little smug smile.
  g.strokeStyle = POOP_OUTLINE;
  g.lineWidth = Math.max(1.4, r * 0.075);
  g.beginPath();
  g.arc(0, -r * 0.26, r * 0.15, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();

  g.restore();
}

/**
 * Top-edge telegraph. `heat` 0..1 climbs as the drop gets closer to entering.
 * Restyled as a rounded candy pointer bubble — same lead time, same column.
 */
export function drawWarning(
  g: CanvasRenderingContext2D,
  x: number,
  r: number,
  heat: number,
  beam: CanvasGradient | null,
  pulse: number
): void {
  // Width tracks payload size, but is capped so one fat drop's chevron cannot
  // swamp its neighbours in a dense sky.
  const w = Math.min(26, Math.max(9, r * 1.05));
  const bh = w * 0.94;
  const top = 5;

  g.save();
  if (beam) {
    g.globalAlpha = 0.12 + heat * 0.34;
    g.fillStyle = beam;
    g.fillRect(x - w, 0, w * 2, 130);
  }

  g.globalAlpha = 0.62 + pulse * 0.38;
  g.lineJoin = "round";
  g.lineCap = "round";

  // Rounded nose pointing down at the impact column, drawn under the bubble.
  g.fillStyle = ACCENT;
  g.strokeStyle = ACCENT_DEEP;
  g.lineWidth = Math.max(2, w * 0.16);
  g.beginPath();
  g.moveTo(x - w * 0.44, top + bh - w * 0.3);
  g.lineTo(x, top + bh + w * 0.62);
  g.lineTo(x + w * 0.44, top + bh - w * 0.3);
  g.closePath();
  g.fill();
  g.stroke();

  // Capsule bubble.
  roundRect(g, x - w, top, w * 2, bh, bh * 0.5);
  g.fill();
  g.stroke();

  // Fuse pill inside the bubble: shrinks to nothing exactly as the drop enters.
  const fw = (w - w * 0.3) * (1 - heat);
  if (fw > 0.5) {
    g.globalAlpha = 0.95;
    g.fillStyle = "#ffffff";
    roundRect(g, x - fw, top + bh * 0.5 - bh * 0.16, fw * 2, bh * 0.32, bh * 0.16);
    g.fill();
  }
  g.restore();
}

/**
 * Ground shadow under a drop still in the air.
 *
 * With nine drops in flight at different sizes and therefore different speeds,
 * the top-edge markers say *where* but not *when*. This says when: the shadow
 * tightens and darkens as the drop closes on the floor, so a column reads as
 * imminent or not without the player tracking each turd's altitude.
 * `t` is 0 at the top of the screen and 1 at the floor.
 */
export function drawImpactShadow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number
): void {
  g.save();
  g.globalAlpha = 0.06 + t * t * 0.3;
  g.fillStyle = "#181c2d";
  g.beginPath();
  g.ellipse(x, y, r * (1.35 - t * 0.5), r * (0.42 - t * 0.16), 0, 0, TAU);
  g.fill();
  g.restore();
}

/** Ground stain: soft rounded blobs. Spreads fast on impact, then fades. */
export function drawDecal(g: CanvasRenderingContext2D, d: Decal): void {
  const t = d.life / d.maxLife;
  const spread = Math.min(1, (d.maxLife - d.life) * 9);
  const r = d.r * (0.55 + spread * 0.45);
  const a = Math.min(1, t * 1.8);
  const w1 = Math.sin(d.seed);
  const w2 = Math.cos(d.seed * 1.7);

  g.save();
  g.globalAlpha = a * 0.42;
  g.fillStyle = POOP_BODY;
  g.beginPath();
  g.ellipse(d.x, d.y, r * 1.5, r * 0.44, 0, 0, TAU);
  g.ellipse(d.x + w1 * r * 1.25, d.y + w2 * r * 0.12, r * 0.62, r * 0.26, 0, 0, TAU);
  g.ellipse(d.x - w2 * r * 1.45, d.y - w1 * r * 0.1, r * 0.48, r * 0.2, 0, 0, TAU);
  g.fill();
  g.globalAlpha = a * 0.26;
  g.fillStyle = POOP_DARK;
  g.beginPath();
  g.ellipse(d.x + r * 0.3, d.y + r * 0.1, r * 0.7, r * 0.2, 0, 0, TAU);
  g.fill();
  g.restore();
}

/** Soft pastel cloud: white puff with a cool underside so it still has volume. */
export function drawCloud(g: CanvasRenderingContext2D, c: Cloud): void {
  const a = Math.min(0.85, c.alpha * CLOUD_ALPHA_GAIN);
  g.save();
  g.globalAlpha = a * 0.55;
  g.fillStyle = CLOUD_UNDER;
  g.beginPath();
  g.ellipse(c.x, c.y + 9 * c.s, 94 * c.s, 27 * c.s, 0, 0, TAU);
  g.ellipse(c.x - 54 * c.s, c.y + 16 * c.s, 47 * c.s, 18 * c.s, 0, 0, TAU);
  g.ellipse(c.x + 60 * c.s, c.y + 14 * c.s, 53 * c.s, 20 * c.s, 0, 0, TAU);
  g.fill();
  g.globalAlpha = a;
  g.fillStyle = CLOUD_TOP;
  g.beginPath();
  g.ellipse(c.x, c.y, 92 * c.s, 26 * c.s, 0, 0, TAU);
  g.ellipse(c.x - 54 * c.s, c.y + 9 * c.s, 46 * c.s, 17 * c.s, 0, 0, TAU);
  g.ellipse(c.x + 60 * c.s, c.y + 7 * c.s, 52 * c.s, 19 * c.s, 0, 0, TAU);
  g.ellipse(c.x + 10 * c.s, c.y - 17 * c.s, 44 * c.s, 21 * c.s, 0, 0, TAU);
  g.fill();
  g.restore();
}

/**
 * The victim. Chunky rounded primitives with a soft dark outline so he pops off
 * the pale sky: legs cycle while running, the whole body leans and squashes,
 * and the mouth blows open when something is about to land.
 */
export function drawGuy(g: CanvasRenderingContext2D, p: GuyPose): void {
  const stride = Math.sin(p.legPhase) * 10 * p.run;
  const swing = Math.sin(p.legPhase + Math.PI) * 9 * p.run;

  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.lean + p.dead * 1.3);
  g.scale(p.squashX, p.squashY);

  g.lineCap = "round";
  g.lineJoin = "round";

  // Legs first so the torso overlaps the hips.
  g.strokeStyle = PANTS;
  g.lineWidth = 7.5;
  g.beginPath();
  g.moveTo(-4.5, 8);
  g.lineTo(-4.5 + stride, 25);
  g.moveTo(4.5, 8);
  g.lineTo(4.5 - stride, 25);
  g.stroke();
  g.strokeStyle = ACCENT_DEEP;
  g.lineWidth = 6.5;
  g.beginPath();
  g.moveTo(-4.5 + stride, 25.5);
  g.lineTo(-8 + stride, 27);
  g.moveTo(4.5 - stride, 25.5);
  g.lineTo(1 - stride, 27);
  g.stroke();

  // Arms flail behind the lean.
  g.strokeStyle = OUTLINE;
  g.lineWidth = 7.5;
  g.beginPath();
  g.moveTo(-10, -6);
  g.lineTo(-14, 4 + swing);
  g.moveTo(10, -6);
  g.lineTo(14, 4 - swing);
  g.stroke();
  g.strokeStyle = SKIN;
  g.lineWidth = 4.5;
  g.stroke();

  // Torso: a fat rounded capsule, carrying the body's drop shadow.
  g.shadowColor = SHADOW_INK;
  g.shadowBlur = 9;
  g.shadowOffsetY = 4;
  g.fillStyle = ACCENT;
  roundRect(g, -13, -14, 26, 26, 12);
  g.fill();
  g.shadowColor = "rgba(0,0,0,0)";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2.4;
  roundRect(g, -13, -14, 26, 26, 12);
  g.stroke();
  g.fillStyle = "rgba(47, 42, 36, 0.14)";
  roundRect(g, -12, 3, 24, 8, 5);
  g.fill();

  // Head.
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(0, -26, 12.5, 0, TAU);
  g.fill();
  g.fillStyle = SKIN_SHADE;
  g.beginPath();
  g.ellipse(0, -19.5, 9, 4.5, 0, 0, Math.PI);
  g.fill();
  // Mop of hair, drawn as a capped arc across the top of the skull.
  g.fillStyle = HAIR;
  g.beginPath();
  g.arc(0, -26, 12.5, Math.PI * 1.06, Math.PI * 2);
  g.closePath();
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(0, -26, 12.5, 0, TAU);
  g.stroke();

  g.fillStyle = INK;
  if (p.dead > 0.35) {
    // X eyes: the universal shorthand for "got hit by falling poop".
    g.strokeStyle = INK;
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-8, -30);
    g.lineTo(-2.5, -24.5);
    g.moveTo(-2.5, -30);
    g.lineTo(-8, -24.5);
    g.moveTo(2.5, -30);
    g.lineTo(8, -24.5);
    g.moveTo(8, -30);
    g.lineTo(2.5, -24.5);
    g.stroke();
    g.beginPath();
    g.ellipse(0, -18, 4.4, 3.4, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#ff6b8a";
    g.beginPath();
    g.ellipse(0, -14.5, 2.6, 4.4, 0, 0, TAU);
    g.fill();
  } else {
    // Big dot eyes.
    const open = 0.7 + p.eyes * 2.7;
    g.beginPath();
    g.ellipse(-4.6, -27.5, 2.4, open, 0, 0, TAU);
    g.ellipse(4.6, -27.5, 2.4, open, 0, 0, TAU);
    g.fill();
    if (p.eyes > 0.5) {
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(-5.4, -28.6, 0.8, 0, TAU);
      g.arc(3.8, -28.6, 0.8, 0, TAU);
      g.fill();
      g.fillStyle = INK;
    }
    // Rosy cheeks — small, warm, never competing with the hazard.
    g.globalAlpha = 0.5;
    g.fillStyle = "#ff9db2";
    g.beginPath();
    g.ellipse(-8, -22.5, 2.6, 1.8, 0, 0, TAU);
    g.ellipse(8, -22.5, 2.6, 1.8, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(0, -20, 1.8 + p.scream * 3.4, 1.3 + p.scream * 4.6, 0, 0, TAU);
    g.fill();
  }

  g.restore();
}
