/**
 * talk532(웹톡532)로 건너가는 자리.
 *
 * 세 호스트가 한 살림을 한다.
 *
 *   game.ohsedu.site   이 앱
 *   login.ohsedu.site  로그인만 하러 건너가는 문. talk532 와 **같은 배포**다
 *   talk.ohsedu.site   talk532
 *
 * 로그인 화면을 이 앱에 두지 않는다. 인증 갈래(이메일 코드·비밀번호·구글)와 그
 * 뒤의 관문(약관·비밀번호·별명)이 저쪽에 다 있어서, 여기 한 벌 더 만들면 언젠가
 * 한쪽만 고치는 날이 온다. 세션은 `.ohsedu.site` 쿠키에 있으므로 저쪽에서
 * 로그인하고 돌아오면 이 앱은 이미 로그인 상태다 — 주소로 토큰을 주고받지 않는다.
 */

/** 세 호스트가 공유하는 뿌리. 세션 쿠키의 도메인이 이것이다. */
export const ROOT_DOMAIN = "ohsedu.site";

/**
 * 개발에서는 두 앱이 각자 다른 포트에 뜬다. 그때만 환경변수로 바꾼다 —
 * 값을 안 주면 배포 주소를 가리키고, 거기서는 localhost 로 돌려보내 주지 않는다
 * (talk532 의 safeReturnUrl 이 배포 모드에서 localhost 를 허용하지 않는다).
 */
export const TALK_ORIGIN =
  process.env.NEXT_PUBLIC_TALK_ORIGIN || "https://talk." + ROOT_DOMAIN;

export const LOGIN_ORIGIN =
  process.env.NEXT_PUBLIC_LOGIN_ORIGIN || "https://login." + ROOT_DOMAIN;

/**
 * 세션 쿠키를 어느 호스트까지 보낼지.
 *
 * `.ohsedu.site` 로 적어야 세 호스트가 같은 세션을 본다. localhost 개발에서는
 * 적지 않는다 — 점 붙은 도메인은 그 도메인 아래에서만 저장되므로, localhost 에
 * 그 값을 적으면 쿠키가 조용히 버려지고 로그인이 되지 않는다.
 *
 * talk532/lib/bridge.ts 의 같은 이름과 **값이 같아야 한다.** 어긋나면 두 앱이
 * 서로 다른 쿠키를 쓰게 되고, 로그인은 되는데 건너오면 로그아웃돼 보인다.
 */
export const COOKIE_DOMAIN: string | undefined = (() => {
  if (typeof window === "undefined") return undefined;
  const host = window.location.hostname;
  if (host === ROOT_DOMAIN || host.endsWith("." + ROOT_DOMAIN)) {
    return "." + ROOT_DOMAIN;
  }
  return undefined;
})();

/**
 * 로그인하러 보낼 주소.
 *
 * `return` 에 지금 보고 있던 주소를 실어 보낸다. 저쪽 문지기(talk532/proxy.ts)가
 * 이 값을 보고 "게임에서 온 사람" 을 가려내므로, 이것이 없으면 login 호스트는
 * 그냥 talk.ohsedu.site 로 넘겨 버린다.
 *
 * 브라우저에서만 부른다 — 돌아올 자리가 지금 화면이라서, 서버에서는 그것을
 * 알 방법이 없다.
 */
export function loginUrl(): string {
  const url = new URL("/", LOGIN_ORIGIN);
  url.searchParams.set("from", "game532");
  url.searchParams.set(
    "return",
    // 조각(#…)은 뗀다. 쿼리는 남긴다 — 랭킹의 어느 탭을 보고 있었는지가 거기 있다.
    typeof window === "undefined"
      ? "/"
      : window.location.origin + window.location.pathname + window.location.search
  );
  return url.toString();
}

/**
 * 그 사람과 1:1 대화를 시작할 주소.
 *
 * 방을 이 앱에서 만들지 않는다. talk532 의 start_direct_room 은 부르는 사람이
 * 곧 방의 한쪽이고, "말을 걸어도 되는 상대인가" 판정도 그 함수 안에 있다 —
 * 이 앱이 service-role 로 방을 만들면 그 판정을 우회하는 길이 생긴다.
 *
 * 로그인하지 않은 채로 눌러도 된다. 저쪽에서 로그인 관문이 먼저 서고, 통과하면
 * 주소에 남아 있는 이 값이 그대로 이어진다.
 */
export function directMessageUrl(userId: string): string {
  const url = new URL("/", TALK_ORIGIN);
  url.searchParams.set("dm", userId);
  return url.toString();
}

/** talk532 의 avatars 버킷. 공개 버킷이라 서명 없이 주소만으로 읽힌다. */
const AVATAR_BUCKET_BASE =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") +
  "/storage/v1/object/public/avatars/";

/**
 * 아바타를 그릴 주소. 그릴 그림이 없으면 null.
 *
 * talk532 의 avatarImageUrl 과 같은 규칙이다.
 *
 *   image 가 있으면       → Storage 의 그 경로 (`<uuid>/<시각>.webp`)
 *   icon 이 파일 이름이면  → talk532 가 배포하는 정적 파일 (`/avatars/01_default.png`)
 *   그 밖                 → null. 이모지를 쓰던 시절의 값이라 글자로 그린다
 *
 * 프리셋 목록을 이 앱에 복사해 두지 않는다. 저쪽에 그림이 예순 장 넘게 있고,
 * 늘어날 때마다 두 곳을 맞춰야 하는 목록이 된다. 대신 "파일 이름처럼 생겼는가"
 * 만 보고 넘기고, 없는 파일이면 그림이 안 뜨는 자리에서 기본 그림으로 떨어진다
 * (그리는 쪽의 onError).
 */
export function talkAvatarUrl(
  icon?: string | null,
  image?: string | null
): string | null {
  if (image) {
    // data:/blob:/http 는 그 자체가 주소다. 옛 프로필에 data URI 가 남아 있다.
    if (/^(data|blob|https?):/.test(image)) return image;
    return AVATAR_BUCKET_BASE + image;
  }

  const key = icon?.trim();
  if (!key) return TALK_ORIGIN + "/avatars/" + DEFAULT_AVATAR;
  // 파일 이름처럼 생긴 값만 파일로 본다. 이모지는 여기서 걸린다.
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  return TALK_ORIGIN + "/avatars/" + (key.includes(".") ? key : key + ".png");
}

/** 아무것도 고르지 않은 사람의 회색 실루엣. talk532 의 AVATAR_PRESETS 첫 칸이다. */
export const DEFAULT_AVATAR = "01_default.png";

export const DEFAULT_AVATAR_URL = TALK_ORIGIN + "/avatars/" + DEFAULT_AVATAR;

/**
 * 그 대화방을 여는 주소.
 *
 * talk532 는 방을 `/room/<코드>` 로 연다 — 대시보드를 거치지 않고 바로 그 방이
 * 서는 자리라, 메시지함에서 한 줄을 눌렀을 때 목록을 한 번 더 보여 주지 않는다.
 *
 * 특정 **메시지**로 내려가는 주소는 저쪽에 없다(도착지는 대시보드 안의 상태로만
 * 전해진다). 그래서 여기서 데려다줄 수 있는 가장 가까운 자리가 그 방이고,
 * 안 읽은 말은 어차피 방을 열면 맨 아래에 있다.
 */
export function roomUrl(code: string): string {
  return TALK_ORIGIN + "/room/" + encodeURIComponent(code.toUpperCase());
}
