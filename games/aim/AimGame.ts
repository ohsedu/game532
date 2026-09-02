import { BaseGame, type GameServices } from "@/games/core/BaseGame";

/** Placeholder. Replaced by the real implementation. */
export class AimGame extends BaseGame {
  constructor(services: GameServices) {
    super(services);
  }

  protected onReset(): void {}

  protected onUpdate(dt: number): void {
    this.rawScore += dt;
  }

  protected onRender(g: CanvasRenderingContext2D): void {
    g.fillStyle = "#f7f8fc";
    g.fillRect(0, 0, this.width, this.height);
  }
}
