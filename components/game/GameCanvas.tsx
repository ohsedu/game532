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
  onGameOver: (finalScore: number, elapsedSeconds: number) => void;
  audioRef?: (audio: AudioManager) => void;
  /** Handed the input manager so the touch layer can drive it. */
  inputRef?: (input: InputManager) => void;
}

/**
 * Hosts one game instance on a canvas.
 *
 * The React tree never re-renders during play: the game publishes score and HUD
 * changes through refs held by the parent, and the loop lives in a ref.
 *
 * Drag-to-steer is NOT handled here — TouchLayer owns it, because a drag has to
 * be allowed to start anywhere on the game screen, not only over the canvas.
 * What stays here is the facing game's tap-a-side input, which is only
 * meaningful in board coordinates.
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
  inputRef: bindInput,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    bindInput?.(input);

    const game = createGame(gameId, {
      input,
      audio,
      isTouch: window.matchMedia("(pointer: coarse)").matches,
      onScore: (s) => onScoreRef.current(s),
      onStats: (s) => onStatsRef.current(s),
      onGameOver: (s, elapsed) => onGameOverRef.current(s, elapsed),
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

    /** Tap position relative to the play area centre -> nearest arrow. */
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

    /** Client coords -> the fixed 1000x700 logical space. */
    const toGame = (clientX: number, clientY: number): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [
        ((clientX - rect.left) / Math.max(1, rect.width)) * GAME_WIDTH,
        ((clientY - rect.top) / Math.max(1, rect.height)) * GAME_HEIGHT,
      ];
    };

    // Mouse is excluded for the arrow-driven games: they are keyboard-first by
    // design and a stray click should never move the player. Aim-style games
    // ("pointer" mode) are the exception, since there the pointer IS the input.
    const onPointerDown = (e: PointerEvent) => {
      if (pausedRef.current) return;
      const mode = touchRef.current;
      if (mode === "pointer") {
        const [gx, gy] = toGame(e.clientX, e.clientY);
        audio.unlock();
        input.setPointer(gx, gy, true);
        return;
      }
      if (e.pointerType === "mouse") return;
      if (mode === "tap") {
        // The whole board is the button. Nothing to aim at, so no coordinates.
        e.preventDefault();
        audio.unlock();
        input.virtualActionTap();
        return;
      }
      if (mode !== "sector") return;
      e.preventDefault();
      audio.unlock();
      input.virtualTap(sectorKey(e.clientX, e.clientY));
    };

    const onPointerMove = (e: PointerEvent) => {
      if (touchRef.current !== "pointer") return;
      const [gx, gy] = toGame(e.clientX, e.clientY);
      input.setPointer(gx, gy, input.pointerDown());
    };

    const onPointerUp = () => {
      if (touchRef.current !== "pointer") return;
      input.clearPointer();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

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
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
      ro.disconnect();
      loop.stop();
      input.detach();
      game.destroy();
      audio.dispose();
      gameRef.current = null;
      inputRef.current = null;
    };
    // audioRef/inputRef are stable setters from the parent; excluded so a new
    // inline function does not rebuild the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, resize]);

  // Releasing touch input on pause stops the player drifting under the overlay.
  useEffect(() => {
    if (!paused) return;
    inputRef.current?.clearVirtual();
  }, [paused]);

  // Restart without rebuilding: reuse the instance, as the contract requires.
  useEffect(() => {
    gameRef.current?.start();
  }, [runId]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none select-none"
      aria-label="게임 화면"
    />
  );
}
