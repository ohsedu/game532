"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query.
 *
 * Uses useSyncExternalStore so the server snapshot is an explicit `false` —
 * that keeps SSR output and the first client render identical instead of
 * copying `matchMedia` into state inside an effect, which would both flash and
 * trip the react-hooks set-state-in-effect rule.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * A phone held upright. Deliberately keyed on `pointer: coarse` rather than a
 * user-agent string, and capped by width so a tablet in portrait — which has
 * plenty of room for the board — is not nagged to rotate.
 */
export const PORTRAIT_PHONE =
  "(orientation: portrait) and (max-width: 767px) and (pointer: coarse)";
