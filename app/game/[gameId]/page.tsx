import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isGameId } from "@/types/game";
import { GAME_LIST, getGameMeta } from "@/games/registry";
import GameShell from "@/components/game/GameShell";

export function generateStaticParams() {
  return GAME_LIST.map((g) => ({ gameId: g.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/game/[gameId]">): Promise<Metadata> {
  const { gameId } = await params;
  if (!isGameId(gameId)) return { title: "game532" };
  const meta = getGameMeta(gameId);
  return {
    title: `${meta.titleKo} · ${meta.title} — game532`,
    description: meta.description,
  };
}

export default async function GamePage({ params }: PageProps<"/game/[gameId]">) {
  const { gameId } = await params;
  if (!isGameId(gameId)) notFound();
  return <GameShell meta={getGameMeta(gameId)} />;
}
