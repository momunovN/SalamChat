import type { Call, Chat, ChatMember, Message, Session, User } from "./types";

const SESSION_KEY = "tooapp.session";

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  if (!s) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

type ApiError = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init: RequestInit & { authed?: boolean; session?: Session | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const authed = init.authed !== false;
  const session = init.session ?? loadSession();
  if (authed && session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && authed && session?.refresh_token && !path.includes("/auth/refresh")) {
    const next = await refresh(session.refresh_token);
    if (next) {
      saveSession(next);
      return request<T>(path, { ...init, session: next });
    }
    authLost();
  }
  const text = await res.text();
  let data = {} as T & ApiError;
  if (text) {
    try {
      data = JSON.parse(text) as T & ApiError;
    } catch {
      throw new Error(res.ok ? "bad json" : `HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  return data;
}

function authLost() {
  saveSession(null);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("tooapp:auth-lost"));
}

async function refresh(refreshToken: string) {
  try {
    return await request<Session>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      authed: false,
    });
  } catch {
    authLost();
    return null;
  }
}

export const api = {
  requestOTP: (phone: string) =>
    request<{ ok: boolean; dev_code?: string; retry_after_sec: number }>("/v1/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
      authed: false,
    }),
  verifyOTP: (phone: string, code: string) =>
    request<Session>("/v1/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({
        phone,
        code,
        device: { platform: "web", device_name: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "web" },
      }),
      authed: false,
    }),
  me: () => request<User>("/v1/me"),
  patchMe: (body: Partial<Pick<User, "display_name" | "username" | "bio" | "avatar_url">>) =>
    request<User>("/v1/me", { method: "PATCH", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/v1/auth/logout", { method: "POST" }),
  chats: (q = "", type = "") => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (type) p.set("type", type);
    const qs = p.toString();
    return request<{ items: Chat[] }>(`/v1/chats${qs ? `?${qs}` : ""}`).then((r) => ({
      items: r.items ?? [],
    }));
  },
  messages: (chatId: string, cursor = "") => {
    const p = new URLSearchParams({ limit: "50" });
    if (cursor) p.set("cursor", cursor);
    return request<{ items: Message[]; cursor?: string | null }>(`/v1/chats/${chatId}/messages?${p}`);
  },
  send: (chatId: string, clientId: string, type: string, payload: unknown, uploadIds?: string[], replyToId?: string) =>
    request<Message>(`/v1/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        type,
        payload,
        upload_ids: uploadIds,
        reply_to_id: replyToId,
      }),
    }),
  editMessage: (id: string, text: string) =>
    request<Message>(`/v1/messages/${id}`, { method: "PATCH", body: JSON.stringify({ text }) }),
  deleteMessage: (id: string) => request<{ ok: boolean }>(`/v1/messages/${id}`, { method: "DELETE" }),
  members: (chatId: string) =>
    request<{ items: ChatMember[] }>(`/v1/chats/${chatId}/members`).then((r) => ({ items: r.items ?? [] })),
  addMembers: (chatId: string, userIds: string[]) =>
    request<{ items: ChatMember[] }>(`/v1/chats/${chatId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    }),
  removeMember: (chatId: string, userId: string) =>
    request<{ ok: boolean }>(`/v1/chats/${chatId}/members/${userId}`, { method: "DELETE" }),
  receipts: (ids: string[], status: "delivered" | "read") =>
    request<{ ok: boolean }>("/v1/receipts", { method: "POST", body: JSON.stringify({ message_ids: ids, status }) }),
  direct: (userId: string) =>
    request<Chat>("/v1/chats/direct", { method: "POST", body: JSON.stringify({ user_id: userId }) }),
  group: (title: string, memberIds: string[]) =>
    request<Chat>("/v1/chats/groups", { method: "POST", body: JSON.stringify({ title, member_ids: memberIds }) }),
  users: (q: string) =>
    request<{ items: User[] }>(`/v1/users?q=${encodeURIComponent(q)}`).then((r) => ({ items: r.items ?? [] })),
  contacts: () =>
    request<{ items: User[]; synced?: boolean }>("/v1/contacts").then((r) => ({
      items: r.items ?? [],
      synced: !!r.synced,
    })),
  syncContacts: (enabled: boolean, items: { phone: string; name?: string }[]) =>
    request<{ ok: boolean; count?: number }>("/v1/contacts/sync", {
      method: "POST",
      body: JSON.stringify({ enabled, items }),
    }),
  calls: () => request<{ items: Call[] }>("/v1/calls").then((r) => ({ items: r.items ?? [] })),
  startCall: (chatId: string, kind: "audio" | "video") =>
    request<Call>(`/v1/chats/${chatId}/calls`, { method: "POST", body: JSON.stringify({ kind }) }),
  answerCall: (id: string) => request<Call>(`/v1/calls/${id}/answer`, { method: "POST" }),
  rejectCall: (id: string) => request<Call>(`/v1/calls/${id}/reject`, { method: "POST" }),
  hangupCall: (id: string) => request<Call>(`/v1/calls/${id}/hangup`, { method: "POST" }),
  typing: (chatId: string) => request<{ ok: boolean }>("/v1/typing", { method: "POST", body: JSON.stringify({ chat_id: chatId }) }),
  upload: async (file: File, kind: "photo" | "file" | "voice") => {
    const intent = await request<{ id: string; put_url: string }>("/v1/uploads/intent", {
      method: "POST",
      body: JSON.stringify({ mime: file.type || "application/octet-stream", kind, size_bytes: file.size }),
    });
    const session = loadSession();
    const put = await fetch(intent.put_url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!put.ok) throw new Error("upload failed");
    await request(`/v1/uploads/${intent.id}/complete`, { method: "POST" });
    return intent.id;
  },
};
