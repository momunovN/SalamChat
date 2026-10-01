import { parsePayload } from "./chats";
import { query, queryOne } from "./db";
import { publicBase } from "./env";
import { HttpError } from "./http";
import { openPayload } from "./seal";

export type ProfileLibrary = {
  media: { id: string; url: string; kind: string; created_at: string }[];
  links: { id: string; url: string; created_at: string }[];
  voice: { id: string; url: string; duration_ms: number | null; created_at: string }[];
  groups: { id: string; title: string; username: string | null; avatar_url: string | null; member_count: number }[];
};

const LINK_RE = /https?:\/\/[^\s<>"']+/gi;

function textOf(payload: unknown) {
  const open = openPayload(parsePayload(payload));
  return [open.text, open.caption]
    .filter((part) => typeof part === "string")
    .join("\n");
}

function linksIn(text: string) {
  const found = text.match(LINK_RE) || [];
  return found.map((url) => url.replace(/[),.;!?]+$/g, ""));
}

function iso(d: Date | string) {
  return typeof d === "string" ? d : d.toISOString();
}

export async function profileLibrary(viewerId: string, profileId: string, req?: Request): Promise<ProfileLibrary> {
  const exists = await queryOne(`SELECT 1 AS ok FROM users WHERE id=$1`, [profileId]);
  if (!exists) throw new HttpError(404, "not_found", "user not found");
  const self = viewerId === profileId;
  const messages = await query<{ id: string; type: string; payload: unknown; created_at: Date | string }>(
    self
      ? `SELECT m.id, m.type, m.payload, m.created_at
         FROM messages m
         JOIN chat_members me ON me.chat_id = m.chat_id AND me.user_id = $1
         WHERE m.author_id = $1 AND m.deleted_at IS NULL
           AND (me.cleared_at IS NULL OR m.created_at > me.cleared_at)
         ORDER BY m.created_at DESC
         LIMIT 200`
      : `SELECT m.id, m.type, m.payload, m.created_at
         FROM messages m
         JOIN chats c ON c.id = m.chat_id AND c.type = 'direct'
         JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $2
         JOIN chat_members them ON them.chat_id = c.id AND them.user_id = $1
         WHERE m.author_id = $1 AND m.deleted_at IS NULL
           AND (me.cleared_at IS NULL OR m.created_at > me.cleared_at)
         ORDER BY m.created_at DESC
         LIMIT 200`,
    self ? [viewerId] : [profileId, viewerId],
  );
  const ids = messages.map((m) => m.id);
  const files = new Map<string, { id: string; kind: string; url: string; duration_ms: number | null }[]>();
  if (ids.length) {
    const rows = await query<{
      id: string;
      message_id: string;
      kind: string;
      object_key: string;
      duration_ms: number | null;
      sealed: boolean;
      upload_id: string | null;
    }>(
      `SELECT a.id, a.message_id, a.kind, a.object_key, a.duration_ms,
              COALESCE(u.sealed, false) AS sealed, u.id AS upload_id
       FROM attachments a
       LEFT JOIN uploads u ON u.object_key = a.object_key
       WHERE a.message_id = ANY($1::uuid[])`,
      [ids],
    );
    const base = publicBase(req);
    for (const row of rows) {
      const url =
        row.sealed && row.upload_id
          ? `${base}/media/id/${row.upload_id}`
          : /^https?:\/\//i.test(row.object_key)
            ? row.object_key
            : `${base}/media/${row.object_key}`;
      const list = files.get(row.message_id) || [];
      list.push({ id: row.id, kind: row.kind, url, duration_ms: row.duration_ms });
      files.set(row.message_id, list);
    }
  }
  const media: ProfileLibrary["media"] = [];
  const links: ProfileLibrary["links"] = [];
  const voice: ProfileLibrary["voice"] = [];
  const seenLinks = new Set<string>();
  for (const message of messages) {
    const at = iso(message.created_at);
    const attached = files.get(message.id) || [];
    for (const file of attached) {
      if (file.kind === "photo" || file.kind === "video") {
        media.push({ id: file.id, url: file.url, kind: file.kind, created_at: at });
      }
      if (file.kind === "voice" && file.url) {
        voice.push({ id: file.id, url: file.url, duration_ms: file.duration_ms, created_at: at });
      }
    }
    for (const url of linksIn(textOf(message.payload))) {
      if (seenLinks.has(url)) continue;
      seenLinks.add(url);
      links.push({ id: `${message.id}:${links.length}`, url, created_at: at });
    }
  }
  const groups = await query<{
    id: string;
    title: string;
    username: string | null;
    avatar_url: string | null;
    member_count: string | number;
  }>(
    `SELECT c.id, COALESCE(c.title, '') AS title, c.username, c.avatar_url,
            (SELECT count(*) FROM chat_members x WHERE x.chat_id = c.id) AS member_count
     FROM chats c
     JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1 AND me.hidden_at IS NULL
     JOIN chat_members them ON them.chat_id = c.id AND them.user_id = $2
     WHERE c.type = 'group'
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [viewerId, profileId],
  );
  return {
    media: media.slice(0, 60),
    links: links.slice(0, 60),
    voice: voice.slice(0, 60),
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      username: g.username,
      avatar_url: g.avatar_url,
      member_count: Number(g.member_count || 0),
    })),
  };
}
