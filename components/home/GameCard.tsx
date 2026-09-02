"use client";

import Link from "next/link";
import type { GameMeta } from "@/types/game";
import { useLocalBest } from "@/lib/useLocalBest";
import type { TopScore } from "@/lib/topScores";
import { formatScore } from "@/lib/format";

/** Rounded, friendly glyph so each card reads differently at a glance. */
function CardArt({ id, accent }: { id: GameMeta["id"]; accent: string }) {
  if (id === "dodge") {
    return (
      <svg viewBox="0 0 140 84" className="h-full w-full" aria-hidden="true">
        {([
          [16, 18, "#ff6b8a"],
          [122, 26, "#ffb443"],
          [26, 66, "#4ecb71"],
          [116, 62, "#a77bff"],
          [70, 10, "#ff6b8a"],
        ] as const).map(([x, y, c], i) => (
          <g key={i}>
            <circle cx={x} cy={y + 2} r={7} fill="rgba(24,28,45,0.08)" />
            <circle cx={x} cy={y} r={7} fill={c} />
          </g>
        ))}
        <ellipse cx={70} cy={50} rx={17} ry={16} fill="rgba(24,28,45,0.07)" />
        <circle cx={70} cy={47} r={16} fill="#ffffff" stroke={accent} strokeWidth={3} />
        <circle cx={70} cy={47} r={5.5} fill={accent} />
        <circle cx={64} cy={43} r={1.8} fill="#22252d" />
        <circle cx={76} cy={43} r={1.8} fill="#22252d" />
      </svg>
    );
  }

  if (id === "poop") {
    return (
      <svg viewBox="0 0 140 84" className="h-full w-full" aria-hidden="true">
        {([
          [30, 16, 9],
          [72, 8, 11],
          [110, 22, 8],
        ] as const).map(([x, y, r], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y + r * 1.05} rx={r * 1.15} ry={r * 0.8} fill="#6b4423" />
            <ellipse cx={x} cy={y + r * 0.2} rx={r * 0.82} ry={r * 0.62} fill="#8b5a2b" />
            <ellipse cx={x} cy={y - r * 0.5} rx={r * 0.5} ry={r * 0.4} fill="#a06a35" />
            <circle cx={x - r * 0.3} cy={y + r * 0.5} r={1.5} fill="#3a2412" />
            <circle cx={x + r * 0.3} cy={y + r * 0.5} r={1.5} fill="#3a2412" />
          </g>
        ))}
        <ellipse cx={70} cy={76} rx={15} ry={4} fill="rgba(24,28,45,0.10)" />
        <circle cx={70} cy={60} r={14} fill={accent} stroke="#2f2a24" strokeWidth={2.2} />
        <ellipse cx={65} cy={54} rx={3.6} ry={2.6} transform="rotate(-30 65 54)" fill="#ffffff" opacity={0.55} />
        <circle cx={65.5} cy={57.5} r={2.1} fill="#22252d" />
        <circle cx={74.5} cy={57.5} r={2.1} fill="#22252d" />
        <path d="M64.5 64 a6.2 6.2 0 0 0 11 0" stroke="#22252d" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </svg>
    );
  }

  if (id === "stack") {
    return (
      <svg viewBox="0 0 140 84" className="h-full w-full" aria-hidden="true">
        {/* Tower narrowing as it rises, with the live block sliding above it. */}
        {([
          [30, 70, 80, "#4ecb71"],
          [36, 58, 68, "#4f8cff"],
          [44, 46, 52, "#a77bff"],
          [50, 34, 40, "#ffb443"],
        ] as const).map(([x, y, w, c], i) => (
          <rect key={i} x={x} y={y} width={w} height={11} rx={4} fill={c} stroke="rgba(24,28,45,0.16)" strokeWidth={1.5} />
        ))}
        <rect x={82} y={16} width={34} height={11} rx={4} fill="#ff6b8a" stroke="rgba(24,28,45,0.16)" strokeWidth={1.5} />
        <path d="M74 21 h-14 M62 17 l-5 4 l5 4" stroke={accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (id === "runner") {
    return (
      <svg viewBox="0 0 140 84" className="h-full w-full" aria-hidden="true">
        <line x1={8} y1={66} x2={132} y2={66} stroke={accent} strokeWidth={2.5} opacity={0.4} strokeLinecap="round" />
        {/* Mid-air, arcing over the block ahead. */}
        <path d="M30 58 q14 -26 30 -4" stroke={accent} strokeWidth={2} fill="none" strokeDasharray="3 4" opacity={0.5} />
        <ellipse cx={46} cy={64} rx={11} ry={3} fill="rgba(24,28,45,0.10)" />
        <rect x={36} y={24} width={21} height={28} rx={10.5} fill={accent} stroke="#5b3fb8" strokeWidth={2} />
        <path d="M40 30 a6 6 0 0 1 6 -4" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.55} />
        <ellipse cx={46.5} cy={35} rx={8} ry={6} fill="#ffffff" />
        <circle cx={43.5} cy={35} r={1.9} fill="#22252d" />
        <circle cx={49.5} cy={35} r={1.9} fill="#22252d" />
        <circle cx={41} cy={46} r={2} fill="#ffffff" opacity={0.7} />
        <path d="M41 52 l-4 7 M52 52 l4 7" stroke="#5b3fb8" strokeWidth={3} strokeLinecap="round" />
        <rect x={84} y={50} width={16} height={16} rx={4} fill="#ff6b8a" stroke="rgba(24,28,45,0.16)" strokeWidth={1.5} />
        <rect x={110} y={30} width={20} height={9} rx={4} fill="#ffb443" stroke="rgba(24,28,45,0.16)" strokeWidth={1.5} />
      </svg>
    );
  }

  if (id === "aim") {
    return (
      <svg viewBox="0 0 140 84" className="h-full w-full" aria-hidden="true">
        {/* Two targets mid-countdown plus the crosshair on the near one. */}
        <g opacity={0.45}>
          <circle cx={34} cy={26} r={13} fill="none" stroke={accent} strokeWidth={2.5} />
          <circle cx={34} cy={26} r={6} fill={accent} />
        </g>
        <circle cx={104} cy={58} r={10} fill="none" stroke="#a77bff" strokeWidth={2.5} opacity={0.5} />
        <circle cx={104} cy={58} r={4} fill="#a77bff" opacity={0.6} />
        <circle cx={70} cy={44} r={20} fill="none" stroke={accent} strokeWidth={2.5} strokeDasharray="6 5" />
        <circle cx={70} cy={44} r={13} fill="#ffffff" stroke={accent} strokeWidth={3} />
        <circle cx={70} cy={44} r={5.5} fill={accent} />
        <path d="M70 20 v9 M70 59 v9 M46 44 h9 M85 44 h9" stroke="#22252d" strokeWidth={2.5} strokeLinecap="round" opacity={0.75} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 140 84" className="h-full w-full" aria-hidden="true">
      <circle cx={70} cy={44} r={26} fill="none" stroke={accent} strokeWidth={2.5} strokeDasharray="5 6" opacity={0.45} />
      <g>
        <circle cx={20} cy={44} r={11} fill="#a77bff" />
        <circle cx={16} cy={41} r={1.8} fill="#fff" />
        <circle cx={24} cy={41} r={1.8} fill="#fff" />
      </g>
      <ellipse cx={70} cy={62} rx={15} ry={4} fill="rgba(24,28,45,0.10)" />
      <circle cx={70} cy={44} r={15} fill="#ffffff" stroke={accent} strokeWidth={3} />
      <path d="M55 36 a15 15 0 0 0 0 17" stroke={accent} strokeWidth={5} fill="none" strokeLinecap="round" />
      <circle cx={63} cy={42} r={2} fill="#22252d" />
      <circle cx={72} cy={42} r={2} fill="#22252d" />
    </svg>
  );
}

export default function GameCard({
  meta,
  index,
  top,
}: {
  meta: GameMeta;
  index: number;
  /** Best score anyone has posted, from the server. Null when none exists. */
  top: TopScore | null;
}) {
  // The personal best lives in localStorage, so clearing site data wipes it.
  // The server number is the one that survives, which is why it leads here and
  // the local one is only shown as a personal aside.
  const mine = useLocalBest(meta.id);

  return (
    <Link
      href={`/game/${meta.id}`}
      className="group card animate-rise relative flex flex-col overflow-hidden p-0 transition-transform duration-200 hover:-translate-y-1.5"
      style={{ animationDelay: index * 80 + "ms" }}
    >
      <div
        className="relative flex h-40 items-center justify-center px-8"
        style={{
          background: `linear-gradient(160deg, ${meta.accent}26, ${meta.accent}0d)`,
        }}
      >
        <span
          className="pill absolute left-4 top-4 px-3 py-1 text-[11px] text-white"
          style={{ backgroundColor: meta.accent }}
        >
          GAME {meta.no}
        </span>
        <div className="h-24 w-full transition-transform duration-300 group-hover:scale-110">
          <CardArt id={meta.id} accent={meta.accent} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-7">
        <h2 className="text-3xl text-ink">{meta.titleKo}</h2>
        <p className="num mt-1 text-[11px] tracking-widest" style={{ color: meta.accent }}>
          {meta.title}
        </p>

        <p className="mt-4 min-h-12 text-sm leading-relaxed text-ink-dim">
          {meta.description}
        </p>
        <p className="mt-2.5 text-xs leading-relaxed text-ink-faint">{meta.controls}</p>

        <div className="mt-auto flex items-end justify-between pt-6">
          <div className="min-w-0">
            <p className="text-[10px] text-ink-faint">
              {top ? "1위 · " + top.nickname : "최고점수"}
            </p>
            <p className="num mt-0.5 truncate text-2xl font-semibold text-ink">
              {top ? formatScore(top.score) : "—"}
            </p>
            {mine > 0 ? (
              <p className="num mt-1 text-[11px] text-ink-faint">
                내 기록 {formatScore(mine)}
              </p>
            ) : null}
          </div>
          <span
            className="pill px-7 py-3 text-base text-white transition-transform group-hover:scale-105"
            style={{ backgroundColor: meta.accent }}
          >
            PLAY
          </span>
        </div>
      </div>
    </Link>
  );
}
