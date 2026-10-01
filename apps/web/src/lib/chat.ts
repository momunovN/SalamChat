import type { Dict, Lang } from "./i18n";
import { sanitizeUsername } from "./name";
import type { Chat, Message } from "./types";

export function slugFromPath(path: string): string | null {
  const clean = path.split("?")[0].split("#")[0];
  const match = /^\/cont\/([^/]+)\/?$/.exec(clean);
  if (!match) return null;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  raw = raw.replace(/^@+/, "").trim().toLowerCase();
  const nick = sanitizeUsername(raw);
  if (nick) return nick;
  if (/^[a-z0-9]{8}$/.test(raw)) return raw;
  return null;
}

export function pathsEqual(a: string, b: string) {
  const norm = (path: string) => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  };
  return norm(a) === norm(b);
}

export function chatMatchesSlug(chat: Chat | null | undefined, slug: string) {
  if (!chat || !slug) return false;
  if (chat.type === "group") return sanitizeUsername(chat.username || "") === slug;
  const nick = sanitizeUsername(chat.peer?.username || "");
  if (nick && nick === slug) return true;
  return (chat.peer?.public_id || "").toLowerCase() === slug;
}

export function pathForChat(chat: Chat | null | undefined): string {
  if (!chat) return "/";
  if (chat.type === "group") {
    const nick = sanitizeUsername(chat.username || "");
    return nick ? `/cont/@${nick}` : "/";
  }
  const nick = sanitizeUsername(chat.peer?.username || "");
  if (nick) return `/cont/@${nick}`;
  const id = (chat.peer?.public_id || "").toLowerCase();
  if (/^[a-z0-9]{8}$/.test(id)) return `/cont/${id}`;
  return "/";
}

export function payloadText(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") {
    try {
      const v = JSON.parse(payload) as unknown;
      if (v && typeof v === "object" && "text" in v) {
        return String((v as { text?: unknown }).text || "");
      }
      return String(v);
    } catch {
      return payload;
    }
  }
  if (typeof payload === "object" && payload && "text" in payload) {
    return String((payload as { text?: unknown }).text || "");
  }
  return "";
}

export function formatClock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

export function messageBody(m: Message | null | undefined, t: Dict): string {
  if (!m) return "";
  if (m.deleted_at) return t.deletedMsg;
  if (m.type === "text") return payloadText(m.payload);
  if (m.type === "photo") return `📷 ${t.photo}`;
  if (m.type === "file") return `📎 ${t.file}`;
  if (m.type === "voice") {
    const ms = m.payload?.duration_ms;
    return ms ? `🎤 ${formatClock(ms)}` : `🎤 ${t.voice}`;
  }
  if (m.type === "location") return `📍 ${t.location}`;
  if (m.type === "system") return payloadText(m.payload);
  return payloadText(m.payload);
}

export function lastPreview(m: Message | null | undefined, t: Dict, me?: string, group?: boolean): string {
  if (!m) return group ? t.groupCreated : "";
  const body = messageBody(m, t);
  if (!group) return body;
  const who = m.author_id === me ? t.you : m.author_name || "";
  return who ? `${who}: ${body}` : body;
}

export function membersPhrase(n: number, t: Dict, lang: Lang): string {
  if (lang === "ky") return `${n} ${t.memberMany}`;
  const n10 = n % 10;
  const n100 = n % 100;
  let word = t.memberMany;
  if (n10 === 1 && n100 !== 11) word = t.memberOne;
  else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) word = t.memberFew;
  return `${n} ${word}`;
}

export function dayLabel(iso: string, t: Dict, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const start = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff === 0) return t.today;
  if (diff === 1) return t.yesterday;
  return d.toLocaleDateString(lang === "ky" ? "ky-KG" : "ru-RU", { day: "numeric", month: "long" });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
