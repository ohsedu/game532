const COLORS = ["#ff6b8a", "#ffb443", "#4ecb71", "#4f8cff", "#a77bff"];

/**
 * Decorative confetti scattered down the page margins.
 *
 * Positions are a fixed table rather than Math.random so the server and client
 * render identical markup. Hidden below xl, where the margins disappear.
 */
const PIECES: { x: number; y: number; rot: number; size: number; c: number; dur: number }[] = [
  { x: 4, y: 12, rot: 24, size: 11, c: 3, dur: 7.5 },
  { x: 11, y: 6, rot: -18, size: 8, c: 1, dur: 6.2 },
  { x: 7, y: 27, rot: 42, size: 13, c: 0, dur: 8.4 },
  { x: 2, y: 38, rot: -34, size: 9, c: 4, dur: 6.8 },
  { x: 13, y: 45, rot: 12, size: 10, c: 2, dur: 7.9 },
  { x: 5, y: 58, rot: -52, size: 12, c: 1, dur: 6.5 },
  { x: 10, y: 68, rot: 30, size: 8, c: 3, dur: 8.1 },
  { x: 3, y: 79, rot: -14, size: 11, c: 0, dur: 7.2 },
  { x: 14, y: 88, rot: 48, size: 9, c: 4, dur: 6.9 },
  { x: 8, y: 95, rot: -28, size: 10, c: 2, dur: 7.7 },

  { x: 88, y: 9, rot: -22, size: 10, c: 4, dur: 7.1 },
  { x: 95, y: 18, rot: 36, size: 12, c: 2, dur: 8.3 },
  { x: 84, y: 30, rot: -44, size: 8, c: 0, dur: 6.4 },
  { x: 93, y: 41, rot: 16, size: 11, c: 3, dur: 7.6 },
  { x: 87, y: 52, rot: -30, size: 9, c: 1, dur: 6.7 },
  { x: 97, y: 63, rot: 50, size: 13, c: 4, dur: 8.6 },
  { x: 83, y: 74, rot: -12, size: 10, c: 2, dur: 7.3 },
  { x: 91, y: 84, rot: 28, size: 8, c: 0, dur: 6.1 },
  { x: 96, y: 93, rot: -40, size: 11, c: 3, dur: 8.0 },
];

export default function Confetti() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 hidden overflow-hidden xl:block"
    >
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="animate-confetti absolute block"
          style={
            {
              left: p.x + "%",
              top: p.y + "%",
              width: p.size,
              height: p.size * 0.62,
              backgroundColor: COLORS[p.c],
              borderRadius: 2,
              opacity: 0.75,
              "--rot": p.rot + "deg",
              "--dur": p.dur + "s",
              "--delay": (i % 5) * 0.6 + "s",
              transform: `rotate(${p.rot}deg)`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
