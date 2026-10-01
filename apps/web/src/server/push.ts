import { createECDH, createHash } from "crypto";
import * as webpush from "web-push";
import { query } from "./db";
import { env, jwtSecret } from "./env";
import { HttpError } from "./http";

export type PushNote = {
  author: string;
  kind: "message" | "call";
  type: string;
  text: string;
  tag: string;
  url: string;
};

type SubRow = {
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  lang: string;
};

const labels = {
  ru: {
    message: "Новое сообщение",
    photo: "Фото",
    voice: "Голосовое",
    file: "Файл",
    call: "Входящий звонок",
    video: "Входящий видеозвонок",
  },
  ky: {
    message: "Жаңы билдирүү",
    photo: "Сүрөт",
    voice: "Үн билдирүү",
    file: "Файл",
    call: "Кирүүчү чалуу",
    video: "Кирүүчү видео чалуу",
  },
};

let vapidCache: { publicKey: string; privateKey: string } | null = null;

function derivedVapid(seed: string) {
  const ecdh = createECDH("prime256v1");
  for (let i = 0; i < 32; i++) {
    const candidate = createHash("sha256").update(`salam-vapid-v1:${i}:${seed}`).digest();
    try {
      ecdh.setPrivateKey(candidate);
      return {
        publicKey: ecdh.getPublicKey(null, "uncompressed").toString("base64url"),
        privateKey: candidate.toString("base64url"),
      };
    } catch {
      /* this hash is not a valid P-256 scalar */
    }
  }
  throw new Error("vapid");
}

function vapidKeys() {
  if (vapidCache) return vapidCache;
  const publicKey = env("VAPID_PUBLIC_KEY");
  const privateKey = env("VAPID_PRIVATE_KEY");
  vapidCache = publicKey && privateKey ? { publicKey, privateKey } : derivedVapid(jwtSecret());
  const raw = env("VAPID_SUBJECT") || env("TOOAPP_PUBLIC_URL") || "https://salam-chat.ru";
  const subject = raw.startsWith("https://") || raw.startsWith("mailto:") ? raw : "https://salam-chat.ru";
  webpush.setVapidDetails(subject, vapidCache.publicKey, vapidCache.privateKey);
  return vapidCache;
}

export function vapidPublicKey() {
  return vapidKeys().publicKey;
}

function clip(text: string, max: number) {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

function bodyFor(note: PushNote, lang: "ru" | "ky") {
  const dict = labels[lang];
  if (note.kind === "call") return note.type === "video" ? dict.video : dict.call;
  if (note.type === "text" && note.text.trim()) return clip(note.text.trim(), 140);
  if (note.type === "photo") return dict.photo;
  if (note.type === "voice") return dict.voice;
  if (note.type === "file") return dict.file;
  return dict.message;
}

function endpointOf(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "bad_request", "bad endpoint");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "bad_request", "bad endpoint");
  if (url.href.length > 2000) throw new HttpError(400, "bad_request", "bad endpoint");
  return url.href;
}

export async function savePushSubscription(
  userId: string,
  body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; lang?: string },
) {
  const endpoint = endpointOf(body.endpoint || "");
  const p256dh = String(body.keys?.p256dh || "");
  const auth = String(body.keys?.auth || "");
  if (p256dh.length < 8 || p256dh.length > 200 || auth.length < 4 || auth.length > 200) {
    throw new HttpError(400, "bad_request", "bad keys");
  }
  const lang = body.lang === "ky" ? "ky" : "ru";
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret, lang)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth_secret=$4, lang=$5`,
    [userId, endpoint, p256dh, auth, lang],
  );
  return { ok: true };
}

export async function dropPushSubscription(userId: string, endpointRaw: string) {
  const endpoint = endpointOf(endpointRaw);
  await query(`DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`, [userId, endpoint]);
  return { ok: true };
}

export async function pushToUsers(userIds: string[], note: PushNote) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    vapidKeys();
    const rows = await query<SubRow>(
      `SELECT endpoint, p256dh, auth_secret, lang FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
      [ids],
    );
    await Promise.all(
      rows.map(async (row) => {
        const lang = row.lang === "ky" ? "ky" : "ru";
        const payload = JSON.stringify({
          title: clip(note.author || "Salam", 80),
          body: bodyFor(note, lang),
          tag: note.tag,
          url: note.url || "/",
          kind: note.kind,
        });
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_secret } },
            payload,
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [row.endpoint]);
            return;
          }
          console.error("push", status || (err instanceof Error ? err.message : err));
        }
      }),
    );
  } catch (err) {
    console.error("push", err instanceof Error ? err.message : err);
  }
}
