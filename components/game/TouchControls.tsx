"use client";

import { RefObject, useCallback, useEffect, useRef } from "react";
import type { TouchMode } from "@/types/game";
import type { ArrowKey, InputManager } from "@/games/core/InputManager";
import { VirtualStick } from "@/games/core/VirtualStick";

interface TouchLayerProps {
  mode: TouchMode;
  accent: string;
  /** Null until the canvas has mounted and handed its input manager over. */
  input: InputManager | null;
  disabled: boolean;
}

/** Drag distance, in CSS px, before an axis engages. */
const DEADZONE = 10;
/**
 * Past this the origin follows the thumb, so long drags keep steering.
 *
 * Down from 52. The origin trails the thumb by this much, and every reversal
 * has to unwind it first — see VirtualStick for the full accounting.
 */
const RADIUS = 34;
/** Reversal assist: origin moves this many times the thumb's motion against it. */
const REVERSE_GAIN = 2;
/** ...but only when the thumb is moving at least this fast, px/s. A tremor is slower. */
const REVERSE_SPEED = 240;
/**
 * How far the knob graphic travels at full displacement. Cosmetic.
 *
 * Bounded by the ring: (stick − knob) / 2 is 24px on a tablet and 19px on a
 * phone (globals.css), and the knob must stay inside on both.
 */
const KNOB_TRAVEL = 18;

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
}: TouchLayerProps) {
  const leftKnob = useRef<HTMLDivElement | null>(null);
  const activeKnob = useRef<HTMLDivElement | null>(null);
  const pointerId = useRef<number | null>(null);
  // Created on the first touch rather than in the initializer, so a render
  // never allocates one that a desktop player will never use.
  const stick = useRef<VirtualStick | null>(null);

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
    // The stick clamps its displacement to RADIUS, so this maps the full range
    // onto the knob's travel inside the ring instead of poking out of it.
    const k = KNOB_TRAVEL / RADIUS;
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
    if (mode !== "joystick" && mode !== "joystick-laser") return;

    const down = (e: PointerEvent) => {
      if (disabledRef.current || e.pointerType === "mouse") return;
      // Never swallow a press meant for the pause or mute button.
      if ((e.target as HTMLElement | null)?.closest("button, a, input")) return;
      e.preventDefault();
      pointerId.current = e.pointerId;
      (stick.current ??= new VirtualStick(RADIUS, REVERSE_GAIN, REVERSE_SPEED)).begin(
        e.clientX,
        e.clientY,
        e.timeStamp
      );
      activeKnob.current = leftKnob.current;
    };

    const move = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      const s = stick.current;
      if (!s) return;
      e.preventDefault();
      s.move(e.clientX, e.clientY, e.timeStamp);
      inputRef.current?.setVirtualVector(s.dx, s.dy, DEADZONE);
      setKnob(activeKnob.current, s.dx, s.dy);
    };

    const end = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      release();
    };

    // passive: false so preventDefault actually suppresses the scroll gesture.
    const opts = { passive: false } as const;
    window.addEventListener("pointerdown", down, opts);
    window.addEventListener("pointermove", move, opts);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [mode, setKnob, release]);

  // "pointer" and "tap" games are played on the board itself, so the layer
  // renders nothing at all rather than putting a button over the play area.
  if (mode === "pointer" || mode === "tap") return null;

  const left =
    mode === "sector" ? (
      <DPad accent={accent} input={input} disabled={disabled} />
    ) : mode === "jump-slide" || mode === "jump-slide-dash" ? (
      <TapButton accent={accent} input={input} disabled={disabled} label="JUMP" arrow="ArrowUp" big />
    ) : mode === "action" ? (
      <ActionButton accent={accent} input={input} disabled={disabled} label="TAP" big />
    ) : (
      <StickView accent={accent} knobRef={leftKnob} disabled={disabled} />
    );

  const right =
    mode === "sector" ? (
      <DPad accent={accent} input={input} disabled={disabled} />
    ) : mode === "jump-slide-dash" ? (
      // Jump goes under the dominant thumb on its own; the two situational
      // moves share the other side, dash above slide so a panic press lands on
      // the one that is nearly always right.
      <div className="flex flex-col items-center gap-2">
        <TapButton accent={accent} input={input} disabled={disabled} label="DASH" arrow="ArrowRight" />
        <HoldButton accent={accent} input={input} disabled={disabled} label="SLIDE" />
      </div>
    ) : mode === "jump-slide" ? (
      <HoldButton accent={accent} input={input} disabled={disabled} label="SLIDE" />
    ) : mode === "action" ? (
      <ActionButton accent={accent} input={input} disabled={disabled} label="TAP" big />
    ) : mode === "joystick-laser" ? (
      // Boost stays where the thumb already expects it; the laser sits above,
      // so reaching for the rarer move can never land on the common one.
      <div className="flex flex-col items-center gap-2">
        <SpecialButton accent={accent} input={input} disabled={disabled} label="LASER" />
        <ActionButton accent={accent} input={input} disabled={disabled} label="BOOST" />
      </div>
    ) : (
      <ActionButton accent={accent} input={input} disabled={disabled} label="BOOST" />
    );

  return (
    <div className="touch-only pointer-events-none fixed inset-0 z-30 items-center">
      <div className="flex flex-1 justify-center">{left}</div>

      {/* Reserves exactly the board is span so the controls never sit over it. */}
      <div className="shrink-0" style={{ width: "var(--board-w)" }} aria-hidden="true" />

      <div className="flex flex-1 justify-center">{right}</div>
    </div>
  );
}

/**
 * Purely an indicator. It is pinned to the viewport edge rather than the board,
 * so it can never sit over the play area no matter how wide the board gets.
 */
function StickView({
  accent,
  knobRef,
  disabled,
}: {
  accent: string;
  knobRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={
        "relative flex h-[var(--stick-size)] w-[var(--stick-size)] items-center justify-center rounded-full border-2 bg-white/45 backdrop-blur-sm transition-opacity " +
        (disabled ? "opacity-0" : "opacity-100")
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
/**
 * A tap on the special channel — a one-shot, unlike BOOST which is held.
 *
 * Fires on press rather than release: the whole point of the laser is that it
 * lands the instant the player decides they need it.
 */
function SpecialButton({
  accent,
  input,
  disabled,
  label,
}: {
  accent: string;
  input: InputManager | null;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "pointer-events-auto flex h-[var(--boost-size)] w-[var(--boost-size)] touch-none select-none items-center justify-center rounded-full border-2 bg-white/55 text-xs backdrop-blur-[2px] transition-transform active:scale-90 " +
        (disabled ? "opacity-0" : "opacity-100")
      }
      style={{ borderColor: accent + "55", color: accent }}
      onPointerDown={(e) => {
        if (disabled || e.pointerType === "mouse") return;
        e.preventDefault();
        input?.virtualSpecialTap();
      }}
      aria-label={label}
    >
      {label}
    </button>
  );
}

function ActionButton({
  accent,
  input,
  disabled,
  label,
  big,
}: {
  accent: string;
  input: InputManager | null;
  disabled: boolean;
  label: string;
  big?: boolean;
}) {
  const set = (down: boolean) => input?.setVirtualBoost(down);
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "pointer-events-auto flex touch-none select-none items-center justify-center rounded-full border-2 bg-white/55 backdrop-blur-[2px] transition-transform active:scale-90 " +
        (big
          ? "h-[var(--action-size)] w-[var(--action-size)] text-sm "
          : "h-[var(--boost-size)] w-[var(--boost-size)] text-xs ") +
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
      aria-label={label}
    >
      {label}
    </button>
  );
}

/**
 * One-shot arrow press. For moves that fire on the press edge — a dash is a
 * commitment, not something you steer with.
 */
function TapButton({
  accent,
  input,
  disabled,
  label,
  arrow,
  big,
}: {
  accent: string;
  input: InputManager | null;
  disabled: boolean;
  label: string;
  arrow: ArrowKey;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "pointer-events-auto flex touch-none select-none items-center justify-center rounded-full border-2 bg-white/55 backdrop-blur-[2px] transition-transform active:scale-90 " +
        (big
          ? "h-[var(--action-size)] w-[var(--action-size)] text-sm "
          : "h-[var(--boost-size)] w-[var(--boost-size)] text-xs ") +
        (disabled ? "opacity-0" : "opacity-100")
      }
      style={{ borderColor: accent + "55", color: accent }}
      onPointerDown={(e) => {
        if (disabled || e.pointerType === "mouse") return;
        e.preventDefault();
        input?.virtualTap(arrow);
      }}
      aria-label={label}
    >
      {label}
    </button>
  );
}

/**
 * Holds an arrow for as long as the thumb is down. Sliding is a held state, so
 * a tap-style press would end the slide the instant it began.
 */
function HoldButton({
  accent,
  input,
  disabled,
  label,
}: {
  accent: string;
  input: InputManager | null;
  disabled: boolean;
  label: string;
}) {
  const set = (down: boolean) => input?.setVirtual("ArrowDown", down);
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        "pointer-events-auto flex h-[var(--action-size)] w-[var(--action-size)] touch-none select-none items-center justify-center rounded-full border-2 bg-white/55 text-sm backdrop-blur-[2px] transition-transform active:scale-90 " +
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
      aria-label={label}
    >
      {label}
    </button>
  );
}

const DIRS: { id: string; keys: ArrowKey[]; label: string; cell: string }[] = [
  { id: "ul", keys: ["ArrowUp", "ArrowLeft"], label: "↖", cell: "col-start-1 row-start-1" },
  { id: "u", keys: ["ArrowUp"], label: "↑", cell: "col-start-2 row-start-1" },
  { id: "ur", keys: ["ArrowUp", "ArrowRight"], label: "↗", cell: "col-start-3 row-start-1" },
  { id: "l", keys: ["ArrowLeft"], label: "←", cell: "col-start-1 row-start-2" },
  { id: "r", keys: ["ArrowRight"], label: "→", cell: "col-start-3 row-start-2" },
  { id: "dl", keys: ["ArrowDown", "ArrowLeft"], label: "↙", cell: "col-start-1 row-start-3" },
  { id: "d", keys: ["ArrowDown"], label: "↓", cell: "col-start-2 row-start-3" },
  { id: "dr", keys: ["ArrowDown", "ArrowRight"], label: "↘", cell: "col-start-3 row-start-3" },
];

/** Four discrete buttons, for the facing game where each press is one input. */
function DPad({
  accent,
  input,
  disabled,
}: {
  accent: string;
  input: InputManager | null;
  disabled: boolean;
}) {
  return (
    <div
      className={
        "pointer-events-auto grid touch-none select-none grid-cols-3 grid-rows-3 gap-1 transition-opacity " +
        (disabled ? "opacity-0" : "opacity-100")
      }
    >
      {DIRS.map((d) => (
        <button
          key={d.id}
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
            for (const k of d.keys) input?.virtualTap(k);
          }}
          aria-label={d.id}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
