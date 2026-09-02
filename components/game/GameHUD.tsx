"use client";

import { memo } from "react";
import type { HudStat } from "@/games/core/BaseGame";
import { formatScore } from "@/lib/format";

interface GameHUDProps {
  score: number;
  best: number;
  stats: HudStat[];
  accent: string;
  muted: boolean;
  paused: boolean;
  onToggleMute: () => void;
  onTogglePause: () => void;
}

/**
 * Overlays the canvas. Re-renders only when the score or a stat actually
 * changes — BaseGame publishes on integer change, not per frame.
 */
function GameHUD({
  score,
  best,
  stats,
  accent,
  muted,
  paused,
  onToggleMute,
  onTogglePause,
}: GameHUDProps) {
  const beatingBest = best > 0 && score > best;

  return (
    <div className="hud-inner pointer-events-none flex items-start justify-between gap-2 p-4">
      <div className="rounded-2xl bg-white/80 px-4 py-2.5 shadow-sm backdrop-blur-sm">
        <p className="text-[10px] leading-none text-ink-faint">SCORE</p>
        <p
          className="num mt-1 text-2xl font-semibold leading-none sm:text-3xl"
          style={{ color: beatingBest ? "var(--color-gold)" : accent }}
        >
          {formatScore(score)}
        </p>
        <p className="num mt-1.5 text-[11px] leading-none text-ink-faint">
          BEST {best > 0 ? formatScore(best) : "—"}
          {beatingBest ? (
            <span className="animate-blink ml-1.5 text-gold">신기록!</span>
          ) : null}
        </p>
      </div>

      <div className="flex items-start gap-2">
        {stats.length > 0 ? (
          <div className="flex gap-4 rounded-2xl bg-white/80 px-4 py-2.5 shadow-sm backdrop-blur-sm">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <p className="text-[10px] leading-none text-ink-faint">{s.label}</p>
                <p
                  className="num mt-1 text-base font-semibold leading-none"
                  style={{ color: s.highlight ? accent : "var(--color-ink)" }}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onTogglePause}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-sm shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
          aria-label={paused ? "계속하기" : "일시정지"}
          title={paused ? "계속하기 (ESC)" : "일시정지 (ESC)"}
        >
          {paused ? "▶" : "⏸"}
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-sm shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
          aria-label={muted ? "소리 켜기" : "소리 끄기"}
          title={muted ? "소리 켜기" : "소리 끄기"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>
    </div>
  );
}

export default memo(GameHUD);
