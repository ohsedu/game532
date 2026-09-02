"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameMeta } from "@/types/game";
import type { HudStat } from "@/games/core/BaseGame";
import type { AudioManager } from "@/games/core/AudioManager";
import { commitBest } from "@/lib/localBest";
import { useLocalBest } from "@/lib/useLocalBest";
import { formatScore } from "@/lib/format";
import GameCanvas from "./GameCanvas";
import GameHUD from "./GameHUD";
import GameOver from "./GameOver";
import GamePause from "./GamePause";

type Phase = "ready" | "playing" | "over";

const EMPTY_STATS: HudStat[] = [];

/**
 * Board width, capped by the height that is actually available.
 *
 * The board is a fixed 1000x700 ratio, so constraining only its width lets a
 * short viewport push the hint line below the fold and force a scroll while
 * playing. Deriving the width from the leftover height instead keeps the whole
 * screen visible at any window size. 11rem covers the nav, the hint line (two
 * lines on mobile) and the vertical padding.
 */
const BOARD_WIDTH = "min(100%, calc((100dvh - 11rem) * 10 / 7))";

export default function GameShell({ meta }: { meta: GameMeta }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<HudStat[]>(EMPTY_STATS);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [muted, setMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  // Best score is external (localStorage), so it is subscribed to rather than
  // copied into state. commitBest notifies this subscription.
  const best = useLocalBest(meta.id);

  const audioRef = useRef<AudioManager | null>(null);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const overTimerRef = useRef(0);
  // True from the moment the player dies, before the panel appears. Stops ESC
  // from pausing during the death animation.
  const endingRef = useRef(false);

  const begin = useCallback(() => {
    audioRef.current?.unlock();
    audioRef.current?.play("click");
    if (overTimerRef.current) window.clearTimeout(overTimerRef.current);
    endingRef.current = false;
    startedAtRef.current = performance.now();
    setScore(0);
    setStats(EMPTY_STATS);
    setIsNewRecord(false);
    setDurationMs(0);
    setPaused(false);
    setPhase("playing");
    setRunId((n) => n + 1);
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play("click");
    // Paused time must not count toward the run, or the score-vs-duration check
    // on the server would see an implausibly long, low-scoring run.
    if (pausedAtRef.current) {
      startedAtRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
    }
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.play("click");
    pausedAtRef.current = performance.now();
    setPaused(true);
  }, []);

  // ESC toggles pause during play. Any arrow (or Enter/Space) starts a run from
  // the ready screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (phase !== "playing" || endingRef.current) return;
        e.preventDefault();
        if (paused) resume();
        else pause();
        return;
      }
      if (phase !== "ready") return;
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
  }, [phase, paused, begin, pause, resume]);

  // Losing focus mid-run pauses rather than letting the player die off-screen.
  useEffect(() => {
    if (phase !== "playing") return;
    const onBlur = () => {
      if (endingRef.current || pausedAtRef.current) return;
      pausedAtRef.current = performance.now();
      setPaused(true);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [phase]);

  useEffect(() => {
    return () => {
      if (overTimerRef.current) window.clearTimeout(overTimerRef.current);
    };
  }, []);

  const handleGameOver = useCallback(
    (finalScore: number) => {
      endingRef.current = true;
      setDurationMs(performance.now() - startedAtRef.current);
      setIsNewRecord(commitBest(meta.id, finalScore));
      setScore(finalScore);
      // Let the death animation read before the panel covers it.
      overTimerRef.current = window.setTimeout(() => setPhase("over"), 620);
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
    <main className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col justify-center px-4 py-6 sm:px-6">
      <nav
        className="mx-auto mb-4 flex w-full items-center justify-between gap-3"
        style={{ maxWidth: BOARD_WIDTH }}
      >
        <Link
          href="/"
          className="pill border border-line bg-surface px-4 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          ← 게임 선택
        </Link>
        <p className="truncate text-sm" style={{ color: meta.accent }}>
          GAME {meta.no} · {meta.titleKo}
        </p>
        <Link
          href={`/ranking?game=${meta.id}`}
          className="pill border border-line bg-surface px-4 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          랭킹 →
        </Link>
      </nav>

      <div
        className="card relative mx-auto w-full overflow-hidden p-0"
        style={{ aspectRatio: "1000 / 700", maxWidth: BOARD_WIDTH }}
      >
        {phase === "ready" ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
            style={{
              background: `radial-gradient(620px circle at 50% 0%, ${meta.accent}1f, transparent 68%)`,
            }}
          >
            <span
              className="pill px-4 py-1.5 text-xs"
              style={{ backgroundColor: meta.accent + "22", color: meta.accent }}
            >
              GAME {meta.no}
            </span>
            <h1 className="animate-bob mt-5 text-5xl text-ink sm:text-6xl">{meta.titleKo}</h1>
            <p className="num mt-2 text-sm tracking-widest" style={{ color: meta.accent }}>
              {meta.title}
            </p>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-ink-dim">
              {meta.description}
            </p>
            <p className="mt-2 text-xs text-ink-faint">{meta.controls}</p>

            <button
              type="button"
              onClick={begin}
              className="pill mt-9 px-10 py-4 text-base text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: meta.accent }}
            >
              시작하기
            </button>
            <p className="animate-blink mt-3 text-xs text-ink-faint">
              <span className="hidden sm:inline">아무 방향키나 눌러도 시작돼요</span>
              <span className="sm:hidden">터치해서 시작하세요</span>
            </p>
            <p className="num mt-6 text-xs text-ink-faint">
              BEST {best > 0 ? formatScore(best) : "—"}
            </p>
          </div>
        ) : (
          <>
            <GameCanvas
              gameId={meta.id}
              runId={runId}
              touch={meta.touch}
              paused={paused}
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
              paused={paused}
              onToggleMute={toggleMute}
              onTogglePause={paused ? resume : pause}
            />
            {paused && phase === "playing" ? (
              <GamePause
                accent={meta.accent}
                score={score}
                best={best}
                onResume={resume}
                onRestart={begin}
              />
            ) : null}
            {phase === "over" ? (
              <GameOver
                gameId={meta.id}
                accent={meta.accent}
                score={score}
                best={Math.max(best, score)}
                isNewRecord={isNewRecord}
                durationMs={durationMs}
                onRestart={begin}
              />
            ) : null}
          </>
        )}
      </div>

      <p
        className="mx-auto mt-4 w-full text-center text-xs leading-relaxed text-ink-faint"
        style={{ maxWidth: BOARD_WIDTH }}
      >
        <span className="hidden sm:inline">
          ↑ ↓ ← → 로 조작 · <span className="text-ink-dim">ESC</span> 로 일시정지
        </span>
        <span className="sm:hidden">
          {meta.touch === "joystick"
            ? "화면을 끌어서 움직이세요"
            : "적이 오는 쪽 화면을 탭하세요"}
          {" · 우측 상단 "}
          <span className="text-ink-dim">⏸</span>
          {" 로 일시정지"}
        </span>
      </p>
    </main>
  );
}
