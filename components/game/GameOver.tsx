"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GameId } from "@/types/game";
import { NICKNAME_MAX } from "@/types/score";
import { formatScore, sanitizeNickname } from "@/lib/format";
import { getSavedNickname, saveNickname } from "@/lib/localBest";

interface GameOverProps {
  gameId: GameId;
  accent: string;
  score: number;
  best: number;
  isNewRecord: boolean;
  durationMs: number;
  onRestart: () => void;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; rank: number }
  | { kind: "error"; message: string }
  | { kind: "unavailable" };

export default function GameOver({
  gameId,
  accent,
  score,
  best,
  isNewRecord,
  durationMs,
  onRestart,
}: GameOverProps) {
  // This panel only ever mounts after a run ends, so it never renders on the
  // server — reading storage in the initializer cannot cause a hydration
  // mismatch, and avoids a wasted render pass.
  const [nickname, setNickname] = useState(getSavedNickname);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus the field so a player can type straight into it, but only after the
    // panel has animated in.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  async function submit() {
    const clean = sanitizeNickname(nickname, NICKNAME_MAX);
    if (clean.length === 0) {
      setState({ kind: "error", message: "닉네임을 입력해주세요." });
      inputRef.current?.focus();
      return;
    }

    setState({ kind: "sending" });
    saveNickname(clean);

    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, nickname: clean, score, durationMs }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (res.status === 503) {
        setState({ kind: "unavailable" });
        return;
      }
      if (!res.ok) {
        const message =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "점수 등록에 실패했습니다.";
        setState({ kind: "error", message });
        return;
      }

      const rank =
        data && typeof data === "object" && typeof (data as { rank?: unknown }).rank === "number"
          ? (data as { rank: number }).rank
          : 0;
      setState({ kind: "done", rank });
    } catch {
      setState({ kind: "error", message: "네트워크 오류입니다. 다시 시도해주세요." });
    }
  }

  const submitted = state.kind === "done";

  return (
    <div className="absolute inset-0 z-20 flex overflow-y-auto overscroll-contain bg-white/75 p-4 backdrop-blur-[3px]">
      <div className="panel-compact animate-pop card m-auto w-full max-w-sm px-7 py-7 text-center">
        {isNewRecord ? (
          <>
            <div className="panel-emoji animate-bob text-4xl" aria-hidden="true">
              🎉
            </div>
            <p className="animate-shimmer mt-2 text-xl">신기록 달성!</p>
          </>
        ) : (
          <>
            <div className="panel-emoji text-4xl" aria-hidden="true">
              😵
            </div>
            <p className="mt-2 text-xl text-ink">게임 오버</p>
          </>
        )}

        <p className="mt-6 text-[11px] text-ink-faint">SCORE</p>
        <p className="panel-score num text-5xl font-semibold leading-none" style={{ color: accent }}>
          {formatScore(score)}
        </p>
        <p className="num mt-3 text-xs text-ink-faint">BEST {formatScore(best)}</p>

        {submitted ? (
          <div
            className="mt-7 rounded-2xl px-4 py-5"
            style={{ backgroundColor: accent + "14" }}
          >
            <p className="text-xs text-ink-dim">
              <span className="text-ink">{sanitizeNickname(nickname, NICKNAME_MAX)}</span> 등록
              완료!
            </p>
            <p className="num mt-1 text-3xl font-semibold" style={{ color: accent }}>
              {state.rank}위
            </p>
          </div>
        ) : (
          <div className="mt-7 text-left">
            <label htmlFor="nickname" className="text-[11px] text-ink-faint">
              닉네임 (최대 {NICKNAME_MAX}자)
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="nickname"
                ref={inputRef}
                value={nickname}
                maxLength={NICKNAME_MAX}
                placeholder="PLAYER"
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (state.kind === "error") setState({ kind: "idle" });
                }}
                onKeyDown={(e) => {
                  // Arrow keys belong to the game; stop them bubbling to it.
                  e.stopPropagation();
                  if (e.key === "Enter") void submit();
                }}
                className="pill min-w-0 flex-1 border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={state.kind === "sending"}
                className="pill shrink-0 px-5 py-2.5 text-sm text-white transition-transform active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                {state.kind === "sending" ? "등록 중" : "등록"}
              </button>
            </div>

            {state.kind === "error" ? (
              <p className="mt-2 px-1 text-[11px] text-direction">{state.message}</p>
            ) : null}
            {state.kind === "unavailable" ? (
              <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-faint">
                랭킹 서버가 아직 연결되지 않았어요. 최고 점수는 이 브라우저에 저장됩니다.
              </p>
            ) : null}
          </div>
        )}

        <div className="panel-actions mt-6 grid gap-2">
          <button
            type="button"
            onClick={onRestart}
            className="pill px-5 py-3 text-sm text-white transition-transform hover:scale-[1.02] active:scale-95"
            style={{ backgroundColor: accent }}
          >
            다시하기
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/ranking?game=${gameId}`}
              className="pill border border-line bg-surface px-4 py-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              랭킹 보기
            </Link>
            <Link
              href="/"
              className="pill border border-line bg-surface px-4 py-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              게임 선택
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
