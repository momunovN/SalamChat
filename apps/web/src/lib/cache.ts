import type { Chat, Message } from "./types";

const MAX_CHATS = 100;
const MAX_PER_CHAT = 80;

type Store = {
  chats: Chat[];
  threads: Record<string, Message[]>;
  activeId: string | null;
};

function empty(): Store {
  return { chats: [], threads: {}, activeId: null };
}

function key(userId: string) {
  return `tooapp.box.${userId}`;
}

function read(userId: string): Store {
  if (!userId || typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      chats: Array.isArray(parsed.chats) ? parsed.chats : [],
      threads: parsed.threads && typeof parsed.threads === "object" ? parsed.threads : {},
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return empty();
  }
}

function write(userId: string, store: Store) {
  if (!userId || typeof localStorage === "undefined") return;
  const chats = dedupeChats(store.chats).slice(0, MAX_CHATS);
  const threads: Record<string, Message[]> = {};
  for (const chat of chats) {
    const list = store.threads[chat.id];
    if (!list?.length) continue;
    threads[chat.id] = dedupeMessages(list).slice(-MAX_PER_CHAT).map(stripMessage);
  }
  const payload = JSON.stringify({ chats, threads, activeId: store.activeId });
  try {
    localStorage.setItem(key(userId), payload);
  } catch {
    try {
      const slim: Record<string, Message[]> = {};
      for (const id of Object.keys(threads)) slim[id] = threads[id].slice(-20);
      localStorage.setItem(key(userId), JSON.stringify({ chats, threads: slim, activeId: store.activeId }));
    } catch {
      /* this phone has no room left */
    }
  }
}

function stripMessage(m: Message): Message {
  if (!m.local_url) return m;
  const copy = { ...m };
  delete copy.local_url;
  return copy;
}

function rank(m: Message) {
  if (m.id && m.client_id && m.id !== m.client_id) return 2;
  if (m.status === "sending") return 0;
  return 1;
}

function prefer(a: Message, b: Message): Message {
  const primary = rank(a) > rank(b) ? a : rank(b) > rank(a) ? b : (a.edited_at || "") >= (b.edited_at || "") ? a : b;
  const other = primary === a ? b : a;
  return {
    ...other,
    ...primary,
    attachments: primary.attachments?.length ? primary.attachments : other.attachments,
    reply_to: primary.reply_to || other.reply_to,
    local_url: primary.local_url || other.local_url,
    status: primary.status === "sending" && other.status && other.status !== "sending" ? other.status : primary.status || other.status,
  };
}

export function dedupeMessages(items: Message[]): Message[] {
  const byClient = new Map<string, Message>();
  const loose: Message[] = [];
  for (const m of items) {
    if (!m?.id) continue;
    if (!m.client_id) {
      loose.push(m);
      continue;
    }
    const prev = byClient.get(m.client_id);
    byClient.set(m.client_id, prev ? prefer(prev, m) : m);
  }
  const byId = new Map<string, Message>();
  for (const m of [...byClient.values(), ...loose]) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? prefer(prev, m) : m);
  }
  return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

export function dedupeChats(items: Chat[]): Chat[] {
  const byId = new Map<string, Chat>();
  for (const chat of items) {
    if (!chat?.id) continue;
    const prev = byId.get(chat.id);
    if (!prev) {
      byId.set(chat.id, chat);
      continue;
    }
    const prevAt = prev.last_message?.created_at || "";
    const nextAt = chat.last_message?.created_at || "";
    const last = nextAt >= prevAt ? chat.last_message || prev.last_message : prev.last_message;
    const updated = chat.updated_at > prev.updated_at ? chat.updated_at : prev.updated_at;
    byId.set(chat.id, { ...prev, ...chat, last_message: last, updated_at: updated });
  }
  return [...byId.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

export function mergeChats(local: Chat[], fresh: Chat[]): Chat[] {
  if (fresh.length === 0) return [];
  const prev = new Map(dedupeChats(local).map((chat) => [chat.id, chat]));
  const out: Chat[] = [];
  for (const chat of fresh) {
    if (!chat?.id || out.some((item) => item.id === chat.id)) continue;
    const cached = prev.get(chat.id);
    if (!cached?.last_message) {
      out.push(chat);
      continue;
    }
    const cachedAt = cached.last_message.created_at || "";
    const freshAt = chat.last_message?.created_at || "";
    if (cachedAt > freshAt) {
      out.push({ ...chat, last_message: cached.last_message, updated_at: cached.updated_at > chat.updated_at ? cached.updated_at : chat.updated_at });
    } else {
      out.push(chat);
    }
  }
  return dedupeChats(out);
}

export function mergeThread(local: Message[], fresh: Message[]): Message[] {
  if (fresh.length === 0) return dedupeMessages(local);
  const freshIds = new Set(fresh.map((m) => m.id));
  const freshClients = new Set(fresh.map((m) => m.client_id).filter(Boolean));
  let oldest = "";
  for (const m of fresh) {
    if (!oldest || m.created_at < oldest) oldest = m.created_at;
  }
  const kept = local.filter((m) => {
    if (!m?.id) return false;
    if (freshIds.has(m.id) || (m.client_id && freshClients.has(m.client_id))) return false;
    if (m.status === "sending" || m.status === "failed") return true;
    return !!oldest && m.created_at < oldest;
  });
  return dedupeMessages([...kept, ...fresh]);
}

export function readRoster(userId: string) {
  return dedupeChats(read(userId).chats);
}

export function readThread(userId: string, chatId: string) {
  return dedupeMessages(read(userId).threads[chatId] || []);
}

export function readActive(userId: string) {
  return read(userId).activeId;
}

export function writeRoster(userId: string, chats: Chat[]) {
  const store = read(userId);
  store.chats = chats;
  write(userId, store);
}

export function writeThread(userId: string, chatId: string, messages: Message[]) {
  const store = read(userId);
  store.threads[chatId] = messages;
  write(userId, store);
}

export function forgetChat(userId: string, chatId: string) {
  const store = read(userId);
  store.chats = store.chats.filter((chat) => chat.id !== chatId);
  delete store.threads[chatId];
  if (store.activeId === chatId) store.activeId = null;
  write(userId, store);
}

export function writeActive(userId: string, chatId: string | null) {
  const store = read(userId);
  store.activeId = chatId;
  write(userId, store);
}
