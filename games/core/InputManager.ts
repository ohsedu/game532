export const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
export type ArrowKey = (typeof ARROW_KEYS)[number];

function isArrow(k: string): k is ArrowKey {
  return (ARROW_KEYS as readonly string[]).includes(k);
}

/**
 * Arrow-keys-only input. Tracks held state, per-frame press edges, and the
 * order keys were pressed in so "most recently pressed wins" is available to
 * games that need a single facing direction.
 *
 * Call `endFrame()` once per frame after `update` to clear press edges.
 */
export class InputManager {
  private held = new Set<ArrowKey>();
  private pressed = new Set<ArrowKey>();
  /** Held keys in press order, oldest first. */
  private order: ArrowKey[] = [];
  private lastPress: ArrowKey | null = null;
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (!isArrow(e.key)) return;
    // Arrow keys scroll the page otherwise.
    e.preventDefault();
    if (e.repeat) return;
    if (!this.held.has(e.key)) {
      this.held.add(e.key);
      this.order.push(e.key);
    }
    this.pressed.add(e.key);
    this.lastPress = e.key;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!isArrow(e.key)) return;
    e.preventDefault();
    this.held.delete(e.key);
    const i = this.order.indexOf(e.key);
    if (i >= 0) this.order.splice(i, 1);
  };

  /** Releases everything when the tab loses focus so keys don't stick down. */
  private onBlur = () => this.clear();

  attach(): void {
    if (this.attached) return;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    window.addEventListener("blur", this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.attached = false;
    this.clear();
  }

  isDown(k: ArrowKey): boolean {
    return this.held.has(k);
  }

  /** True only on the frame the key went down. */
  justPressed(k: ArrowKey): boolean {
    return this.pressed.has(k);
  }

  anyJustPressed(): ArrowKey | null {
    return this.lastPress;
  }

  /** Most recently pressed key that is still held, or null. */
  latestHeld(): ArrowKey | null {
    return this.order.length ? this.order[this.order.length - 1] : null;
  }

  axisX(): number {
    return (this.held.has("ArrowRight") ? 1 : 0) - (this.held.has("ArrowLeft") ? 1 : 0);
  }

  axisY(): number {
    return (this.held.has("ArrowDown") ? 1 : 0) - (this.held.has("ArrowUp") ? 1 : 0);
  }

  /** Clears press edges. Call once per frame, after update. */
  endFrame(): void {
    this.pressed.clear();
    this.lastPress = null;
  }

  clear(): void {
    this.held.clear();
    this.pressed.clear();
    this.order.length = 0;
    this.lastPress = null;
  }
}
