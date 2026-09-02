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
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setNickname(getSavedNickname());
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
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/82 backdrop-blur-[3px]">
      <div className="animate-pop w-full max-w-sm px-6 text-center">
        <p className="text-[11px] font-bold tracking-[0.42em] text-ink-faint">GAME OVER</p>

        {isNewRecord ? (
          <p className="animate-shimmer mt-3 text-xl font-black tracking-[0.16em]">
            ★ NEW RECORD ★
          </p>
        ) : null}

        <p className="mt-6 text-[10px] font-bold tracking-[0.28em] text-ink-faint">SCORE</p>
        <p
          className="tabular text-6xl font-black leading-none text-glow"
          style={{ color: accent }}
        >
          {formatScore(score)}
        </p>

        <p className="tabular mt-4 text-xs text-ink-faint">
          BEST <span className="text-ink-dim">{formatScore(best)}</span>
        </p>

        {submitted ? (
          <div className="mt-7 rounded-lg border border-line bg-bg-raised p-4">
            <p className="text-xs text-ink-dim">
              <span className="font-bold text-ink">{sanitizeNickname(nickname, NICKNAME_MAX)}</span>{" "}
              등록 완료
            </p>
            <p className="tabular mt-1 text-3xl font-black" style={{ color: accent }}>
              #{state.rank}
            </p>
          </div>
        ) : (
          <div className="mt-7 text-left">
            <label
              htmlFor="nickname"
              className="text-[10px] font-bold tracking-[0.24em] text-ink-faint"
            >
              닉네임
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
                className="tabular min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2.5 text-sm font-bold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-line-bright"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={state.kind === "sending"}
                className="shrink-0 rounded-md px-4 py-2.5 text-xs font-bold tracking-[0.14em] transition-opacity disabled:opacity-50"
                style={{ backgroundColor: accent, color: "#06080e" }}
              >
                {state.kind === "sending" ? "등록 중" : "점수 등록"}
              </button>
            </div>

            {state.kind === "error" ? (
              <p className="mt-2 text-[11px] text-direction">{state.message}</p>
            ) : null}
            {state.kind === "unavailable" ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                랭킹 서버가 아직 연결되지 않았습니다. 최고 점수는 이 브라우저에 저장됩니다.
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-7 grid gap-2">
          <button
            type="button"
            onClick={onRestart}
            className="rounded-md border px-4 py-3 text-xs font-bold tracking-[0.18em] transition-colors"
            style={{ borderColor: accent + "66", color: accent }}
          >
            다시하기
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/ranking?game=${gameId}`}
              className="rounded-md border border-line px-4 py-3 text-xs font-bold tracking-[0.14em] text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
            >
              랭킹 보기
            </Link>
            <Link
              href="/"
              className="rounded-md border border-line px-4 py-3 text-xs font-bold tracking-[0.14em] text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
            >
              게임 선택
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
