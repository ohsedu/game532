# Engine contract

Read this before writing any game. It is the fixed interface every game plugs
into. Do not modify anything under `games/core/`, `types/`, or `lib/` — if you
think the contract is wrong, say so in your report instead of changing it.

## Coordinate space

Every game runs in a fixed logical space:

```ts
import { GAME_WIDTH, GAME_HEIGHT } from "@/types/game"; // 1000 x 700
```

Never read `canvas.width` or `window.innerWidth`. The canvas layer handles CSS
size and `devicePixelRatio` scaling; the game only ever sees 1000x700.

## The base class

```ts
import { BaseGame, type GameServices, type HudStat } from "@/games/core/BaseGame";

export class MyGame extends BaseGame {
  constructor(services: GameServices) {
    super(services, 700); // second arg = particle pool capacity
  }

  protected onReset(): void {}                        // required: rebuild all state
  protected onUpdate(dt: number): void {}             // required: dt in seconds
  protected onRender(g: CanvasRenderingContext2D): void {} // required
  protected onDeathUpdate(dt: number): void {}        // optional: post-death animation
  protected onRenderOverlay(g: CanvasRenderingContext2D): void {} // optional: not shaken
  protected hudStats(): HudStat[] { return []; }      // optional: extra React HUD values
}
```

Available to subclasses (all already constructed for you):

| Member | Type | Notes |
| --- | --- | --- |
| `this.width` / `this.height` | `number` | 1000 / 700 |
| `this.input` | `InputManager` | arrow keys only |
| `this.audio` | `AudioManager` | `play(name, detune?, volume?)` |
| `this.fx` | `ParticleSystem` | `emit` / `burst` / `spray`, pooled |
| `this.shake` | `ScreenShake` | `add(magnitude, duration)` |
| `this.rawScore` | `number` | fractional; published floored |
| `this.elapsed` | `number` | seconds this run |
| `this.deathTime` | `number` | seconds since death |
| `this.status` | `"ready" \| "playing" \| "gameover"` | read-only in practice |
| `this.die()` | `() => void` | ends the run; idempotent |

`onUpdate` is only called while playing. Particles and shake are updated and
rendered by the base class — do not call `fx.update` / `fx.render` yourself.

## Input

```ts
import type { ArrowKey } from "@/games/core/InputManager";

this.input.axisX();          // -1 | 0 | 1  (Left/Right held)
this.input.axisY();          // -1 | 0 | 1  (Up/Down held)
this.input.isDown("ArrowUp");
this.input.justPressed("ArrowLeft"); // true only on the frame it went down
this.input.latestHeld();     // most recently pressed key still held, or null
```

Arrow keys only. No WASD, no mouse, no other keys. `endFrame()` is called by the
canvas layer — do not call it.

## Audio

`this.audio.play(name, detune = 1, volume = 1)` where name is one of:
`click`, `shoot`, `hit`, `death`, `score`, `graze`, `spawn`, `success`, `warn`.

`detune` multiplies the base frequency — use it to pitch a sound up as a combo
climbs. Playing before the user has interacted is a silent no-op, so just call
it freely.

## Particles

```ts
this.fx.emit({ x, y, vx, vy, life, size, sizeEnd, color, shape, drag, gravity, spin, additive });
this.fx.burst(x, y, count, speed, opts);                    // radial
this.fx.spray(x, y, count, angle, spread, speed, opts);     // cone
```

`shape` is `"circle" | "square" | "spark" | "ring"`. `drag` is a per-second
retention factor (0.1 = heavy drag, 1 = none). `additive: true` reads as light.

## Difficulty helpers

```ts
import { rampLinear, rampEaseIn, rampEaseOut, rampAsymptotic, stage, OPENING_GRACE }
  from "@/games/core/curve";

rampEaseOut(this.elapsed, 1.2, 4.5, 60);  // from -> to over 60s, fast early
rampEaseIn(this.elapsed, 180, 420, 90);   // gentle first, steep later
rampAsymptotic(this.elapsed, 2, 6, 45);   // approaches 8, never reaches it
stage(this.elapsed, 15);                  // 0,1,2,... one step per 15s
```

`OPENING_GRACE` (1.1s) is the shared window where nothing may kill the player.
Honor it — the first second of every game must be safe.

## Drawing helpers

```ts
import { roundRect, glowCircle, drawGrid, vignette, text, withAlpha, radialLight, MONO_FONT }
  from "@/games/core/draw";
```

`text(g, str, x, y, { size, color, align, baseline, weight, alpha, shadow, shadowBlur })`.

## Collision

```ts
import { circleHit, circleHitForgiving, rectHit, circleRectHit, edgeGap, outOfBounds }
  from "@/games/core/Collision";
```

Use `circleHitForgiving(player, hazard, forgiveness)` for anything that kills the
player — a few px of forgiveness is what makes near-misses feel fair rather than
cheap. `edgeGap` returns the gap between circle edges, for graze detection.

## Math

`vec, set, add, scale, len, normalize, dist, distSq, clamp, lerp, damp, randRange, randInt, pick`
from `@/games/core/Vector2`. Prefer `damp(a, b, lambda, dt)` over `lerp` for
frame-rate-independent smoothing.

## Hard requirements

1. **No allocation in the hot loop.** Pre-allocate entity arrays in `onReset`
   and reuse them with an `active` flag. No `new`, no array literals, no
   `.map` / `.filter` inside `onUpdate` / `onRender`.
2. **Delta time everywhere.** Every movement multiplied by `dt`. No frame-count
   assumptions.
3. **No React, no DOM, no `window` access** beyond what the engine gives you.
   These modules must stay renderer-agnostic.
4. **No timers.** No `setTimeout` / `setInterval`; drive everything off `dt`.
5. **Deterministic reset.** `onReset` must fully restore a fresh run; the game
   is reused across restarts, not re-constructed.
6. **`die()` once.** Guard so a single frame cannot end the run twice.
7. **TypeScript strict.** No `any`, no non-null assertions on possibly-undefined
   values, no unused variables (ESLint runs in the build).

---

## Action button and pointer (added for the second wave of games)

Beyond the four arrows, two more channels exist. A game uses whichever suits
it; nothing is required to use either.

### Action button

Space on desktop, an on-screen button on touch. One physical channel — a game
either *holds* it or *taps* it, never both.

```ts
this.input.isBoosting();    // held  — used by the movement games for boost
this.input.justActioned();  // edge  — true only on the frame it went down
```

Declare `touch: "action"` in the registry to get a big button on each side.

### Pointer

Only for aim-style games. Coordinates arrive already converted to the logical
1000x700 space, so the game never touches DOM rects.

```ts
this.input.pointerX;          // -1 until the pointer has been over the board
this.input.pointerY;
this.input.pointerDown();     // held
this.input.pointerJustDown(); // edge, cleared in endFrame
```

Declare `touch: "pointer"`. The touch layer then renders nothing — the board
itself is the control — and unlike every other mode the mouse is live, because
there the pointer IS the input.

### Booster

Shared speed boost with a self-refilling gauge, if a game wants one:

```ts
import { Booster } from "@/games/core/Booster";

private readonly booster = new Booster(1.7);
// onReset:  this.booster.reset()
// onUpdate: const mult = this.booster.update(dt, this.input.isBoosting())
// overlay:  this.booster.render(g, this.width - 30, 200, 11, 300, ACCENT, INK)
```

Do not re-tune its constants per game; they are shared on purpose.
