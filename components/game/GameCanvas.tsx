"use client";

import { useCallback, useEffect, useRef } from "react";
import { GAME_HEIGHT, GAME_WIDTH, type GameId, type TouchMode } from "@/types/game";
import type { BaseGame, HudStat } from "@/games/core/BaseGame";
import { AudioManager } from "@/games/core/AudioManager";
import { InputManager, type ArrowKey } from "@/games/core/InputManager";
import { GameLoop } from "@/games/core/GameLoop";
import { createGame } from "@/games/registry";

export interface GameCanvasProps {
  gameId: GameId;
  /** Bumping this restarts the run. */
  runId: number;
  touch: TouchMode;
  /** Halts simulation without tearing the game down (used by overlays). */
  paused?: boolean;
  onScore: (score: number) => void;
  onStats: (stats: HudStat[]) => void;
  onGameOver: (finalScore: number) => void;
  audioRef?: (audio: AudioManager) => void;
}

/** Drag distance, in CSS px, before an axis engages. */
const JOY_DEADZONE = 14;
/** Past this the origin follows the finger, so long drags keep steering. */
const JOY_RADIUS = 58;

/**
 * Hosts one game instance on a canvas.
 *
 * The React tree never re-renders during play: the game publishes score and HUD
 * changes through refs held by the parent, the loop lives in a ref, and the
 * touch stick is positioned by writing to the DOM node directly rather than
 * through state.
 */
export default function GameCanvas({
  gameId,
  runId,
  touch,
  paused = false,
  onScore,
  onStats,
  onGameOver,
  audioRef,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<BaseGame | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const pausedRef = useRef(paused);
  const touchRef = useRef(touch);

  // Callbacks live in refs so changing them never rebuilds the game. Syncing
  // happens in an effect rather than during render: refs are not render state,
  // and writing them in the render body breaks under concurrent rendering.
  const onScoreRef = useRef(onScore);
  const onStatsRef = useRef(onStats);
  const onGameOverRef = useRef(onGameOver);

  useEffect(() => {
    onScoreRef.current = onScore;
    onStatsRef.current = onStats;
    onGameOverRef.current = onGameOver;
  }, [onScore, onStats, onGameOver]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    touchRef.current = touch;
  }, [touch]);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Cap DPR at 2: beyond that the pixel cost outweighs any visible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Map the fixed logical space onto the backing store.
    ctx.setTransform(w / GAME_WIDTH, 0, 0, h / GAME_HEIGHT, 0, 0);
  }, []);

  // Build the game once per gameId. Restart is a separate, cheaper effect.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const input = new InputManager();
    const audio = new AudioManager();
    input.attach();
    inputRef.current = input;
    audioRef?.(audio);

    const game = createGame(gameId, {
      input,
      audio,
      onScore: (s) => onScoreRef.current(s),
      onStats: (s) => onStatsRef.current(s),
      onGameOver: (s) => onGameOverRef.current(s),
    });
    gameRef.current = game;

    resize();

    const loop = new GameLoop((dt) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (!pausedRef.current) {
        game.update(dt);
      }
      ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      game.render(ctx);
      input.endFrame();
    });
    loop.start();
    game.start();

    // --- Touch controls ------------------------------------------------------
    // Mouse is deliberately excluded: the games are keyboard-first by design,
    // and a stray click-drag on desktop should never steer the player.
    let pointerId: number | null = null;
    let originX = 0;
    let originY = 0;

    const showStick = (clientX: number, clientY: number) => {
      const stick = stickRef.current;
      if (!stick) return;
      const rect = canvas.getBoundingClientRect();
      stick.style.left = clientX - rect.left + "px";
      stick.style.top = clientY - rect.top + "px";
      stick.style.opacity = "1";
      if (knobRef.current) knobRef.current.style.transform = "translate(-50%, -50%)";
    };

    const moveKnob = (dx: number, dy: number) => {
      const knob = knobRef.current;
      if (!knob) return;
      const d = Math.hypot(dx, dy);
      const k = d > JOY_RADIUS ? JOY_RADIUS / d : 1;
      knob.style.transform =
        "translate(calc(-50% + " + dx * k + "px), calc(-50% + " + dy * k + "px))";
    };

    const hideStick = () => {
      if (stickRef.current) stickRef.current.style.opacity = "0";
    };

    /** Tap position relative to the play area center -> nearest arrow. */
    const sectorKey = (clientX: number, clientY: number): ArrowKey => {
      const rect = canvas.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      // Scale to the logical space so the diagonals split the 1000x700 arena
      // evenly rather than the letterboxed CSS box.
      const sx = dx * (GAME_WIDTH / Math.max(1, rect.width));
      const sy = dy * (GAME_HEIGHT / Math.max(1, rect.height));
      if (Math.abs(sx) >= Math.abs(sy)) return sx >= 0 ? "ArrowRight" : "ArrowLeft";
      return sy >= 0 ? "ArrowDown" : "ArrowUp";
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (pausedRef.current) return;
      e.preventDefault();
      audio.unlock();

      if (touchRef.current === "sector") {
        input.virtualTap(sectorKey(e.clientX, e.clientY));
        return;
      }

      pointerId = e.pointerId;
      originX = e.clientX;
      originY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      showStick(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId !== e.pointerId || touchRef.current !== "joystick") return;
      e.preventDefault();
      let dx = e.clientX - originX;
      let dy = e.clientY - originY;

      // Origin follows once the finger passes the ring, so the stick never
      // runs out of travel during a long swipe.
      const d = Math.hypot(dx, dy);
      if (d > JOY_RADIUS) {
        const pull = (d - JOY_RADIUS) / d;
        originX += dx * pull;
        originY += dy * pull;
        dx = e.clientX - originX;
        dy = e.clientY - originY;
        showStick(originX, originY);
      }

      input.setVirtualVector(dx, dy, JOY_DEADZONE);
      moveKnob(dx, dy);
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      input.clearVirtual();
      hideStick();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // A backgrounded tab should not burn frames; dt clamping covers the return.
    const onVisibility = () => {
      if (document.hidden) loop.stop();
      else loop.start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      ro.disconnect();
      loop.stop();
      input.detach();
      game.destroy();
      audio.dispose();
      gameRef.current = null;
      inputRef.current = null;
    };
    // audioRef is a stable setter from the parent; excluded deliberately so a
    // new inline function does not rebuild the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, resize]);

  // Releasing touch input on pause stops the player drifting under the overlay.
  useEffect(() => {
    if (!paused) return;
    inputRef.current?.clearVirtual();
    if (stickRef.current) stickRef.current.style.opacity = "0";
  }, [paused]);

  // Restart without rebuilding: reuse the instance, as the contract requires.
  useEffect(() => {
    gameRef.current?.start();
  }, [runId]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        aria-label="게임 화면"
      />
      {touch === "joystick" ? (
        <div
          ref={stickRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 bg-black/10 opacity-0 transition-opacity duration-150"
        >
          <div
            ref={knobRef}
            className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 shadow-md"
          />
        </div>
      ) : null}
    </>
  );
}
