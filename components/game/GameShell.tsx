"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameMeta, TouchMode } from "@/types/game";
import type { HudStat } from "@/games/core/BaseGame";
import type { AudioManager } from "@/games/core/AudioManager";
import type { InputManager } from "@/games/core/InputManager";
import { commitBest } from "@/lib/localBest";
import { useMyBest } from "@/lib/useMyBest";
import { formatScore } from "@/lib/format";
import { setNavGuard } from "@/lib/navGuard";
import AuthButton from "@/components/home/AuthButton";
import MessageBell from "@/components/home/MessageBell";
import GameCanvas from "./GameCanvas";
import GameHUD from "./GameHUD";
import GameOver from "./GameOver";
import GamePause from "./GamePause";
import RotateGate from "./RotateGate";
import TouchLayer from "./TouchControls";
import { PORTRAIT_PHONE, useMediaQuery } from "@/lib/useMediaQuery";

type Phase = "ready" | "playing" | "over";

const EMPTY_STATS: HudStat[] = [];

/** Phone-side control hint, keyed by how the game takes touch input. */
const TOUCH_HINT: Record<TouchMode, string> = {
  // 이 둘의 버튼에는 글자가 없다(TouchControls 의 BoostIcon·LaserIcon). 안내가
  // 화면에 없는 낱말을 부르면 찾다가 죽으므로, 그림을 부르는 말로 적는다.
  joystick: "화면을 끌어서 이동 · 번개 버튼으로 가속",
  "joystick-laser": "화면을 끌어서 이동 · 번개는 가속 · 위쪽은 레이저",
  sector: "적이 오는 쪽 화면을 탭",
  action: "TAP 버튼으로 조작",
  tap: "화면을 탭",
  "jump-slide": "JUMP 로 뛰고 SLIDE 로 미끄러지기",
  "jump-slide-dash": "JUMP · SLIDE · DASH 버튼으로 돌파",
  pointer: "타겟을 탭",
};

/**
 * Board width, capped by the height that is actually available.
 *
 * The board is a fixed 1000x700 ratio, so constraining only its width lets a
 * short viewport push the hint line below the fold and force a scroll while
 * playing. Deriving the width from the leftover height instead keeps the whole
 * screen visible at any window size. --board-reserve covers the account row,
 * the nav, the hint line (two lines on mobile) and the vertical padding.
 */
const BOARD_WIDTH = "min(100%, calc((100dvh - var(--board-reserve)) * 10 / 7))";

export default function GameShell({ meta }: { meta: GameMeta }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<HudStat[]>(EMPTY_STATS);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [muted, setMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  // Best score is external — the account's record, or localStorage for a guest
  // — so it is subscribed to rather than copied into state. Both commitBest and
  // a registered run notify this subscription.
  const best = useMyBest(meta.id);

  // handleGameOver has to compare against the best as it stood *before* the run
  // was committed, and it cannot read `best` directly: commitBest notifies
  // synchronously, so by the time the comparison ran the number would already
  // include the score being judged.
  const bestRef = useRef(best);
  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  // A phone held upright cannot show the board at a playable size, so the run
  // freezes behind the rotate prompt instead of the player dying blind.
  const portrait = useMediaQuery(PORTRAIT_PHONE);

  const [input, setInput] = useState<InputManager | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const overTimerRef = useRef(0);
  // True from the moment the player dies, before the panel appears. Stops ESC
  // from pausing during the death animation.
  const endingRef = useRef(false);

  const begin = useCallback(() => {
    audioRef.current?.unlock();
    audioRef.current?.play("click");
    if (overTimerRef.current) window.clearTimeout(overTimerRef.current);
    endingRef.current = false;
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
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.play("click");
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
      if (endingRef.current) return;
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

  /*
   * 헤더의 메시지함에게 "지금은 한 판 중" 이라고 알려 둔다.
   *
   * 메시지 한 줄을 누르면 창이 통째로 웹톡532 로 옮겨 가고, 그 순간 도중이던
   * 판은 점수도 기록도 남기지 못한 채 사라진다. 묻는 창은 그쪽이 세우고,
   * 무엇을 잃는지는 이쪽만 안다 — 그래서 문구를 여기서 준다.
   *
   * 일시정지 중에도 건다. 멈춰 있을 뿐 아직 끝나지 않은 판이라 잃는 것은 같다.
   * 정리 함수로 반드시 푼다 — 안 풀면 게임을 끝낸 뒤에도 계속 물어본다.
   */
  useEffect(() => {
    if (phase !== "playing") return;
    setNavGuard(() => {
      /*
       * 묻는 동안에도 총알은 날아온다 — 답을 고르다 죽으면 물어본 보람이 없다.
       * 그래서 물음이 서는 순간 판을 세운다. 취소하면 일시정지 화면이 남고,
       * 이어 하기는 거기서 누른다(창 포커스를 잃을 때와 같은 처리다).
       */
      if (!paused) pause();
      return "게임을 진행 중이에요.\n지금 이동하면 이번 판은 기록되지 않아요.";
    });
    return () => setNavGuard(null);
  }, [phase, paused, pause]);

  const handleGameOver = useCallback(
    (finalScore: number, elapsedSeconds: number) => {
      endingRef.current = true;
      setDurationMs(elapsedSeconds * 1000);
      // Judged against the number on screen, which for a member is their
      // account's. Beating a browser's stale copy is not a record when the
      // account already holds more — and commitBest only knows about the copy.
      setIsNewRecord(finalScore > bestRef.current);
      commitBest(meta.id, finalScore);
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

  const bindInput = useCallback((next: InputManager) => setInput(next), []);

  const padsDisabled = paused || portrait || phase === "over";
  const touchActive = phase === "playing" && !paused && !portrait;

  const bindAudio = useCallback((audio: AudioManager) => {
    audioRef.current = audio;
    setMuted(audio.isMuted);
  }, []);

  return (
    <main
      className={
        "landscape-flush mx-auto flex w-full max-w-[1000px] flex-1 flex-col justify-center px-4 py-6 sm:px-6" +
        (touchActive ? " touch-none" : "")
      }
    >
      {/*
        메시지함과 프로필은 판 위 오른쪽 끝, 홈 화면과 같은 자리에 선다.

        한때는 아래 nav 의 오른칸에 아바타만 끼워 두었다 — 줄 하나를 아끼려던
        것이었는데, 배지가 붙는 메시지함까지 그 칸에 들어가면 눌러야 할 것이
        셋이 되면서 가운데 제목이 판의 중심선에서 밀려난다. 두 화면이 같은
        자리에 같은 둘을 두면 오갈 때 눈이 옮겨 다니지 않는 이점도 있다.

        대신 줄 하나만큼 판이 작아진다. 그 높이는 --board-reserve 가 이미 세고
        있고(globals.css), 가로로 눕힌 폰에서는 이 줄이 통째로 사라진다.
      */}
      <div
        className="landscape-hide mx-auto mb-2 flex w-full items-center justify-end gap-2"
        style={{ maxWidth: BOARD_WIDTH }}
      >
        <MessageBell />
        <AuthButton />
      </div>

      {/*
        A three-column grid rather than justify-between, so the title stays on
        the board's centre line no matter how wide the two ends grow.
      */}
      <nav
        className="landscape-hide mx-auto mb-4 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3"
        style={{ maxWidth: BOARD_WIDTH }}
      >
        <div className="justify-self-start">
          <Link
            href="/"
            className="pill border border-line bg-surface px-4 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            ← 게임 선택
          </Link>
        </div>
        <p className="truncate text-sm" style={{ color: meta.accent }}>
          GAME {meta.no} · {meta.titleKo}
        </p>
        <div className="flex items-center gap-2 justify-self-end">
          <Link
            href={`/ranking?game=${meta.id}`}
            className="pill border border-line bg-surface px-4 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            랭킹 →
          </Link>
        </div>
      </nav>

      <div className="relative mx-auto w-full">
        {phase !== "ready" ? (
          <div className="hud-slot">
            <div className="mx-auto w-full" style={{ maxWidth: BOARD_WIDTH }}>
              <GameHUD
                score={score}
                best={best}
                stats={stats}
                accent={meta.accent}
                muted={muted}
                paused={paused || portrait}
                onToggleMute={toggleMute}
                onTogglePause={paused ? resume : pause}
              />
            </div>
          </div>
        ) : null}

      <div
        className="board-card card relative mx-auto w-full overflow-hidden p-0"
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
              paused={paused || portrait}
              onScore={setScore}
              onStats={setStats}
              onGameOver={handleGameOver}
              audioRef={bindAudio}
              inputRef={bindInput}
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

        <RotateGate accent={meta.accent} />
      </div>

        {phase !== "ready" ? (
          <TouchLayer
            mode={meta.touch}
            accent={meta.accent}
            input={input}
            disabled={padsDisabled}
          />
        ) : null}
      </div>

      <p
        className="landscape-hide mx-auto mt-4 w-full text-center text-xs leading-relaxed text-ink-faint"
        style={{ maxWidth: BOARD_WIDTH }}
      >
        <span className="hidden sm:inline">
          {meta.keys} · <span className="text-ink-dim">ESC</span> 로 일시정지
        </span>
        <span className="sm:hidden">
          {TOUCH_HINT[meta.touch]}
          {" · 우측 상단 "}
          <span className="text-ink-dim">⏸</span>
          {" 로 일시정지"}
        </span>
      </p>
    </main>
  );
}
