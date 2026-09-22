import { query, queryOne } from "./db";
import { envelope, hub } from "./hub";
import { HttpError, iso } from "./http";
import { publicBase } from "./env";
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
    payload: parsePayload(r.payload),
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
    text: String(payload.text || payload.caption || ""),
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
    if (m.reply_to_id) m.reply_to = map.get(m.reply_to_id) || { id: m.reply_to_id, type: "text", deleted: true };
  }
}

async function statusFor(messageId: string) {
  const row = await queryOne<{ delivered: string; read: string }>(
    `SELECT
      COALESCE(sum(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END),0)::text AS delivered,
      COALESCE(sum(CASE WHEN status = 'read' THEN 1 ELSE 0 END),0)::text AS read
     FROM receipts WHERE message_id=$1`,
    [messageId],
  );
  if (Number(row?.read || 0) > 0) return "read";
  if (Number(row?.delivered || 0) > 0) return "delivered";
  return "sent";
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
  }>(
    `SELECT id, message_id, kind, object_key, mime, size_bytes, width, height, duration_ms, waveform, filename
     FROM attachments WHERE message_id = ANY($1::uuid[])`,
    [ids],
  );
  const base = publicBase(req);
  for (const a of rows) {
    const item: Attachment = {
      id: a.id,
      kind: a.kind,
      object_key: a.object_key,
      url: `${base}/media/${a.object_key}`,
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

export async function listMessages(userId: string, chatId: string, q = "", cursor = "", limit = 50, req?: Request) {
  await mustMember(chatId, userId);
  if (limit <= 0 || limit > 100) limit = 50;
  q = q.trim();
  const before = cursor ? new Date(cursor) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(before.getTime())) throw new HttpError(400, "bad_request", "bad cursor");
  const rows = await query<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.chat_id=$1 AND m.created_at < $2 AND m.deleted_at IS NULL
       AND ($3 = '' OR (m.payload->>'text') ILIKE '%'||$3||'%')
     ORDER BY m.created_at DESC
     LIMIT $4`,
    [chatId, before.toISOString(), q, limit + 1],
  );
  let next: string | undefined;
  let items = rows.map(mapMsg);
  if (items.length > limit) {
    next = items[limit - 1].created_at;
    items = items.slice(0, limit);
  }
  const atts = await attachmentsFor(
    items.map((m) => m.id),
    req,
  );
  for (const m of items) {
    m.attachments = atts.get(m.id) || [];
    if (m.author_id === userId) m.status = await statusFor(m.id);
  }
  await attachReplies(items);
  return { items, cursor: next ?? null };
}

export async function sendMessage(
  userId: string,
  chatId: string,
  input: {
    client_id: string;
    type: string;
    payload?: unknown;
    reply_to_id?: string | null;
    upload_ids?: string[];
  },
  req?: Request,
) {
  await mustMember(chatId, userId);
  if (!input.client_id) throw new HttpError(400, "bad_request", "client_id required");
  const type = input.type;
  if (!["text", "photo", "file", "voice", "location", "system"].includes(type)) {
    throw new HttpError(400, "bad_request", "bad type");
  }
  if (type === "system") throw new HttpError(403, "forbidden", "system messages are server-only");
  let payload = input.payload ?? {};
  if (type === "text") {
    const text = String((payload as { text?: string }).text || "").trim();
    if (!text || [...text].length > 4096) throw new HttpError(400, "bad_request", "text length");
    payload = { ...(payload as object), text };
  }

  if (input.reply_to_id) {
    const reply = await queryOne<{ chat_id: string }>(`SELECT chat_id FROM messages WHERE id=$1`, [input.reply_to_id]);
    if (!reply || reply.chat_id !== chatId) throw new HttpError(400, "bad_request", "bad reply_to");
  }

  const existing = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.client_id=$1`,
    [input.client_id],
  );
  if (existing) {
    const msg = mapMsg(existing);
    const atts = await attachmentsFor([msg.id], req);
    msg.attachments = atts.get(msg.id) || [];
    msg.status = await statusFor(msg.id);
    return msg;
  }

  const id = crypto.randomUUID();
  try {
    await query(
      `INSERT INTO messages (id, chat_id, author_id, type, payload, client_id, reply_to_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (client_id) DO NOTHING`,
      [id, chatId, userId, type, JSON.stringify(payload), input.client_id, input.reply_to_id || null],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("messages_client_id_uidx") || msg.includes("duplicate key")) {
      return sendMessage(userId, chatId, input, req);
    }
    throw err;
  }

  if (input.upload_ids?.length) {
    await attachUploads(userId, id, type, input.upload_ids);
  }

  await query(`UPDATE chats SET updated_at=now(), last_message_id=$2 WHERE id=$1`, [chatId, id]);

  const msg = await getMessage(userId, id, req);
  msg.status = "sent";
  const members = await memberIds(chatId);
  hub.publishMany(members, envelope("message.created", msg));
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
  if (!row || row.deleted_at) throw new HttpError(404, "not_found", "not found");
  await mustMember(row.chat_id, userId);
  if (row.author_id !== userId) throw new HttpError(403, "forbidden", "forbidden");
  if (row.type !== "text") throw new HttpError(400, "bad_request", "only text");
  const next = String(text || "").trim();
  if (!next || [...next].length > 4096) throw new HttpError(400, "bad_request", "text length");
  const payload = { ...parsePayload(row.payload), text: next };
  await query(`UPDATE messages SET payload=$2::jsonb, edited_at=now() WHERE id=$1`, [id, JSON.stringify(payload)]);
  const msg = await getMessage(userId, id, req);
  const members = await memberIds(row.chat_id);
  hub.publishMany(members, envelope("message.updated", msg));
  return msg;
}

export async function deleteMessage(userId: string, id: string) {
  const row = await queryOne<MsgRow>(
    `SELECT ${MSG_COLS}
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id=$1`,
    [id],
  );
  if (!row || row.deleted_at) throw new HttpError(404, "not_found", "not found");
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
  hub.publishMany(members, envelope("message.deleted", { id, chat_id: row.chat_id }));
  return { ok: true };
}

async function attachUploads(userId: string, messageId: string, msgType: string, uploadIds: string[]) {
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
      `INSERT INTO attachments (message_id, kind, object_key, mime, size_bytes) VALUES ($1,$2,$3,$4,$5)`,
      [messageId, kind, u.object_key, u.mime, Number(u.size_bytes || 0)],
    );
  }
}

export async function receipts(userId: string, messageIds: string[], status: string) {
  if (status !== "delivered" && status !== "read") throw new HttpError(400, "bad_request", "bad status");
  for (const id of messageIds || []) {
    const row = await queryOne<{ chat_id: string; author_id: string | null }>(
      `SELECT chat_id, author_id FROM messages WHERE id=$1`,
      [id],
    );
    if (!row) continue;
    try {
      await mustMember(row.chat_id, userId);
    } catch {
      continue;
    }
    if (row.author_id === userId) continue;
    await query(
      `INSERT INTO receipts (message_id, user_id, status, at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (message_id, user_id) DO UPDATE
         SET status = CASE WHEN receipts.status = 'read' THEN 'read' ELSE EXCLUDED.status END,
             at = now()`,
      [id, userId, status],
    );
    if (status === "read") {
      await query(
        `UPDATE chat_members SET last_read_at=now(), last_read_message_id=$3 WHERE chat_id=$1 AND user_id=$2`,
        [row.chat_id, userId, id],
      );
    }
    if (row.author_id) {
      hub.publish(
        row.author_id,
        envelope("receipt.upserted", {
          message_id: id,
          user_id: userId,
          status,
          chat_id: row.chat_id,
        }),
      );
    }
  }
  return { ok: true };
}
