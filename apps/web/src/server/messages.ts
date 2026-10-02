import { query, queryOne } from "./db";
import { publicBase } from "./env";
import { envelope, hub } from "./hub";
import { HttpError, iso } from "./http";
import {
  cachedName,
  membersCached,
  onPersist,
  publishChat,
  readHot,
  readRecent,
  rewriteHot,
} from "./valkey";
import {
  canManageMembers,
  memberIds,
  memberRole,
  mustMember,
  parsePayload,
  type Attachment,
  type Message,
  type ReplyPreview,
} from "./chats";
import { pushToUsers } from "./push";
import { openPayload, sealPayload } from "./seal";

type MsgRow = {
  id: string;
  chat_id: string;
  author_id: string | null;
  author_name?: string | null;
  type: string;
  payload: unknown;
  client_id: string;
  reply_to_id: string | null;
  created_at: Date | string;
  edited_at: Date | string | null;
  deleted_at: Date | string | null;
};

const MSG_COLS = `m.id, m.chat_id, m.author_id, m.type, m.payload, m.client_id, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at, u.display_name AS author_name`;

function mapMsg(r: MsgRow): Message {
  return {
    id: r.id,
    chat_id: r.chat_id,
    author_id: r.author_id,
    author_name: r.author_name || undefined,
    type: r.type,
    payload: openPayload(parsePayload(r.payload)),
    client_id: r.client_id,
    reply_to_id: r.reply_to_id,
    created_at: iso(r.created_at) || new Date().toISOString(),
    edited_at: iso(r.edited_at),
    deleted_at: iso(r.deleted_at),
  };
}

function previewFrom(m: Message): ReplyPreview {
  const payload = parsePayload(m.payload);
  return {
    id: m.id,
    author_id: m.author_id,
    author_name: m.author_name,
    type: m.type,
    text: String(payload.text || (m.type === "photo" ? "" : payload.caption || "")),
    deleted: !!m.deleted_at,
  };
}

async function attachReplies(items: Message[]) {
  const ids = [...new Set(items.map((m) => m.reply_to_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  const rows = await query<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id = ANY($1::uuid[])`,
    [ids],
  );
  const map = new Map(rows.map((r) => [r.id, previewFrom(mapMsg(r))]));
  for (const m of items) {
    if (!m.reply_to_id) continue;
    const found = map.get(m.reply_to_id);
    if (found) m.reply_to = found;
    else if (!m.reply_to) m.reply_to = { id: m.reply_to_id, type: "text", deleted: true };
  }
}

async function statusesFor(ids: string[]) {
  const map = new Map<string, string>();
  for (const id of ids) map.set(id, "sent");
  if (ids.length === 0) return map;
  const rows = await query<{ message_id: string; delivered: string; read: string }>(
    `SELECT message_id::text AS message_id,
       COALESCE(sum(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END),0)::text AS delivered,
       COALESCE(sum(CASE WHEN status = 'read' THEN 1 ELSE 0 END),0)::text AS read
     FROM receipts
     WHERE message_id = ANY($1::uuid[])
     GROUP BY message_id`,
    [ids],
  );
  for (const row of rows) {
    map.set(row.message_id, Number(row.read) > 0 ? "read" : Number(row.delivered) > 0 ? "delivered" : "sent");
  }
  return map;
}

async function attachmentsFor(ids: string[], req?: Request) {
  const out = new Map<string, Attachment[]>();
  if (ids.length === 0) return out;
  const rows = await query<{
    id: string;
    message_id: string;
    kind: string;
    object_key: string;
    mime: string;
    size_bytes: string | number;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    waveform: unknown;
    filename: string | null;
    sealed: boolean;
    upload_id: string | null;
  }>(
    `SELECT a.id, a.message_id, a.kind, a.object_key, a.mime, a.size_bytes, a.width, a.height, a.duration_ms, a.waveform, a.filename,
            COALESCE(u.sealed, false) AS sealed, u.id AS upload_id
     FROM attachments a
     LEFT JOIN uploads u ON u.object_key = a.object_key
     WHERE a.message_id = ANY($1::uuid[])`,
    [ids],
  );
  const base = publicBase(req);
  for (const a of rows) {
    const item: Attachment = {
      id: a.id,
      kind: a.kind,
      object_key: a.object_key,
      url:
        a.sealed && a.upload_id
          ? `${base}/media/id/${a.upload_id}`
          : /^https?:\/\//i.test(a.object_key)
            ? a.object_key
            : `${base}/media/${a.object_key}`,
      mime: a.mime,
      size_bytes: Number(a.size_bytes || 0),
      width: a.width,
      height: a.height,
      duration_ms: a.duration_ms,
      waveform: a.waveform,
      filename: a.filename,
    };
    const list = out.get(a.message_id) || [];
    list.push(item);
    out.set(a.message_id, list);
  }
  return out;
}

export async function getMessage(userId: string, id: string, req?: Request) {
  const row = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id=$1`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "not found");
  await mustMember(row.chat_id, userId);
  const msg = mapMsg(row);
  const atts = await attachmentsFor([msg.id], req);
  msg.attachments = atts.get(msg.id) || [];
  await attachReplies([msg]);
  return msg;
}

export async function listMessages(
  userId: string,
  chatId: string,
  q = "",
  cursor = "",
  limit = 50,
  req?: Request,
  after = "",
) {
  // Membership and the "cleared history" marker come from the same row: one round trip.
  const member = await queryOne<{ cleared_at: Date | string | null }>(
    `SELECT cleared_at FROM chat_members WHERE chat_id=$1 AND user_id=$2`,
    [chatId, userId],
  );
  if (!member) throw new HttpError(403, "forbidden", "forbidden");
  if (limit <= 0 || limit > 100) limit = 50;
  q = q.trim();
  const before = cursor ? new Date(cursor) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(before.getTime())) throw new HttpError(400, "bad_request", "bad cursor");
  const since = after ? new Date(after) : null;
  if (since && Number.isNaN(since.getTime())) throw new HttpError(400, "bad_request", "bad after");
  const cleared = iso(member.cleared_at) ?? null;
  const rows = await query<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.chat_id=$1 AND m.created_at < $2 AND m.deleted_at IS NULL
       AND ($5::timestamptz IS NULL OR m.created_at > $5::timestamptz)
       AND ($6::timestamptz IS NULL OR m.created_at > $6::timestamptz)
       AND ($3 = '' OR (m.payload->>'text') ILIKE '%'||$3||'%')
     ORDER BY m.created_at DESC
     LIMIT $4`,
    [chatId, before.toISOString(), q, limit + 1, cleared, since ? since.toISOString() : null],
  );
  let next: string | undefined;
  let pgItems = rows.map(mapMsg);
  if (pgItems.length > limit) {
    next = pgItems[limit - 1].created_at;
    pgItems = pgItems.slice(0, limit);
  }
  const pgIds = new Set(pgItems.map((m) => m.id));
  let items = pgItems;
  try {
    const hot = await readRecent(chatId);
    const extra: Message[] = [];
    const seen = new Set(pgIds);
    const needle = q.toLowerCase();
    for (const raw of hot) {
      let msg: Message;
      try {
        msg = JSON.parse(raw) as Message;
      } catch {
        continue;
      }
      if (!msg?.id || seen.has(msg.id) || msg.deleted_at) continue;
      if (msg.client_id && pgItems.some((item) => item.client_id === msg.client_id)) continue;
      if (cleared && msg.created_at <= cleared) continue;
      if (new Date(msg.created_at) >= before) continue;
      if (needle) {
        const text = String(parsePayload(msg.payload).text || "").toLowerCase();
        if (!text.includes(needle)) continue;
      }
      seen.add(msg.id);
      extra.push(msg);
    }
    if (extra.length) {
      items = [...extra, ...pgItems].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      if (items.length > limit) {
        next = items[limit - 1].created_at;
        items = items.slice(0, limit);
      }
    }
  } catch {
    items = pgItems;
  }
  const [atts, statuses] = await Promise.all([
    attachmentsFor(
      items.map((m) => m.id).filter((id) => pgIds.has(id)),
      req,
    ),
    statusesFor(items.filter((m) => m.author_id === userId && pgIds.has(m.id)).map((m) => m.id)),
    attachReplies(items),
  ]);
  for (const m of items) {
    if (!m.attachments?.length) m.attachments = atts.get(m.id) || [];
    if (m.author_id === userId && pgIds.has(m.id)) m.status = statuses.get(m.id) || "sent";
    else if (m.author_id === userId && !m.status) m.status = "sent";
  }
  return { items, cursor: next ?? null };
}

type SendInput = {
  client_id: string;
  type: string;
  payload?: unknown;
  reply_to_id?: string | null;
  upload_ids?: string[];
};

function prepareSend(input: SendInput) {
  if (!input.client_id) throw new HttpError(400, "bad_request", "client_id required");
  const type = input.type;
  if (!["text", "photo", "file", "voice", "location", "system"].includes(type)) {
    throw new HttpError(400, "bad_request", "bad type");
  }
  if (type === "system") throw new HttpError(403, "forbidden", "system messages are server-only");
  let payload = input.payload ?? {};
  let voiceMs: number | null = null;
  if (type === "text") {
    const text = String((payload as { text?: string }).text || "").trim();
    if (!text || [...text].length > 4096) throw new HttpError(400, "bad_request", "text length");
    payload = { ...(payload as object), text };
  }
  if (type === "voice") {
    const raw = Number((payload as { duration_ms?: number }).duration_ms);
    voiceMs = Number.isFinite(raw) ? Math.max(1, Math.min(Math.round(raw), 10 * 60 * 1000)) : null;
    const base = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const wave = Array.isArray(base.waveform)
      ? base.waveform
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
          .slice(0, 64)
          .map((n) => Math.max(0, Math.min(1, n)))
      : [];
    payload = { ...base, ...(voiceMs ? { duration_ms: voiceMs } : {}), ...(wave.length ? { waveform: wave } : {}) };
  }
  return { type, payload, voiceMs };
}

async function replyPreview(chatId: string, replyId: string) {
  const raw = await readHot(replyId).catch(() => null);
  if (raw) {
    const msg = JSON.parse(raw) as Message;
    if (msg.chat_id !== chatId) throw new HttpError(400, "bad_request", "bad reply_to");
    return previewFrom(msg);
  }
  const reply = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id=$1`,
    [replyId],
  );
  if (!reply || reply.chat_id !== chatId) throw new HttpError(400, "bad_request", "bad reply_to");
  return previewFrom(mapMsg(reply));
}

function fanoutNew(chatId: string, members: string[], msg: Message) {
  const fresh = envelope("message.new", msg);
  hub.publishMany(members, fresh);
  publishChat(chatId, fresh);
  if (msg.author_id) {
    hub.publish(
      msg.author_id,
      envelope("message.ack", {
        id: msg.id,
        client_id: msg.client_id,
        chat_id: chatId,
        created_at: msg.created_at,
      }),
    );
    const payload = msg.payload;
    const text =
      payload && typeof payload === "object" && "text" in payload && typeof (payload as { text?: unknown }).text === "string"
        ? (payload as { text: string }).text
        : "";
    void pushToUsers(
      members.filter((id) => id !== msg.author_id),
      {
        author: msg.author_name || "Salam",
        kind: "message",
        type: msg.type,
        text,
        tag: `chat-${chatId}`,
        url: "/",
      },
    );
  }
}

export async function sendMessage(userId: string, chatId: string, input: SendInput, req?: Request): Promise<Message> {
  const prepared = prepareSend(input);
  return sendMessagePg(userId, chatId, input, prepared, req);
}

/** A retry of an already stored client_id: return the stored row and fan it out again. */
async function resendExisting(userId: string, chatId: string, clientId: string, members: string[], req?: Request) {
  const row = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.client_id=$1`,
    [clientId],
  );
  if (!row || row.author_id !== userId) throw new HttpError(409, "conflict", "client_id");
  const msg = mapMsg(row);
  const [atts, statuses] = await Promise.all([attachmentsFor([msg.id], req), statusesFor([msg.id]), attachReplies([msg])]);
  msg.attachments = atts.get(msg.id) || [];
  msg.status = statuses.get(msg.id) || "sent";
  if (msg.chat_id === chatId) fanoutNew(chatId, members, msg);
  return msg;
}

function authorName(userId: string) {
  return cachedName(userId, async () => {
    const row = await queryOne<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [userId]);
    return row?.display_name || "";
  }).catch(() => "");
}

/**
 * Hot path. Every query is a network round trip, so the send is two of them:
 * 1) membership (cached member list), author name and reply preview in parallel;
 * 2) one statement that inserts the message, bumps the chat and unhides it for members.
 * The reply is then built from what we already have instead of reading the row back.
 */
async function sendMessagePg(
  userId: string,
  chatId: string,
  input: SendInput,
  prepared: { type: string; payload: unknown; voiceMs: number | null },
  req?: Request,
): Promise<Message> {
  const { type, payload, voiceMs } = prepared;

  const [members, name, reply] = await Promise.all([
    membersCached(chatId, () => memberIds(chatId)),
    authorName(userId),
    input.reply_to_id ? replyPreview(chatId, input.reply_to_id) : Promise.resolve(null),
  ]);
  if (!members.includes(userId)) throw new HttpError(403, "forbidden", "forbidden");

  const id = crypto.randomUUID();
  let row: { id: string; created_at: Date | string } | null;
  try {
    row = await queryOne<{ id: string; created_at: Date | string }>(
      `WITH ins AS (
         INSERT INTO messages (id, chat_id, author_id, type, payload, client_id, reply_to_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
         ON CONFLICT (client_id) DO NOTHING
         RETURNING id, created_at
       ), bump AS (
         UPDATE chats SET updated_at=now(), last_message_id=(SELECT id FROM ins)
         WHERE id=$2 AND EXISTS (SELECT 1 FROM ins)
       ), unhide AS (
         UPDATE chat_members SET hidden_at=NULL
         WHERE chat_id=$2 AND hidden_at IS NOT NULL AND EXISTS (SELECT 1 FROM ins)
       )
       SELECT id, created_at FROM ins`,
      [id, chatId, userId, type, JSON.stringify(sealPayload(payload)), input.client_id, input.reply_to_id || null],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("messages_client_id_uidx") || msg.includes("duplicate key")) {
      return resendExisting(userId, chatId, input.client_id, members, req);
    }
    throw err;
  }
  if (!row?.id) return resendExisting(userId, chatId, input.client_id, members, req);

  const msg: Message = {
    id: row.id,
    chat_id: chatId,
    author_id: userId,
    author_name: name || undefined,
    type,
    payload,
    client_id: input.client_id,
    reply_to_id: input.reply_to_id || null,
    reply_to: reply,
    created_at: iso(row.created_at) || new Date().toISOString(),
    edited_at: undefined,
    deleted_at: undefined,
    attachments: [],
    status: "sent",
  };

  if (input.upload_ids?.length) {
    await attachUploads(userId, msg.id, type, input.upload_ids, voiceMs);
    msg.attachments = (await attachmentsFor([msg.id], req)).get(msg.id) || [];
  }

  fanoutNew(chatId, members, msg);
  return msg;
}

function parseHot(raw: string) {
  return JSON.parse(raw) as Message;
}

async function editHot(userId: string, id: string, text: string) {
  const raw = await readHot(id);
  if (!raw) throw new HttpError(404, "not_found", "not found");
  const msg = parseHot(raw);
  if (msg.deleted_at) throw new HttpError(404, "not_found", "not found");
  const members = await membersCached(msg.chat_id, () => memberIds(msg.chat_id));
  if (!members.includes(userId)) throw new HttpError(403, "forbidden", "forbidden");
  if (msg.author_id !== userId) throw new HttpError(403, "forbidden", "forbidden");
  if (msg.type !== "text") throw new HttpError(400, "bad_request", "only text");
  const next = String(text || "").trim();
  if (!next || [...next].length > 4096) throw new HttpError(400, "bad_request", "text length");
  msg.payload = { ...parsePayload(msg.payload), text: next };
  msg.edited_at = new Date().toISOString();
  await rewriteHot(msg.chat_id, msg.id, JSON.stringify(msg), false);
  hub.publishMany(members, envelope("message.updated", msg));
  return msg;
}

export async function editMessage(userId: string, id: string, text: string, req?: Request) {
  const row = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id=$1`,
    [id],
  );
  if (!row) return editHot(userId, id, text);
  if (row.deleted_at) throw new HttpError(404, "not_found", "not found");
  await mustMember(row.chat_id, userId);
  if (row.author_id !== userId) throw new HttpError(403, "forbidden", "forbidden");
  if (row.type !== "text") throw new HttpError(400, "bad_request", "only text");
  const next = String(text || "").trim();
  if (!next || [...next].length > 4096) throw new HttpError(400, "bad_request", "text length");
  const payload = sealPayload({ ...openPayload(parsePayload(row.payload)), text: next });
  await query(`UPDATE messages SET payload=$2::jsonb, edited_at=now() WHERE id=$1`, [id, JSON.stringify(payload)]);
  const msg = await getMessage(userId, id, req);
  await rewriteHot(row.chat_id, msg.id, JSON.stringify(msg), false).catch(() => undefined);
  const members = await memberIds(row.chat_id);
  hub.publishMany(members, envelope("message.updated", msg));
  return msg;
}

async function deleteHot(userId: string, id: string) {
  const raw = await readHot(id);
  if (!raw) throw new HttpError(404, "not_found", "not found");
  const msg = parseHot(raw);
  if (msg.deleted_at) throw new HttpError(404, "not_found", "not found");
  const members = await membersCached(msg.chat_id, () => memberIds(msg.chat_id));
  if (!members.includes(userId)) throw new HttpError(403, "forbidden", "forbidden");
  if (msg.author_id !== userId) {
    const role = await memberRole(msg.chat_id, userId);
    const chat = await queryOne<{ type: string }>(`SELECT type FROM chats WHERE id=$1`, [msg.chat_id]);
    if (chat?.type !== "group" || !canManageMembers(role)) throw new HttpError(403, "forbidden", "forbidden");
  }
  msg.deleted_at = new Date().toISOString();
  await rewriteHot(msg.chat_id, msg.id, JSON.stringify(msg), true);
  hub.publishMany(members, envelope("message.deleted", { id, chat_id: msg.chat_id }));
  return { ok: true };
}

export async function deleteMessage(userId: string, id: string) {
  const row = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id=$1`,
    [id],
  );
  if (!row) return deleteHot(userId, id);
  if (row.deleted_at) throw new HttpError(404, "not_found", "not found");
  await mustMember(row.chat_id, userId);
  if (row.author_id !== userId) {
    const role = await memberRole(row.chat_id, userId);
    const chat = await queryOne<{ type: string }>(`SELECT type FROM chats WHERE id=$1`, [row.chat_id]);
    if (chat?.type !== "group" || !canManageMembers(role)) throw new HttpError(403, "forbidden", "forbidden");
  }
  await query(`UPDATE messages SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id]);
  await query(
    `UPDATE chats SET last_message_id = (
       SELECT id FROM messages WHERE chat_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1
     ), updated_at=now()
     WHERE id=$1 AND last_message_id=$2`,
    [row.chat_id, id],
  );
  const members = await memberIds(row.chat_id);
  const tomb = mapMsg(row);
  tomb.deleted_at = new Date().toISOString();
  await rewriteHot(row.chat_id, id, JSON.stringify(tomb), true).catch(() => undefined);
  hub.publishMany(members, envelope("message.deleted", { id, chat_id: row.chat_id }));
  return { ok: true };
}

async function attachUploads(
  userId: string,
  messageId: string,
  msgType: string,
  uploadIds: string[],
  voiceMs?: number | null,
) {
  let kind = msgType;
  for (const uid of uploadIds) {
    const u = await queryOne<{ object_key: string; mime: string; size_bytes: string | number; kind: string; status: string }>(
      `SELECT object_key, mime, size_bytes, kind, status FROM uploads WHERE id=$1 AND user_id=$2`,
      [uid, userId],
    );
    if (!u) throw new HttpError(400, "bad_request", "upload not found");
    if (u.status !== "ready") throw new HttpError(400, "bad_request", "upload not ready");
    if (kind === "photo" && u.kind !== "photo" && u.kind !== "video") kind = u.kind;
    else if (u.kind) kind = u.kind;
    await query(
      `INSERT INTO attachments (message_id, kind, object_key, mime, size_bytes, duration_ms) VALUES ($1,$2,$3,$4,$5,$6)`,
      [messageId, kind, u.object_key, u.mime, Number(u.size_bytes || 0), kind === "voice" ? voiceMs ?? null : null],
    );
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All ids in one statement: membership, upsert and the read marker together.
 * Opening a chat sends up to 50 ids; one by one that was ~200 sequential queries.
 */
export async function receipts(userId: string, messageIds: string[], status: string) {
  if (status !== "delivered" && status !== "read") throw new HttpError(400, "bad_request", "bad status");
  const ids = [...new Set((messageIds || []).map((id) => String(id).toLowerCase()).filter((id) => UUID_RE.test(id)))].slice(0, 500);
  if (ids.length === 0) return { ok: true };
  const rows = await query<{ id: string; chat_id: string; author_id: string | null; status: string }>(
    `WITH valid AS (
       SELECT m.id, m.chat_id, m.author_id, m.created_at
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE m.id = ANY($1::uuid[]) AND m.author_id IS DISTINCT FROM $2
     ), up AS (
       INSERT INTO receipts (message_id, user_id, status, at)
       SELECT id, $2, $3, now() FROM valid
       ON CONFLICT (message_id, user_id) DO UPDATE
         SET status = CASE WHEN receipts.status = 'read' THEN 'read' ELSE EXCLUDED.status END,
             at = now()
       RETURNING message_id, status
     ), mark AS (
       UPDATE chat_members cm
       SET last_read_at = now(), last_read_message_id = l.id
       FROM (SELECT DISTINCT ON (chat_id) chat_id, id FROM valid ORDER BY chat_id, created_at DESC) l
       WHERE $3 = 'read' AND cm.chat_id = l.chat_id AND cm.user_id = $2
     )
     SELECT v.id::text AS id, v.chat_id::text AS chat_id, v.author_id::text AS author_id, up.status
     FROM valid v JOIN up ON up.message_id = v.id`,
    [ids, userId, status],
  );
  for (const row of rows) {
    if (!row.author_id) continue;
    hub.publish(
      row.author_id,
      envelope("receipt", { message_id: row.id, user_id: userId, status: row.status, chat_id: row.chat_id }),
    );
  }
  return { ok: true };
}

onPersist(async (job) => {
  const raw = await readHot(job.id).catch(() => null);
  const hot = raw ? parseHot(raw) : null;
  const payload = hot?.payload ?? job.payload;
  const createdAt = hot?.created_at || job.createdAt;
  const replyTo = hot?.reply_to_id ?? job.replyToId;
  await query(
    `INSERT INTO messages (id, chat_id, author_id, type, payload, client_id, reply_to_id, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     ON CONFLICT (client_id) DO NOTHING`,
    [job.id, job.chatId, job.userId, job.type, JSON.stringify(sealPayload(payload)), job.clientId, replyTo, createdAt],
  );
  const row = await queryOne<{ id: string }>(`SELECT id FROM messages WHERE client_id=$1`, [job.clientId]);
  if (!row) throw new Error("message missing after insert");
  const realId = row.id;
  if (hot?.edited_at) {
    await query(`UPDATE messages SET payload=$2::jsonb, edited_at=$3 WHERE id=$1`, [
      realId,
      JSON.stringify(sealPayload(openPayload(parsePayload(hot.payload)))),
      hot.edited_at,
    ]);
  }
  if (hot?.deleted_at) {
    await query(`UPDATE messages SET deleted_at=$2 WHERE id=$1 AND deleted_at IS NULL`, [realId, hot.deleted_at]);
  }
  if (job.uploadIds.length) {
    const have = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM attachments WHERE message_id=$1`, [realId]);
    if (Number(have?.n || 0) < job.uploadIds.length) {
      await query(`DELETE FROM attachments WHERE message_id=$1`, [realId]);
      await attachUploads(job.userId, realId, job.type, job.uploadIds, job.voiceMs);
    }
  }
  await query(`UPDATE chats SET updated_at=now(), last_message_id=$2 WHERE id=$1`, [job.chatId, realId]);
});
