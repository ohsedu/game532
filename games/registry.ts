import type { GameId, GameMeta } from "@/types/game";
import type { BaseGame, GameServices } from "./core/BaseGame";
import { DodgeGame } from "./dodge/DodgeGame";
import { PoopGame } from "./poop/PoopGame";
import { DirectionGame } from "./direction/DirectionGame";
import { StackGame } from "./stack/StackGame";
import { RunnerGame } from "./runner/RunnerGame";
import { AimGame } from "./aim/AimGame";

export const GAME_LIST: readonly GameMeta[] = [
  {
    id: "dodge",
    no: "01",
    title: "BULLET DODGE",
    titleKo: "총알 피하기",
    description: "사방에서 날아오는 총알을 피해 최대한 오래 살아남아라.",
    controls: "방향키로 이동 · SPACE 부스터 · 총알을 스칠수록 GRAZE 보너스",
    keys: "↑ ↓ ← → 이동 · SPACE 부스터",
    accent: "#4f8cff",
    touch: "joystick",
  },
  {
    id: "poop",
    no: "02",
    title: "POOP STORM",
    titleKo: "똥 피하기",
    description: "하늘에서 쏟아지는 똥을 피해라. 점점 정신없어진다.",
    controls: "방향키로 이동 · SPACE 부스터 · 아슬아슬하게 피하면 NEAR MISS 보너스",
    keys: "↑ ↓ ← → 이동 · SPACE 부스터",
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
    keys: "↑ ↓ ← → 로 시선 전환",
    accent: "#ff6b8a",
    touch: "sector",
  },
  {
    id: "stack",
    no: "04",
    title: "STACK UP",
    titleKo: "블록 쌓기",
    description: "움직이는 블록을 정확히 멈춰 쌓아라. 어긋난 만큼 잘려나간다.",
    controls: "정확히 멈출수록 블록이 덜 잘린다 · PERFECT 연속이면 폭이 돌아온다",
    keys: "SPACE 로 블록 내려놓기",
    accent: "#4ecb71",
    touch: "tap",
  },
  {
    id: "runner",
    no: "05",
    title: "DASH RUN",
    titleKo: "점프 러너",
    description: "끝없이 달린다. 뛰어넘고, 미끄러지고, 부딪히면 끝.",
    controls: "장애물을 뛰어넘고 미끄러져 통과 · 아슬아슬할수록 보너스",
    keys: "SPACE 점프 (길게 누르면 높이) · ↓ 슬라이드",
    accent: "#a77bff",
    touch: "jump-slide",
  },
  {
    id: "aim",
    no: "06",
    title: "AIM LAB",
    titleKo: "타겟 사수",
    description: "사라지기 전에 클릭해라. 순수 반응속도와 정확도 싸움.",
    controls: "사라지기 전에 정확히 맞혀라 · 놓치면 목숨이 준다",
    keys: "마우스로 조준하고 클릭",
    accent: "#14b8c4",
    touch: "pointer",
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
  stack: (s) => new StackGame(s),
  runner: (s) => new RunnerGame(s),
  aim: (s) => new AimGame(s),
};

export function createGame(id: GameId, services: GameServices): BaseGame {
  return FACTORIES[id](services);
}
