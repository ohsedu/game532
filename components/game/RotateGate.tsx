"use client";

import { useCallback, useState } from "react";

interface OrientationLock {
  lock?: (orientation: "landscape") => Promise<void>;
}

/**
 * Shown over the game while a phone is held in portrait.
 *
 * The board is a fixed 1000x700 landscape rectangle; squeezed into a phone's
 * portrait width it renders about 90px tall, which is not playable. Rather than
 * reflow the game to portrait — which would change every spawn edge, travel
 * distance and difficulty constant — the site asks for landscape.
 *
 * Visibility is driven entirely by CSS (`.rotate-gate` in globals.css) so it
 * costs no JavaScript and cannot flash on hydration. The fullscreen button is
 * the only scripted part, and it is hidden where the APIs do not exist.
 */
export default function RotateGate({ accent }: { accent: string }) {
  const [failed, setFailed] = useState(false);

  const goFullscreen = useCallback(async () => {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      // Only Android Chrome honours this, and only in fullscreen. iOS Safari
      // has no orientation lock at all, which is why the prompt above is the
      // real mechanism and this button is a convenience.
      const orientation = screen.orientation as unknown as OrientationLock;
      await orientation?.lock?.("landscape");
    } catch {
      setFailed(true);
    }
  }, []);

  return (
    <div className="rotate-gate absolute inset-0 z-30 flex-col items-center justify-center gap-7 overflow-y-auto rounded-[inherit] bg-surface px-8 py-12 text-center">
      <div
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl text-4xl"
        style={{ backgroundColor: accent + "1f" }}
        aria-hidden="true"
      >
        <span className="animate-rotate-hint inline-block">📱</span>
      </div>

      <div>
        <p className="text-2xl text-ink">가로로 돌려주세요</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">
          이 게임은 가로 화면에서만 제대로 플레이할 수 있어요.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void goFullscreen()}
        className="fullscreen-only pill px-6 py-3 text-sm text-white transition-transform active:scale-95"
        style={{ backgroundColor: accent }}
      >
        전체화면으로 전환
      </button>

      {failed ? (
        <p className="text-xs text-ink-faint">
          기기에서 화면 회전 잠금을 꺼주세요.
        </p>
      ) : null}
    </div>
  );
}
