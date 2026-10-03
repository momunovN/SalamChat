import { SignJWT, jwtVerify } from "jose";
import { parseAccess } from "./auth";
import { queryOne } from "./db";
import { envBool, jwtSecret } from "./env";
import { HttpError, bearer } from "./http";

/**
 * /media is read by <img>, <audio> and <a download>, which cannot send an Authorization header.
 * So every authorized /v1 response also hands out a long-lived cookie scoped to /media, which
 * the browser (and iOS URLSession) then sends with media requests. Android sends its bearer.
 */
const COOKIE = "salam_media";
const ISSUER = "salam-media";
const LIFETIME_S = 30 * 24 * 3600;
/** A cookie older than this is reissued on the next /v1 call, so an active user never loses it. */
const RENEW_AFTER_S = 24 * 3600;

function key() {
  return new TextEncoder().encode(jwtSecret());
}

function readCookie(req: Request) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return "";
}

async function cookieClaims(req: Request) {
  const token = readCookie(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER });
    const userId = String(payload.sub || "");
    return userId ? { userId, iat: Number(payload.iat || 0) } : null;
  } catch {
    return null;
  }
}

function secure(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return proto.split(",")[0].trim() === "https" ? "; Secure" : "";
}

/** Set-Cookie for a user who made an authorized /v1 call, or null when theirs is still fresh. */
export async function mediaCookieFor(req: Request, userId: string) {
  const have = await cookieClaims(req);
  if (have?.userId === userId && Date.now() / 1000 - have.iat < RENEW_AFTER_S) return null;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${LIFETIME_S}s`)
    .sign(key());
  return `${COOKIE}=${token}; Path=/media; Max-Age=${LIFETIME_S}; HttpOnly; SameSite=Lax${secure(req)}`;
}

export function clearMediaCookie(req: Request) {
  return `${COOKIE}=; Path=/media; Max-Age=0; HttpOnly; SameSite=Lax${secure(req)}`;
}

/** The signed-in user behind a /v1 request, without failing it: null when there is none. */
export async function quietUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  try {
    return (await parseAccess(token)).userId;
  } catch {
    return null;
  }
}

const allowed = new Map<string, number>();
const ALLOW_TTL_MS = 10 * 60_000;

/**
 * Who may read a stored file: its uploader, members of a chat where it was sent, the audience
 * of a status it belongs to, and, for profile photos, any signed-in user (avatars show in
 * search and member lists).
 */
async function mayRead(userId: string, objectKey: string, path: string) {
  const memo = `${userId}|${path}`;
  const until = allowed.get(memo);
  if (until && until > Date.now()) return true;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM uploads WHERE object_key = $1 AND user_id = $2)
       OR EXISTS (
         SELECT 1 FROM attachments a
         JOIN messages m ON m.id = a.message_id
         JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
         WHERE a.object_key = $1
       )
       OR EXISTS (SELECT 1 FROM users WHERE avatar_url LIKE '%' || $3)
       OR EXISTS (
         -- A status photo or video: its author and everyone they have a direct chat with.
         SELECT 1 FROM stories s
         JOIN uploads up ON up.id = s.upload_id AND up.object_key = $1
         WHERE s.user_id = $2 OR s.user_id IN (
           SELECT m2.user_id FROM chat_members m1
           JOIN chats c ON c.id = m1.chat_id AND c.type = 'direct'
           JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id <> m1.user_id
           WHERE m1.user_id = $2
         )
       )
     ) AS ok`,
    [objectKey, userId, path],
  );
  if (!row?.ok) return false;
  if (allowed.size > 50_000) allowed.clear();
  allowed.set(memo, Date.now() + ALLOW_TTL_MS);
  return true;
}

/**
 * Throws unless the request comes from someone allowed to see this file. `path` is the
 * /media/... path the file is served at, as stored in avatar URLs.
 */
export async function requireMediaAccess(req: Request, objectKey: string, path: string) {
  // Escape hatch while old app builds without media auth are still around.
  if (envBool("SALAM_MEDIA_OPEN", false)) return;
  const userId = (await quietUser(req)) || (await cookieClaims(req))?.userId;
  if (!userId) throw new HttpError(401, "unauthorized", "sign in to view this file");
  if (!(await mayRead(userId, objectKey, path))) throw new HttpError(404, "not_found", "not found");
}
