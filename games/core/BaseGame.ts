import { GAME_HEIGHT, GAME_WIDTH, type GameStatus } from "@/types/game";
import type { AudioManager } from "./AudioManager";
import type { InputManager } from "./InputManager";
import { ParticleSystem } from "./Particles";
import { ScreenShake } from "./ScreenShake";

/** Extra numbers a game wants surfaced in the React HUD. */
export interface HudStat {
  label: string;
  value: string;
  /** Rendered with the accent color and a pulse when it changes. */
  highlight?: boolean;
}

export interface GameServices {
  input: InputManager;
  audio: AudioManager;
  /** True on a touch device, so a game can word its own prompts correctly. */
  isTouch: boolean;
  /**
   * Fired only when the integer score actually changes, so React re-renders are
   * bounded by score changes rather than by frames.
   */
  onScore: (score: number) => void;
  /** Fired exactly once per run, after the death animation is allowed to start. */
  onGameOver: (finalScore: number, elapsedSeconds: number) => void;
  /** Optional: fired when a game's HUD extras change (combo, lives, ...). */
  onStats?: (stats: HudStat[]) => void;
}

/**
 * Base class for every game.
 *
 * Subclasses implement `onReset` / `onUpdate` / `onRender` and call `die()`.
 * The base class owns the shared concerns: score publishing, elapsed time,
 * particles, screen shake, and the post-death animation window.
 *
 * Coordinates are always the logical GAME_WIDTH x GAME_HEIGHT space. The canvas
 * layer handles scaling and devicePixelRatio.
 */
export abstract class BaseGame {
  readonly width = GAME_WIDTH;
  readonly height = GAME_HEIGHT;

  protected readonly input: InputManager;
  protected readonly audio: AudioManager;
  /** True on a touch device. Use it for prompt wording, never for gameplay. */
  protected readonly isTouch: boolean;
  protected readonly fx: ParticleSystem;
  protected readonly shake: ScreenShake;
  private readonly services: GameServices;

  /** Fractional score accumulator; the published score is floored. */
  protected rawScore = 0;
  /** Seconds of play in the current run. Frozen once the run ends. */
  protected elapsed = 0;
  /** Seconds since death. Drives the death animation. */
  protected deathTime = 0;

  status: GameStatus = "ready";

  private publishedScore = -1;
  private publishedStats = "";

  constructor(services: GameServices, particleCapacity = 600) {
    this.services = services;
    this.input = services.input;
    this.audio = services.audio;
    this.isTouch = services.isTouch;
    this.fx = new ParticleSystem(particleCapacity);
    this.shake = new ScreenShake();
  }

  get score(): number {
    return Math.floor(this.rawScore);
  }

  /** Begins a fresh run. Safe to call on an already-finished game. */
  start(): void {
    this.rawScore = 0;
    this.elapsed = 0;
    this.deathTime = 0;
    this.publishedScore = -1;
    this.publishedStats = "";
    this.fx.clear();
    this.shake.reset();
    this.input.clear();
    this.onReset();
    this.status = "playing";
    this.publish();
  }

  update(dt: number): void {
    this.fx.update(dt);
    this.shake.update(dt);

    if (this.status === "playing") {
      this.elapsed += dt;
      this.onUpdate(dt);
      this.publish();
    } else if (this.status === "gameover") {
      this.deathTime += dt;
      this.onDeathUpdate(dt);
    }
  }

  render(g: CanvasRenderingContext2D): void {
    g.save();
    g.translate(this.shake.x, this.shake.y);
    this.onRender(g);
    this.fx.render(g);
    g.restore();
    // Overlays are drawn outside the shake transform so on-screen text stays readable.
    this.onRenderOverlay(g);
  }

  /** Called when the canvas unmounts. Override to release anything extra. */
  destroy(): void {
    this.fx.clear();
  }

  // --- Subclass surface -----------------------------------------------------

  /** Rebuild all entity state for a fresh run. */
  protected abstract onReset(): void;

  /** Advance simulation by `dt` seconds. Only called while playing. */
  protected abstract onUpdate(dt: number): void;

  /** Draw the scene. Particles are drawn on top automatically. */
  protected abstract onRender(g: CanvasRenderingContext2D): void;

  /** Runs after death so explosions/debris keep animating. */
  protected onDeathUpdate(_dt: number): void {}

  /** Drawn without screen shake applied. */
  protected onRenderOverlay(_g: CanvasRenderingContext2D): void {}

  /** Extra HUD values. Return a stable array; it is diffed before publishing. */
  protected hudStats(): HudStat[] {
    return [];
  }

  // --- Shared behavior ------------------------------------------------------

  /** Ends the run. Idempotent: only the first call in a run takes effect. */
  protected die(): void {
    if (this.status !== "playing") return;
    this.status = "gameover";
    this.deathTime = 0;
    this.publish();
    // Reports the games own elapsed clock, not wall time: elapsed only
    // advances while playing, so pausing can never inflate the run length that
    // the server checks the score against.
    this.services.onGameOver(this.score, this.elapsed);
  }

  private publish(): void {
    const s = this.score;
    if (s !== this.publishedScore) {
      this.publishedScore = s;
      this.services.onScore(s);
    }
    if (this.services.onStats) {
      const stats = this.hudStats();
      // Cheap structural diff keeps this off the React render path most frames.
      const key = stats.map((x) => x.label + ":" + x.value).join("|");
      if (key !== this.publishedStats) {
        this.publishedStats = key;
        this.services.onStats(stats);
      }
    }
  }
}
