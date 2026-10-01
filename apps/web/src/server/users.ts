import { getChat } from "./chats";
import { mapUser, type User, type UserRow } from "./auth";
import { query, queryOne } from "./db";
import { presence } from "./hub";
import { HttpError } from "./http";
import { sanitizeUsername } from "@/lib/name";
import { escapeLike, normalizePhone, phoneDigits } from "./phone";

function hidePrivate(user: User, row: UserRow, opts: { phone: boolean; nick: boolean }) {
  if (!opts.nick || row.username_hidden) user.username = undefined;
  if (!opts.phone) user.phone = "";
  if (!opts.nick) user.username_hidden = undefined;
  user.email = undefined;
  return user;
}

export async function searchUsers(q: string, viewerId = "") {
  q = q.trim().replace(/^@/, "");
  if (!q) return { items: [] as User[] };
  const exact = normalizePhone(q) || "";
  const digits = phoneDigits(q);
  const digitQ = digits.length >= 3 ? digits : "";
  const like = escapeLike(q);
  const nick = q.replace(/^@/, "").toLowerCase();
  const nickQ = /^[a-z][a-z0-9_]{1,23}$/.test(nick) ? nick : "";
  const rows = await query<UserRow>(
    `SELECT id, phone, display_name, username, username_hidden, avatar_url, bio, created_at, updated_at, last_seen_at
     FROM users
     WHERE ($1 <> '' AND (
            display_name ILIKE '%'||$1||'%'
            OR (username_hidden = false AND username ILIKE '%'||$1||'%')
            OR email ILIKE '%'||$1||'%'
          ))
        OR ($2 <> '' AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE '%'||$2||'%')
        OR ($4 <> '' AND username_hidden = false AND lower(username) = $4)
     ORDER BY
       CASE
         WHEN $4 <> '' AND username_hidden = false AND lower(username) = $4 THEN 0
         WHEN $3 <> '' AND phone = $3 THEN 1
         WHEN $2 <> '' AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE $2||'%' THEN 2
         WHEN $2 <> '' AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE '%'||$2 THEN 3
         ELSE 4
       END,
       display_name
     LIMIT 30`,
    [like, digitQ, exact, nickQ],
  );
  const phones = rows.map((r) => r.phone).filter((p): p is string => !!p);
  const saved = new Set<string>();
  if (viewerId && phones.length) {
    const hits = await query<{ phone: string }>(
      `SELECT phone FROM contacts WHERE owner_id=$1 AND phone = ANY($2::text[])`,
      [viewerId, phones],
    );
    for (const hit of hits) saved.add(hit.phone);
  }
  return {
    items: rows.map((r) =>
      hidePrivate(mapUser(r, presence.online(r.id)), r, {
        phone: !!r.phone && saved.has(r.phone),
        nick: !r.username_hidden,
      }),
    ),
  };
}

export async function lookupPhones(phones: string[]) {
  const norm = (phones || []).map(normalizePhone).filter((p): p is string => !!p);
  if (norm.length === 0) return { items: [] as User[] };
  const rows = await query<UserRow>(
    `SELECT id, phone, display_name, username, username_hidden, avatar_url, bio, created_at, updated_at, last_seen_at
     FROM users WHERE phone = ANY($1)`,
    [norm],
  );
  return {
    items: rows.map((r) =>
      hidePrivate(mapUser(r, presence.online(r.id)), r, { phone: true, nick: !r.username_hidden }),
    ),
  };
}

async function savedPhone(viewerId: string, phone: string | null) {
  if (!phone) return false;
  const hit = await queryOne(
    `SELECT 1 AS ok FROM contacts WHERE owner_id=$1 AND phone=$2`,
    [viewerId, phone],
  );
  return !!hit;
}

function muted(until: Date | string | null | undefined) {
  if (!until) return false;
  const t = new Date(until).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

export async function getUserPublic(id: string, viewerId: string) {
  const row = await queryOne<UserRow>(
    `SELECT id, phone, email, display_name, username, username_hidden, avatar_url, bio, birth_date, address, public_id,
            created_at, updated_at, last_seen_at
     FROM users WHERE id=$1`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "user not found");
  const self = id === viewerId;
  const user = mapUser(row, presence.online(row.id));
  if (!self) {
    user.email = undefined;
    user.username_hidden = undefined;
    if (row.username_hidden) user.username = undefined;
    user.phone = (await savedPhone(viewerId, row.phone)) ? user.phone : "";
    const [a, b] = viewerId < id ? [viewerId, id] : [id, viewerId];
    const mute = await queryOne<{ muted_until: Date | null }>(
      `SELECT cm.muted_until
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
       WHERE c.peer_key = $2`,
      [viewerId, `${a}:${b}`],
    );
    user.notifications = !muted(mute?.muted_until);
  }
  return user;
}

export async function resolveSlug(viewerId: string, raw: string) {
  const slug = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!slug) throw new HttpError(404, "not_found", "not found");
  const nick = sanitizeUsername(slug);
  if (nick) {
    const user = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE lower(username)=lower($1)`,
      [nick],
    );
    if (user) return { user: await getUserPublic(user.id, viewerId), chat: null };
    const group = await queryOne<{ id: string }>(
      `SELECT c.id
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2
       WHERE c.type = 'group' AND lower(c.username)=lower($1)`,
      [nick, viewerId],
    );
    if (group) return { user: null, chat: await getChat(viewerId, group.id) };
  }
  if (/^[a-z0-9]{8}$/.test(slug)) {
    const byId = await queryOne<{ id: string }>(`SELECT id FROM users WHERE public_id=$1`, [slug]);
    if (byId) return { user: await getUserPublic(byId.id, viewerId), chat: null };
  }
  throw new HttpError(404, "not_found", "not found");
}
