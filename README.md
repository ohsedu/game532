# game532

방향키 네 개로만 즐기는 키보드 아케이드 미니게임 3종. 점수를 기록하고 랭킹에 도전합니다.

| | 게임 | 설명 |
| --- | --- | --- |
| GAME 01 | **BULLET DODGE** · 총알 피하기 | 사방에서 날아오는 총알을 피해 생존. 스치면 GRAZE 보너스 |
| GAME 02 | **POOP STORM** · 똥 피하기 | 하늘에서 쏟아지는 똥을 피한다. 아슬아슬하게 피하면 NEAR MISS 보너스 |
| GAME 03 | **FACE OFF** · 방향 사수 | 적이 덮치는 순간 그 방향을 보고 있어야 산다. 순수 반응속도 |

조작은 `↑ ↓ ← →` 뿐입니다. WASD도, 마우스 조작도 없습니다.
플레이 중 `ESC` 로 일시정지 / 재개할 수 있습니다.

**모바일**도 지원합니다. 게임 코드는 여전히 방향키만 알고 있고, 입력 계층에서
터치를 가상 방향키로 변환합니다.

| 게임 | 터치 조작 |
| --- | --- |
| 총알 피하기 / 똥 피하기 | 화면을 끌어서 조준 (플로팅 조이스틱, 8방향) |
| 방향 사수 | 적이 오는 쪽 화면을 탭 (중앙 기준 4분할) |

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

로그인 흐름까지 로컬에서 시험하려면 [talk532](../talk532)도 같이 띄우고
`.env.local`에 `NEXT_PUBLIC_TALK_ORIGIN` / `NEXT_PUBLIC_LOGIN_ORIGIN`을 그 주소로
적어야 합니다. 배포된 talk532는 localhost로 돌려보내 주지 않습니다 — 열린
리다이렉터가 되지 않으려고 일부러 막아 둔 것입니다.

## talk532와 한 살림입니다

Supabase 프로젝트를 [talk532(웹톡532)](../talk532)와 **하나로 씁니다.** 로그인,
프로필, 1:1 대화가 저쪽에 있고 이 앱의 `game_scores` 테이블이 그 프로젝트 안에
삽니다.

| 호스트 | 무엇 |
| --- | --- |
| `game.ohsedu.site` | 이 앱 |
| `login.ohsedu.site` | 로그인만 하러 건너가는 문. **talk532와 같은 배포**입니다 |
| `talk.ohsedu.site` | talk532 |

세션은 `.ohsedu.site` 도메인 쿠키 하나에 담깁니다. 그래서 세 호스트가 로그인을
공유하고, 주소로 토큰을 주고받지 않습니다. 이 앱에는 **로그인 화면이 없습니다** —
인증 갈래(이메일 코드 / 비밀번호 / 구글)와 그 뒤의 관문(약관 / 비밀번호 / 별명)이
전부 talk532에 있어서, 한 벌 더 만들면 언젠가 한쪽만 고치는 날이 옵니다.

오른쪽 위 버튼이 로그인 상태를 보여주고, 누르면
`login.ohsedu.site/?from=game532&return=<지금 주소>`로 갑니다. talk532의
`proxy.ts`가 그 `return`이 우리 주소인지 확인하고, 아니면 `talk.ohsedu.site`로
넘깁니다.

로그인해 두면 두 가지가 달라집니다.

- **점수가 별명으로 자동 등록됩니다.** 닉네임 칸이 사라집니다 — 서버가 세션에서
  별명을 읽고 요청 본문의 이름은 무시하므로, 칸을 남겨 둬도 결과가 달라지지
  않습니다. 0점은 등록하지 않습니다.
- **랭킹에 '대화하기'가 뜹니다.** 회원 줄에만, 그리고 talk532에서 검색을 열어 둔
  사람에게만 붙습니다 — `start_direct_room`이 그 밖의 사람을 거부하므로, 안 가리면
  눌러야만 에러가 나는 버튼이 됩니다. 누르면 talk532가 자기 세션으로 1:1 방을 엽니다.

## Supabase 연결 (온라인 랭킹)

1. **talk532의 프로젝트를 그대로 씁니다** — 새로 만들지 마세요.
2. 스키마 정본은 [`talk532/supabase/game-scores.sql`](../talk532/supabase/game-scores.sql)
   입니다. talk532에서 `npm run sql`로 뽑은 `run.sql`을 SQL Editor에 붙여넣고 Run.
   (이 저장소의 [`supabase/schema.sql`](supabase/schema.sql)은 어디로 갔는지만
   알려 주는 껍데기입니다. 왜 옮겼는지는 그 파일에 적어 두었습니다.)
3. `.env.example`을 `.env.local`로 복사하고 값 채우기

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co    # talk532와 같은 값
NEXT_PUBLIC_SUPABASE_ANON_KEY=...                    # talk532와 같은 값
SUPABASE_SERVICE_ROLE_KEY=...                        # 그 프로젝트의 service_role
```

앞의 두 값이 talk532와 **다르면** 로그인은 되는데 이 앱에서는 로그아웃돼 보이고,
점수는 다른 DB로 들어갑니다.

`SUPABASE_SERVICE_ROLE_KEY`는 **서버 전용**입니다. RLS를 우회하므로 절대
`NEXT_PUBLIC_` 접두사를 붙이거나 클라이언트 컴포넌트에서 import하지 마세요.
비어 있으면 랭킹은 보이지만 점수 등록만 503으로 막힙니다.

### 랭킹에 같은 이름이 여러 줄 보이는 이유

이 앱은 한때 자기 Supabase 프로젝트를 따로 썼습니다. 거기 쌓인 스무 줄은 통합
프로젝트로 옮긴 뒤 옛 프로젝트를 지웠고, 이관 스크립트도 함께 걷었습니다
(쓸 곳이 없어진 스크립트를 남겨 두면 README가 돌아가지 않는 명령을 안내하게
됩니다. 필요하면 `git log -- scripts/migrate-scores.mjs` 에 있습니다).

옮겨온 줄은 전부 **비회원 줄**(`user_id = null`)입니다. 그 시절에는 로그인이 없어서
남은 것이 사람이 적어 넣은 닉네임뿐이었고, 그것으로 계정을 짚으면 남의 이름을
적었던 사람의 점수가 그 사람 계정에 붙습니다 — 그러면 그 줄의 '대화하기' 버튼이
엉뚱한 사람에게 말을 걸게 됩니다.

그래서 **비회원 줄은 접지 않습니다.** 옛 기록이 한 이름으로 여러 줄 서 있는 것은
정상이고, 로그인해서 한 판 하면 그때부터 쌓이는 회원 줄은 사람당 하나로 접힙니다.

## 점수 보안

- `game_scores` 테이블은 RLS 활성화. **SELECT만 공개**이고 INSERT/UPDATE/DELETE 정책은
  아예 없습니다 → 클라이언트는 직접 쓸 수 없습니다.
- 로그인한 사람의 닉네임은 **서버가 세션에서 읽습니다.** 요청 본문의 닉네임은
  비회원일 때만 읽습니다 — 클라이언트가 보낸 이름을 믿으면 남의 이름으로, 나아가
  남의 계정에 점수를 올릴 수 있습니다.
- 점수 등록은 `POST /api/scores`만 통과합니다. 서버에서 game_id, 닉네임 길이,
  정수/음수, 상한, **점수 대비 플레이 시간 타당성**을 검증하고 IP당 분당 10회로
  제한합니다.
- 점수는 클라이언트에서 생성되므로 완벽한 치팅 방지는 불가능합니다. 일반적인 조작을
  어렵게 만드는 수준입니다 (설계상 의도된 한계).

## API

```
GET  /api/scores?gameId=dodge     -> { configured, entries: RankingEntry[] }  상위 100명
POST /api/scores                  -> { ok, nickname, score, rank, member }
     { gameId, nickname, score, durationMs? }   # nickname 은 비회원일 때만 읽힘
```

동점 처리: `order by score desc, created_at asc` — 먼저 기록한 사람이 위로 갑니다.

회원 점수는 **사람당 최고 한 줄**로 접힙니다. 접지 않으면 잘하는 사람 하나가
상위권을 제 점수로 도배하고(제출마다 한 줄이라 실제로 그렇게 됩니다), 그 줄마다
'대화하기' 버튼이 하나씩 달립니다. 비회원 점수는 접지 않습니다 — 접으려면 닉네임이
같으면 같은 사람이라고 봐야 하는데, 그건 남의 이름을 적어 남의 줄을 지우는 길입니다.

`rank`가 0이면 상위 100위 밖이라는 뜻입니다. 회원은 줄이 아니라 **계정**으로 찾으므로,
이번 판이 자기 최고 기록을 넘지 못했으면 여전히 서 있는 자리를 알려줍니다.

`GET`은 **보는 사람이 누구든 같은 답**입니다(엣지에서 20초 캐시). "이 줄이 나야"와
'대화하기'를 감출지는 화면이 자기 세션으로 판단합니다. 이 응답에 세션을 섞으면
토큰 갱신의 `Set-Cookie`가 캐시된 응답에 붙어 남의 세션이 흘러갈 수 있습니다.

## 구조

```
app/
  page.tsx                    메인 (게임 카드 3개)
  game/[gameId]/page.tsx      게임 화면
  ranking/page.tsx            랭킹
  api/scores/route.ts         점수 등록 / 랭킹 조회

components/
  game/    GameCanvas · GameShell · GameHUD · GameOver
  home/    GameCard · AuthButton      로그인 상태 / 계정 메뉴
  ranking/ RankingTable               '대화하기' 가 붙는 자리

games/
  core/       GameLoop · InputManager · Collision · Vector2 · Particles ·
              ScreenShake · AudioManager · BaseGame · draw · curve
  dodge/      DodgeGame
  poop/       PoopGame
  direction/  DirectionGame
  registry.ts 게임 메타데이터 + 팩토리

lib/        format · localBest · rateLimit · supabase/{server,client}
            talk        talk532 로 건너가는 주소와 아바타 (로그인 · 1:1 대화)
            usePlayer   세션 쿠키에서 읽는 "지금 누가 하고 있나"
types/      game · score
supabase/   schema.sql  ← 껍데기. 정본은 talk532/supabase/game-scores.sql
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
- **입력은 4개 화살표가 전부.** 물리 키보드와 터치가 같은 4개 채널로 합류하므로
  게임은 입력 장치를 구분하지 않습니다 (`InputManager`의 virtual 채널).

## 브랜치

`main` 통합 · `dev` 개발 · `prod` 배포

## 배포 (Vercel)

저장소를 연결하고 위 환경변수 3개를 등록하면 됩니다. 게임 연산은 전부 브라우저에서
돌고 서버는 랭킹 조회/점수 등록만 담당하므로 무료 플랜으로 충분합니다.

```bash
npm run build      # 배포 전 점검
```
