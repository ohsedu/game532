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
  onToggleMute: () => void;
}

/**
 * Overlays the canvas. Re-renders only when the score or a stat actually
 * changes - BaseGame publishes on integer change, not per frame.
 */
function GameHUD({ score, best, stats, accent, muted, onToggleMute }: GameHUDProps) {
  const beatingBest = best > 0 && score > best;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4 sm:p-5">
      <div>
        <p className="text-[10px] font-bold tracking-[0.28em] text-ink-faint">SCORE</p>
        <p
          className="tabular text-3xl font-black leading-none sm:text-4xl"
          style={{ color: beatingBest ? "var(--color-gold)" : accent }}
        >
          {formatScore(score)}
        </p>
        <p className="tabular mt-1.5 text-[11px] text-ink-faint">
          BEST {best > 0 ? formatScore(best) : "—"}
          {beatingBest ? <span className="ml-2 text-gold animate-blink">NEW!</span> : null}
        </p>
      </div>

      <div className="flex items-start gap-4">
        {stats.map((s) => (
          <div key={s.label} className="text-right">
            <p className="text-[10px] font-bold tracking-[0.2em] text-ink-faint">{s.label}</p>
            <p
              className="tabular text-lg font-bold leading-tight"
              style={{ color: s.highlight ? accent : "var(--color-ink)" }}
            >
              {s.value}
            </p>
          </div>
        ))}

        <button
          type="button"
          onClick={onToggleMute}
          className="pointer-events-auto rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
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
