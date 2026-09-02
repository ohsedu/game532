/** 12430 -> "12,430" */
export function formatScore(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}

/** 83.4 -> "1:23" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

/** 1 -> "01" so ranking rows stay aligned in a monospace column. */
export function formatRank(rank: number): string {
  return String(rank).padStart(2, "0");
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return yy + "." + mm + "." + dd;
}

/** C0 (0x00-0x1F) and C1 (0x7F-0x9F) control characters break table layout. */
function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Strips control characters, collapses whitespace, and trims to the allowed
 * length. Mirrored on the server; never trust this alone.
 */
export function sanitizeNickname(raw: string, max: number): string {
  let cleaned = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    if (code === undefined || isControlCode(code)) continue;
    cleaned += ch;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, max);
}
