import { query, queryOne } from "./db";
import { publicBase } from "./env";
import { envelope, hub } from "./hub";
import { HttpError, iso } from "./http";

/**
 * Statuses (stories): photo, video or a text card, gone after 24 hours. The audience is
 * everyone the author has a direct chat with, the same people who can message them.
 */

const KINDS = new Set(["text", "photo", "video"]);
const BGS = new Set(["#2b6bff", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#334155"]);

export type Story = {
  id: string;
  kind: string;
  text: string;
  bg: string;
  url: string | null;
  mime: string | null;
  created_at: string;
  expires_at: string;
  viewed: boolean;
  views?: number;
};

export type StoryGroup = {
  user: { id: string; display_name: string; avatar_url: string | null };
  stories: Story[];
  unseen: boolean;
};

type Row = {
  id: string;
  user_id: string;
  kind: string;
  text: string;
  bg: string;
  created_at: Date;
  expires_at: Date;
  object_key: string | null;
  upload_id: string | null;
  sealed: boolean | null;
  mime: string | null;
  display_name: string;
  avatar_url: string | null;
  viewed: boolean;
  views: number;
};

/** People who share a direct chat with `userId`. */
const PEERS = `
  SELECT m2.user_id FROM chat_members m1
  JOIN chats c ON c.id = m1.chat_id AND c.type = 'direct'
  JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id <> m1.user_id
  WHERE m1.user_id = $1`;

function mediaUrl(base: string, r: Pick<Row, "object_key" | "upload_id" | "sealed">) {
  if (!r.object_key) return null;
  if (r.sealed && r.upload_id) return `${base}/media/id/${r.upload_id}`;
  if (/^https?:\/\//i.test(r.object_key)) return r.object_key;
  return `${base}/media/${r.object_key}`;
}

function mapStory(r: Row, base: string, own: boolean): Story {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    bg: r.bg,
    url: mediaUrl(base, r),
    mime: r.mime,
    created_at: iso(r.created_at) || new Date().toISOString(),
    expires_at: iso(r.expires_at) || new Date().toISOString(),
    viewed: own || r.viewed,
    ...(own ? { views: Number(r.views || 0) } : {}),
  };
}

const SELECT = `
  SELECT s.id, s.user_id, s.kind, s.text, s.bg, s.created_at, s.expires_at, s.upload_id,
         u.object_key, u.sealed, u.mime,
         a.display_name, a.avatar_url,
         EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS viewed,
         (SELECT count(*)::int FROM story_views v WHERE v.story_id = s.id) AS views
  FROM stories s
  JOIN users a ON a.id = s.user_id
  LEFT JOIN uploads u ON u.id = s.upload_id`;

/** Our own statuses first, then people with unseen ones, then the rest, newest first. */
export async function listStories(me: string, req: Request): Promise<{ items: StoryGroup[] }> {
  const rows = await query<Row>(
    `${SELECT}
     WHERE s.expires_at > now() AND (s.user_id = $1 OR s.user_id IN (${PEERS}))
     ORDER BY s.created_at ASC`,
    [me],
  );
  const base = publicBase(req);
  const groups = new Map<string, StoryGroup>();
  for (const r of rows) {
    const own = r.user_id === me;
    let group = groups.get(r.user_id);
    if (!group) {
      group = { user: { id: r.user_id, display_name: r.display_name, avatar_url: r.avatar_url }, stories: [], unseen: false };
      groups.set(r.user_id, group);
    }
    const story = mapStory(r, base, own);
    group.stories.push(story);
    if (!story.viewed) group.unseen = true;
  }
  const last = (g: StoryGroup) => g.stories[g.stories.length - 1]?.created_at || "";
  const items = [...groups.values()].sort((a, b) => {
    if (a.user.id === me) return -1;
    if (b.user.id === me) return 1;
    if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
    return last(b).localeCompare(last(a));
  });
  return { items };
}

async function audience(me: string) {
  const rows = await query<{ user_id: string }>(PEERS, [me]);
  return [me, ...rows.map((r) => r.user_id)];
}

export async function createStory(
  me: string,
  body: { kind?: string; text?: string; bg?: string; upload_id?: string },
  req: Request,
) {
  const kind = body.kind || "";
  if (!KINDS.has(kind)) throw new HttpError(400, "bad_request", "kind");
  const text = String(body.text || "").trim().slice(0, 700);
  const bg = BGS.has(body.bg || "") ? (body.bg as string) : "#2b6bff";
  let uploadId: string | null = null;
  if (kind === "text") {
    if (!text) throw new HttpError(400, "bad_request", "text required");
  } else {
    const up = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM uploads WHERE id = $1 AND user_id = $2`,
      [body.upload_id || null, me],
    );
    if (!up || up.status !== "ready") throw new HttpError(400, "bad_request", "upload not ready");
    uploadId = up.id;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO stories (user_id, kind, text, bg, upload_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [me, kind, text, bg, uploadId],
  );
  if (!row) throw new HttpError(500, "internal", "story not saved");
  const saved = await queryOne<Row>(`${SELECT} WHERE s.id = $2`, [me, row.id]);
  hub.publishMany(await audience(me), envelope("story.updated", { user_id: me }));
  return saved ? mapStory(saved, publicBase(req), true) : null;
}

export async function viewStory(me: string, id: string) {
  const story = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM stories WHERE id = $1 AND expires_at > now()
       AND (user_id = $2 OR user_id IN (${PEERS.replace("$1", "$2")}))`,
    [id, me],
  );
  if (!story) throw new HttpError(404, "not_found", "not found");
  if (story.user_id === me) return { ok: true };
  await query(`INSERT INTO story_views (story_id, viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, me]);
  return { ok: true };
}

export async function deleteStory(me: string, id: string) {
  const gone = await queryOne<{ id: string }>(`DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id`, [id, me]);
  if (!gone) throw new HttpError(404, "not_found", "not found");
  hub.publishMany(await audience(me), envelope("story.updated", { user_id: me }));
  return { ok: true };
}

export async function storyViews(me: string, id: string) {
  const own = await queryOne<{ id: string }>(`SELECT id FROM stories WHERE id = $1 AND user_id = $2`, [id, me]);
  if (!own) throw new HttpError(404, "not_found", "not found");
  const rows = await query<{ id: string; display_name: string; avatar_url: string | null; viewed_at: Date }>(
    `SELECT u.id, u.display_name, u.avatar_url, v.viewed_at
     FROM story_views v JOIN users u ON u.id = v.viewer_id
     WHERE v.story_id = $1 ORDER BY v.viewed_at DESC`,
    [id],
  );
  return { items: rows.map((r) => ({ id: r.id, display_name: r.display_name, avatar_url: r.avatar_url, viewed_at: iso(r.viewed_at) })) };
}

/** Clears out statuses a day past their end; their uploads stay for chats that may share them. */
export async function sweepStories() {
  await query(`DELETE FROM stories WHERE expires_at < now() - interval '1 day'`);
}
