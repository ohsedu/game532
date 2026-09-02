import Link from "next/link";
import GameCard from "@/components/home/GameCard";
import { GAME_LIST } from "@/games/registry";
import { getTopScores } from "@/lib/topScores";

/**
 * Read fresh on every request.
 *
 * This page was cached for 30s, which meant a player could post a record, come
 * back, and be shown the old one — indistinguishable from a broken query. The
 * six lookups are indexed and run concurrently (~200ms measured), and a
 * leaderboard that is wrong is worse than one that costs a fifth of a second.
 * POST /api/scores also revalidates this path, so a submission from anywhere
 * lands immediately.
 */
export const revalidate = 0;

export default async function HomePage() {
  const top = await getTopScores();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-8 pb-16 sm:pt-12 sm:pb-24">
      <header className="animate-rise text-center">
        <span className="pill inline-block bg-primary-soft px-5 py-2 text-sm text-primary">
          간단하게 즐기는 미니게임
        </span>
        <h1 className="mt-6 text-7xl text-ink sm:text-8xl">
          <span className="text-primary">game532</span>
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-dim">
          어떤 게임을 플레이하시겠어요?
        </p>
      </header>

      <section className="mt-5 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_LIST.map((meta, i) => (
          <GameCard key={meta.id} meta={meta} index={i} top={top[meta.id] ?? null} />
        ))}
      </section>

      <footer className="animate-rise mt-12 flex flex-col items-center gap-5">
        <Link
          href="/ranking"
          className="pill bg-primary px-10 py-4 text-base text-white shadow-lg shadow-primary/25 transition-transform hover:scale-105 active:scale-95"
        >
          🏆 랭킹 보기
        </Link>
        <p className="text-xs text-ink-faint">
          키보드도, 마우스도, 터치도 · ESC 로 일시정지
        </p>
      </footer>
    </main>
  );
}
