import { createHash, randomBytes, randomInt } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { query, queryOne } from "./db";
import { forgetName } from "./valkey";
import { jwtSecret, otpDev, phoneCodeOnScreen } from "./env";
import { sendOTP } from "./sms";
import { HttpError } from "./http";
import { sanitizeDisplayName, sanitizeUsername } from "@/lib/name";
import { nickTaken } from "./nicks";
import { defaultDisplayName, normalizeEmail, optionalPhone } from "./phone";

const USER_COLS = `id, phone, email, display_name, username, avatar_url, bio, birth_date, address, username_hidden, public_id, created_at, updated_at, last_seen_at`;

export type User = {
  id: string;
  phone: string;
  email?: string | null;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
  bio: string;
  birth_date?: string | null;
  address?: string;
  username_hidden?: boolean;
  public_id?: string | null;
  notifications?: boolean;
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
  birth_date?: Date | string | null;
  address?: string | null;
  username_hidden?: boolean | null;
  public_id?: string | null;
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

function asDate(d: Date | string | null | undefined) {
  if (!d) return undefined;
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    birth_date: asDate(r.birth_date) ?? null,
    address: r.address ?? "",
    username_hidden: !!r.username_hidden,
    public_id: r.public_id ?? undefined,
    created_at: asIso(r.created_at) || new Date().toISOString(),
    updated_at: asIso(r.updated_at) || new Date().toISOString(),
    last_seen_at: asIso(r.last_seen_at),
    online,
    contacts_sync: r.contacts_sync,
  };
}

function deliverStub() {
  return process.env.NODE_ENV !== "production" && otpDev();
}

async function dropCode(hash: string) {
  await query(`DELETE FROM otp_challenges WHERE code_hash=$1`, [hash]);
}

export async function requestOTP(emailRaw: string, phoneRaw = "") {
  const emailTyped = emailRaw.trim().length > 0;
  const email = normalizeEmail(emailRaw);
  if (emailTyped && !email) throw new HttpError(400, "bad_request", "invalid email");
  const parsed = optionalPhone(phoneRaw || "");
  if (parsed.invalid) throw new HttpError(400, "bad_request", "invalid phone");
  const phone = parsed.phone;
  if (!email && !phone) throw new HttpError(400, "bad_request", "email or phone required");

  const recent = email
    ? await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM otp_challenges WHERE lower(email)=lower($1) AND created_at > now() - interval '1 minute'`,
        [email],
      )
    : await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM otp_challenges
         WHERE phone=$1 AND coalesce(email, '') = '' AND created_at > now() - interval '1 minute'`,
        [phone],
      );
  if (Number(recent?.count || 0) > 0) {
    throw new HttpError(400, "bad_request", "too many otp requests");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const key = email || phone || "";
  const hash = hmacCode(key, code);
  await query(
    `INSERT INTO otp_challenges (phone, email, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')`,
    [phone || "", email, hash],
  );

  let via: "email" | "sms" | "screen" | "stub";
  let hint: string | undefined;
  const { sendLoginCode } = await import("./mail");
  if (email) {
    try {
      via = await sendLoginCode(email, code);
    } catch (err) {
      await dropCode(hash);
      console.error("login email", err);
      throw new HttpError(502, "bad_gateway", "Не удалось отправить письмо");
    }
  } else {
    let sent: "p1sms" | "stub";
    try {
      sent = await sendOTP(phone || "", code);
    } catch (err) {
      await dropCode(hash);
      console.error("login sms", err);
      throw new HttpError(502, "bad_gateway", "Не удалось отправить SMS");
    }
    if (sent === "p1sms") {
      via = "sms";
    } else {
      // No SMS provider yet. A number that already has a confirmed email gets the code there,
      // otherwise anyone could type that number and read the code off the screen.
      const owner = await userByPhone(phone || "");
      if (owner?.email) {
        try {
          via = await sendLoginCode(owner.email, code);
        } catch (err) {
          await dropCode(hash);
          console.error("login email (phone owner)", err);
          throw new HttpError(502, "bad_gateway", "Не удалось отправить письмо");
        }
        hint = maskEmail(owner.email);
      } else {
        via = phoneCodeOnScreen() ? "screen" : "stub";
      }
    }
  }
  if (via === "stub" && !deliverStub()) {
    await dropCode(hash);
    throw new HttpError(502, "bad_gateway", email || hint ? "Почта не настроена" : "SMS не настроено");
  }
  return {
    ok: true,
    retry_after_sec: 60,
    via,
    ...(hint ? { hint } : {}),
    ...(via === "stub" || via === "screen" ? { dev_code: code } : {}),
  };
}

/** a***@mail.ru: enough to recognise your own mailbox, not enough to learn someone else's. */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const head = name.slice(0, Math.min(2, Math.max(1, name.length - 1)));
  return `${head}***@${domain}`;
}

/** Sends a code that confirms the mailbox before it is tied to the signed-in account. */
export async function requestEmailAttach(userId: string, emailRaw: string) {
  const email = normalizeEmail(emailRaw || "");
  if (!email) throw new HttpError(400, "bad_request", "invalid email");
  const taken = await queryOne<{ id: string }>(`SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2`, [email, userId]);
  if (taken) throw new HttpError(409, "conflict", "email taken");
  const recent = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM otp_challenges
     WHERE purpose='attach' AND user_id=$1 AND created_at > now() - interval '1 minute'`,
    [userId],
  );
  if (Number(recent?.count || 0) > 0) throw new HttpError(400, "bad_request", "too many otp requests");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hmacCode(`attach:${userId}:${email}`, code);
  await query(
    `INSERT INTO otp_challenges (phone, email, code_hash, expires_at, purpose, user_id)
     VALUES ('', $1, $2, now() + interval '5 minutes', 'attach', $3)`,
    [email, hash, userId],
  );
  const { sendLoginCode } = await import("./mail");
  let via: "email" | "stub";
  try {
    via = await sendLoginCode(email, code, "attach");
  } catch (err) {
    await dropCode(hash);
    console.error("attach email", err);
    throw new HttpError(502, "bad_gateway", "Не удалось отправить письмо");
  }
  if (via === "stub" && !deliverStub()) {
    await dropCode(hash);
    throw new HttpError(502, "bad_gateway", "Почта не настроена");
  }
  return { ok: true, retry_after_sec: 60, via, ...(via === "stub" ? { dev_code: code } : {}) };
}

export async function verifyEmailAttach(userId: string, emailRaw: string, code: string) {
  const email = normalizeEmail(emailRaw || "");
  if (!email) throw new HttpError(400, "bad_request", "invalid email");
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length !== 6) throw new HttpError(400, "bad_request", "invalid code");
  const ch = await queryOne<{ id: string; code_hash: string; attempts: number; expires_at: Date | string }>(
    `SELECT id, code_hash, attempts, expires_at FROM otp_challenges
     WHERE purpose='attach' AND user_id=$1 AND lower(email)=lower($2) AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId, email],
  );
  if (!ch) throw new HttpError(400, "bad_request", "no otp");
  if (Date.now() > new Date(ch.expires_at).getTime()) throw new HttpError(400, "bad_request", "otp expired");
  if (ch.attempts >= 5) throw new HttpError(400, "bad_request", "too many attempts");
  if (hmacCode(`attach:${userId}:${email}`, digits) !== ch.code_hash) {
    await query(`UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1`, [ch.id]);
    throw new HttpError(400, "bad_request", "wrong code");
  }
  const used = await query<{ id: string }>(
    `UPDATE otp_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`,
    [ch.id],
  );
  if (!used.length) throw new HttpError(400, "bad_request", "no otp");
  try {
    await query(`UPDATE users SET email=$1, updated_at=now() WHERE id=$2`, [email, userId]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/duplicate key/i.test(msg)) throw new HttpError(409, "conflict", "email taken");
    throw err;
  }
  return getUser(userId);
}

type DeviceIn = { platform?: string; device_name?: string; push_token?: string };

async function issueSession(user: User, deviceId: string, refresh: string) {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const access = await new SignJWT({ did: deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("salam")
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

async function userByPhone(phone: string) {
  return queryOne<UserRow>(`SELECT ${USER_COLS} FROM users WHERE phone=$1`, [phone]);
}

async function ensurePhoneUser(phone: string) {
  let userRow = await userByPhone(phone);
  if (userRow) return userRow;
  const id = crypto.randomUUID();
  try {
    userRow = await queryOne<UserRow>(
      `INSERT INTO users (id, phone, email, display_name) VALUES ($1,$2,NULL,$3)
       RETURNING ${USER_COLS}`,
      [id, phone, defaultDisplayName(phone)],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/duplicate key/i.test(msg)) userRow = await userByPhone(phone);
    else throw err;
  }
  if (!userRow) throw new HttpError(500, "internal", "user create failed");
  return userRow;
}

export async function verifyOTP(emailRaw: string, code: string, device: DeviceIn = {}, phoneRaw = "") {
  const emailTyped = emailRaw.trim().length > 0;
  const email = normalizeEmail(emailRaw);
  if (emailTyped && !email) throw new HttpError(400, "bad_request", "invalid email");
  const parsed = optionalPhone(phoneRaw || "");
  if (parsed.invalid) throw new HttpError(400, "bad_request", "invalid phone");
  const phone = parsed.phone;
  if (!email && !phone) throw new HttpError(400, "bad_request", "email or phone required");
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length !== 6) throw new HttpError(400, "bad_request", "invalid code");
  let platform = device.platform || "web";
  if (!["ios", "android", "web"].includes(platform)) platform = "web";

  const ch = email
    ? await queryOne<{ id: string; code_hash: string; attempts: number; expires_at: Date | string; phone: string }>(
        `SELECT id, code_hash, attempts, expires_at, phone FROM otp_challenges WHERE lower(email)=lower($1) AND purpose='login' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [email],
      )
    : await queryOne<{ id: string; code_hash: string; attempts: number; expires_at: Date | string; phone: string }>(
        `SELECT id, code_hash, attempts, expires_at, phone FROM otp_challenges
         WHERE phone=$1 AND coalesce(email, '') = '' AND purpose='login' AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [phone],
      );
  if (!ch) throw new HttpError(400, "bad_request", "no otp");
  if (Date.now() > new Date(ch.expires_at).getTime()) throw new HttpError(400, "bad_request", "otp expired");
  if (ch.attempts >= 5) throw new HttpError(400, "bad_request", "too many attempts");
  const hmacKey = email || phone || "";
  if (hmacCode(hmacKey, digits) !== ch.code_hash) {
    await query(`UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1`, [ch.id]);
    throw new HttpError(400, "bad_request", "wrong code");
  }
  const savedPhone = phone || (ch.phone ? optionalPhone(ch.phone).phone : null);

  // No transaction: Neon often drops idle-in-transaction sockets, which blocked login.
  if (!email) {
    const userRow = await ensurePhoneUser(phone || "");
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
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ["salam", "tooapp", "samal"] });
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

function parseBirth(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, "bad_request", "invalid birth date");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "bad_request", "invalid birth date");
  const year = Number(s.slice(0, 4));
  if (year < 1900 || d.getTime() > Date.now()) throw new HttpError(400, "bad_request", "invalid birth date");
  return s;
}

function parseAddress(raw: string) {
  const s = raw.trim().replace(/\s+/g, " ");
  if ([...s].length > 160) throw new HttpError(400, "bad_request", "invalid address");
  return s;
}

export async function updateMe(
  id: string,
  patch: {
    display_name?: string;
    username?: string;
    bio?: string;
    avatar_url?: string;
    birth_date?: string | null;
    address?: string;
    username_hidden?: boolean;
  },
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
      if (await nickTaken(nick, { userId: id })) throw new HttpError(409, "conflict", "username taken");
      username = nick;
    } else {
      username = null;
    }
  }
  const birth = patch.birth_date !== undefined ? parseBirth(patch.birth_date || "") : null;
  const address = patch.address !== undefined ? parseAddress(patch.address) : null;
  try {
    await query(
      `UPDATE users SET
        display_name = COALESCE($2, display_name),
        username = CASE WHEN $6 THEN $3 ELSE username END,
        bio = COALESCE($4, bio),
        avatar_url = COALESCE($5, avatar_url),
        birth_date = CASE WHEN $7 THEN $8::date ELSE birth_date END,
        address = CASE WHEN $9 THEN $10 ELSE address END,
        username_hidden = CASE WHEN $11 THEN $12 ELSE username_hidden END,
        updated_at = now()
       WHERE id=$1`,
      [
        id,
        displayName,
        username,
        patch.bio ?? null,
        patch.avatar_url ?? null,
        patch.username !== undefined,
        patch.birth_date !== undefined,
        birth,
        patch.address !== undefined,
        address,
        patch.username_hidden !== undefined,
        !!patch.username_hidden,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/users_username|duplicate key|users_public_id|chats_username/i.test(msg)) {
      throw new HttpError(409, "conflict", "username taken");
    }
    throw err;
  }
  if (displayName) void forgetName(id);
  return getUser(id);
}

export { mapUser };
export type { UserRow };
