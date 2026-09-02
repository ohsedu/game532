"use client";

import { useCallback, useEffect, useRef } from "react";
import { GAME_HEIGHT, GAME_WIDTH, type GameId } from "@/types/game";
import type { BaseGame, HudStat } from "@/games/core/BaseGame";
import { AudioManager } from "@/games/core/AudioManager";
import { InputManager } from "@/games/core/InputManager";
import { GameLoop } from "@/games/core/GameLoop";
import { createGame } from "@/games/registry";

export interface GameCanvasProps {
  gameId: GameId;
  /** Bumping this restarts the run. */
  runId: number;
  /** Halts simulation without tearing the game down (used by overlays). */
  paused?: boolean;
  onScore: (score: number) => void;
  onStats: (stats: HudStat[]) => void;
  onGameOver: (finalScore: number) => void;
  audioRef?: (audio: AudioManager) => void;
}

/**
 * Hosts one game instance on a canvas.
 *
 * The React tree never re-renders during play: the game publishes score and HUD
 * changes through refs held by the parent, and everything else lives inside the
 * requestAnimationFrame loop.
 */
export default function GameCanvas({
  gameId,
  runId,
  paused = false,
  onScore,
  onStats,
  onGameOver,
  audioRef,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<BaseGame | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const pausedRef = useRef(paused);

  // Callbacks live in refs so changing them never rebuilds the game.
  const onScoreRef = useRef(onScore);
  const onStatsRef = useRef(onStats);
  const onGameOverRef = useRef(onGameOver);
  onScoreRef.current = onScore;
  onStatsRef.current = onStats;
  onGameOverRef.current = onGameOver;

  pausedRef.current = paused;

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
    loopRef.current = loop;
    loop.start();
    game.start();

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
      ro.disconnect();
      loop.stop();
      input.detach();
      game.destroy();
      audio.dispose();
      gameRef.current = null;
      loopRef.current = null;
      inputRef.current = null;
    };
    // audioRef is a stable setter from the parent; excluded deliberately so a
    // new inline function does not rebuild the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, resize]);

  // Restart without rebuilding: reuse the instance, as the contract requires.
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    game.start();
  }, [runId]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none select-none"
      style={{ imageRendering: "auto" }}
      aria-label="게임 화면"
    />
  );
}
