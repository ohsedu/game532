import { randRange } from "./Vector2";

export type ParticleShape = "circle" | "square" | "spark" | "ring";

export interface ParticleOptions {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  life?: number;
  size?: number;
  sizeEnd?: number;
  color?: string;
  shape?: ParticleShape;
  /** Per-second velocity retention factor, applied as pow(drag, dt). */
  drag?: number;
  gravity?: number;
  rotation?: number;
  spin?: number;
  /** Additive blending reads as light; good for sparks and explosions. */
  additive?: boolean;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  sizeEnd: number;
  color: string;
  shape: ParticleShape;
  drag: number;
  gravity: number;
  rotation: number;
  spin: number;
  additive: boolean;
}

function blank(): Particle {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 3,
    sizeEnd: 0,
    color: "#fff",
    shape: "circle",
    drag: 1,
    gravity: 0,
    rotation: 0,
    spin: 0,
    additive: false,
  };
}

/**
 * Fixed-capacity particle pool. Never allocates during play; when full, the
 * oldest particle is recycled so bursts degrade gracefully instead of dropping.
 */
export class ParticleSystem {
  private pool: Particle[];
  private cursor = 0;

  constructor(capacity = 600) {
    this.pool = Array.from({ length: capacity }, blank);
  }

  emit(o: ParticleOptions): void {
    const p = this.acquire();
    p.active = true;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.maxLife = o.life ?? 0.6;
    p.life = p.maxLife;
    p.size = o.size ?? 3;
    p.sizeEnd = o.sizeEnd ?? 0;
    p.color = o.color ?? "#ffffff";
    p.shape = o.shape ?? "circle";
    p.drag = o.drag ?? 1;
    p.gravity = o.gravity ?? 0;
    p.rotation = o.rotation ?? 0;
    p.spin = o.spin ?? 0;
    p.additive = o.additive ?? false;
  }

  /** Radial burst. `speed` is randomized per particle within +/-40%. */
  burst(
    x: number,
    y: number,
    count: number,
    speed: number,
    opts: Omit<ParticleOptions, "x" | "y" | "vx" | "vy"> = {}
  ): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + randRange(-0.3, 0.3);
      const s = speed * randRange(0.6, 1.4);
      this.emit({
        ...opts,
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        rotation: a,
      });
    }
  }

  /** Cone spray around `angle`. */
  spray(
    x: number,
    y: number,
    count: number,
    angle: number,
    spread: number,
    speed: number,
    opts: Omit<ParticleOptions, "x" | "y" | "vx" | "vy"> = {}
  ): void {
    for (let i = 0; i < count; i++) {
      const a = angle + randRange(-spread, spread);
      const s = speed * randRange(0.5, 1.3);
      this.emit({ ...opts, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rotation: a });
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (p.drag !== 1) {
        const d = Math.pow(p.drag, dt);
        p.vx *= d;
        p.vy *= d;
      }
      if (p.gravity) p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
    }
  }

  render(g: CanvasRenderingContext2D): void {
    let additiveOn = false;
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.life / p.maxLife;

      if (p.additive !== additiveOn) {
        g.globalCompositeOperation = p.additive ? "lighter" : "source-over";
        additiveOn = p.additive;
      }

      g.globalAlpha = Math.min(1, t * 1.4);
      g.fillStyle = p.color;
      g.strokeStyle = p.color;
      const size = p.sizeEnd + (p.size - p.sizeEnd) * t;

      switch (p.shape) {
        case "circle":
          g.beginPath();
          g.arc(p.x, p.y, Math.max(0.4, size), 0, Math.PI * 2);
          g.fill();
          break;
        case "square":
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rotation);
          g.fillRect(-size, -size, size * 2, size * 2);
          g.restore();
          break;
        case "spark": {
          const l = size * 3;
          g.lineWidth = Math.max(0.6, size * 0.6);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - Math.cos(p.rotation) * l, p.y - Math.sin(p.rotation) * l);
          g.stroke();
          break;
        }
        case "ring":
          g.lineWidth = Math.max(0.6, size * 0.35);
          g.beginPath();
          g.arc(p.x, p.y, Math.max(0.4, (1 - t) * p.size * 4 + 2), 0, Math.PI * 2);
          g.stroke();
          break;
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    this.cursor = 0;
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  private acquire(): Particle {
    const n = this.pool.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      if (!this.pool[idx].active) {
        this.cursor = (idx + 1) % n;
        return this.pool[idx];
      }
    }
    // Pool exhausted: recycle round-robin so bursts still read correctly.
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % n;
    return p;
  }
}
