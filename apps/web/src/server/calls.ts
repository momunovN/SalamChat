import { SignJWT } from "jose";
import { query, queryOne } from "./db";
import { env } from "./env";
import { envelope, hub } from "./hub";
import { HttpError, iso } from "./http";
import { memberIds, mustMember } from "./chats";
import { pushToUsers } from "./push";

export type Call = {
  id: string;
  chat_id: string;
  initiator_id: string;
  kind: string;
  status: string;
  sfu_room?: string | null;
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
};

type CallRow = {
  id: string;
  chat_id: string;
  initiator_id: string;
  kind: string;
  status: string;
  sfu_room: string | null;
  started_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
};

function mapCall(r: CallRow): Call {
  return {
    id: r.id,
    chat_id: r.chat_id,
    initiator_id: r.initiator_id,
    kind: r.kind,
    status: r.status,
    sfu_room: r.sfu_room,
    started_at: iso(r.started_at) || new Date().toISOString(),
    answered_at: iso(r.answered_at),
    ended_at: iso(r.ended_at),
  };
}

export async function getCall(userId: string, id: string) {
  const row = await queryOne<CallRow>(
    `SELECT id, chat_id, initiator_id, kind, status, sfu_room, started_at, answered_at, ended_at FROM calls WHERE id=$1`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "not found");
  await mustMember(row.chat_id, userId);
  return mapCall(row);
}

function noteEvent(id: string, userId: string, event: string) {
  void query(`INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,$3)`, [id, userId, event]).catch((err) => {
    console.error("call event", err instanceof Error ? err.message : err);
  });
}

// The join token belongs to one participant. The ring sent to the chat must not include it.
export type IceServer = { urls: string[]; username?: string; credential?: string };

export function iceServers(): IceServer[] {
  const stun: IceServer = { urls: ["stun:stun.l.google.com:19302"] };
  const raw = env("TURN_URL") || env("TURN_URLS");
  const urls = raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => /^(turns?|stun):/i.test(item));
  if (!urls.length) return [stun];
  const username = env("TURN_USERNAME");
  const credential = env("TURN_CREDENTIAL");
  const turn: IceServer = { urls };
  if (username) turn.username = username;
  if (credential) turn.credential = credential;
  return [stun, turn];
}

function withIce<T extends { url: string; token: string; room: string }>(signed: T) {
  return { ...signed, ice_servers: iceServers() };
}

async function withCreds(call: Call, userId: string) {
  const signed = await signLiveKitToken(userId, call.sfu_room || "");
  return { ...call, ...withIce(signed) };
}

export async function startCall(userId: string, chatId: string, kind: string) {
  if (kind !== "audio" && kind !== "video") throw new HttpError(400, "bad_request", "kind");
  const id = crypto.randomUUID();
  const room = "salam-" + id;
  const credsPromise = signLiveKitToken(userId, room);
  const membersPromise = memberIds(chatId);
  const row = await queryOne<CallRow>(
    `INSERT INTO calls (id, chat_id, initiator_id, kind, status, sfu_room)
     SELECT $1, $2, $3, $4, 'ringing', $5
     WHERE EXISTS (SELECT 1 FROM chat_members WHERE chat_id = $2 AND user_id = $3)
     RETURNING id, chat_id, initiator_id, kind, status, sfu_room, started_at, answered_at, ended_at`,
    [id, chatId, userId, kind, room],
  );
  if (!row) throw new HttpError(403, "forbidden", "forbidden");
  const call = mapCall(row);
  const [signed, members] = await Promise.all([credsPromise, membersPromise]);
  noteEvent(id, userId, "invite");
  hub.publishMany(members, envelope("call.updated", call));
  const peers = members.filter((member) => member !== userId);
  void (async () => {
    const row = await queryOne<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [userId]).catch(() => null);
    await pushToUsers(peers, {
      author: row?.display_name || "Salam",
      kind: "call",
      type: kind,
      text: "",
      tag: `call-${id}`,
      url: "/",
    });
  })();
  return { ...call, ...withIce(signed) };
}

export async function listCalls(userId: string) {
  const rows = await query<CallRow>(
    `SELECT c.id, c.chat_id, c.initiator_id, c.kind, c.status, c.sfu_room, c.started_at, c.answered_at, c.ended_at
     FROM calls c
     JOIN chat_members m ON m.chat_id = c.chat_id
     WHERE m.user_id=$1
     ORDER BY c.started_at DESC
     LIMIT 50`,
    [userId],
  );
  return { items: rows.map(mapCall) };
}

const closed = new Set(["ended", "missed", "declined"]);

async function transit(
  userId: string,
  id: string,
  event: string,
  status: string,
  tsCol: "answered_at" | "ended_at",
  allowed: string[],
) {
  const call = await getCall(userId, id);
  if (!allowed.includes(call.status)) return call;
  await query(`UPDATE calls SET status=$2, ${tsCol}=now() WHERE id=$1`, [id, status]);
  await query(`INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,$3)`, [id, userId, event]);
  const next = await getCall(userId, id);
  hub.publishMany(await memberIds(call.chat_id), envelope("call.updated", next));
  return next;
}

export async function answerCall(userId: string, id: string) {
  const row = await queryOne<CallRow>(
    `UPDATE calls AS c
     SET status = 'active', answered_at = now()
     WHERE c.id = $1 AND c.status = 'ringing'
       AND EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id = c.chat_id AND m.user_id = $2)
     RETURNING c.id, c.chat_id, c.initiator_id, c.kind, c.status, c.sfu_room, c.started_at, c.answered_at, c.ended_at`,
    [id, userId],
  );
  if (!row) {
    const call = await getCall(userId, id);
    if (call.status !== "active") return call;
    return withCreds(call, userId);
  }
  const call = mapCall(row);
  const [members, signed] = await Promise.all([memberIds(call.chat_id), signLiveKitToken(userId, call.sfu_room || "")]);
  noteEvent(id, userId, "join");
  hub.publishMany(members, envelope("call.updated", call));
  return { ...call, ...withIce(signed) };
}

export async function rejectCall(userId: string, id: string) {
  return transit(userId, id, "reject", "declined", "ended_at", ["ringing"]);
}

export async function hangupCall(userId: string, id: string) {
  const call = await getCall(userId, id);
  const members = await memberIds(call.chat_id);
  if (closed.has(call.status)) {
    hub.publishMany(members, envelope("call.updated", call));
    return call;
  }
  const status = call.status === "ringing" ? "missed" : "ended";
  await query(`UPDATE calls SET status=$2, ended_at=now() WHERE id=$1`, [id, status]);
  await query(`INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,'end')`, [id, userId]);
  const next = await getCall(userId, id);
  hub.publishMany(members, envelope("call.updated", next));
  return next;
}

export async function callToken(userId: string, id: string) {
  const call = await getCall(userId, id);
  const room = call.sfu_room || "";
  const signed = await signLiveKitToken(userId, room);
  return withIce(signed);
}

export async function signLiveKitToken(identity: string, room: string) {
  const url = env("LIVEKIT_URL", "");
  const key = env("LIVEKIT_API_KEY", "");
  const secret = env("LIVEKIT_API_SECRET", "");
  if (!url || !key || !secret) return { url, token: `stub-${identity}`, room };
  const token = await new SignJWT({
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(key)
    .setSubject(identity)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(secret));
  return { url, token, room };
}
