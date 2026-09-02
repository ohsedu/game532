import type { Metadata } from "next";
import Link from "next/link";
import { isGameId, type GameId } from "@/types/game";
import { GAME_LIST } from "@/games/registry";
import RankingTable from "@/components/ranking/RankingTable";
import { getRanking } from "@/lib/ranking";

export const metadata: Metadata = {
  title: "랭킹 — game532",
  description: "게임별 상위 100명의 기록.",
};

export default async function RankingPage({ searchParams }: PageProps<"/ranking">) {
  const sp = await searchParams;
  const raw = sp.game;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const initialGameId: GameId = isGameId(requested) ? requested : GAME_LIST[0].id;

  // Fetched here rather than from the browser: the first tab arrives inside the
  // HTML, so opening the page shows a table instead of a skeleton and a round
  // trip. Other tabs still fetch on demand, and those hit an edge cache.
  let initial: Awaited<ReturnType<typeof getRanking>> | null = null;
  try {
    initial = await getRanking(initialGameId);
  } catch {
    // A leaderboard being unavailable is not a reason to refuse the page; the
    // client will retry and render its own error state.
    initial = null;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12 sm:py-16">
      <nav className="mb-8">
        <Link
          href="/"
          className="pill border border-line bg-surface px-4 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          ← 게임 선택
        </Link>
      </nav>

      <header className="animate-rise text-center">
        <div className="animate-bob text-5xl" aria-hidden="true">
          🏆
        </div>
        <h1 className="mt-3 text-4xl text-ink sm:text-5xl">랭킹</h1>
        <p className="mt-3 text-sm text-ink-dim">
          게임별 상위 100명 · 동점이면 먼저 기록한 사람이 위로 올라가요
        </p>
      </header>

      <section className="animate-rise mt-10" style={{ animationDelay: "80ms" }}>
        <RankingTable
          games={GAME_LIST}
          initialGameId={initialGameId}
          initial={initial}
        />
      </section>
    </main>
  );
}
