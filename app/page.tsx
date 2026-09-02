import Link from "next/link";
import GameCard from "@/components/home/GameCard";
import { GAME_LIST } from "@/games/registry";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-14 sm:py-20">
      <header className="animate-rise">
        <p className="text-[11px] font-bold tracking-[0.42em] text-ink-faint">
          KEYBOARD MINIGAMES
        </p>
        <h1 className="mt-3 text-6xl font-black tracking-tighter text-accent text-glow sm:text-7xl">
          ARCADE
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-dim">
          방향키 네 개로만 즐기는 아케이드 미니게임 3종.
          <br />
          어떤 게임을 플레이하시겠습니까?
        </p>
      </header>

      <section className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_LIST.map((meta, i) => (
          <GameCard key={meta.id} meta={meta} index={i} />
        ))}
      </section>

      <footer className="animate-rise mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-xs text-ink-faint">
        <p>
          ↑ ↓ ← → 만 사용합니다 · 마우스는 메뉴에서만
        </p>
        <Link
          href="/ranking"
          className="rounded-md border border-line px-4 py-2 font-bold tracking-[0.18em] text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
        >
          🏆 RANKING
        </Link>
      </footer>
    </main>
  );
}
