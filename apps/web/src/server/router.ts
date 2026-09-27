import {
  getUser,
  logout,
  parseAccess,
  refreshSession,
  requestOTP,
  updateMe,
  verifyOTP,
} from "./auth";
import {
  addMembers,
  createGroup,
  directChat,
  getChat,
  hideChat,
  listChats,
  listMembers,
  markRead,
  removeMember,
  renameChat,
} from "./chats";
import {
  answerCall,
  callToken,
  getCall,
  hangupCall,
  listCalls,
  rejectCall,
  startCall,
} from "./calls";
import { migrate } from "./db";
import { envelope, hub, presence } from "./hub";
import { bearer, corsHeaders, errorResponse, HttpError, json, readJSON } from "./http";
import { deleteMessage, editMessage, listMessages, receipts, sendMessage } from "./messages";
import { listContacts, syncContacts } from "./contacts";
import { getUserPublic, lookupPhones, searchUsers } from "./users";
import { completeUpload, createIntent, mediaType, putUpload, readMedia } from "./uploads";
import { sseResponse } from "./stream";
import { valkeyReady } from "./valkey";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function match(parts: string[], pattern: string) {
  const pat = pattern.split("/").filter(Boolean);
  if (pat.length !== parts.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < pat.length; i++) {
    if (pat[i].startsWith(":")) out[pat[i].slice(1)] = parts[i];
    else if (pat[i] !== parts[i]) return null;
  }
  return out;
}

async function requireUser(req: Request) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthorized", "missing token");
  const ids = await parseAccess(token);
  presence.heartbeat(ids.userId);
  return ids;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    await migrate();
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    if (pathname === "/healthz") {
      return json(200, { ok: true, name: "tooapp", valkey: valkeyReady() ? "up" : "down" });
    }
    if (pathname.startsWith("/media/")) {
      let key = pathname.slice("/media/".length);
      try {
        key = decodeURIComponent(key);
      } catch {
        throw new HttpError(400, "bad_request", "bad key");
      }
      const buf = await readMedia(key);
      const type = await mediaType(key);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": type,
          "Content-Length": String(buf.length),
          "Cache-Control": "public, max-age=86400",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    if (!pathname.startsWith("/v1/")) {
      return json(404, { error: { code: "not_found", message: "not found" } });
    }
    const parts = pathname.slice(4).split("/").filter(Boolean);
    const method = req.method.toUpperCase();
    return await dispatch(method, parts, req, url);
  } catch (err) {
    return errorResponse(err);
  }
}

async function dispatch(method: string, parts: string[], req: Request, url: URL): Promise<Response> {
  const p = (pat: string) => match(parts, pat);

  if (method === "POST" && p("auth/otp/request")) {
    const body = await readJSON<{ phone?: string }>(req);
    return json(200, await requestOTP(body.phone || ""));
  }
  if (method === "POST" && p("auth/otp/verify")) {
    const body = await readJSON<{ phone?: string; code?: string; device?: { platform?: string; device_name?: string; push_token?: string } }>(req);
    return json(200, await verifyOTP(body.phone || "", body.code || "", body.device));
  }
  if (method === "POST" && p("auth/refresh")) {
    const body = await readJSON<{ refresh_token?: string }>(req);
    return json(200, await refreshSession(body.refresh_token || ""));
  }

  const auth = await requireUser(req);

  if (method === "GET" && (p("stream") || p("events"))) {
    return sseResponse(auth.userId);
  }
  if (method === "POST" && p("auth/logout")) {
    return json(200, await logout(auth.deviceId));
  }
  if (method === "GET" && p("me")) {
    return json(200, await getUser(auth.userId));
  }
  if (method === "PATCH" && p("me")) {
    const body = await readJSON<{ display_name?: string; username?: string; bio?: string; avatar_url?: string }>(req);
    return json(200, await updateMe(auth.userId, body));
  }
  if (method === "GET" && p("chats")) {
    const items = await listChats(auth.userId, url.searchParams.get("q") || "", url.searchParams.get("type") || "");
    return json(200, { items });
  }
  {
    const m = p("chats/direct");
    if (method === "POST" && m) {
      const body = await readJSON<{ user_id?: string }>(req);
      if (!body.user_id || !UUID.test(body.user_id)) throw new HttpError(400, "bad_json", "user_id required");
      return json(200, await directChat(auth.userId, body.user_id));
    }
  }
  {
    const m = p("chats/groups");
    if (method === "POST" && m) {
      const body = await readJSON<{ title?: string; member_ids?: string[] }>(req);
      return json(201, await createGroup(auth.userId, body.title || "", body.member_ids || []));
    }
  }
  {
    const m = p("chats/:chatID");
    if (m && !UUID.test(m.chatID)) throw new HttpError(400, "bad_id", "invalid chat id");
    if (method === "GET" && m) {
      return json(200, await getChat(auth.userId, m.chatID));
    }
    if (method === "DELETE" && m) {
      const out = await hideChat(auth.userId, m.chatID);
      try {
        const ids = await (await import("./chats")).memberIds(m.chatID);
        hub.publishMany([...new Set([...ids, auth.userId])], envelope("chat.updated", { chat_id: m.chatID }));
      } catch {
        hub.publish(auth.userId, envelope("chat.updated", { chat_id: m.chatID }));
      }
      return json(200, out);
    }
    if (method === "PATCH" && m) {
      const body = await readJSON<{ title?: string }>(req);
      const chat = await renameChat(auth.userId, m.chatID, body.title || "");
      const ids = await (await import("./chats")).memberIds(m.chatID);
      hub.publishMany(ids, envelope("chat.updated", { chat_id: m.chatID }));
      return json(200, chat);
    }
  }
  {
    const m = p("chats/:chatID/read");
    if (method === "POST" && m) {
      const body = await readJSON<{ message_id?: string }>(req);
      if (!body.message_id) throw new HttpError(400, "bad_json", "invalid json");
      return json(200, await markRead(m.chatID, auth.userId, body.message_id));
    }
  }
  {
    const m = p("chats/:chatID/members/:userID");
    if (method === "DELETE" && m) {
      if (!UUID.test(m.chatID) || !UUID.test(m.userID)) throw new HttpError(400, "bad_id", "invalid id");
      const out = await removeMember(auth.userId, m.chatID, m.userID);
      try {
        const ids = await (await import("./chats")).memberIds(m.chatID);
        hub.publishMany([...ids, m.userID], envelope("chat.updated", { chat_id: m.chatID }));
      } catch {
        /* group may be empty */
      }
      return json(200, out);
    }
  }
  {
    const m = p("chats/:chatID/members");
    if (m && !UUID.test(m.chatID)) throw new HttpError(400, "bad_id", "invalid chat id");
    if (method === "GET" && m) {
      return json(200, await listMembers(auth.userId, m.chatID));
    }
    if (method === "POST" && m) {
      const body = await readJSON<{ user_ids?: string[] }>(req);
      const added = await addMembers(auth.userId, m.chatID, body.user_ids || []);
      const ids = await (await import("./chats")).memberIds(m.chatID);
      hub.publishMany(ids, envelope("chat.updated", { chat_id: m.chatID }));
      return json(200, added);
    }
  }
  {
    const m = p("chats/:chatID/messages");
    if (m && !UUID.test(m.chatID)) throw new HttpError(400, "bad_id", "invalid chat id");
    if (method === "GET" && m) {
      const limit = Number(url.searchParams.get("limit") || "50");
      return json(
        200,
        await listMessages(
          auth.userId,
          m.chatID,
          url.searchParams.get("q") || "",
          url.searchParams.get("cursor") || "",
          limit,
          req,
        ),
      );
    }
    if (method === "POST" && m) {
      const body = await readJSON<{
        client_id?: string;
        type?: string;
        payload?: unknown;
        reply_to_id?: string;
        upload_ids?: string[];
      }>(req);
      const msg = await sendMessage(
        auth.userId,
        m.chatID,
        {
          client_id: body.client_id || "",
          type: body.type || "text",
          payload: body.payload,
          reply_to_id: body.reply_to_id,
          upload_ids: body.upload_ids,
        },
        req,
      );
      return json(201, msg);
    }
  }
  {
    const m = p("chats/:chatID/calls");
    if (method === "POST" && m) {
      const body = await readJSON<{ kind?: string }>(req);
      return json(201, await startCall(auth.userId, m.chatID, body.kind || "audio"));
    }
  }
  {
    const m = p("messages/:id");
    if (m && !UUID.test(m.id)) throw new HttpError(400, "bad_id", "invalid id");
    if (method === "PATCH" && m) {
      const body = await readJSON<{ text?: string }>(req);
      return json(200, await editMessage(auth.userId, m.id, body.text || "", req));
    }
    if (method === "DELETE" && m) {
      return json(200, await deleteMessage(auth.userId, m.id));
    }
  }
  if (method === "POST" && p("receipts")) {
    const body = await readJSON<{ message_ids?: string[]; status?: string }>(req);
    return json(200, await receipts(auth.userId, body.message_ids || [], body.status || ""));
  }
  if (method === "GET" && p("contacts")) {
    return json(200, await listContacts(auth.userId));
  }
  if (method === "POST" && p("contacts/sync")) {
    const body = await readJSON<{ enabled?: boolean; items?: { phone?: string; name?: string }[] }>(req);
    return json(200, await syncContacts(auth.userId, body.enabled !== false, body.items || []));
  }
  if (method === "GET" && p("users")) {
    return json(200, await searchUsers(url.searchParams.get("q") || ""));
  }
  if (method === "POST" && p("users/lookup")) {
    const body = await readJSON<{ phones?: string[] }>(req);
    return json(200, await lookupPhones(body.phones || []));
  }
  {
    const m = p("users/:id");
    if (method === "GET" && m) {
      if (!UUID.test(m.id)) throw new HttpError(400, "bad_id", "invalid id");
      return json(200, await getUserPublic(m.id));
    }
  }
  if (method === "GET" && p("calls")) {
    return json(200, await listCalls(auth.userId));
  }
  {
    const m = p("calls/:id");
    if (method === "GET" && m) return json(200, await getCall(auth.userId, m.id));
  }
  {
    const m = p("calls/:id/answer");
    if (method === "POST" && m) return json(200, await answerCall(auth.userId, m.id));
  }
  {
    const m = p("calls/:id/reject");
    if (method === "POST" && m) return json(200, await rejectCall(auth.userId, m.id));
  }
  {
    const m = p("calls/:id/hangup");
    if (method === "POST" && m) return json(200, await hangupCall(auth.userId, m.id));
  }
  {
    const m = p("calls/:id/token");
    if (method === "GET" && m) return json(200, await callToken(auth.userId, m.id));
  }
  if (method === "POST" && p("uploads/intent")) {
    const body = await readJSON<{ mime?: string; kind?: string; size_bytes?: number }>(req);
    return json(200, await createIntent(auth.userId, body.mime || "", body.kind || "file", body.size_bytes || 0, req));
  }
  {
    const m = p("uploads/:id");
    if (method === "PUT" && m) return json(200, await putUpload(auth.userId, m.id, req));
  }
  {
    const m = p("uploads/:id/complete");
    if (method === "POST" && m) return json(200, await completeUpload(auth.userId, m.id, req));
  }
  if (method === "POST" && p("typing")) {
    const body = await readJSON<{ chat_id?: string }>(req);
    if (body.chat_id) {
      const members = await (await import("./chats")).memberIds(body.chat_id);
      hub.publishMany(
        members.filter((id) => id !== auth.userId),
        envelope("typing", { chat_id: body.chat_id, user_id: auth.userId }),
      );
    }
    return json(200, { ok: true });
  }

  throw new HttpError(404, "not_found", "not found");
}
