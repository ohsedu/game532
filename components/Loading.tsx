/**
 * The waiting state, shown while a route is being fetched.
 *
 * Three dots that bounce in turn — the same idiom talk532 uses, and read as
 * "wait" without a label. No client hooks, so it can be rendered straight from
 * an app/**\/loading.tsx boundary.
 */
export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function Loading({ label = "불러오는 중…" }: { label?: string }) {
  return (
    // role=status so the wait is announced to someone who cannot see the dots.
    // The dots themselves are hidden from it; only the label is read.
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-24"
      role="status"
      aria-live="polite"
    >
      <Dots />
      <p className="text-xs text-ink-faint">{label}</p>
    </div>
  );
}
