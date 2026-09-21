import { createHash, randomBytes, randomInt } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { query, queryOne } from "./db";
import { jwtSecret, otpDev } from "./env";
import { HttpError } from "./http";
import { sanitizeDisplayName, sanitizeUsername } from "@/lib/name";
import { defaultDisplayName, normalizePhone } from "./phone";

export type User = {
  id: string;
  phone: string;
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
  phone: string;
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

function hmacCode(phone: string, code: string) {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(jwtSecret()), Buffer.from(phone), Buffer.from(code)]))
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
    phone: r.phone,
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

export async function requestOTP(phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new HttpError(400, "bad_request", "invalid phone");
  const recent = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM otp_challenges WHERE phone=$1 AND created_at > now() - interval '1 minute'`,
    [phone],
  );
  if (Number(recent?.count || 0) > 0) {
    throw new HttpError(400, "bad_request", "too many otp requests");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hmacCode(phone, code);
  await query(`INSERT INTO otp_challenges (phone, code_hash, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, [
    phone,
    hash,
  ]);
  const { sendOTP } = await import("./sms");
  const via = await sendOTP(phone, code);
  return {
    ok: true,
    retry_after_sec: 60,
    via,
    ...(otpDev() || via === "stub" ? { dev_code: code } : {}),
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

export async function verifyOTP(phoneRaw: string, code: string, device: DeviceIn = {}) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new HttpError(400, "bad_request", "invalid phone");
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length !== 6) throw new HttpError(400, "bad_request", "invalid code");
  let platform = device.platform || "web";
  if (!["ios", "android", "web"].includes(platform)) platform = "web";

  const ch = await queryOne<{ id: string; code_hash: string; attempts: number; expires_at: Date | string }>(
    `SELECT id, code_hash, attempts, expires_at FROM otp_challenges WHERE phone=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  if (!ch) throw new HttpError(400, "bad_request", "no otp");
  if (Date.now() > new Date(ch.expires_at).getTime()) throw new HttpError(400, "bad_request", "otp expired");
  if (ch.attempts >= 5) throw new HttpError(400, "bad_request", "too many attempts");
  if (hmacCode(phone, digits) !== ch.code_hash) {
    await query(`UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1`, [ch.id]);
    throw new HttpError(400, "bad_request", "wrong code");
  }

  // No transaction: Neon often drops idle-in-transaction sockets, which blocked login.
  let userRow = await queryOne<UserRow>(
    `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at FROM users WHERE phone=$1`,
    [phone],
  );
  if (!userRow) {
    const id = crypto.randomUUID();
    const name = defaultDisplayName(phone);
    try {
      userRow = await queryOne<UserRow>(
        `INSERT INTO users (id, phone, display_name) VALUES ($1,$2,$3)
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at`,
        [id, phone, name],
      );
    } catch {
      userRow = await queryOne<UserRow>(
        `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at FROM users WHERE phone=$1`,
        [phone],
      );
    }
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
    `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at, contacts_sync FROM users WHERE id=$1`,
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
  return getUser(id);
}

export { mapUser };
export type { UserRow };
