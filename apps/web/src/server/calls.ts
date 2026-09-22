import { SignJWT } from "jose";
import { query, queryOne } from "./db";
import { env } from "./env";
import { envelope, hub } from "./hub";
import { HttpError, iso } from "./http";
import { memberIds, mustMember } from "./chats";

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

export async function startCall(userId: string, chatId: string, kind: string) {
  if (kind !== "audio" && kind !== "video") throw new HttpError(400, "bad_request", "kind");
  await mustMember(chatId, userId);
  const id = crypto.randomUUID();
  const room = "tooapp-" + id;
  await query(
    `INSERT INTO calls (id, chat_id, initiator_id, kind, status, sfu_room) VALUES ($1,$2,$3,$4,'ringing',$5)`,
    [id, chatId, userId, kind, room],
  );
  await query(`INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,'invite')`, [id, userId]);
  const call = await getCall(userId, id);
  hub.publishMany(await memberIds(chatId), envelope("call.updated", call));
  return call;
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

async function transit(userId: string, id: string, event: string, status: string, tsCol: "answered_at" | "ended_at") {
  const call = await getCall(userId, id);
  await query(`UPDATE calls SET status=$2, ${tsCol}=now() WHERE id=$1`, [id, status]);
  await query(`INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,$3)`, [id, userId, event]);
  const next = await getCall(userId, id);
  hub.publishMany(await memberIds(call.chat_id), envelope("call.updated", next));
  return next;
}

export async function answerCall(userId: string, id: string) {
  return transit(userId, id, "join", "active", "answered_at");
}

export async function rejectCall(userId: string, id: string) {
  return transit(userId, id, "reject", "declined", "ended_at");
}

export async function hangupCall(userId: string, id: string) {
  const call = await getCall(userId, id);
  const status = call.status === "ringing" ? "missed" : "ended";
  await query(`UPDATE calls SET status=$2, ended_at=now() WHERE id=$1`, [id, status]);
  await query(`INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,'end')`, [id, userId]);
  const next = await getCall(userId, id);
  hub.publishMany(await memberIds(call.chat_id), envelope("call.updated", next));
  return next;
}

export async function callToken(userId: string, id: string) {
  const call = await getCall(userId, id);
  const room = call.sfu_room || "";
  const signed = await signLiveKitToken(userId, room);
  return { ...signed, ice_servers: ["stun:stun.l.google.com:19302"] };
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
