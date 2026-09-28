import { query, queryOne } from "./db";
import { presence } from "./hub";
import { HttpError, iso } from "./http";
import { bustMembers, hotTailMap, rememberMembers } from "./valkey";
import { mapUser, type User, type UserRow } from "./auth";

export type ReplyPreview = {
  id: string;
  author_id?: string | null;
  author_name?: string | null;
  type: string;
  text?: string;
  deleted?: boolean;
};

export type Message = {
  id: string;
  chat_id: string;
  author_id?: string | null;
  author_name?: string | null;
  type: string;
  payload: unknown;
  client_id: string;
  reply_to_id?: string | null;
  reply_to?: ReplyPreview | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  attachments?: Attachment[];
  status?: string;
};

export type ChatMember = {
  user: User;
  role: string;
  joined_at: string;
};

export function parsePayload(p: unknown): Record<string, unknown> {
  if (p == null) return {};
  if (typeof p === "string") {
    try {
      const v = JSON.parse(p) as unknown;
      if (v && typeof v === "object") return v as Record<string, unknown>;
      return { text: String(v) };
    } catch {
      return { text: p };
    }
  }
  if (typeof p === "object") return p as Record<string, unknown>;
  return {};
}

export type Attachment = {
  id: string;
  kind: string;
  url: string;
  object_key: string;
  mime: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  waveform?: unknown;
  filename?: string | null;
};

export type Chat = {
  id: string;
  type: string;
  title: string;
  avatar_url?: string | null;
  peer?: User;
  last_message?: Message | null;
  unread_count: number;
  muted_until?: string | null;
  member_count: number;
  updated_at: string;
  created_at: string;
};

type ChatRow = {
  id: string;
  type: string;
  title: string;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
  muted_until: Date | null;
  member_count: string | number;
  unread: string | number;
  peer_id: string | null;
  peer_phone: string | null;
  peer_display_name: string | null;
  peer_username: string | null;
  peer_avatar_url: string | null;
  peer_bio: string | null;
  peer_created_at: Date | null;
  peer_updated_at: Date | null;
  peer_last_seen_at: Date | null;
  lm_id: string | null;
  lm_chat_id: string | null;
  lm_author_id: string | null;
  lm_type: string | null;
  lm_payload: unknown;
  lm_client_id: string | null;
  lm_reply_to_id: string | null;
  lm_created_at: Date | null;
  lm_edited_at: Date | null;
  lm_deleted_at: Date | null;
  lm_author_name: string | null;
};

function mapChat(r: ChatRow): Chat {
  const chat: Chat = {
    id: r.id,
    type: r.type,
    title: r.title || "",
    avatar_url: r.avatar_url ?? undefined,
    unread_count: Number(r.unread || 0),
    muted_until: iso(r.muted_until),
    member_count: Number(r.member_count || 0),
    updated_at: iso(r.updated_at) || new Date().toISOString(),
    created_at: iso(r.created_at) || new Date().toISOString(),
  };
  if (r.peer_id) {
    const peer = mapUser(
      {
        id: r.peer_id,
        phone: r.peer_phone || "",
        display_name: r.peer_display_name || "",
        username: r.peer_username,
        avatar_url: r.peer_avatar_url,
        bio: r.peer_bio || "",
        created_at: r.peer_created_at || r.created_at,
        updated_at: r.peer_updated_at || r.updated_at,
        last_seen_at: r.peer_last_seen_at,
      },
      presence.online(r.peer_id),
    );
    chat.peer = peer;
    if (!chat.title) chat.title = peer.display_name;
    if (!chat.avatar_url) chat.avatar_url = peer.avatar_url;
  }
  if (r.lm_id && r.lm_chat_id && r.lm_type && r.lm_created_at) {
    chat.last_message = {
      id: r.lm_id,
      chat_id: r.lm_chat_id,
      author_id: r.lm_author_id,
      author_name: r.lm_author_name || undefined,
      type: r.lm_type,
      payload: parsePayload(r.lm_payload),
      client_id: r.lm_client_id || "",
      reply_to_id: r.lm_reply_to_id,
      created_at: iso(r.lm_created_at) || new Date().toISOString(),
      edited_at: iso(r.lm_edited_at),
      deleted_at: iso(r.lm_deleted_at),
    };
  }
  return chat;
}

export async function listChats(userId: string, q = "", kind = "") {
  q = q.trim();
  const rows = await query<ChatRow>(
    `
    SELECT
      c.id, c.type, COALESCE(c.title, '') AS title, c.avatar_url, c.created_at, c.updated_at,
      cm.muted_until,
      (SELECT count(*) FROM chat_members x WHERE x.chat_id=c.id) AS member_count,
      COALESCE((
        SELECT count(*) FROM messages msg
        WHERE msg.chat_id=c.id AND msg.deleted_at IS NULL
          AND msg.author_id IS DISTINCT FROM $1
          AND (cm.cleared_at IS NULL OR msg.created_at > cm.cleared_at)
          AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
      ),0) AS unread,
      peer.id AS peer_id, peer.phone AS peer_phone, peer.display_name AS peer_display_name,
      peer.username AS peer_username, peer.avatar_url AS peer_avatar_url, peer.bio AS peer_bio,
      peer.created_at AS peer_created_at, peer.updated_at AS peer_updated_at, peer.last_seen_at AS peer_last_seen_at,
      lm.id AS lm_id, lm.chat_id AS lm_chat_id, lm.author_id AS lm_author_id, lm.type AS lm_type,
      lm.payload AS lm_payload, lm.client_id AS lm_client_id, lm.reply_to_id AS lm_reply_to_id,
      lm.created_at AS lm_created_at, lm.edited_at AS lm_edited_at, lm.deleted_at AS lm_deleted_at,
      lma.display_name AS lm_author_name
    FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    LEFT JOIN LATERAL (
      SELECT u.* FROM chat_members cm2
      JOIN users u ON u.id = cm2.user_id
      WHERE cm2.chat_id = c.id AND cm2.user_id <> $1
      LIMIT 1
    ) peer ON c.type = 'direct'
    LEFT JOIN LATERAL (
      SELECT id, chat_id, author_id, type, payload, client_id, reply_to_id, created_at, edited_at, deleted_at
      FROM messages
      WHERE chat_id = c.id AND deleted_at IS NULL
        AND (cm.cleared_at IS NULL OR created_at > cm.cleared_at)
      ORDER BY created_at DESC
      LIMIT 1
    ) lm ON true
    LEFT JOIN users lma ON lma.id = lm.author_id
    WHERE cm.user_id = $1
      AND cm.hidden_at IS NULL
      AND ($2 = '' OR c.type = $2)
      AND (
        $3 = '' OR
        c.title ILIKE '%'||$3||'%' OR
        peer.display_name ILIKE '%'||$3||'%' OR
        peer.username ILIKE '%'||$3||'%'
      )
    ORDER BY c.updated_at DESC
    LIMIT 100
  `,
    [userId, kind, q],
  );
  const chats = rows.map(mapChat);
  try {
    const tails = await hotTailMap(chats.map((c) => c.id));
    for (const chat of chats) {
      const raw = tails.get(chat.id);
      if (!raw) continue;
      let hot: Message;
      try {
        hot = JSON.parse(raw) as Message;
      } catch {
        continue;
      }
      if (!hot?.id || hot.deleted_at) continue;
      const prevAt = chat.last_message?.created_at || "";
      if (hot.created_at <= prevAt) continue;
      if (hot.author_id && hot.author_id !== userId && hot.id !== chat.last_message?.id) chat.unread_count += 1;
      chat.last_message = hot;
      if (hot.created_at > chat.updated_at) chat.updated_at = hot.created_at;
    }
  } catch {
    /* the postgres list is still complete */
  }
  chats.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  return chats;
}

export async function getChat(userId: string, chatId: string) {
  await mustMember(chatId, userId);
  const list = await listChats(userId, "", "");
  const found = list.find((c) => c.id === chatId);
  if (!found) throw new HttpError(404, "not_found", "not found");
  return found;
}

export async function directChat(me: string, peer: string) {
  if (me === peer) throw new HttpError(400, "bad_request", "cannot chat with self");
  const [a, b] = me < peer ? [me, peer] : [peer, me];
  const key = `${a}:${b}`;
  const existing = await queryOne<{ id: string }>(`SELECT id FROM chats WHERE peer_key=$1`, [key]);
  if (existing) {
    await query(
      `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')
       ON CONFLICT (chat_id, user_id) DO UPDATE SET hidden_at = NULL`,
      [existing.id, me],
    );
    return getChat(me, existing.id);
  }
  const chatId = crypto.randomUUID();
  try {
    await query(`INSERT INTO chats (id, type, created_by, peer_key) VALUES ($1,'direct',$2,$3)`, [chatId, me, key]);
    await query(`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member')`, [
      chatId,
      me,
      peer,
    ]);
    await rememberMembers(chatId, [me, peer]).catch(() => undefined);
  } catch {
    const again = await queryOne<{ id: string }>(`SELECT id FROM chats WHERE peer_key=$1`, [key]);
    if (again) return getChat(me, again.id);
    throw new HttpError(500, "internal", "chat create failed");
  }
  return getChat(me, chatId);
}

export async function createGroup(me: string, title: string, memberIds: string[]) {
  title = title.trim();
  if (!title) throw new HttpError(400, "bad_request", "title required");
  const seen = new Set<string>([me]);
  const members = [me];
  for (const id of memberIds || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    members.push(id);
  }
  if (members.length > 256) throw new HttpError(400, "bad_request", "too many members");
  const chatId = crypto.randomUUID();
  await query(`INSERT INTO chats (id, type, title, created_by) VALUES ($1,'group',$2,$3)`, [chatId, title, me]);
  for (const uid of members) {
    const role = uid === me ? "owner" : "member";
    await query(`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3)`, [chatId, uid, role]);
  }
  await rememberMembers(chatId, members).catch(() => undefined);
  return getChat(me, chatId);
}

export async function unhideChat(chatId: string) {
  await query(`UPDATE chat_members SET hidden_at = NULL WHERE chat_id=$1 AND hidden_at IS NOT NULL`, [chatId]);
}

export async function clearedAt(chatId: string, userId: string) {
  const row = await queryOne<{ cleared_at: Date | string | null }>(
    `SELECT cleared_at FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
    [chatId, userId],
  );
  if (!row?.cleared_at) return null;
  const date = new Date(row.cleared_at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function hideChat(userId: string, chatId: string) {
  await mustMember(chatId, userId);
  const chat = await queryOne<{ type: string }>(`SELECT type FROM chats WHERE id=$1`, [chatId]);
  if (!chat) throw new HttpError(404, "not_found", "not found");
  if (chat.type === "group") {
    try {
      return await removeMember(userId, chatId, userId);
    } catch {
      /* still hide the row if leaving the group failed */
    }
  }
  try {
    await query(`UPDATE chat_members SET hidden_at=now(), cleared_at=now() WHERE chat_id=$1 AND user_id=$2`, [
      chatId,
      userId,
    ]);
  } catch {
    await query(`DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, [chatId, userId]);
  }
  return { ok: true };
}

export async function renameChat(userId: string, chatId: string, title: string) {
  title = title.trim();
  if (!title || [...title].length > 80) throw new HttpError(400, "bad_request", "title length");
  const chat = await queryOne<{ type: string }>(`SELECT type FROM chats WHERE id=$1`, [chatId]);
  if (!chat) throw new HttpError(404, "not_found", "not found");
  if (chat.type !== "group") throw new HttpError(400, "bad_request", "not a group");
  const role = await memberRole(chatId, userId);
  if (!canManageMembers(role)) throw new HttpError(403, "forbidden", "forbidden");
  await query(`UPDATE chats SET title=$2, updated_at=now() WHERE id=$1`, [chatId, title]);
  return getChat(userId, chatId);
}

export async function mustMember(chatId: string, userId: string) {
  const row = await queryOne(`SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, [chatId, userId]);
  if (!row) throw new HttpError(403, "forbidden", "forbidden");
}

export async function memberIds(chatId: string) {
  const rows = await query<{ user_id: string }>(`SELECT user_id FROM chat_members WHERE chat_id=$1`, [chatId]);
  return rows.map((r) => r.user_id);
}

export async function peerUserIds(userId: string) {
  const rows = await query<{ user_id: string }>(
    `SELECT DISTINCT other.user_id
     FROM chat_members me
     JOIN chat_members other ON other.chat_id = me.chat_id AND other.user_id <> me.user_id
     WHERE me.user_id = $1
     LIMIT 500`,
    [userId],
  );
  return rows.map((r) => r.user_id);
}

export async function markRead(chatId: string, userId: string, messageId: string) {
  await mustMember(chatId, userId);
  await query(
    `UPDATE chat_members SET last_read_at=now(), last_read_message_id=$3 WHERE chat_id=$1 AND user_id=$2`,
    [chatId, userId, messageId],
  );
  return { ok: true };
}

export async function memberRole(chatId: string, userId: string) {
  const row = await queryOne<{ role: string }>(
    `SELECT role FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
    [chatId, userId],
  );
  if (!row) throw new HttpError(403, "forbidden", "forbidden");
  return row.role;
}

export function canManageMembers(role: string) {
  return role === "owner" || role === "admin";
}

export async function listMembers(userId: string, chatId: string) {
  await mustMember(chatId, userId);
  const rows = await query<UserRow & { role: string; joined_at: Date | string }>(
    `SELECT u.id, u.phone, u.display_name, u.username, u.avatar_url, u.bio, u.created_at, u.updated_at, u.last_seen_at,
            cm.role, cm.joined_at
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id=$1
     ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name`,
    [chatId],
  );
  const items: ChatMember[] = rows.map((r) => ({
    user: mapUser(r, presence.online(r.id)),
    role: r.role,
    joined_at: iso(r.joined_at) || new Date().toISOString(),
  }));
  return { items };
}

export async function addMembers(me: string, chatId: string, userIds: string[]) {
  const chat = await getChat(me, chatId);
  if (chat.type !== "group") throw new HttpError(400, "bad_request", "not a group");
  const role = await memberRole(chatId, me);
  if (!canManageMembers(role)) throw new HttpError(403, "forbidden", "forbidden");
  const ids = [...new Set((userIds || []).filter((id) => id && id !== me))];
  for (const uid of ids) {
    const exists = await queryOne<{ id: string }>(`SELECT id FROM users WHERE id=$1`, [uid]);
    if (!exists) continue;
    await query(
      `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [chatId, uid],
    );
  }
  await query(`UPDATE chats SET updated_at=now() WHERE id=$1`, [chatId]);
  await bustMembers(chatId).catch(() => undefined);
  return listMembers(me, chatId);
}

export async function removeMember(me: string, chatId: string, targetId: string) {
  const chat = await getChat(me, chatId);
  if (chat.type !== "group") throw new HttpError(400, "bad_request", "not a group");
  const myRole = await memberRole(chatId, me);
  const target = await queryOne<{ role: string }>(
    `SELECT role FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
    [chatId, targetId],
  );
  if (!target) throw new HttpError(404, "not_found", "not found");
  const self = me === targetId;
  if (!self && !canManageMembers(myRole)) throw new HttpError(403, "forbidden", "forbidden");
  if (!self && myRole === "admin" && (target.role === "admin" || target.role === "owner")) {
    throw new HttpError(403, "forbidden", "forbidden");
  }
  if (target.role === "owner" && !self) throw new HttpError(403, "forbidden", "cannot remove owner");
  if (self && target.role === "owner") {
    const next = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM chat_members
       WHERE chat_id=$1 AND user_id<>$2
       ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at
       LIMIT 1`,
      [chatId, me],
    );
    if (next) {
      await query(`UPDATE chat_members SET role='owner' WHERE chat_id=$1 AND user_id=$2`, [chatId, next.user_id]);
    }
  }
  await query(`DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, [chatId, targetId]);
  await query(`UPDATE chats SET updated_at=now() WHERE id=$1`, [chatId]);
  await bustMembers(chatId).catch(() => undefined);
  return { ok: true };
}
