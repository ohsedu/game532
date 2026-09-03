"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { TALK_ORIGIN, loginUrl } from "@/lib/talk";
import { usePlayer } from "@/lib/usePlayer";
// 얼굴을 그리는 일은 메시지함도 한다(줄마다 보낸 사람이 있다). 같은 프로필을
// 두 곳에서 그리게 되면서 TalkAvatar 로 옮겼다.
import { GuestFace, MemberFace } from "./TalkAvatar";

/**
 * Top-right sign-in control.
 *
 * Signed out, it is a link to login.ohsedu.site carrying the page to come back
 * to. Signed in, it is the player's avatar; pressing it opens a small card with
 * their name, a way over to 웹톡532, and sign-out.
 *
 * The signed-out state is an anchor rather than a button so it can be opened in
 * a new tab and its address copied — and so it still works before hydration.
 * `href` is computed on press because it has to name the page the player is
 * currently on, which the server cannot know.
 */
export default function AuthButton() {
  const state = usePlayer();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Pressing anywhere else, or Escape, closes the card. Without this it stays
  // open behind whatever the player does next.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /*
   * Nothing is drawn until the cookie has been read.
   *
   * The empty box holds the space so the header does not jump when the answer
   * arrives. Showing the signed-out state meanwhile would flash "로그인" at
   * someone who is signed in — on every single page load, which reads as
   * having been logged out and quietly trains people to press it again.
   */
  if (state.kind === "loading") {
    return <div className="h-11 w-11" aria-hidden="true" />;
  }

  if (state.kind === "guest") {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = loginUrl();
        }}
        className="pill flex items-center gap-2 border border-line bg-surface py-1 pl-1 pr-4 text-sm text-ink-dim shadow-sm transition-colors hover:border-line-strong hover:text-ink"
      >
        <span className="h-9 w-9 overflow-hidden rounded-full">
          <GuestFace />
        </span>
        로그인
      </a>
    );
  }

  const { player } = state;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="pill flex items-center gap-2 border border-line bg-surface py-1 pl-1 pr-4 text-sm text-ink shadow-sm transition-colors hover:border-line-strong"
      >
        <span className="h-9 w-9 overflow-hidden rounded-full bg-surface-2">
          <MemberFace icon={player.avatarIcon} image={player.avatarImage} />
        </span>
        {/* A member without a nickname yet: name the state instead of a blank. */}
        <span className="max-w-[7rem] truncate">
          {player.nickname ?? "별명 없음"}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="card animate-pop absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden p-0 text-left"
        >
          <div className="px-4 py-3">
            <p className="text-[11px] text-ink-faint">웹톡532 계정</p>
            <p className="mt-0.5 truncate text-sm text-ink">
              {player.nickname ?? "별명을 정하지 않았어요"}
            </p>
            {player.nickname ? null : (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                별명을 정하면 점수가 이름으로 등록돼요.
              </p>
            )}
          </div>

          <div className="border-t border-line">
            <a
              href={TALK_ORIGIN}
              className="block px-4 py-3 text-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
              role="menuitem"
            >
              웹톡532 열기
            </a>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                /*
                 * Signs out of every *.ohsedu.site at once, because the session
                 * is one cookie. That is the honest behaviour — a "sign out"
                 * that left 웹톡532 signed in would be a lie about what just
                 * happened. onAuthStateChange updates this header; no reload.
                 */
                void getBrowserClient()?.auth.signOut();
              }}
              className="block w-full px-4 py-3 text-left text-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              로그아웃
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
