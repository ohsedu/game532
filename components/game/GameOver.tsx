"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameId } from "@/types/game";
import { NICKNAME_MAX } from "@/types/score";
import { formatScore, sanitizeNickname } from "@/lib/format";
import { noteAccountBest } from "@/lib/accountBest";
import { getSavedNickname, saveNickname } from "@/lib/localBest";
import { loginUrl } from "@/lib/talk";
import { usePlayer } from "@/lib/usePlayer";

interface GameOverProps {
  gameId: GameId;
  accent: string;
  score: number;
  best: number;
  isNewRecord: boolean;
  durationMs: number;
  onRestart: () => void;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; rank: number }
  | { kind: "error"; message: string }
  | { kind: "unavailable" };

export default function GameOver({
  gameId,
  accent,
  score,
  best,
  isNewRecord,
  durationMs,
  onRestart,
}: GameOverProps) {
  const me = usePlayer();

  /**
   * Whether this run registers by itself.
   *
   * A signed-in player with a nickname has nothing to type — the server reads
   * their name from their profile and ignores anything sent in the body, so a
   * field here would be decoration that does not affect the result.
   *
   * A member who has not chosen a nickname yet is not in this branch. They get
   * the typed field, and their score lands as a guest row — which is what the
   * server does too. Registering them under a blank name would be worse.
   */
  const auto = me.kind === "member" && Boolean(me.player.nickname);

  // This panel only ever mounts after a run ends, so it never renders on the
  // server — reading storage in the initializer cannot cause a hydration
  // mismatch, and avoids a wasted render pass.
  const [nickname, setNickname] = useState(getSavedNickname);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus the field so a player can type straight into it, but only after the
    // panel has animated in. Nothing to focus when it registers by itself.
    if (auto || me.kind === "loading") return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [auto, me.kind]);

  /**
   * Posts the run. `name` is only read for a guest; the server names a member
   * from their session either way.
   *
   * Does not set "sending" itself — the caller does, if it has a reason to.
   * The automatic path calls this from an effect, and a setState reachable
   * synchronously from an effect body is a cascading render (and a lint error).
   * It has no reason to: the automatic panel reads 'idle' as "등록 중" already,
   * because in that branch the post always starts in the same commit.
   */
  const submit = useCallback(
    async (name: string) => {
      try {
        const res = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId, nickname: name, score, durationMs }),
        });
        const data: unknown = await res.json().catch(() => null);

        if (res.status === 503) {
          setState({ kind: "unavailable" });
          return;
        }
        if (!res.ok) {
          const message =
            data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : "점수 등록에 실패했습니다.";
          setState({ kind: "error", message });
          return;
        }

        const rank =
          data && typeof data === "object" && typeof (data as { rank?: unknown }).rank === "number"
            ? (data as { rank: number }).rank
            : 0;
        // The row just landed under this account, so fold it into the cached
        // bests rather than asking the database for a number we already know.
        // `auto` is exactly the server's own condition for attaching a user_id
        // — a member with no nickname posts as a guest there too — and the fold
        // is a no-op for anyone else.
        if (auto) noteAccountBest(gameId, score);
        setState({ kind: "done", rank });
      } catch {
        setState({ kind: "error", message: "네트워크 오류입니다. 다시 시도해주세요." });
      }
    },
    [gameId, score, durationMs, auto]
  );

  function submitTyped() {
    const clean = sanitizeNickname(nickname, NICKNAME_MAX);
    if (clean.length === 0) {
      setState({ kind: "error", message: "닉네임을 입력해주세요." });
      inputRef.current?.focus();
      return;
    }
    saveNickname(clean);
    setState({ kind: "sending" });
    void submit(clean);
  }

  /*
   * The automatic post.
   *
   * The ref, not the state, is the guard. React runs effects twice in
   * development, and a state check would still be 'idle' on the second run —
   * which is how you end up with two rows for one death.
   *
   * A zero is left alone. Every run that ends immediately would otherwise write
   * a row that can never place, and dying on the first block or the first
   * bullet is common in half these games.
   */
  const posted = useRef(false);
  useEffect(() => {
    if (!auto || posted.current) return;
    if (score <= 0) return;
    posted.current = true;
    /*
     * set-state-in-effect fires because submit() contains setState calls, but
     * every one of them is behind the fetch's await — there is no synchronous
     * state change here and so no cascading render. Posting a result once when
     * the panel appears is what an effect is for; the alternative is wrapping
     * the same call in a microtask, which changes nothing except that the rule
     * stops noticing.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void submit("");
  }, [auto, score, submit]);

  const submitted = state.kind === "done";
  const zeroSkipped = auto && score <= 0;

  return (
    <div className="absolute inset-0 z-20 flex p-3 backdrop-blur-[3px] bg-white/75 sm:p-4">
      <div className="panel-compact animate-pop card m-auto max-h-full w-full max-w-sm overflow-y-auto overscroll-contain px-7 py-7 text-center">
        {isNewRecord ? (
          <>
            <div className="panel-emoji animate-bob text-4xl" aria-hidden="true">
              🎉
            </div>
            <p className="animate-shimmer mt-2 text-xl">신기록 달성!</p>
          </>
        ) : (
          <>
            <div className="panel-emoji text-4xl" aria-hidden="true">
              😵
            </div>
            <p className="mt-2 text-xl text-ink">게임 오버</p>
          </>
        )}

        <p className="mt-6 text-[11px] text-ink-faint">SCORE</p>
        <p className="panel-score num text-5xl font-semibold leading-none" style={{ color: accent }}>
          {formatScore(score)}
        </p>
        <p className="num mt-3 text-xs text-ink-faint">BEST {formatScore(best)}</p>

        {/*
          Nothing is drawn here until the session cookie has been read. Showing
          the nickname field meanwhile would put a signed-in player halfway
          through typing a name they do not need, and then take the field away.
        */}
        {me.kind === "loading" ? (
          <div className="mt-7 h-[92px]" aria-hidden="true" />
        ) : submitted ? (
          <div
            className="mt-7 rounded-2xl px-4 py-5"
            style={{ backgroundColor: accent + "14" }}
          >
            <p className="text-xs text-ink-dim">
              <span className="text-ink">
                {auto && me.kind === "member"
                  ? me.player.nickname
                  : sanitizeNickname(nickname, NICKNAME_MAX)}
              </span>{" "}
              등록 완료!
            </p>
            {state.rank > 0 ? (
              <p className="num mt-1 text-3xl font-semibold" style={{ color: accent }}>
                {state.rank}위
              </p>
            ) : (
              // rank 0 means the row did not make the top 100. Saying "0위"
              // would read as a bug; saying nothing would read as a failure.
              <p className="mt-1.5 text-xs text-ink-faint">아직 100위 안에는 못 들었어요</p>
            )}
          </div>
        ) : auto ? (
          <div className="mt-7 rounded-2xl px-4 py-5" style={{ backgroundColor: accent + "14" }}>
            {zeroSkipped ? (
              <p className="text-xs leading-relaxed text-ink-dim">
                0점은 등록하지 않아요.
                <br />
                <span className="text-ink-faint">한 판 더 해볼까요?</span>
              </p>
            ) : state.kind === "error" ? (
              <>
                <p className="text-[11px] leading-relaxed text-direction">{state.message}</p>
                <button
                  type="button"
                  onClick={() => {
                    setState({ kind: "sending" });
                    void submit("");
                  }}
                  className="pill mt-3 px-5 py-2 text-xs text-white transition-transform active:scale-95"
                  style={{ backgroundColor: accent }}
                >
                  다시 시도
                </button>
              </>
            ) : state.kind === "unavailable" ? (
              <p className="text-[11px] leading-relaxed text-ink-faint">
                랭킹 서버가 아직 연결되지 않았어요. 최고 점수는 이 브라우저에 저장됩니다.
              </p>
            ) : (
              <p className="text-xs text-ink-dim">
                <span className="text-ink">
                  {me.kind === "member" ? me.player.nickname : ""}
                </span>{" "}
                이름으로 등록 중…
              </p>
            )}
          </div>
        ) : (
          <div className="mt-7 text-left">
            <label htmlFor="nickname" className="text-[11px] text-ink-faint">
              닉네임 (최대 {NICKNAME_MAX}자)
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="nickname"
                ref={inputRef}
                value={nickname}
                maxLength={NICKNAME_MAX}
                placeholder="PLAYER"
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (state.kind === "error") setState({ kind: "idle" });
                }}
                onKeyDown={(e) => {
                  // Arrow keys belong to the game; stop them bubbling to it.
                  e.stopPropagation();
                  if (e.key === "Enter") submitTyped();
                }}
                className="pill min-w-0 flex-1 border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={submitTyped}
                disabled={state.kind === "sending"}
                className="pill shrink-0 px-5 py-2.5 text-sm text-white transition-transform active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                {state.kind === "sending" ? "등록 중" : "등록"}
              </button>
            </div>

            {state.kind === "error" ? (
              <p className="mt-2 px-1 text-[11px] text-direction">{state.message}</p>
            ) : null}
            {state.kind === "unavailable" ? (
              <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-faint">
                랭킹 서버가 아직 연결되지 않았어요. 최고 점수는 이 브라우저에 저장됩니다.
              </p>
            ) : null}

            {/*
              Offered to a guest only, and only as a line of text under the
              field — not as a second button competing with 등록. Signing in
              leaves the page, so a player who just finished a run must not be
              nudged into it before their score is recorded.
            */}
            {me.kind === "guest" ? (
              <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-faint">
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = loginUrl();
                  }}
                  className="text-primary underline decoration-primary/30 underline-offset-2"
                >
                  로그인
                </button>
                하면 다음부터 닉네임으로 자동 등록돼요.
              </p>
            ) : null}
          </div>
        )}

        <div className="panel-actions mt-6 grid gap-2">
          <button
            type="button"
            onClick={onRestart}
            className="pill px-5 py-3 text-sm text-white transition-transform hover:scale-[1.02] active:scale-95"
            style={{ backgroundColor: accent }}
          >
            다시하기
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/ranking?game=${gameId}`}
              className="pill border border-line bg-surface px-4 py-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              랭킹 보기
            </Link>
            <Link
              href="/"
              className="pill border border-line bg-surface px-4 py-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              게임 선택
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
