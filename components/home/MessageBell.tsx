"use client";

import { useEffect, useRef, useState } from "react";
import { TALK_ORIGIN, roomUrl } from "@/lib/talk";
import { askNavGuard } from "@/lib/navGuard";
import { useInbox, whenLabel } from "@/lib/useInbox";
import { usePlayer } from "@/lib/usePlayer";
import { MemberFace } from "./TalkAvatar";

/**
 * 말풍선. 봉투가 아니라 이것인 이유는 이 앱이 데려가는 곳이 우편함이 아니라
 * 대화방이어서다 — 저쪽(웹톡532)의 말투와 같은 그림이어야 같은 곳으로 간다는
 * 것이 눌러 보기 전에 읽힌다.
 */
function MessageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.15rem] w-[1.15rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/**
 * 안 읽은 개수. 999 를 넘으면 세지 않는다 — 자릿수가 늘면 배지가 버튼을 덮고,
 * 1,204 개와 999+ 개 사이에 사람이 다르게 할 일도 없다(웹톡532 와 같은 규칙).
 */
function badgeLabel(n: number): string {
  return n > 999 ? "999+" : String(n);
}

/**
 * 헤더의 메시지함.
 *
 * 로그인하지 않았으면 통째로 사라진다. 비회원에게는 올 메시지도, 데려갈 방도
 * 없어서 눌러 봐야 로그인하라는 말밖에 못 하는데, 그 말은 바로 옆의 로그인
 * 버튼이 이미 하고 있다.
 *
 * 목록의 한 줄을 누르면 웹톡532 의 그 방으로 건너간다. **게임 도중이면 먼저
 * 묻는다** — 한 판을 잃는 이동이고, 브라우저의 기본 확인창은 이 앱이 무엇을
 * 잃는지 설명할 자리가 없어서 직접 세운다(lib/navGuard.ts).
 */
export default function MessageBell() {
  const state = usePlayer();
  const userId = state.kind === "member" ? state.player.id : null;
  const inbox = useInbox(userId);

  const [open, setOpen] = useState(false);
  /** 확인을 기다리는 이동. 게임 중에만 값이 찬다. */
  const [pending, setPending] = useState<{ url: string; warn: string } | null>(
    null
  );
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 바깥을 누르거나 Escape 를 누르면 닫는다. 확인창이 떠 있는 동안에는 그쪽이
  // 먼저다 — 뒤의 패널을 닫아 버리면 무엇을 누르다 나온 물음인지가 사라진다.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      if (pending) return;
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pending) setPending(null);
      else setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pending]);

  if (state.kind !== "member") {
    /*
     * 로그인 전에는 자리도 잡지 않는다. 로그인 버튼이 이 옆에서 이미 44px 를
     * 들고 서 있어서 줄 높이가 흔들리지 않는다.
     */
    return null;
  }

  /** 여기서만 창을 옮긴다 — 게임 중인지 묻는 자리가 한 곳이어야 빠뜨리지 않는다. */
  const go = (url: string) => {
    const warn = askNavGuard();
    if (warn) {
      setPending({ url, warn });
      return;
    }
    // 대입 대신 assign — 같은 일을 하고, 렌더 중 바깥 값 수정으로 읽히지 않는다.
    window.location.assign(url);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            // 열면서 한 번 더 읽는다. 30초 폴링과 방금 도착한 말 사이의 틈을
            // 메우는 자리다.
            if (!v) inbox.refresh();
            return !v;
          });
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          inbox.unread > 0 ? `메시지 ${inbox.unread}개 안 읽음` : "메시지"
        }
        className="pill relative flex h-11 w-11 items-center justify-center border border-line bg-surface text-ink-dim shadow-sm transition-colors hover:border-line-strong hover:text-ink"
      >
        <MessageIcon />
        {inbox.unread > 0 ? (
          <span
            className="num absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#ff4d5e] px-1 text-[11px] leading-none text-white shadow-sm"
            aria-hidden="true"
          >
            {badgeLabel(inbox.unread)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="card animate-pop absolute right-0 top-full z-30 mt-2 w-[19rem] overflow-hidden p-0 text-left sm:w-[21rem]"
        >
          <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
            <p className="text-sm text-ink">메시지</p>
            <p className="num text-[11px] text-ink-faint">
              {inbox.unread > 0 ? badgeLabel(inbox.unread) + " 안 읽음" : "새 메시지 없음"}
            </p>
          </div>

          {inbox.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs leading-relaxed text-ink-faint">
              {inbox.loading ? "불러오는 중…" : "안 읽은 메시지가 없어요."}
            </p>
          ) : (
            /*
             * 열 줄이 넘어가지 않도록 위에서 이미 잘랐지만, 높이는 그것과
             * 별개로 묶는다 — 한 줄이 두 줄로 접히는 긴 이름이 섞이면 패널이
             * 화면 밖으로 자란다.
             */
            <ul className="max-h-[19rem] overflow-y-auto overscroll-contain">
              {inbox.items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => go(roomUrl(m.roomCode))}
                    className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-2">
                      <MemberFace icon={m.avatarIcon} image={m.avatarImage} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {m.title}
                        </span>
                        <span className="num shrink-0 text-[11px] text-ink-faint">
                          {whenLabel(m.createdAt)}
                        </span>
                      </span>
                      {/*
                        여럿이 있는 방에서만 보낸 사람을 앞에 붙인다. 1:1 은
                        제목이 이미 그 사람이라 이름이 두 번 나온다.
                      */}
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-dim">
                        {m.from ? (
                          <span className="text-ink-faint">{m.from} · </span>
                        ) : null}
                        {m.preview}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/*
            열한 개째부터는 여기서 세지 않는다. 스크롤을 더 길게 만드는 대신
            목록을 제대로 갖춘 곳으로 보낸다.
          */}
          {inbox.hasMore ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => go(TALK_ORIGIN)}
              className="block w-full px-4 py-3 text-center text-xs text-primary transition-colors hover:bg-surface-2"
            >
              {/*
                화면에 세운 줄 수를 빼서 센다 — INBOX_LIMIT 을 빼면, 그물에
                걸리지 않아 열 줄이 못 찬 날에 숫자가 한둘 어긋난다.
              */}
              더보기 · 웹톡532 에서 {badgeLabel(inbox.unread - inbox.items.length)}개 더
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => go(TALK_ORIGIN)}
              className="block w-full px-4 py-3 text-center text-xs text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              웹톡532 열기
            </button>
          )}
        </div>
      ) : null}

      {pending ? (
        <ConfirmLeave
          warn={pending.warn}
          onCancel={() => setPending(null)}
          onGo={() => {
            const url = pending.url;
            setPending(null);
            // 대입 대신 assign — 같은 일을 하고, 렌더 중 바깥 값 수정으로 읽히지 않는다.
    window.location.assign(url);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * "지금 나가면 이 판은 사라진다" 를 묻는 창.
 *
 * window.confirm 을 쓰지 않는 이유는 두 가지다. 그쪽은 게임 화면 위에 브라우저의
 * 회색 창을 띄워 이 앱이 무엇을 잃는지 설명할 자리가 없고, iOS 홈 화면 앱에서는
 * 아예 뜨지 않는 경우가 있다.
 */
function ConfirmLeave({
  warn,
  onCancel,
  onGo,
}: {
  warn: string;
  onCancel: () => void;
  onGo: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-6"
      role="dialog"
      aria-modal="true"
      // 패널 바깥 누름 처리가 이 위까지 올라오지 않게 막는다.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="card animate-pop w-full max-w-xs p-6 text-center">
        {/* 문구는 두 줄로 온다 — 거는 쪽이 어디서 끊을지를 정한다. */}
        <p className="whitespace-pre-line text-sm leading-relaxed text-ink">
          {warn}
        </p>
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="pill flex-1 border border-line bg-surface py-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onGo}
            className="pill flex-1 bg-primary py-3 text-sm text-white transition-transform hover:scale-105 active:scale-95"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  );
}
