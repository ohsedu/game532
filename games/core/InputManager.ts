export const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
export type ArrowKey = (typeof ARROW_KEYS)[number];

function isArrow(k: string): k is ArrowKey {
  return (ARROW_KEYS as readonly string[]).includes(k);
}

/**
 * Arrow-keys-only input.
 *
 * Two sources feed the same four arrows: the physical keyboard, and a "virtual"
 * channel driven by touch. Games never learn which one is active — they still
 * only ever see the four arrows, which is what keeps the engine contract
 * unchanged while the site gains mobile controls.
 *
 * Tracks held state, per-frame press edges, and the order keys were pressed in
 * so "most recently pressed wins" is available to games that need a single
 * facing direction.
 */
export class InputManager {
  /** Boost is a separate channel: it is not a direction, so it never enters
   *  the arrow sets that drive movement and facing. */
  private boostHeld = false;
  private boostVirtual = false;
  /** Press edge on the action/boost channel, cleared each frame. */
  private actionPressed = false;
  /** Pointer in logical game coordinates; -1 when the pointer has never been
   *  over the board. Only aim-style games read it. */
  private ptrX = -1;
  private ptrY = -1;
  private ptrDown = false;
  private ptrPressed = false;
  private held = new Set<ArrowKey>();
  private virtual = new Set<ArrowKey>();
  private pressed = new Set<ArrowKey>();
  /** Virtual keys released at the end of the current frame (tap-style input). */
  private taps = new Set<ArrowKey>();
  /** Held keys in press order, oldest first. */
  private order: ArrowKey[] = [];
  private lastPress: ArrowKey | null = null;
  private attached = false;

  private beginPress(k: ArrowKey): void {
    if (!this.order.includes(k)) this.order.push(k);
    this.pressed.add(k);
    this.lastPress = k;
  }

  private endPress(k: ArrowKey): void {
    if (this.held.has(k) || this.virtual.has(k)) return;
    const i = this.order.indexOf(k);
    if (i >= 0) this.order.splice(i, 1);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      // Space scrolls the page otherwise.
      e.preventDefault();
      if (!this.boostHeld && !e.repeat) this.actionPressed = true;
      this.boostHeld = true;
      return;
    }
    if (!isArrow(e.key)) return;
    // Arrow keys scroll the page otherwise.
    e.preventDefault();
    if (e.repeat) return;
    const wasDown = this.held.has(e.key) || this.virtual.has(e.key);
    this.held.add(e.key);
    if (!wasDown) this.beginPress(e.key);
    else this.pressed.add(e.key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      e.preventDefault();
      this.boostHeld = false;
      return;
    }
    if (!isArrow(e.key)) return;
    e.preventDefault();
    this.held.delete(e.key);
    this.endPress(e.key);
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

  // --- Virtual (touch) channel ----------------------------------------------

  /** Holds or releases one arrow from the touch layer. */
  setVirtual(k: ArrowKey, down: boolean): void {
    if (down) {
      const wasDown = this.held.has(k) || this.virtual.has(k);
      this.virtual.add(k);
      if (!wasDown) this.beginPress(k);
    } else {
      this.virtual.delete(k);
      this.endPress(k);
    }
  }

  /**
   * Maps a drag vector onto the arrows, giving 8-way movement from a thumb.
   *
   * An axis engages only past `deadzone`, and the weaker axis additionally has
   * to reach `diagonalRatio` of the stronger one — without that, a drag that is
   * a few degrees off pure-horizontal registers as a diagonal and the player
   * drifts.
   */
  setVirtualVector(dx: number, dy: number, deadzone: number, diagonalRatio = 0.42): void {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const strong = Math.max(ax, ay);

    if (strong < deadzone) {
      this.clearVirtual();
      return;
    }

    const minor = strong * diagonalRatio;
    const wantRight = dx > 0 && ax >= deadzone && (ax === strong || ax >= minor);
    const wantLeft = dx < 0 && ax >= deadzone && (ax === strong || ax >= minor);
    const wantDown = dy > 0 && ay >= deadzone && (ay === strong || ay >= minor);
    const wantUp = dy < 0 && ay >= deadzone && (ay === strong || ay >= minor);

    this.setVirtual("ArrowRight", wantRight);
    this.setVirtual("ArrowLeft", wantLeft);
    this.setVirtual("ArrowDown", wantDown);
    this.setVirtual("ArrowUp", wantUp);
  }

  /**
   * One-shot press, released at the end of the frame. Used by games that read
   * press edges (facing changes) rather than held state.
   */
  virtualTap(k: ArrowKey): void {
    this.setVirtual(k, true);
    this.taps.add(k);
  }

  clearVirtual(): void {
    this.boostVirtual = false;
    if (this.virtual.size === 0) return;
    for (const k of ARROW_KEYS) {
      if (this.virtual.has(k)) {
        this.virtual.delete(k);
        this.endPress(k);
      }
    }
  }

  // --- Queries --------------------------------------------------------------

  /** True while boost is requested, from the keyboard or the touch button. */
  isBoosting(): boolean {
    return this.boostHeld || this.boostVirtual;
  }

  setVirtualBoost(down: boolean): void {
    if (down && !this.boostVirtual && !this.boostHeld) this.actionPressed = true;
    this.boostVirtual = down;
  }

  /**
   * True only on the frame the action button went down.
   *
   * Same physical channel as boost — Space, or the on-screen button. A game
   * either holds it (boost) or taps it (jump, drop); nothing needs both.
   */
  justActioned(): boolean {
    return this.actionPressed;
  }

  // --- Pointer --------------------------------------------------------------

  /** Fed by the canvas in logical game coordinates. */
  setPointer(x: number, y: number, down: boolean): void {
    this.ptrX = x;
    this.ptrY = y;
    if (down && !this.ptrDown) this.ptrPressed = true;
    this.ptrDown = down;
  }

  clearPointer(): void {
    this.ptrDown = false;
  }

  get pointerX(): number {
    return this.ptrX;
  }

  get pointerY(): number {
    return this.ptrY;
  }

  pointerDown(): boolean {
    return this.ptrDown;
  }

  /** True only on the frame the pointer went down. */
  pointerJustDown(): boolean {
    return this.ptrPressed;
  }

  isDown(k: ArrowKey): boolean {
    return this.held.has(k) || this.virtual.has(k);
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
    return (this.isDown("ArrowRight") ? 1 : 0) - (this.isDown("ArrowLeft") ? 1 : 0);
  }

  axisY(): number {
    return (this.isDown("ArrowDown") ? 1 : 0) - (this.isDown("ArrowUp") ? 1 : 0);
  }

  /** Clears press edges and one-shot taps. Call once per frame, after update. */
  endFrame(): void {
    this.pressed.clear();
    this.lastPress = null;
    this.actionPressed = false;
    this.ptrPressed = false;
    if (this.taps.size > 0) {
      for (const k of this.taps) {
        this.virtual.delete(k);
        this.endPress(k);
      }
      this.taps.clear();
    }
  }

  clear(): void {
    this.boostHeld = false;
    this.boostVirtual = false;
    this.actionPressed = false;
    this.ptrDown = false;
    this.ptrPressed = false;
    this.held.clear();
    this.virtual.clear();
    this.pressed.clear();
    this.taps.clear();
    this.order.length = 0;
    this.lastPress = null;
  }
}
