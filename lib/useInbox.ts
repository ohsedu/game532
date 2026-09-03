"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "./supabase/client";

/**
 * 패널이 한 번에 보여 주는 줄 수. 이보다 많으면 여기서 세지 않고 웹톡532 로
 * 넘긴다 — 스무 줄을 이 좁은 칸에서 훑는 것보다 저쪽 목록이 낫다.
 */
export const INBOX_LIMIT = 10;

/**
 * 안 읽은 말을 찾으려고 한 번에 끌어오는 줄 수.
 *
 * 열 줄을 그리려고 예순 줄을 받는 이유는 방마다 읽은 시각이 달라서다. 한 번의
 * 질의로는 "방 A 는 이 시각 이후, 방 B 는 저 시각 이후" 를 적을 수 없어서,
 * 가장 이른 읽은 시각 뒤를 통째로 받아 화면 쪽에서 방별로 가른다.
 *
 * 이 그물을 빠져나갈 만큼 대화가 많으면 줄이 열보다 적게 보일 수 있는데,
 * 배지 숫자는 그것과 무관하게 unread_counts 가 세므로 개수는 틀리지 않는다.
 */
const SCAN_LIMIT = 60;

/** 배지를 얼마나 자주 다시 세는가. 화면이 보이는 동안에만 돈다. */
const POLL_MS = 30_000;

export interface InboxItem {
  /** messages.id. 목록의 키다. */
  id: number;
  /** 눌렀을 때 열 방. talk532 는 코드로 방을 연다. */
  roomCode: string;
  /** 1:1 이면 보낸 사람, 여럿이 있는 방이면 방 이름. */
  title: string;
  /** 여럿이 있는 방에서만. 그 줄을 누가 썼는지가 제목에 안 들어가서 따로 준다. */
  from: string | null;
  preview: string;
  createdAt: string;
  avatarIcon: string | null;
  avatarImage: string | null;
}

export interface Inbox {
  /** 방을 통틀어 안 읽은 개수. 아래 목록의 길이가 아니다. */
  unread: number;
  items: InboxItem[];
  /** 열 줄에 다 안 들어간다 — 패널이 '더보기' 를 세운다. */
  hasMore: boolean;
  loading: boolean;
  refresh: () => void;
}

const EMPTY: InboxItem[] = [];

interface MessageRow {
  id: number;
  room_id: string;
  user_id: string;
  content: string | null;
  created_at: string;
  kind: string | null;
  deleted_at: string | null;
  emoji_path: string | null;
  attachments: unknown;
}

/** talk532 의 previewText 중 이 목록에 올라오는 갈래(user·notice)만 옮겨 온 것. */
function previewOf(row: MessageRow): string {
  if (row.deleted_at && row.kind === "notice") return "내려간 공지입니다";
  if (row.deleted_at) return "삭제된 메시지입니다";
  if (row.kind === "notice") return "[공지] " + (row.content ?? "");
  if (row.content) return row.content;
  if (row.emoji_path) return "이모티콘";
  // attachments 는 jsonb 다. 장수까지 세지 않는 것은 이 한 줄에 들어갈 자리가
  // 없어서다 — 무엇이 왔는지만 알려 주고 세는 일은 저쪽 목록에 맡긴다.
  if (Array.isArray(row.attachments) && row.attachments.length > 0) return "사진";
  return "";
}

/** "방금 · 12분 · 3시간 · 어제 · 03.14" */
export function whenLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "분";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "시간";
  if (diff < 172_800_000) return "어제";
  const d = new Date(t);
  return (
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    String(d.getDate()).padStart(2, "0")
  );
}

interface Snapshot {
  /**
   * 이 값이 누구의 것인가.
   *
   * 로그아웃하거나 다른 계정으로 갈아탄 순간 앞사람의 메시지가 화면에 남으면
   * 안 된다. 이펙트에서 상태를 비우는 대신 주인을 적어 두고 읽는 쪽에서 맞춰
   * 본다 — 비우는 쪽은 렌더를 한 번 더 돌리고, 그 사이 한 프레임이 샌다.
   */
  owner: string;
  unread: number;
  items: InboxItem[];
}

const NOTHING: Snapshot = { owner: "", unread: 0, items: EMPTY };

interface RoomInfo {
  code: string;
  name: string;
  direct: boolean;
  lastRead: number;
}

/**
 * 안 읽은 말을 읽어 온다. 로그인한 사람에게만 도는 질의다.
 *
 * 안 읽은 것이 없으면 여기서 끝난다 — 흔한 경우가 RPC 한 번으로 끝나야 30초마다
 * 도는 것이 부담이 되지 않는다. 있을 때만 방과 사람을 마저 읽는다.
 */
async function read(userId: string): Promise<Omit<Snapshot, "owner">> {
  const supabase = getBrowserClient();
  if (!supabase) return { unread: 0, items: EMPTY };

  /*
   * 개수의 정본은 이 함수다(talk532/supabase/room-notice.sql). 화면에서 다시
   * 세지 않는 이유는 저쪽이 지난 대화 가리기(history_from)와 공지까지 셈에
   * 넣기 때문이다 — 여기서 흉내 내면 두 앱의 배지가 서로 다른 수를 말한다.
   */
  const counts = await supabase.rpc("unread_counts");
  if (counts.error) throw counts.error;

  const rows = (counts.data ?? []) as { room_id: string; unread: number }[];
  const unread = rows.reduce((n, r) => n + (r.unread ?? 0), 0);
  if (unread <= 0) return { unread: 0, items: EMPTY };

  const roomIds = rows.filter((r) => (r.unread ?? 0) > 0).map((r) => r.room_id);

  // 내 참여 기록과 방을 한 번에. 읽은 시각이 여기 있고, 그것이 곧 "어디부터가
  // 안 읽은 것인가" 의 기준선이다.
  const membership = await supabase
    .from("room_members")
    .select("room_id, last_read_at, rooms(code, name, direct_key)")
    .eq("user_id", userId)
    .in("room_id", roomIds);
  if (membership.error) throw membership.error;

  const info = new Map<string, RoomInfo>();
  let earliest = Number.POSITIVE_INFINITY;

  for (const row of membership.data ?? []) {
    const r = row as unknown as {
      room_id: string;
      last_read_at: string | null;
      rooms:
        | { code: string; name: string; direct_key: string | null }
        | { code: string; name: string; direct_key: string | null }[]
        | null;
    };
    const room = Array.isArray(r.rooms) ? r.rooms[0] : r.rooms;
    if (!room?.code) continue;
    // 한 번도 연 적 없는 방은 처음부터 전부 안 읽은 것이다.
    const lastRead = r.last_read_at ? Date.parse(r.last_read_at) : 0;
    info.set(r.room_id, {
      code: room.code,
      name: room.name ?? "",
      direct: room.direct_key !== null,
      lastRead,
    });
    if (lastRead < earliest) earliest = lastRead;
  }
  if (info.size === 0) return { unread, items: EMPTY };

  const messages = await supabase
    .from("messages")
    .select(
      "id, room_id, user_id, content, created_at, kind, deleted_at, emoji_path, attachments"
    )
    .in("room_id", [...info.keys()])
    // 내가 쓴 말은 알림이 아니다. unread_counts 도 같은 줄을 세지 않는다.
    .neq("user_id", userId)
    // 입퇴장 안내(join/leave/kick)는 개수에도 안 들어간다. 갈래를 맞춰 둔다.
    .in("kind", ["user", "notice"])
    .gte("created_at", new Date(earliest).toISOString())
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);
  if (messages.error) throw messages.error;

  const fresh = ((messages.data ?? []) as unknown as MessageRow[])
    .filter((m) => {
      const room = info.get(m.room_id);
      if (!room) return false;
      /*
       * 같은 시각도 안 읽은 것으로 센다 — unread_counts 가 `>=` 로 세기 때문이다.
       * 나간 사람이 말을 걸어오면 참여 기록이 같은 트랜잭션에서 되살아나면서
       * 두 시각이 완전히 같은 값이 되는 자리가 있다(talk532/read-state.sql).
       */
      return Date.parse(m.created_at) >= room.lastRead;
    })
    .slice(0, INBOX_LIMIT);

  if (fresh.length === 0) return { unread, items: EMPTY };

  // 보낸 사람의 얼굴과 이름. 같은 방 사람은 profiles 정책으로 보인다.
  const authorIds = [...new Set(fresh.map((m) => m.user_id))];
  const profiles = await supabase
    .from("profiles")
    .select("id, nickname, avatar_icon, avatar_image")
    .in("id", authorIds);

  // 프로필을 못 읽어도 목록은 세운다 — 이름 없는 줄이 빈 패널보다 낫다.
  const who = new Map<
    string,
    { nickname: string | null; icon: string | null; image: string | null }
  >();
  for (const p of (profiles.data ?? []) as {
    id: string;
    nickname: string | null;
    avatar_icon: string | null;
    avatar_image: string | null;
  }[]) {
    who.set(p.id, {
      nickname: p.nickname,
      icon: p.avatar_icon,
      image: p.avatar_image,
    });
  }

  const items: InboxItem[] = fresh.map((m) => {
    const room = info.get(m.room_id)!;
    const author = who.get(m.user_id);
    const name = author?.nickname?.trim() || "알 수 없음";
    return {
      id: m.id,
      roomCode: room.code,
      /*
       * 1:1 방의 rooms.name 은 두 사람의 별명을 이어 붙인 값이라
       * (start_direct_room) 내 이름까지 들어 있다. 그 방에서 내가 아닌 줄은
       * 곧 상대의 말이므로 보낸 사람을 그대로 제목으로 쓴다.
       */
      title: room.direct ? name : room.name || name,
      from: room.direct ? null : name,
      preview: previewOf(m),
      createdAt: m.created_at,
      avatarIcon: author?.icon ?? null,
      avatarImage: author?.image ?? null,
    };
  });

  return { unread, items };
}

/**
 * 헤더의 메시지함이 보는 값.
 *
 * 로그인하지 않았으면 아무것도 하지 않는다(userId 가 null). 화면이 가려져 있는
 * 동안에는 폴링을 멈추고, 다시 보이거나 창이 포커스를 얻으면 곧바로 한 번 읽는다
 * — 웹톡532 에서 메시지를 읽고 돌아왔을 때 배지가 남아 있지 않게 하는 자리가
 * 여기다.
 */
export function useInbox(userId: string | null): Inbox {
  const [snap, setSnap] = useState<Snapshot>(NOTHING);

  // 늦게 도착한 응답이 새 응답을 덮지 않도록 세대를 센다.
  const gen = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!userId) return;
    const mine = ++gen.current;
    read(userId)
      .then((next) => {
        if (!alive.current || gen.current !== mine) return;
        setSnap({ owner: userId, ...next });
      })
      .catch(() => {
        /*
         * 읽기에 실패해도 마지막으로 본 값을 그대로 둔다. 배지를 0 으로
         * 떨어뜨리면 "다 읽었다" 라는 거짓말이 되고, 다음 폴링에서 다시
         * 나타나며 깜빡인다.
         *
         * 첫 읽기가 실패하면 주인이 안 적히므로 패널은 계속 '불러오는 중' 이다.
         * 그 편이 맞다 — 한 번도 못 읽어 온 것을 "없다" 라고 할 수는 없다.
         */
      });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();

    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);

    const wake = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);

    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [userId, load]);

  // 주인이 다른 값은 없는 것으로 친다 — 로그아웃한 순간, 그리고 계정을 갈아탄
  // 뒤 첫 응답이 오기 전까지가 그 사이다.
  const mine = Boolean(userId) && snap.owner === userId;
  const shown = mine ? snap : NOTHING;

  return {
    unread: shown.unread,
    items: shown.items,
    hasMore: shown.unread > INBOX_LIMIT,
    /*
     * 따로 세지 않고 "아직 이 사람 것이 안 왔다" 로 읽는다. 상태를 하나 더 두면
     * 그것을 켜는 자리가 이펙트 안이 되는데, 거기서 상태를 건드리면 렌더가 한 번
     * 더 돈다. 두 번째 읽기부터는 패널에 이미 내용이 있어서 표시할 것도 없다.
     */
    loading: Boolean(userId) && !mine,
    refresh: load,
  };
}
