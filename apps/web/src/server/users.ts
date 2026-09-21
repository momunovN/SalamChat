import { mapUser, type UserRow } from "./auth";
import { query, queryOne } from "./db";
import { presence } from "./hub";
import { HttpError } from "./http";
import { escapeLike, normalizePhone, phoneDigits } from "./phone";

export async function searchUsers(q: string) {
  q = q.trim().replace(/^@/, "");
  if (!q) return { items: [] as ReturnType<typeof mapUser>[] };
  const exact = normalizePhone(q) || "";
  const digits = phoneDigits(q);
  const digitQ = digits.length >= 3 ? digits : "";
  const like = escapeLike(q);
  const rows = await query<UserRow>(
    `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at
     FROM users
     WHERE ($1 <> '' AND (display_name ILIKE '%'||$1||'%' OR username ILIKE '%'||$1||'%'))
        OR ($2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%'||$2||'%')
     ORDER BY
       CASE
         WHEN $3 <> '' AND phone = $3 THEN 0
         WHEN $2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE $2||'%' THEN 1
         WHEN $2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%'||$2 THEN 2
         ELSE 3
       END,
       display_name
     LIMIT 30`,
    [like, digitQ, exact],
  );
  return {
    items: rows.map((r) => mapUser(r, presence.online(r.id))),
  };
}

export async function lookupPhones(phones: string[]) {
  const norm = (phones || []).map(normalizePhone).filter((p): p is string => !!p);
  if (norm.length === 0) return { items: [] as ReturnType<typeof mapUser>[] };
  const rows = await query<UserRow>(
    `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at
     FROM users WHERE phone = ANY($1)`,
    [norm],
  );
  return { items: rows.map((r) => mapUser(r, presence.online(r.id))) };
}

export async function getUserPublic(id: string) {
  const row = await queryOne<UserRow>(
    `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at FROM users WHERE id=$1`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "user not found");
  return mapUser(row, presence.online(row.id));
}
