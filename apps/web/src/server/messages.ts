import { query, queryOne } from "./db";
import { publicBase } from "./env";
import { envelope, hub } from "./hub";
import { HttpError, iso } from "./http";
import {
  cachedName,
  connectValkey,
  membersCached,
  messageByClient,
  onPersist,
  readHot,
  readRecent,
  rewriteHot,
  stageMessage,
  valkeyReady,
  type PersistJob,
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
    if (!m.reply_to_id) continue;
    const found = map.get(m.reply_to_id);
    if (found) m.reply_to = found;
    else if (!m.reply_to) m.reply_to = { id: m.reply_to_id, type: "text", deleted: true };
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
      url: /^https?:\/\//i.test(a.object_key) ? a.object_key : `${base}/media/${a.object_key}`,
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
  const atts = await attachmentsFor(
    items.map((m) => m.id).filter((id) => pgIds.has(id)),
    req,
  );
  for (const m of items) {
    if (!m.attachments?.length) m.attachments = atts.get(m.id) || [];
    if (m.author_id === userId && pgIds.has(m.id)) m.status = await statusFor(m.id);
    else if (m.author_id === userId && !m.status) m.status = "sent";
  }
  await attachReplies(items);
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
    const base = payload && typeof payload === "object" ? payload : {};
    payload = { ...base, ...(voiceMs ? { duration_ms: voiceMs } : {}) };
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

async function readyAttachments(
  userId: string,
  msgType: string,
  uploadIds: string[],
  voiceMs: number | null,
  req?: Request,
) {
  const base = publicBase(req);
  const out: Attachment[] = [];
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
    out.push({
      id: crypto.randomUUID(),
      kind,
      object_key: u.object_key,
      url: /^https?:\/\//i.test(u.object_key) ? u.object_key : `${base}/media/${u.object_key}`,
      mime: u.mime,
      size_bytes: Number(u.size_bytes || 0),
      duration_ms: kind === "voice" ? voiceMs : null,
    });
  }
  return out;
}

export async function sendMessage(userId: string, chatId: string, input: SendInput, req?: Request): Promise<Message> {
  const prepared = prepareSend(input);
  await connectValkey();
  if (!valkeyReady()) return sendMessagePg(userId, chatId, input, prepared, req);

  const uploadIds = input.upload_ids || [];
  const [members, dupRaw, reply, attachments, authorName] = await Promise.all([
    membersCached(chatId, () => memberIds(chatId)),
    messageByClient(input.client_id).catch(() => null),
    input.reply_to_id ? replyPreview(chatId, input.reply_to_id) : Promise.resolve(undefined),
    uploadIds.length ? readyAttachments(userId, prepared.type, uploadIds, prepared.voiceMs, req) : Promise.resolve([]),
    cachedName(userId, async () => {
      const row = await queryOne<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [userId]);
      return row?.display_name || "";
    }),
  ]);
  if (!members.includes(userId)) throw new HttpError(403, "forbidden", "forbidden");
  if (dupRaw) {
    const dup = JSON.parse(dupRaw) as Message;
    if (dup.chat_id === chatId) return dup;
  }

  const id = crypto.randomUUID();
  const msg: Message = {
    id,
    chat_id: chatId,
    author_id: userId,
    author_name: authorName || undefined,
    type: prepared.type,
    payload: prepared.payload,
    client_id: input.client_id,
    reply_to_id: input.reply_to_id || null,
    reply_to: reply,
    created_at: new Date().toISOString(),
    attachments,
    status: "sent",
  };
  const job: PersistJob = {
    id,
    chatId,
    userId,
    type: prepared.type,
    payload: prepared.payload,
    clientId: input.client_id,
    replyToId: input.reply_to_id || null,
    createdAt: msg.created_at,
    uploadIds,
    voiceMs: prepared.voiceMs,
  };
  try {
    const staged = await stageMessage(JSON.stringify(msg), id, input.client_id, chatId, job);
    if (staged === "dup") {
      const again = await messageByClient(input.client_id);
      if (again) {
        const parsed = JSON.parse(again) as Message;
        if (parsed.chat_id === chatId) return parsed;
      }
      return sendMessagePg(userId, chatId, input, prepared, req);
    }
    if (staged === "down") return sendMessagePg(userId, chatId, input, prepared, req);
  } catch (err) {
    console.error("valkey stage", err instanceof Error ? err.message : err);
    return sendMessagePg(userId, chatId, input, prepared, req);
  }
  hub.publishMany(members, envelope("message.created", msg));
  return msg;
}

async function sendMessagePg(
  userId: string,
  chatId: string,
  input: SendInput,
  prepared: { type: string; payload: unknown; voiceMs: number | null },
  req?: Request,
): Promise<Message> {
  await mustMember(chatId, userId);
  const { type, payload, voiceMs } = prepared;

  if (input.reply_to_id) await replyPreview(chatId, input.reply_to_id);

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
    await attachUploads(userId, id, type, input.upload_ids, voiceMs);
  }

  await query(`UPDATE chats SET updated_at=now(), last_message_id=$2 WHERE id=$1`, [chatId, id]);

  const msg = await getMessage(userId, id, req);
  msg.status = "sent";
  const members = await memberIds(chatId);
  hub.publishMany(members, envelope("message.created", msg));
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
  const payload = { ...parsePayload(row.payload), text: next };
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
    [job.id, job.chatId, job.userId, job.type, JSON.stringify(payload), job.clientId, replyTo, createdAt],
  );
  const row = await queryOne<{ id: string }>(`SELECT id FROM messages WHERE client_id=$1`, [job.clientId]);
  if (!row) throw new Error("message missing after insert");
  const realId = row.id;
  if (hot?.edited_at) {
    await query(`UPDATE messages SET payload=$2::jsonb, edited_at=$3 WHERE id=$1`, [
      realId,
      JSON.stringify(parsePayload(hot.payload)),
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
