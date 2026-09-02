# ARCADE

방향키 네 개로만 즐기는 키보드 아케이드 미니게임 3종. 점수를 기록하고 랭킹에 도전합니다.

| | 게임 | 설명 |
| --- | --- | --- |
| GAME 01 | **BULLET DODGE** · 총알 피하기 | 사방에서 날아오는 총알을 피해 생존. 스치면 GRAZE 보너스 |
| GAME 02 | **POOP STORM** · 똥 피하기 | 하늘에서 쏟아지는 똥을 피한다. 아슬아슬하게 피하면 NEAR MISS 보너스 |
| GAME 03 | **FACE OFF** · 방향 사수 | 적이 덮치는 순간 그 방향을 보고 있어야 산다. 순수 반응속도 |

조작은 `↑ ↓ ← →` 뿐입니다. WASD도, 마우스 조작도 없습니다.

## 기술 스택

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
HTML5 Canvas · Supabase (PostgreSQL) · Vercel

게임 렌더링과 물리/충돌은 전부 Canvas + `requestAnimationFrame` 안에서 처리합니다.
React는 게임 선택, HUD, 게임 종료 화면, 랭킹 등 **바깥 UI만** 담당하며, 플레이 중에는
점수가 실제로 바뀔 때만 리렌더링됩니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000
```

Supabase 설정 없이도 **바로 플레이 가능합니다.** 이 경우 최고 점수는 브라우저
localStorage에 저장되고, 랭킹 페이지는 "연결되지 않음" 안내를 보여줍니다.

## Supabase 연결 (온라인 랭킹)

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql) 실행
3. `.env.example`을 `.env.local`로 복사하고 값 채우기

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SERVICE_ROLE_KEY`는 **서버 전용**입니다. RLS를 우회하므로 절대
`NEXT_PUBLIC_` 접두사를 붙이거나 클라이언트 컴포넌트에서 import하지 마세요.

## 점수 보안

- `scores` 테이블은 RLS 활성화. **SELECT만 공개**이고 INSERT/UPDATE/DELETE 정책은
  아예 없습니다 → 클라이언트는 직접 쓸 수 없습니다.
- 점수 등록은 `POST /api/scores`만 통과합니다. 서버에서 game_id, 닉네임 길이,
  정수/음수, 상한, **점수 대비 플레이 시간 타당성**을 검증하고 IP당 분당 10회로
  제한합니다.
- 점수는 클라이언트에서 생성되므로 완벽한 치팅 방지는 불가능합니다. 일반적인 조작을
  어렵게 만드는 수준입니다 (설계상 의도된 한계).

## API

```
GET  /api/scores?gameId=dodge     -> { configured, entries: RankingEntry[] }  상위 100명
POST /api/scores                  -> { ok, nickname, score, rank }
     { gameId, nickname, score, durationMs? }
```

동점 처리: `order by score desc, created_at asc` — 먼저 기록한 사람이 위로 갑니다.

## 구조

```
app/
  page.tsx                    메인 (게임 카드 3개)
  game/[gameId]/page.tsx      게임 화면
  ranking/page.tsx            랭킹
  api/scores/route.ts         점수 등록 / 랭킹 조회

components/
  game/    GameCanvas · GameShell · GameHUD · GameOver
  home/    GameCard
  ranking/ RankingTable

games/
  core/       GameLoop · InputManager · Collision · Vector2 · Particles ·
              ScreenShake · AudioManager · BaseGame · draw · curve
  dodge/      DodgeGame
  poop/       PoopGame
  direction/  DirectionGame
  registry.ts 게임 메타데이터 + 팩토리

lib/        format · localBest · rateLimit · supabase/{server,client}
types/      game · score
supabase/   schema.sql
docs/       ENGINE_CONTRACT.md
```

게임을 추가하려면 `types/game.ts`의 `GameId`에 값을 넣고, `BaseGame`을 상속한
클래스를 만들고, `games/registry.ts`에 메타데이터와 팩토리를 한 줄씩 추가하면
됩니다. 계약은 [`docs/ENGINE_CONTRACT.md`](docs/ENGINE_CONTRACT.md)에 있습니다.

## 게임 엔진

- **논리 좌표계 고정 1000 × 700.** 캔버스 CSS 크기와 `devicePixelRatio`는 호스트가
  처리하고(2x 상한), 게임은 항상 1000×700만 봅니다.
- **delta time 기반.** 프레임 속도가 달라도 게임 속도는 동일합니다. 백그라운드 탭
  복귀 시 터널링을 막기 위해 dt는 1/20초로 clamp합니다.
- **핫 루프 무할당.** 총알·똥·적·파티클 전부 고정 크기 풀에서 `active` 플래그로
  재사용합니다.
- **사운드는 합성.** 오디오 파일 없이 WebAudio로 생성하며, 최초 사용자 입력 전에는
  AudioContext를 만들지 않습니다.

## 브랜치

`main` 통합 · `dev` 개발 · `prod` 배포

## 배포 (Vercel)

저장소를 연결하고 위 환경변수 3개를 등록하면 됩니다. 게임 연산은 전부 브라우저에서
돌고 서버는 랭킹 조회/점수 등록만 담당하므로 무료 플랜으로 충분합니다.

```bash
npm run build      # 배포 전 점검
```
