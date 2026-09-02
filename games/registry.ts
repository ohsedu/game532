import type { GameId, GameMeta } from "@/types/game";
import type { BaseGame, GameServices } from "./core/BaseGame";
import { DodgeGame } from "./dodge/DodgeGame";
import { PoopGame } from "./poop/PoopGame";
import { DirectionGame } from "./direction/DirectionGame";

export const GAME_LIST: readonly GameMeta[] = [
  {
    id: "dodge",
    no: "01",
    title: "BULLET DODGE",
    titleKo: "총알 피하기",
    description: "사방에서 날아오는 총알을 피해 최대한 오래 살아남아라.",
    controls: "방향키로 이동 · 총알을 스칠수록 GRAZE 보너스",
    accent: "#4f8cff",
    touch: "joystick",
  },
  {
    id: "poop",
    no: "02",
    title: "POOP STORM",
    titleKo: "똥 피하기",
    description: "하늘에서 쏟아지는 똥을 피해라. 점점 정신없어진다.",
    controls: "방향키로 이동 · 아슬아슬하게 피하면 NEAR MISS 보너스",
    accent: "#ffa62b",
    touch: "joystick",
  },
  {
    id: "direction",
    no: "03",
    title: "FACE OFF",
    titleKo: "방향 사수",
    description: "적이 덮치는 순간 그 방향을 보고 있어야 산다. 반응속도 싸움.",
    controls: "방향키로 시선 전환 · 연속 방어로 COMBO 배수",
    accent: "#ff6b8a",
    touch: "sector",
  },
] as const;

const BY_ID = new Map<GameId, GameMeta>(GAME_LIST.map((g) => [g.id, g]));

export function getGameMeta(id: GameId): GameMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error("Unknown game id: " + id);
  return meta;
}

type GameFactory = (services: GameServices) => BaseGame;

const FACTORIES: Record<GameId, GameFactory> = {
  dodge: (s) => new DodgeGame(s),
  poop: (s) => new PoopGame(s),
  direction: (s) => new DirectionGame(s),
};

export function createGame(id: GameId, services: GameServices): BaseGame {
  return FACTORIES[id](services);
}
