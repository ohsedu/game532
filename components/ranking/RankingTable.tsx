"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GameId, GameMeta } from "@/types/game";
import type { RankingEntry } from "@/types/score";
import { formatDate, formatScore } from "@/lib/format";
import { DEFAULT_AVATAR_URL, directMessageUrl, talkAvatarUrl } from "@/lib/talk";
import { usePlayer } from "@/lib/usePlayer";

interface RankingTableProps {
  games: readonly GameMeta[];
  initialGameId: GameId;
  /** First tab, fetched on the server. Null when that fetch failed. */
  initial: { configured: boolean; entries: RankingEntry[] } | null;
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

/** The talk532 avatar next to a member's name. Nothing at all for a guest. */
function RowFace({ entry }: { entry: RankingEntry }) {
  if (!entry.userId) return null;

  const src = talkAvatarUrl(entry.avatarIcon, entry.avatarImage);

  return (
    <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-surface-2">
      {src ? (
        // Storage paths and another origin's static files; next/image handles
        // neither. Lazy because a hundred of these load at once.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const el = e.currentTarget;
            if (el.src !== DEFAULT_AVATAR_URL) el.src = DEFAULT_AVATAR_URL;
          }}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm">
          {entry.avatarIcon}
        </span>
      )}
    </span>
  );
}

export default function RankingTable({
  games,
  initialGameId,
  initial,
}: RankingTableProps) {
  const [gameId, setGameId] = useState<GameId>(initialGameId);
  // Keyed by game so switching back to an already-loaded tab is instant and the
  // effect never has to set a "loading" state synchronously. Seeded with what
  // the server already sent, so the first tab never shows a skeleton.
  const [loaded, setLoaded] = useState<Partial<Record<GameId, LoadState>>>(() =>
    initial === null
      ? {}
      : {
          [initialGameId]: initial.configured
            ? { kind: "ready", entries: initial.entries }
            : { kind: "unconfigured" },
        }
  );
  const state: LoadState = loaded[gameId] ?? { kind: "loading" };

  /*
   * Who is looking, used for one thing only: hiding "대화하기" on their own row.
   *
   * The ranking itself says nothing about the viewer — that is what lets it be
   * cached and shared. This is the half that cannot be, and it is decided here
   * rather than on the server for the same reason.
   */
  const me = usePlayer();
  const myId = me.kind === "member" ? me.player.id : null;

  // Tracks which tab arrived with the page, so the effect can skip re-fetching
  // it on mount and then behave normally for every later switch.
  const servedRef = useRef(initial === null ? null : initialGameId);

  useEffect(() => {
    if (servedRef.current === gameId) {
      servedRef.current = null;
      return;
    }
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
              /*
               * "대화하기" appears on a row when the database handed back an
               * account id, which it only does for members who leave
               * themselves findable in talk532 — a row with no id is either a
               * guest or someone who turned that off, and both must look the
               * same here.
               *
               * Never on the viewer's own row: start_direct_room refuses a room
               * with yourself, so it would be a button that only errors.
               */
              const canTalk = Boolean(e.userId) && e.userId !== myId;

              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:gap-4 sm:px-6"
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

                  <RowFace entry={e} />

                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {e.nickname}
                    {e.userId === myId && myId !== null ? (
                      <span className="ml-1.5 text-[11px] text-primary">나</span>
                    ) : null}
                  </span>

                  {canTalk ? (
                    /*
                     * A link, not a button: the room is opened by talk532 with
                     * its own session, because that is the only side allowed to
                     * decide whether this person accepts messages. Same tab —
                     * a new one would leave two copies of the chat app running
                     * with disagreeing unread badges.
                     */
                    <a
                      href={directMessageUrl(e.userId as string)}
                      className="pill shrink-0 border border-primary-soft bg-primary-soft px-3 py-1.5 text-[11px] text-primary transition-colors hover:bg-primary hover:text-white"
                      title={`${e.nickname}님과 1:1 대화`}
                    >
                      대화하기
                    </a>
                  ) : null}

                  <span className="num hidden text-[11px] text-ink-faint sm:block">
                    {formatDate(e.createdAt)}
                  </span>
                  <span className="num w-20 shrink-0 text-right text-sm font-semibold text-ink sm:w-24">
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
