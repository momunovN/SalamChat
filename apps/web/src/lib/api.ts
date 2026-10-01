import type { Call, Chat, ChatMember, Message, ProfileLibrary, Session, User } from "./types";

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

/** via "screen": no SMS provider yet, the code comes back in dev_code to show under the input. */
export type OtpSent = {
  ok: boolean;
  via?: "email" | "sms" | "screen" | "stub";
  hint?: string;
  dev_code?: string;
  retry_after_sec: number;
};

type ApiError = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init: RequestInit & { authed?: boolean; session?: Session | null; timeoutMs?: number } = {}): Promise<T> {
  const { authed: authedOpt, session: sessionOpt, timeoutMs, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Accept", "application/json");
  const authed = authedOpt !== false;
  const session = sessionOpt ?? loadSession();
  if (authed && session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  if (rest.body && !(rest.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && authed && session?.refresh_token && !path.includes("/auth/refresh")) {
    const next = await refreshOnce(session.refresh_token);
    if (next) return request<T>(path, { ...init, session: next });
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

let refreshing: { token: string; promise: Promise<Session | null> } | null = null;

// Several requests can hit 401 at once. They share one refresh call, otherwise the
// second refresh reuses an already rotated token and the user is logged out.
function refreshOnce(refreshToken: string) {
  const current = loadSession();
  if (current && current.refresh_token !== refreshToken && current.access_token) {
    return Promise.resolve<Session | null>(current);
  }
  if (refreshing?.token === refreshToken) return refreshing.promise;
  const promise = refresh(refreshToken).finally(() => {
    if (refreshing?.promise === promise) refreshing = null;
  });
  refreshing = { token: refreshToken, promise };
  return promise;
}

async function refresh(refreshToken: string) {
  try {
    const next = await request<Session>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      authed: false,
    });
    saveSession(next);
    return next;
  } catch {
    authLost();
    return null;
  }
}

export const api = {
  requestOTP: (email: string, phone = "") =>
    request<OtpSent>("/v1/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ email, phone }),
      authed: false,
    }),
  verifyOTP: (email: string, code: string, phone = "") =>
    request<Session>("/v1/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({
        email,
        phone,
        code,
        device: { platform: "web", device_name: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "web" },
      }),
      authed: false,
    }),
  me: () => request<User>("/v1/me"),
  requestEmailAttach: (email: string) =>
    request<OtpSent>("/v1/me/email/request", { method: "POST", body: JSON.stringify({ email }) }),
  verifyEmailAttach: (email: string, code: string) =>
    request<User>("/v1/me/email/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  patchMe: (
    body: Partial<
      Pick<User, "display_name" | "username" | "bio" | "avatar_url" | "birth_date" | "address" | "username_hidden">
    >,
  ) => request<User>("/v1/me", { method: "PATCH", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/v1/auth/logout", { method: "POST" }),
  subscribePush: (body: { endpoint: string; keys: { p256dh: string; auth: string }; lang: string }) =>
    request<{ ok: boolean }>("/v1/push/subscribe", { method: "POST", body: JSON.stringify(body) }),
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
  // Fire-and-forget: a lost receipt is not worth an unhandled rejection.
  receipts: (ids: string[], status: "delivered" | "read") =>
    request<{ ok: boolean }>("/v1/receipts", { method: "POST", body: JSON.stringify({ message_ids: ids, status }) }).catch(
      () => ({ ok: false }),
    ),
  direct: (userId: string) =>
    request<Chat>("/v1/chats/direct", { method: "POST", body: JSON.stringify({ user_id: userId }) }),
  group: (title: string, memberIds: string[], username?: string) =>
    request<Chat>("/v1/chats/groups", {
      method: "POST",
      body: JSON.stringify({ title, member_ids: memberIds, ...(username ? { username } : {}) }),
    }),
  chat: (id: string) => request<Chat>(`/v1/chats/${id}`),
  hideChat: (chatId: string) => request<{ ok: boolean }>(`/v1/chats/${chatId}`, { method: "DELETE" }),
  renameChat: (chatId: string, title: string, username?: string) =>
    request<Chat>(`/v1/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title, ...(username !== undefined ? { username } : {}) }),
    }),
  users: (q: string) =>
    request<{ items: User[] }>(`/v1/users?q=${encodeURIComponent(q)}`).then((r) => ({ items: r.items ?? [] })),
  user: (id: string) => request<User>(`/v1/users/${id}`),
  library: (id: string) => request<ProfileLibrary>(`/v1/users/${id}/library`),
  setNotifications: (id: string, enabled: boolean) =>
    request<{ enabled: boolean; chat_id: string; muted_until: string | null }>(`/v1/users/${id}/notifications`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  resolve: (slug: string) =>
    request<{ user: User | null; chat: Chat | null }>(`/v1/resolve?slug=${encodeURIComponent(slug)}`),
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
  call: (id: string) => request<Call>(`/v1/calls/${id}`),
  startCall: (chatId: string, kind: "audio" | "video") =>
    request<Call>(`/v1/chats/${chatId}/calls`, { method: "POST", body: JSON.stringify({ kind }) }),
  answerCall: (id: string) => request<Call>(`/v1/calls/${id}/answer`, { method: "POST" }),
  rejectCall: (id: string) => request<Call>(`/v1/calls/${id}/reject`, { method: "POST" }),
  hangupCall: (id: string) => request<Call>(`/v1/calls/${id}/hangup`, { method: "POST" }),
  callToken: (id: string) =>
    request<{ url: string; token: string; room: string }>(`/v1/calls/${id}/token`),
  typing: (chatId: string) =>
    request<{ ok: boolean }>("/v1/typing", { method: "POST", body: JSON.stringify({ chat_id: chatId }) }).catch(() => ({
      ok: false,
    })),
  upload: async (file: File, kind: "photo" | "file" | "voice") => {
    const intent = await request<{ id: string; put_url: string }>("/v1/uploads/intent", {
      method: "POST",
      body: JSON.stringify({ mime: file.type || "application/octet-stream", kind, size_bytes: file.size }),
    });
    const session = loadSession();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    let put: Response;
    try {
      put = await fetch(intent.put_url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new Error("timeout");
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!put.ok) throw new Error("upload failed");
    await request(`/v1/uploads/${intent.id}/complete`, { method: "POST" });
    return intent.id;
  },
};
