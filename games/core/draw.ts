/** Shared canvas drawing helpers. Pure rendering, no game state. */

export const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Filled circle with an additive halo. `glow` is the halo radius multiplier. */
export function glowCircle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  glow = 2.2
): void {
  const outer = Math.max(r * glow, r + 0.01);
  const grad = g.createRadialGradient(x, y, 0, x, y, outer);
  grad.addColorStop(0, color);
  grad.addColorStop(0.45, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "lighter";
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, outer, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "source-over";
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Subtle scrolling grid used as the arcade backdrop. */
export function drawGrid(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  cell: number,
  offset: number,
  color: string
): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  const o = offset % cell;
  for (let x = -cell + o; x <= w + cell; x += cell) {
    g.moveTo(x, 0);
    g.lineTo(x, h);
  }
  for (let y = -cell + o; y <= h + cell; y += cell) {
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
  g.restore();
}

export function vignette(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength = 0.55
): void {
  const grad = g.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0," + strength + ")");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

export interface TextOptions {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: string;
  font?: string;
  alpha?: number;
  letterSpacing?: string;
  shadow?: string;
  shadowBlur?: number;
}

export function text(
  g: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: TextOptions = {}
): void {
  g.save();
  if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
  const family = opts.font ?? MONO_FONT;
  g.font = (opts.weight ?? "700") + " " + (opts.size ?? 16) + "px " + family;
  g.fillStyle = opts.color ?? "#ffffff";
  g.textAlign = opts.align ?? "center";
  g.textBaseline = opts.baseline ?? "middle";
  if (opts.letterSpacing) {
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      opts.letterSpacing;
  }
  if (opts.shadow) {
    g.shadowColor = opts.shadow;
    g.shadowBlur = opts.shadowBlur ?? 12;
  }
  g.fillText(str, x, y);
  g.restore();
}

/** rgba() string from a #rgb or #rrggbb hex plus an alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const gg = (n >> 8) & 255;
  const b = n & 255;
  return "rgba(" + r + ", " + gg + ", " + b + ", " + alpha + ")";
}

/** Draws a soft radial light without touching composite state permanently. */
export function radialLight(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 1
): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(radius, 0.01));
  grad.addColorStop(0, withAlpha(color, alpha));
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.save();
  g.globalCompositeOperation = "lighter";
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
