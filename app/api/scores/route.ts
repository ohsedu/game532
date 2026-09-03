import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isGameId, type GameId } from "@/types/game";
import { NICKNAME_MAX, SCORE_MAX, type RankingEntry } from "@/types/score";
import { sanitizeNickname } from "@/lib/format";
import { RANKING_LIMIT, toEntries } from "@/lib/ranking";
import {
  getReadClient,
  getRequestUser,
  getWriteClient,
  isReadConfigured,
  isWriteConfigured,
} from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-game plausibility ceilings.
 *
 * `perSecond` bounds how fast a score can legitimately accumulate; `absolute`
 * is the hard stop used when the client does not report a duration. These are
 * set well above real play so they reject fabricated numbers without ever
 * rejecting a genuine run. Client-generated scores can never be fully trusted -
 * the goal here is to make casual tampering not work, as the spec allows.
 */
const LIMITS: Record<GameId, { perSecond: number; absolute: number }> = {
  dodge: { perSecond: 400, absolute: 1_000_000 },
  poop: { perSecond: 400, absolute: 1_000_000 },
  direction: { perSecond: 2_500, absolute: 2_000_000 },
  // Block-drop and target games score in lumps rather than per second, so the
  // per-second bound is set from the fastest plausible tempo: roughly two
  // placements or hits a second at the top combo multiplier.
  stack: { perSecond: 1_500, absolute: 1_000_000 },
  runner: { perSecond: 600, absolute: 1_000_000 },
  aim: { perSecond: 2_000, absolute: 1_000_000 },
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * The ranking for one game.
 *
 * ★ This response is cached and shared between visitors, so it must not depend
 *   on who asked — and must never read the session. `game_ranking` is written
 *   to be viewer-independent for exactly this reason: it returns the same rows
 *   to everyone, and the browser decides which row is its own. Touching
 *   getRequestUser here would let a token refresh attach a Set-Cookie header to
 *   a cached response and hand one player's session to the next.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get("gameId");

  if (!isGameId(gameId)) return bad("gameId가 올바르지 않습니다.");

  if (!isReadConfigured()) {
    // Not an error: the site works without a database, just without rankings.
    return NextResponse.json({ configured: false, entries: [] as RankingEntry[] });
  }

  const supabase = getReadClient();
  if (!supabase) return bad("데이터베이스에 연결할 수 없습니다.", 503);

  const { data, error } = await supabase.rpc("game_ranking", {
    p_game_id: gameId,
    p_limit: RANKING_LIMIT,
  });

  if (error) {
    console.error("[api/scores] ranking query failed:", error.message);
    return bad("랭킹을 불러오지 못했습니다.", 502);
  }

  const entries = toEntries(data ?? []);

  return NextResponse.json(
    { configured: true, entries },
    {
      headers: {
        // Served from the edge for 20s, then handed over stale while it
        // refreshes behind the scenes — so a tab switch is never a cold query.
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=120",
      },
    }
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  // 10 submissions per minute: a fast player finishing runs back to back stays
  // well under it, a script does not.
  const limited = rateLimit("scores:" + ip, 10, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("잘못된 요청 형식입니다.");
  }

  if (!body || typeof body !== "object") return bad("잘못된 요청 형식입니다.");
  const raw = body as Record<string, unknown>;

  const gameId = raw.gameId;
  if (!isGameId(gameId)) return bad("gameId가 올바르지 않습니다.");

  /*
   * Who this score belongs to.
   *
   * For a signed-in player the name comes from their talk532 profile, read
   * here from the verified session. The body's nickname is ignored outright —
   * "registers automatically under my nickname" only means anything if the
   * nickname cannot be chosen by the sender, and a name the client supplies is
   * a name anyone can supply. Posting under someone else's name would also
   * attach it to their account, which is worse than a wrong leaderboard row.
   *
   * A member who has not chosen a nickname yet falls through to the guest path.
   * They are gated on a nickname inside talk532, so this is the narrow window
   * of someone who signed up and came straight here — they still get to type
   * a name for the board, it just is not tied to the account.
   */
  const user = await getRequestUser();
  const member = user?.nickname ? user : null;

  let nickname: string;
  if (member) {
    nickname = sanitizeNickname(member.nickname as string, NICKNAME_MAX);
    if (nickname.length === 0) return bad("닉네임을 확인할 수 없습니다.");
  } else {
    if (typeof raw.nickname !== "string") return bad("닉네임이 필요합니다.");
    nickname = sanitizeNickname(raw.nickname, NICKNAME_MAX);
    if (nickname.length === 0) return bad("닉네임을 입력해주세요.");
  }

  const score = raw.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return bad("점수가 올바르지 않습니다.");
  if (!Number.isInteger(score)) return bad("점수는 정수여야 합니다.");
  if (score < 0) return bad("점수는 음수일 수 없습니다.");
  if (score > SCORE_MAX) return bad("점수가 허용 범위를 벗어났습니다.");

  const limits = LIMITS[gameId];
  const durationMs = raw.durationMs;
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
    // 2000 of slack covers end-of-run bonuses awarded on the final frame.
    const ceiling = (durationMs / 1000) * limits.perSecond + 2000;
    if (score > ceiling) return bad("점수가 플레이 시간과 맞지 않습니다.");
  } else if (score > limits.absolute) {
    return bad("점수가 허용 범위를 벗어났습니다.");
  }

  if (!isWriteConfigured()) {
    return NextResponse.json(
      { error: "랭킹 서버가 설정되지 않았습니다.", configured: false },
      { status: 503 }
    );
  }

  const supabase = getWriteClient();
  if (!supabase) return bad("데이터베이스에 연결할 수 없습니다.", 503);

  // The row id comes back so the rank lookup below can find this exact
  // submission instead of guessing by score and name.
  const { data: inserted, error } = await supabase
    .from("game_scores")
    .insert({ game_id: gameId, user_id: member?.id ?? null, nickname, score })
    .select("id")
    .single();

  if (error) {
    console.error("[api/scores] insert failed:", error.message);
    return bad("점수를 등록하지 못했습니다.", 502);
  }

  // The pages that show leaderboards cache them. Without this a player who has
  // just posted a record reloads and sees the old one, which reads as the query
  // being broken rather than as a cache being young.
  revalidatePath("/");
  revalidatePath("/ranking");

  /*
   * Report back where the score landed so the client can jump to it.
   *
   * Counting rows above this score is no longer the answer: a member's earlier
   * submissions are folded away in the ranking, so counting them would put a
   * player who just beat their own record several places below where the board
   * actually shows them. Asking the ranking function is the only way to get a
   * number that matches what they are about to see.
   *
   * A member is found by account, not by row — the board shows their best, and
   * if this run did not beat it, the honest answer is where they still stand.
   *
   * A rank of 0 means the row is not on the board at all: outside the top 100.
   * The panel says so rather than inventing a position.
   */
  const { data: ranked, error: rankError } = await supabase.rpc("game_ranking", {
    p_game_id: gameId,
    p_limit: RANKING_LIMIT,
  });

  let rank = 0;
  if (rankError) {
    console.error("[api/scores] rank lookup failed:", rankError.message);
  } else {
    const rows = (ranked ?? []) as { id: number; rank: number; user_id: string | null }[];
    const mine = member
      ? rows.find((r) => r.user_id === member.id)
      : rows.find((r) => r.id === inserted.id);
    rank = mine?.rank ?? 0;
  }

  return NextResponse.json({
    ok: true,
    nickname,
    score,
    rank,
    /** So the panel can say whether it registered under an account or a typed name. */
    member: Boolean(member),
  });
}
