import { mapUser, type User, type UserRow } from "./auth";
import { query } from "./db";
import { presence } from "./hub";
import { normalizePhone } from "./phone";

export type ContactUser = User & { book_name?: string };

const MAX = 2000;

export async function syncContacts(
  ownerId: string,
  enabled: boolean,
  items: { phone?: string; name?: string }[],
) {
  if (!enabled) {
    await query(`DELETE FROM contacts WHERE owner_id=$1`, [ownerId]);
    await query(`UPDATE users SET contacts_sync=false, updated_at=now() WHERE id=$1`, [ownerId]);
    return { ok: true, enabled: false, count: 0 };
  }

  const seen = new Set<string>();
  const rows: { phone: string; name: string }[] = [];
  for (const it of items || []) {
    const phone = normalizePhone(it.phone || "");
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    rows.push({ phone, name: String(it.name || "").trim().slice(0, 80) });
    if (rows.length >= MAX) break;
  }

  await query(`DELETE FROM contacts WHERE owner_id=$1`, [ownerId]);
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    const params: unknown[] = [ownerId];
    const values = chunk.map((r) => {
      const a = params.length + 1;
      const b = params.length + 2;
      params.push(r.phone, r.name);
      return `($1,$${a},$${b})`;
    });
    await query(
      `INSERT INTO contacts (owner_id, phone, book_name) VALUES ${values.join(",")}
       ON CONFLICT (owner_id, phone) DO UPDATE SET book_name = EXCLUDED.book_name`,
      params,
    );
  }
  await query(`UPDATE users SET contacts_sync=true, updated_at=now() WHERE id=$1`, [ownerId]);
  return { ok: true, enabled: true, count: rows.length };
}

export async function listContacts(ownerId: string): Promise<{ items: ContactUser[]; synced: boolean }> {
  const flag = await query<{ contacts_sync: boolean }>(`SELECT contacts_sync FROM users WHERE id=$1`, [ownerId]);
  const synced = !!flag[0]?.contacts_sync;
  const rows = await query<
    UserRow & { book_name: string; contacts_sync?: boolean }
  >(
    `SELECT u.id, u.phone, u.display_name, u.username, u.avatar_url, u.bio, u.created_at, u.updated_at, u.last_seen_at,
            c.book_name
     FROM contacts c
     JOIN users u ON u.phone = c.phone
     WHERE c.owner_id=$1 AND u.id <> $1
     ORDER BY COALESCE(NULLIF(c.book_name, ''), u.display_name)
     LIMIT 500`,
    [ownerId],
  );
  return {
    synced,
    items: rows.map((r) => ({
      ...mapUser(r, presence.online(r.id)),
      book_name: r.book_name || undefined,
    })),
  };
}


