"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GameMeta } from "@/types/game";
import { getBest } from "@/lib/localBest";
import { formatScore } from "@/lib/format";

/** Tiny per-game canvas-free glyph so each card reads differently at a glance. */
function CardArt({ id, accent }: { id: GameMeta["id"]; accent: string }) {
  if (id === "dodge") {
    return (
      <svg viewBox="0 0 120 72" className="h-full w-full" aria-hidden="true">
        {[
          [10, 14],
          [104, 20],
          [22, 60],
          [96, 56],
          [58, 8],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3.5} fill={accent} opacity={0.85} />
        ))}
        {[
          [10, 14],
          [104, 20],
          [22, 60],
          [96, 56],
          [58, 8],
        ].map(([x, y], i) => (
          <line
            key={"l" + i}
            x1={x}
            y1={y}
            x2={60 + (x - 60) * 0.35}
            y2={36 + (y - 36) * 0.35}
            stroke={accent}
            strokeWidth={1}
            opacity={0.3}
          />
        ))}
        <circle cx={60} cy={36} r={9} fill="none" stroke={accent} strokeWidth={1.5} opacity={0.5} />
        <circle cx={60} cy={36} r={3.5} fill="#fff" />
      </svg>
    );
  }
  if (id === "poop") {
    return (
      <svg viewBox="0 0 120 72" className="h-full w-full" aria-hidden="true">
        {[
          [26, 10, 7],
          [62, 4, 9],
          [96, 16, 6],
          [44, 30, 5],
        ].map(([x, y, r], i) => (
          <g key={i} opacity={0.9}>
            <ellipse cx={x} cy={y + r * 0.7} rx={r} ry={r * 0.7} fill="#6b4423" />
            <ellipse cx={x} cy={y} rx={r * 0.68} ry={r * 0.55} fill="#8b5a2b" />
          </g>
        ))}
        <path d="M52 62 h16 v-9 a8 8 0 0 0 -16 0 z" fill={accent} />
        <circle cx={57} cy={54} r={1.5} fill="#0b0b10" />
        <circle cx={63} cy={54} r={1.5} fill="#0b0b10" />
        <line x1={8} y1={66} x2={112} y2={66} stroke={accent} strokeWidth={1.5} opacity={0.45} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 72" className="h-full w-full" aria-hidden="true">
      <circle cx={60} cy={36} r={20} fill="none" stroke={accent} strokeWidth={1} opacity={0.35} />
      <path d="M14 36 l14 -8 v16 z" fill={accent} opacity={0.9} />
      <path d="M106 36 l-14 -8 v16 z" fill={accent} opacity={0.35} />
      <circle cx={60} cy={36} r={8} fill="#e8ecf7" />
      <path d="M46 27 a16 16 0 0 0 0 18" fill="none" stroke={accent} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export default function GameCard({ meta, index }: { meta: GameMeta; index: number }) {
  const [best, setBest] = useState<number | null>(null);

  // Read after mount: localStorage is not available during SSR, and reading it
  // in render would produce a hydration mismatch.
  useEffect(() => {
    setBest(getBest(meta.id));
  }, [meta.id]);

  return (
    <Link
      href={`/game/${meta.id}`}
      className="group animate-rise scanlines relative flex flex-col overflow-hidden rounded-xl border border-line bg-bg-card p-6 transition-all duration-200 hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4"
      style={
        {
          animationDelay: index * 70 + "ms",
          "--tw-outline-color": meta.accent,
          borderColor: undefined,
        } as React.CSSProperties
      }
    >
      {/* Accent wash + border, driven by the game color. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{
          background: `radial-gradient(420px circle at 50% -10%, ${meta.accent}22, transparent 70%)`,
          boxShadow: `inset 0 0 0 1px ${meta.accent}55`,
          borderRadius: "inherit",
        }}
      />

      <div className="relative flex items-start justify-between">
        <span
          className="text-xs font-bold tracking-[0.28em]"
          style={{ color: meta.accent }}
        >
          GAME {meta.no}
        </span>
        <span className="text-[10px] tracking-[0.2em] text-ink-faint">ARROWS ONLY</span>
      </div>

      <div className="relative mt-5 h-16 opacity-80 transition-opacity group-hover:opacity-100">
        <CardArt id={meta.id} accent={meta.accent} />
      </div>

      <h2
        className="relative mt-5 text-2xl font-extrabold tracking-tight text-glow"
        style={{ color: meta.accent }}
      >
        {meta.title}
      </h2>
      <p className="relative mt-1 text-sm font-bold text-ink">{meta.titleKo}</p>

      <p className="relative mt-3 min-h-10 text-[13px] leading-relaxed text-ink-dim">
        {meta.description}
      </p>

      <p className="relative mt-3 text-[11px] leading-relaxed text-ink-faint">{meta.controls}</p>

      <div className="relative mt-5 flex items-end justify-between border-t border-line pt-4">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-ink-faint">BEST</p>
          <p className="tabular mt-0.5 text-lg font-bold text-ink">
            {best === null ? "—" : formatScore(best)}
          </p>
        </div>
        <span
          className="rounded-md px-4 py-2 text-xs font-bold tracking-[0.18em] transition-colors"
          style={{ backgroundColor: meta.accent + "1a", color: meta.accent }}
        >
          PLAY ▶
        </span>
      </div>
    </Link>
  );
}
