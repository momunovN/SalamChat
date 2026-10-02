import { importPKCS8, SignJWT } from "jose";
import { query } from "./db";
import { env } from "./env";

/**
 * Firebase Cloud Messaging (HTTP v1) for the Android app, so messages and calls reach a phone
 * whose app is closed. Off until FCM_SERVICE_ACCOUNT holds the service account JSON (raw or
 * base64) from Firebase console → Project settings → Service accounts.
 */
type Account = { project_id: string; client_email: string; private_key: string };

let account: Account | null | undefined;
let access: { token: string; until: number } | null = null;

function loadAccount(): Account | null {
  if (account !== undefined) return account;
  const raw = env("FCM_SERVICE_ACCOUNT").trim();
  account = null;
  if (!raw) return account;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text) as Partial<Account>;
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      account = {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
      };
    } else {
      console.error("fcm: FCM_SERVICE_ACCOUNT lacks project_id/client_email/private_key");
    }
  } catch (err) {
    console.error("fcm: bad FCM_SERVICE_ACCOUNT", err instanceof Error ? err.message : err);
  }
  return account;
}

export function fcmEnabled() {
  return !!loadAccount();
}

async function accessToken(acc: Account) {
  if (access && access.until > Date.now() + 60_000) return access.token;
  const key = await importPKCS8(acc.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(acc.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`fcm token ${res.status} ${data.error || ""}`);
  access = { token: data.access_token, until: Date.now() + (data.expires_in || 3600) * 1000 };
  return access.token;
}

export type FcmData = Record<string, string>;

async function sendOne(acc: Account, bearer: string, token: string, data: FcmData, ttlSec: number) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    // Data-only + high priority: the app builds the notification itself (incoming call screen,
    // per-chat grouping) and is woken even when it was swiped away.
    body: JSON.stringify({ message: { token, data, android: { priority: "HIGH", ttl: `${ttlSec}s` } } }),
  });
  if (res.ok) return;
  const text = await res.text();
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(text)) {
    await query(`UPDATE devices SET push_token='' WHERE push_token=$1`, [token]).catch(() => undefined);
    return;
  }
  console.error("fcm send", res.status, text.slice(0, 200));
}

/** Data push to every Android device of these users that registered a token. */
export async function fcmToUsers(userIds: string[], data: FcmData, ttlSec = 3600) {
  const acc = loadAccount();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!acc || ids.length === 0) return;
  try {
    const rows = await query<{ push_token: string }>(
      `SELECT DISTINCT push_token FROM devices
       WHERE user_id = ANY($1::uuid[]) AND platform = 'android'
         AND push_token IS NOT NULL AND push_token <> ''
         AND refresh_token_hash NOT LIKE 'revoked:%'`,
      [ids],
    );
    if (rows.length === 0) return;
    const bearer = await accessToken(acc);
    await Promise.all(rows.map((r) => sendOne(acc, bearer, r.push_token, data, ttlSec)));
  } catch (err) {
    console.error("fcm", err instanceof Error ? err.message : err);
  }
}
