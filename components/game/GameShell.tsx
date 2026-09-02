"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameMeta } from "@/types/game";
import type { HudStat } from "@/games/core/BaseGame";
import type { AudioManager } from "@/games/core/AudioManager";
import { commitBest, getBest } from "@/lib/localBest";
import GameCanvas from "./GameCanvas";
import GameHUD from "./GameHUD";
import GameOver from "./GameOver";

type Phase = "ready" | "playing" | "over";

const EMPTY_STATS: HudStat[] = [];

export default function GameShell({ meta }: { meta: GameMeta }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [runId, setRunId] = useState(0);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<HudStat[]>(EMPTY_STATS);
  const [best, setBest] = useState(0);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [muted, setMuted] = useState(false);

  const audioRef = useRef<AudioManager | null>(null);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);

  useEffect(() => {
    setBest(getBest(meta.id));
  }, [meta.id]);

  const begin = useCallback(() => {
    audioRef.current?.unlock();
    audioRef.current?.play("click");
    startedAtRef.current = performance.now();
    setScore(0);
    setStats(EMPTY_STATS);
    setIsNewRecord(false);
    setPhase("playing");
    setRunId((n) => n + 1);
  }, []);

  // Any arrow key (or Enter/Space) starts a run from the ready screen.
  useEffect(() => {
    if (phase !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, begin]);

  const handleGameOver = useCallback(
    (finalScore: number) => {
      durationRef.current = performance.now() - startedAtRef.current;
      const record = commitBest(meta.id, finalScore);
      setIsNewRecord(record);
      if (record) setBest(finalScore);
      setScore(finalScore);
      // Let the death animation read before the panel covers it.
      window.setTimeout(() => setPhase("over"), 620);
    },
    [meta.id]
  );

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.unlock();
    setMuted(audio.toggleMuted());
  }, []);

  const bindAudio = useCallback((audio: AudioManager) => {
    audioRef.current = audio;
    setMuted(audio.isMuted);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col px-4 py-6 sm:px-6">
      <nav className="mb-4 flex items-center justify-between text-xs">
        <Link
          href="/"
          className="text-ink-faint transition-colors hover:text-ink"
          aria-label="게임 선택으로"
        >
          ← ARCADE
        </Link>
        <p className="font-bold tracking-[0.22em]" style={{ color: meta.accent }}>
          GAME {meta.no} · {meta.title}
        </p>
        <Link href={`/ranking?game=${meta.id}`} className="text-ink-faint transition-colors hover:text-ink">
          RANKING →
        </Link>
      </nav>

      <div
        className="scanlines relative w-full overflow-hidden rounded-xl border bg-bg-raised"
        style={{ aspectRatio: "1000 / 700", borderColor: meta.accent + "33" }}
      >
        {phase === "ready" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <p className="text-[11px] font-bold tracking-[0.42em] text-ink-faint">
              GAME {meta.no}
            </p>
            <h1
              className="mt-3 text-4xl font-black tracking-tight text-glow sm:text-5xl"
              style={{ color: meta.accent }}
            >
              {meta.title}
            </h1>
            <p className="mt-2 text-sm font-bold text-ink">{meta.titleKo}</p>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-dim">
              {meta.description}
            </p>
            <p className="mt-2 text-xs text-ink-faint">{meta.controls}</p>

            <button
              type="button"
              onClick={begin}
              className="animate-blink mt-10 rounded-md px-8 py-3.5 text-sm font-bold tracking-[0.22em]"
              style={{ backgroundColor: meta.accent, color: "#06080e" }}
            >
              PRESS ANY ARROW
            </button>
            <p className="mt-4 text-[11px] text-ink-faint">
              BEST {best > 0 ? best.toLocaleString("en-US") : "—"}
            </p>
          </div>
        ) : (
          <>
            <GameCanvas
              gameId={meta.id}
              runId={runId}
              onScore={setScore}
              onStats={setStats}
              onGameOver={handleGameOver}
              audioRef={bindAudio}
            />
            <GameHUD
              score={score}
              best={best}
              stats={stats}
              accent={meta.accent}
              muted={muted}
              onToggleMute={toggleMute}
            />
            {phase === "over" ? (
              <GameOver
                gameId={meta.id}
                accent={meta.accent}
                score={score}
                best={Math.max(best, score)}
                isNewRecord={isNewRecord}
                durationMs={durationRef.current}
                onRestart={begin}
              />
            ) : null}
          </>
        )}
      </div>

      <p className="mt-4 text-center text-[11px] text-ink-faint">
        ↑ ↓ ← → 로 조작합니다 · 게임 중에는 마우스를 사용하지 않습니다
      </p>
    </main>
  );
}
