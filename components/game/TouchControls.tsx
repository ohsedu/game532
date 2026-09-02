"use client";

import { RefObject, useCallback, useEffect, useRef } from "react";
import type { TouchMode } from "@/types/game";
import type { ArrowKey, InputManager } from "@/games/core/InputManager";

interface TouchLayerProps {
  mode: TouchMode;
  accent: string;
  /** Null until the canvas has mounted and handed its input manager over. */
  input: InputManager | null;
  disabled: boolean;
  /** The area a drag may start in — the whole game screen, board included. */
  surfaceRef: RefObject<HTMLElement | null>;
}

/** Drag distance, in CSS px, before an axis engages. */
const DEADZONE = 12;
/** Past this the origin follows the thumb, so long drags keep steering. */
const RADIUS = 52;

/**
 * Touch controls for the game screen.
 *
 * Two decisions, both from playing it on a phone:
 *
 * 1. The stick is *parked* at the outer edge of the viewport rather than
 *    spawning under the thumb. A stick that follows the finger sits on top of
 *    the play area, which is the thing the player needs to see.
 * 2. A drag anywhere on the game screen drives it — board included. Requiring
 *    the thumb to find a small circle first is worse than useless when bullets
 *    are already moving. The parked stick is an indicator, not a target.
 *
 * The facing game gets discrete buttons instead: each press is one input, so
 * an analog stick would only add latency.
 *
 * Only coarse pointers see any of this (`.touch-only`), so the desktop game
 * stays keyboard-only as designed.
 */
export default function TouchLayer({
  mode,
  accent,
  input,
  disabled,
  surfaceRef,
}: TouchLayerProps) {
  const leftKnob = useRef<HTMLDivElement | null>(null);
  const activeKnob = useRef<HTMLDivElement | null>(null);
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const inputRef = useRef(input);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const setKnob = useCallback((knob: HTMLDivElement | null, dx: number, dy: number) => {
    if (!knob) return;
    const d = Math.hypot(dx, dy);
    const k = d > RADIUS ? RADIUS / d : 1;
    knob.style.transform =
      "translate(calc(-50% + " + dx * k + "px), calc(-50% + " + dy * k + "px))";
  }, []);

  const release = useCallback(() => {
    pointerId.current = null;
    inputRef.current?.clearVirtual();
    setKnob(leftKnob.current, 0, 0);
    activeKnob.current = null;
  }, [setKnob]);

  // Lifting the thumb outside the surface, pausing, or rotating all have to
  // drop the input or the player keeps drifting.
  useEffect(() => {
    if (disabled) release();
  }, [disabled, release]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || mode !== "joystick") return;

    const down = (e: PointerEvent) => {
      if (disabledRef.current || e.pointerType === "mouse") return;
      // Never swallow a press meant for the pause or mute button.
      if ((e.target as HTMLElement | null)?.closest("button, a, input")) return;
      e.preventDefault();
      pointerId.current = e.pointerId;
      origin.current = { x: e.clientX, y: e.clientY };
      activeKnob.current = leftKnob.current;
      surface.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      e.preventDefault();
      let dx = e.clientX - origin.current.x;
      let dy = e.clientY - origin.current.y;

      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        const pull = (d - RADIUS) / d;
        origin.current.x += dx * pull;
        origin.current.y += dy * pull;
        dx = e.clientX - origin.current.x;
        dy = e.clientY - origin.current.y;
      }

      inputRef.current?.setVirtualVector(dx, dy, DEADZONE);
      setKnob(activeKnob.current, dx, dy);
    };

    const end = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
      release();
    };

    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", end);
    surface.addEventListener("pointercancel", end);
    return () => {
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", end);
      surface.removeEventListener("pointercancel", end);
    };
  }, [mode, surfaceRef, setKnob, release]);

  if (mode === "sector") {
    return (
      <>
        <DPad side="left" accent={accent} input={input} disabled={disabled} />
        <DPad side="right" accent={accent} input={input} disabled={disabled} />
      </>
    );
  }

  return (
    <>
      <StickView side="left" accent={accent} knobRef={leftKnob} disabled={disabled} />
      <BoostButton accent={accent} input={input} disabled={disabled} />
    </>
  );
}

/**
 * Purely an indicator. It is pinned to the viewport edge rather than the board,
 * so it can never sit over the play area no matter how wide the board gets.
 */
function StickView({
  side,
  accent,
  knobRef,
  disabled,
}: {
  side: "left" | "right";
  accent: string;
  knobRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={
        "touch-only pointer-events-none fixed top-1/2 z-30 h-[var(--stick-size)] w-[var(--stick-size)] -translate-y-1/2 items-center justify-center rounded-full border-2 bg-white/45 backdrop-blur-sm transition-opacity " +
        (side === "left" ? "left-[var(--pad-inset)]" : "right-[var(--pad-inset)]") +
        (disabled ? " opacity-0" : " opacity-100")
      }
      style={{ borderColor: accent + "44" }}
    >
      <div
        ref={knobRef}
        className="absolute left-1/2 top-1/2 h-[var(--knob-size)] w-[var(--knob-size)] rounded-full shadow-md"
        style={{ backgroundColor: accent, transform: "translate(-50%, -50%)" }}
      />
    </div>
  );
}

/**
 * Held, not tapped — boost burns fuel for as long as the thumb is down, which
 * is why this is a press/release pair rather than a click handler.
 */
function BoostButton({
  accent,
  input,
  disabled,
}: {
  accent: string;
  input: InputManager | null;
  disabled: boolean;
}) {
  const set = (down: boolean) => input?.setVirtualBoost(down);
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "touch-only fixed top-1/2 right-[var(--pad-inset)] z-30 h-[var(--boost-size)] w-[var(--boost-size)] -translate-y-1/2 touch-none select-none items-center justify-center rounded-full border-2 bg-white/55 text-[10px] backdrop-blur-[2px] transition-transform active:scale-90 " +
        (disabled ? "opacity-0" : "opacity-100")
      }
      style={{ borderColor: accent + "55", color: accent }}
      onPointerDown={(e) => {
        if (disabled || e.pointerType === "mouse") return;
        e.preventDefault();
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onPointerLeave={() => set(false)}
      aria-label="부스터"
    >
      BOOST
    </button>
  );
}

const DIRS: { key: ArrowKey; label: string; cell: string }[] = [
  { key: "ArrowUp", label: "↑", cell: "col-start-2 row-start-1" },
  { key: "ArrowLeft", label: "←", cell: "col-start-1 row-start-2" },
  { key: "ArrowRight", label: "→", cell: "col-start-3 row-start-2" },
  { key: "ArrowDown", label: "↓", cell: "col-start-2 row-start-3" },
];

/** Four discrete buttons, for the facing game where each press is one input. */
function DPad({
  side,
  accent,
  input,
  disabled,
}: {
  side: "left" | "right";
  accent: string;
  input: InputManager | null;
  disabled: boolean;
}) {
  return (
    <div
      className={
        "touch-only grid fixed top-1/2 z-30 -translate-y-1/2 touch-none select-none grid-cols-3 grid-rows-3 gap-1 transition-opacity " +
        (side === "left" ? "left-[var(--pad-inset)]" : "right-[var(--pad-inset)]") +
        (disabled ? " opacity-0" : " opacity-100")
      }
    >
      {DIRS.map((d) => (
        <button
          key={side + d.key}
          type="button"
          disabled={disabled}
          className={
            d.cell +
            " flex h-[var(--dpad-btn)] w-[var(--dpad-btn)] items-center justify-center rounded-2xl border-2 bg-white/70 text-lg backdrop-blur-sm transition-transform active:scale-90"
          }
          style={{ borderColor: accent + "55", color: accent }}
          // Pointer-down, not click: a facing change has to land on the frame
          // the thumb touches down, not when it lifts.
          onPointerDown={(e) => {
            if (disabled || e.pointerType === "mouse") return;
            e.preventDefault();
            input?.virtualTap(d.key);
          }}
          aria-label={d.key}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
