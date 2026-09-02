"use client";

import Link from "next/link";
import { formatScore } from "@/lib/format";

interface GamePauseProps {
  accent: string;
  score: number;
  best: number;
  onResume: () => void;
  onRestart: () => void;
}

export default function GamePause({
  accent,
  score,
  best,
  onResume,
  onRestart,
}: GamePauseProps) {
  return (
    <div className="absolute inset-0 z-10 flex p-3 bg-white/70 backdrop-blur-[3px] sm:p-4">
      <div className="panel-compact animate-pop card m-auto max-h-full w-full max-w-xs overflow-y-auto overscroll-contain px-7 py-8 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl"
          style={{ backgroundColor: accent + "22", color: accent }}
          aria-hidden="true"
        >
          ⏸
        </div>

        <p className="mt-4 text-2xl text-ink">일시정지</p>
        <p className="mt-1 text-xs text-ink-faint">ESC 를 다시 누르면 이어서 합니다</p>

        <div className="mt-6 flex items-center justify-center gap-6">
          <div>
            <p className="text-[11px] text-ink-faint">SCORE</p>
            <p className="num mt-0.5 text-xl font-semibold" style={{ color: accent }}>
              {formatScore(score)}
            </p>
          </div>
          <span className="h-8 w-px bg-line" aria-hidden="true" />
          <div>
            <p className="text-[11px] text-ink-faint">BEST</p>
            <p className="num mt-0.5 text-xl font-semibold text-ink-dim">
              {best > 0 ? formatScore(best) : "—"}
            </p>
          </div>
        </div>

        <div className="mt-7 grid gap-2">
          <button
            type="button"
            onClick={onResume}
            className="pill px-5 py-3 text-sm text-white transition-transform active:scale-95"
            style={{ backgroundColor: accent }}
          >
            계속하기
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onRestart}
              className="pill border border-line bg-surface px-4 py-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              다시하기
            </button>
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
