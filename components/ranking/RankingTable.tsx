"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GameId, GameMeta } from "@/types/game";
import type { RankingEntry } from "@/types/score";
import { formatDate, formatScore } from "@/lib/format";

interface RankingTableProps {
  games: readonly GameMeta[];
  initialGameId: GameId;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; entries: RankingEntry[] }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string };

const MEDALS: Record<number, { emoji: string; color: string }> = {
  1: { emoji: "🥇", color: "#ffb443" },
  2: { emoji: "🥈", color: "#b9c0cf" },
  3: { emoji: "🥉", color: "#e0a173" },
};

export default function RankingTable({ games, initialGameId }: RankingTableProps) {
  const [gameId, setGameId] = useState<GameId>(initialGameId);
  // Keyed by game so switching back to an already-loaded tab is instant and the
  // effect never has to set a "loading" state synchronously.
  const [loaded, setLoaded] = useState<Partial<Record<GameId, LoadState>>>({});
  const state: LoadState = loaded[gameId] ?? { kind: "loading" };

  useEffect(() => {
    const controller = new AbortController();

    const put = (next: LoadState) => setLoaded((prev) => ({ ...prev, [gameId]: next }));

    fetch(`/api/scores?gameId=${gameId}`, { signal: controller.signal })
      .then(async (res) => {
        const data: unknown = await res.json();
        if (!res.ok) throw new Error("request failed");
        const obj = data as { configured?: boolean; entries?: RankingEntry[] };
        if (obj.configured === false) {
          put({ kind: "unconfigured" });
          return;
        }
        put({ kind: "ready", entries: obj.entries ?? [] });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        put({ kind: "error", message: "랭킹을 불러오지 못했어요." });
      });

    return () => controller.abort();
  }, [gameId]);

  const active = games.find((g) => g.id === gameId) ?? games[0];

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2">
        {games.map((g) => {
          const on = g.id === gameId;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameId(g.id)}
              className="pill border px-5 py-2.5 text-sm transition-all"
              style={{
                borderColor: on ? g.accent : "var(--color-line)",
                color: on ? "#ffffff" : "var(--color-ink-dim)",
                backgroundColor: on ? g.accent : "var(--color-surface)",
              }}
            >
              {g.titleKo}
            </button>
          );
        })}
      </div>

      <div className="card mt-6 overflow-hidden p-0">
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ backgroundColor: active.accent + "14" }}
        >
          <p className="num text-sm tracking-widest" style={{ color: active.accent }}>
            {active.title}
          </p>
          <Link
            href={`/game/${active.id}`}
            className="pill bg-white px-4 py-1.5 text-xs text-ink-dim shadow-sm transition-colors hover:text-ink"
          >
            도전하기 →
          </Link>
        </div>

        {state.kind === "loading" ? (
          <ul className="divide-y divide-line">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 px-6 py-4">
                <span className="h-4 w-7 rounded-full bg-line" />
                <span className="h-4 flex-1 rounded-full bg-line" />
                <span className="h-4 w-16 rounded-full bg-line" />
              </li>
            ))}
          </ul>
        ) : null}

        {state.kind === "unconfigured" ? (
          <div className="px-6 py-16 text-center">
            <div className="text-4xl" aria-hidden="true">
              🔌
            </div>
            <p className="mt-3 text-sm text-ink-dim">랭킹 서버가 아직 연결되지 않았어요.</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              Supabase 환경변수를 설정하면 온라인 랭킹이 켜집니다.
              <br />
              그때까지 최고 점수는 브라우저에 저장돼요.
            </p>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="px-6 py-16 text-center">
            <div className="text-4xl" aria-hidden="true">
              😢
            </div>
            <p className="mt-3 text-sm text-direction">{state.message}</p>
          </div>
        ) : null}

        {state.kind === "ready" && state.entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="animate-bob text-4xl" aria-hidden="true">
              🌱
            </div>
            <p className="mt-3 text-sm text-ink-dim">아직 등록된 기록이 없어요.</p>
            <Link
              href={`/game/${active.id}`}
              className="pill mt-5 inline-block px-6 py-3 text-sm text-white transition-transform hover:scale-105"
              style={{ backgroundColor: active.accent }}
            >
              1위 차지하기
            </Link>
          </div>
        ) : null}

        {state.kind === "ready" && state.entries.length > 0 ? (
          <ol className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {state.entries.map((e) => {
              const medal = MEDALS[e.rank];
              return (
                <li
                  key={e.rank}
                  className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-surface-2"
                  style={medal ? { backgroundColor: medal.color + "0f" } : undefined}
                >
                  <span className="num w-8 shrink-0 text-center text-sm font-semibold text-ink-faint">
                    {medal ? (
                      <span className="text-base" aria-label={e.rank + "위"}>
                        {medal.emoji}
                      </span>
                    ) : (
                      e.rank
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.nickname}</span>
                  <span className="num hidden text-[11px] text-ink-faint sm:block">
                    {formatDate(e.createdAt)}
                  </span>
                  <span className="num w-24 shrink-0 text-right text-sm font-semibold text-ink">
                    {formatScore(e.score)}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
