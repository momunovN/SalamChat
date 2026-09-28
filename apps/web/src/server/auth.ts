import { createHash, randomBytes, randomInt } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { query, queryOne } from "./db";
import { forgetName } from "./valkey";
import { jwtSecret } from "./env";
import { HttpError } from "./http";
import { sanitizeDisplayName, sanitizeUsername } from "@/lib/name";
import { defaultDisplayName, normalizeEmail, optionalPhone } from "./phone";

const USER_COLS = `id, phone, email, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at`;

export type User = {
  id: string;
  phone: string;
  email?: string | null;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
  bio: string;
  created_at: string;
  updated_at: string;
  last_seen_at?: string | null;
  online?: boolean;
  contacts_sync?: boolean;
};

type UserRow = {
  id: string;
  phone: string | null;
  email?: string | null;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_seen_at: Date | string | null;
  contacts_sync?: boolean;
};

function asIso(d: Date | string | null | undefined) {
  if (!d) return undefined;
  if (typeof d === "string") {
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? d : t.toISOString();
  }
  return d.toISOString();
}

function secretKey() {
  return new TextEncoder().encode(jwtSecret());
}

function hmacCode(email: string, code: string) {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(jwtSecret()), Buffer.from(email), Buffer.from(code)]))
    .digest("hex");
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function randomToken() {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

function mapUser(r: UserRow, online?: boolean): User {
  return {
    id: String(r.id),
    phone: r.phone || "",
    email: r.email || undefined,
    display_name: r.display_name,
    username: r.username ?? undefined,
    avatar_url: r.avatar_url ?? undefined,
    bio: r.bio ?? "",
    created_at: asIso(r.created_at) || new Date().toISOString(),
    updated_at: asIso(r.updated_at) || new Date().toISOString(),
    last_seen_at: asIso(r.last_seen_at),
    online,
    contacts_sync: r.contacts_sync,
  };
}

export async function requestOTP(emailRaw: string, phoneRaw = "") {
  const email = normalizeEmail(emailRaw);
  if (!email) throw new HttpError(400, "bad_request", "invalid email");
  const parsed = optionalPhone(phoneRaw || "");
  if (parsed.invalid) throw new HttpError(400, "bad_request", "invalid phone");
  const recent = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM otp_challenges WHERE lower(email)=lower($1) AND created_at > now() - interval '1 minute'`,
    [email],
  );
  if (Number(recent?.count || 0) > 0) {
    throw new HttpError(400, "bad_request", "too many otp requests");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hmacCode(email, code);
  await query(
    `INSERT INTO otp_challenges (phone, email, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')`,
    [parsed.phone || "", email, hash],
  );
  const { sendLoginCode } = await import("./mail");
  let via: "email" | "stub";
  try {
    via = await sendLoginCode(email, code);
  } catch (err) {
    await query(`DELETE FROM otp_challenges WHERE lower(email)=lower($1) AND code_hash=$2`, [email, hash]);
    console.error("login email", err);
    throw new HttpError(502, "bad_gateway", "Не удалось отправить письмо");
  }
  return {
    ok: true,
    retry_after_sec: 60,
    via,
    ...(via === "stub" ? { dev_code: code } : {}),
  };
}

type DeviceIn = { platform?: string; device_name?: string; push_token?: string };

async function issueSession(user: User, deviceId: string, refresh: string) {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const access = await new SignJWT({ did: deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("tooapp")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: exp.toISOString(),
    user,
    device_id: deviceId,
  };
}

async function userByEmail(email: string) {
  return queryOne<UserRow>(`SELECT ${USER_COLS} FROM users WHERE lower(email)=lower($1)`, [email]);
}

export async function verifyOTP(emailRaw: string, code: string, device: DeviceIn = {}, phoneRaw = "") {
  const email = normalizeEmail(emailRaw);
  if (!email) throw new HttpError(400, "bad_request", "invalid email");
  const parsed = optionalPhone(phoneRaw || "");
  if (parsed.invalid) throw new HttpError(400, "bad_request", "invalid phone");
  const phone = parsed.phone;
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length !== 6) throw new HttpError(400, "bad_request", "invalid code");
  let platform = device.platform || "web";
  if (!["ios", "android", "web"].includes(platform)) platform = "web";

  const ch = await queryOne<{ id: string; code_hash: string; attempts: number; expires_at: Date | string; phone: string }>(
    `SELECT id, code_hash, attempts, expires_at, phone FROM otp_challenges WHERE lower(email)=lower($1) AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  if (!ch) throw new HttpError(400, "bad_request", "no otp");
  if (Date.now() > new Date(ch.expires_at).getTime()) throw new HttpError(400, "bad_request", "otp expired");
  if (ch.attempts >= 5) throw new HttpError(400, "bad_request", "too many attempts");
  if (hmacCode(email, digits) !== ch.code_hash) {
    await query(`UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1`, [ch.id]);
    throw new HttpError(400, "bad_request", "wrong code");
  }
  const savedPhone = phone || (ch.phone ? optionalPhone(ch.phone).phone : null);

  // No transaction: Neon often drops idle-in-transaction sockets, which blocked login.
  let userRow = await userByEmail(email);
  if (!userRow && savedPhone) {
    const byPhone = await queryOne<UserRow>(`SELECT ${USER_COLS} FROM users WHERE phone=$1`, [savedPhone]);
    if (byPhone && byPhone.email && byPhone.email.toLowerCase() !== email) {
      throw new HttpError(409, "conflict", "phone taken");
    }
    if (byPhone) {
      await query(`UPDATE users SET email=$1, updated_at=now() WHERE id=$2 AND email IS NULL`, [email, byPhone.id]);
      userRow = await userByEmail(email);
    }
  }
  if (!userRow) {
    const id = crypto.randomUUID();
    const name = defaultDisplayName(savedPhone || "");
    try {
      userRow = await queryOne<UserRow>(
        `INSERT INTO users (id, phone, email, display_name) VALUES ($1,$2,$3,$4)
         RETURNING ${USER_COLS}`,
        [id, savedPhone, email, name],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/duplicate key/i.test(msg) && /phone/i.test(msg)) throw new HttpError(409, "conflict", "phone taken");
      if (/duplicate key/i.test(msg)) {
        userRow = await userByEmail(email);
      } else {
        throw err;
      }
    }
  }
  if (userRow && savedPhone && !userRow.phone) {
    const owner = await queryOne<{ id: string }>(`SELECT id FROM users WHERE phone=$1`, [savedPhone]);
    if (owner && owner.id !== userRow.id) throw new HttpError(409, "conflict", "phone taken");
    await query(`UPDATE users SET phone=$1, updated_at=now() WHERE id=$2 AND phone IS NULL`, [savedPhone, userRow.id]);
    userRow = (await userByEmail(email)) || userRow;
  }
  if (!userRow) throw new HttpError(500, "internal", "user create failed");

  const { raw, hash } = randomToken();
  const deviceId = crypto.randomUUID();
  const deviceName = (device.device_name || "web").slice(0, 120);
  try {
    await query(
      `INSERT INTO devices (id, user_id, platform, device_name, push_token, refresh_token_hash)
       VALUES ($1,$2,$3,$4,NULLIF($5,''),$6)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
      [deviceId, userRow.id, platform, deviceName, device.push_token || "", hash],
    );
    await query(`UPDATE otp_challenges SET consumed_at=now() WHERE id=$1`, [ch.id]);
  } catch (err) {
    console.error("verifyOTP persist", err);
    throw err;
  }

  return issueSession(mapUser(userRow), deviceId, raw);
}

export async function refreshSession(refresh: string) {
  if (!refresh) throw new HttpError(401, "unauthorized", "unauthorized");
  const row = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM devices WHERE refresh_token_hash=$1`,
    [hashToken(refresh)],
  );
  if (!row) throw new HttpError(401, "unauthorized", "unauthorized");
  const { raw, hash } = randomToken();
  await query(`UPDATE devices SET refresh_token_hash=$1, last_seen_at=now() WHERE id=$2`, [hash, row.id]);
  const user = await getUser(row.user_id);
  return issueSession(user, row.id, raw);
}

export async function logout(deviceId: string) {
  await query(`UPDATE devices SET refresh_token_hash='revoked:'||id::text WHERE id=$1`, [deviceId]);
  return { ok: true };
}

export async function parseAccess(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ["tooapp", "samal"] });
    const userId = String(payload.sub || "");
    const deviceId = String(payload.did || "");
    if (!userId || !deviceId) throw new Error("claims");
    return { userId, deviceId };
  } catch {
    throw new HttpError(401, "unauthorized", "invalid token");
  }
}

export async function getUser(id: string): Promise<User> {
  const row = await queryOne<UserRow>(
    `SELECT ${USER_COLS}, contacts_sync FROM users WHERE id=$1`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "not found");
  return mapUser(row);
}

export async function updateMe(
  id: string,
  patch: { display_name?: string; username?: string; bio?: string; avatar_url?: string },
) {
  let displayName = patch.display_name ?? null;
  if (patch.display_name !== undefined) {
    displayName = sanitizeDisplayName(patch.display_name);
    if (!displayName) throw new HttpError(400, "bad_request", "invalid name");
  }
  let username = patch.username ?? null;
  if (patch.username !== undefined) {
    const nick = sanitizeUsername(patch.username);
    if (nick === null) throw new HttpError(400, "bad_request", "invalid username");
    if (nick) {
      const taken = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE lower(username)=lower($1) AND id<>$2`,
        [nick, id],
      );
      if (taken) throw new HttpError(409, "conflict", "username taken");
      username = nick;
    } else {
      username = null;
    }
  }
  try {
    await query(
      `UPDATE users SET
        display_name = COALESCE($2, display_name),
        username = CASE WHEN $6 THEN $3 ELSE COALESCE($3, username) END,
        bio = COALESCE($4, bio),
        avatar_url = COALESCE($5, avatar_url),
        updated_at = now()
       WHERE id=$1`,
      [
        id,
        displayName,
        username,
        patch.bio ?? null,
        patch.avatar_url ?? null,
        patch.username !== undefined,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/users_username|duplicate key/i.test(msg)) throw new HttpError(409, "conflict", "username taken");
    throw err;
  }
  if (displayName) void forgetName(id);
  return getUser(id);
}

export { mapUser };
export type { UserRow };
