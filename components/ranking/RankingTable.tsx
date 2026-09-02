"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GameId, GameMeta } from "@/types/game";
import type { RankingEntry } from "@/types/score";
import { formatDate, formatRank, formatScore } from "@/lib/format";

interface RankingTableProps {
  games: readonly GameMeta[];
  initialGameId: GameId;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; entries: RankingEntry[] }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string };

const MEDALS: Record<number, string> = {
  1: "var(--color-gold)",
  2: "var(--color-silver)",
  3: "var(--color-bronze)",
};

export default function RankingTable({ games, initialGameId }: RankingTableProps) {
  const [gameId, setGameId] = useState<GameId>(initialGameId);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    fetch(`/api/scores?gameId=${gameId}`, { signal: controller.signal })
      .then(async (res) => {
        const data: unknown = await res.json();
        if (!res.ok) throw new Error("request failed");
        const obj = data as { configured?: boolean; entries?: RankingEntry[] };
        if (obj.configured === false) {
          setState({ kind: "unconfigured" });
          return;
        }
        setState({ kind: "ready", entries: obj.entries ?? [] });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ kind: "error", message: "랭킹을 불러오지 못했습니다." });
      });

    return () => controller.abort();
  }, [gameId]);

  const active = games.find((g) => g.id === gameId) ?? games[0];

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {games.map((g) => {
          const on = g.id === gameId;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameId(g.id)}
              className="rounded-md border px-4 py-2.5 text-xs font-bold tracking-[0.14em] transition-colors"
              style={{
                borderColor: on ? g.accent : "var(--color-line)",
                color: on ? g.accent : "var(--color-ink-faint)",
                backgroundColor: on ? g.accent + "14" : "transparent",
              }}
            >
              {g.no} {g.titleKo}
            </button>
          );
        })}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-bg-card">
        <div
          className="flex items-center justify-between border-b border-line px-5 py-3.5"
          style={{ backgroundColor: active.accent + "0d" }}
        >
          <p className="text-xs font-bold tracking-[0.2em]" style={{ color: active.accent }}>
            {active.title}
          </p>
          <Link
            href={`/game/${active.id}`}
            className="text-[11px] text-ink-faint transition-colors hover:text-ink"
          >
            도전하기 →
          </Link>
        </div>

        {state.kind === "loading" ? (
          <ul className="divide-y divide-line">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-3.5">
                <span className="h-3 w-6 rounded bg-line" />
                <span className="h-3 flex-1 rounded bg-line" />
                <span className="h-3 w-16 rounded bg-line" />
              </li>
            ))}
          </ul>
        ) : null}

        {state.kind === "unconfigured" ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-ink-dim">랭킹 서버가 아직 연결되지 않았습니다.</p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Supabase 환경변수를 설정하면 온라인 랭킹이 켜집니다.
              <br />
              그때까지 최고 점수는 브라우저에 저장됩니다.
            </p>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-direction">{state.message}</p>
          </div>
        ) : null}

        {state.kind === "ready" && state.entries.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-ink-dim">아직 등록된 기록이 없습니다.</p>
            <Link
              href={`/game/${active.id}`}
              className="mt-4 inline-block rounded-md px-5 py-2.5 text-xs font-bold tracking-[0.16em]"
              style={{ backgroundColor: active.accent, color: "#06080e" }}
            >
              1위 차지하기
            </Link>
          </div>
        ) : null}

        {state.kind === "ready" && state.entries.length > 0 ? (
          <ol className="max-h-[62vh] divide-y divide-line overflow-y-auto">
            {state.entries.map((e) => (
              <li
                key={e.rank}
                className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-bg-raised"
              >
                <span
                  className="tabular w-7 shrink-0 text-sm font-black"
                  style={{ color: MEDALS[e.rank] ?? "var(--color-ink-faint)" }}
                >
                  {formatRank(e.rank)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                  {e.nickname}
                </span>
                <span className="tabular hidden text-[11px] text-ink-faint sm:block">
                  {formatDate(e.createdAt)}
                </span>
                <span className="tabular w-24 shrink-0 text-right text-sm font-bold text-ink">
                  {formatScore(e.score)}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
