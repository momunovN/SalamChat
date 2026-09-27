"use client";

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  Mic,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { forgetMedia, mediaRemembered, rememberMedia, requestUserMedia } from "@/lib/callMedia";
import { dedupeMessages } from "@/lib/cache";
import { dayKey, dayLabel, formatClock, membersPhrase, messageBody, payloadText } from "@/lib/chat";
import type { Dict, Lang } from "@/lib/i18n";
import type { Chat, ChatMember, Message, ReplyPreview, User } from "@/lib/types";
import { Avatar } from "./Avatar";
import { PermitToast } from "./PermitToast";
import { PeopleResults, useUserSearch } from "./PeopleSearch";
import { VoiceNote } from "./VoiceNote";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function roleLabel(role: string, t: Dict) {
  if (role === "owner") return t.owner;
  if (role === "admin") return t.admin;
  return "";
}

export function ChatPane({
  t,
  lang,
  me,
  chat,
  messages,
  setMessages,
  cursor,
  setCursor,
  isTyping,
  onBack,
  onRefreshChats,
  onOpenDirect,
  onCall,
  rosterTick = 0,
}: {
  t: Dict;
  lang: Lang;
  me: string;
  chat: Chat;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  cursor: string | null;
  setCursor: Dispatch<SetStateAction<string | null>>;
  isTyping: boolean;
  onBack: () => void;
  onRefreshChats: () => void;
  onOpenDirect: (userId: string) => void;
  onCall: (kind: "audio" | "video") => void;
  rosterTick?: number;
}) {
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingAt = useRef(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const startedAt = useRef(0);
  const voiceBlobs = useRef(new Map<string, { blob: Blob; ms: number }>());
  const localUrls = useRef(new Set<string>());
  const replyRef = useRef(replyTo);
  const [recording, setRecording] = useState(false);
  const [micAsk, setMicAsk] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const addSearch = useUserSearch(adding ? addQ : "", me);

  const myRole = members.find((m) => m.user.id === me)?.role || "member";
  const canManage = myRole === "owner" || myRole === "admin";
  const group = chat.type === "group";

  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    void api
      .members(chat.id)
      .then((r) => {
        if (!cancelled) setMembers(r.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chat.id, group, rosterTick]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.id]);

  useEffect(() => {
    replyRef.current = replyTo;
  }, [replyTo]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      const rec = recRef.current;
      if (ms >= 180_000 && rec && rec.state !== "inactive") {
        discardRef.current = false;
        setRecording(false);
        rec.stop();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    const urls = localUrls.current;
    return () => {
      discardRef.current = true;
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    const el = scrollRef.current;
    const prevH = el?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const r = await api.messages(chat.id, cursor);
      const older = [...(r.items ?? [])].reverse();
      setMessages((prev) => dedupeMessages([...older, ...prev]));
      setCursor(r.cursor ?? null);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevH;
      });
    } catch {
      /* ignore */
    } finally {
      setLoadingOlder(false);
    }
  }

  function asPreview(m: Message): ReplyPreview {
    return {
      id: m.id,
      author_id: m.author_id,
      author_name: m.author_id === me ? t.you : m.author_name,
      type: m.type,
      text: payloadText(m.payload),
    };
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (editing) {
      const id = editing.id;
      setText("");
      setEditing(null);
      try {
        const msg = await api.editMessage(id, trimmed);
        setMessages((prev) => prev.map((m) => (m.id === id ? msg : m)));
        onRefreshChats();
      } catch {
        /* keep old */
      }
      return;
    }
    const clientId = crypto.randomUUID();
    const optimistic: Message = {
      id: clientId,
      chat_id: chat.id,
      author_id: me,
      author_name: t.you,
      type: "text",
      payload: { text: trimmed },
      client_id: clientId,
      created_at: new Date().toISOString(),
      status: "sending",
      reply_to_id: replyTo?.id,
      reply_to: replyTo,
    };
    setText("");
    const quoted = replyTo;
    setReplyTo(null);
    stick.current = true;
    setMessages((prev) => [...prev, optimistic]);
    try {
      const msg = await api.send(chat.id, clientId, "text", { text: trimmed }, undefined, quoted?.id);
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? msg : m)));
      onRefreshChats();
    } catch {
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? { ...m, status: "failed" } : m)));
    }
  }

  async function retry(m: Message) {
    if (m.status !== "failed") return;
    const saved = voiceBlobs.current.get(m.client_id);
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: "sending" } : x)));
    try {
      if (m.type === "voice" && saved) {
        const file = voiceFile(saved.blob);
        const uploadId = await api.upload(file, "voice");
        const msg = await api.send(chat.id, m.client_id, "voice", { duration_ms: saved.ms }, [uploadId], m.reply_to_id || undefined);
        voiceBlobs.current.delete(m.client_id);
        if (m.local_url) {
          URL.revokeObjectURL(m.local_url);
          localUrls.current.delete(m.local_url);
        }
        setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? msg : x)));
      } else {
        const msg = await api.send(chat.id, m.client_id, m.type, m.payload, undefined, m.reply_to_id || undefined);
        setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? msg : x)));
      }
      onRefreshChats();
    } catch {
      setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? { ...x, status: "failed" } : x)));
    }
  }

  function noteVoiceError(msg: string) {
    setVoiceError(msg);
    window.setTimeout(() => setVoiceError((cur) => (cur === msg ? null : cur)), 2500);
  }

  function pickRecorderMime() {
    if (typeof MediaRecorder === "undefined") return "";
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return types.find((item) => MediaRecorder.isTypeSupported(item)) || "";
  }

  function askRec(started: number) {
    if (recording || busy || editing) return;
    if (mediaRemembered("mic")) {
      void startRec(started);
      return;
    }
    setMicAsk(true);
  }

  async function startRec(started: number) {
    if (recording || busy || editing) return;
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      noteVoiceError(t.voiceUnsupported);
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await requestUserMedia({ audio: true }, "mic");
      rememberMedia("mic");
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      const live = stream;
      rec.onstop = () => {
        live.getTracks().forEach((track) => track.stop());
        const ms = Date.now() - startedAt.current;
        const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
        const discard = discardRef.current;
        discardRef.current = false;
        recRef.current = null;
        streamRef.current = null;
        window.setTimeout(() => {
          const blob = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          if (!discard) void sendVoice(blob, ms);
        }, 0);
      };
      streamRef.current = stream;
      recRef.current = rec;
      startedAt.current = started;
      setElapsed(0);
      setRecording(true);
      rec.start(200);
    } catch {
      if (!stream) forgetMedia("mic");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      noteVoiceError(t.voiceDenied);
    }
  }

  function stopRec(discard: boolean) {
    const rec = recRef.current;
    setRecording(false);
    if (!rec || rec.state === "inactive") {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      return;
    }
    discardRef.current = discard;
    try {
      if (rec.state === "recording") rec.requestData();
    } catch {
      /* some browsers only flush on stop */
    }
    rec.stop();
  }

  async function sendVoice(blob: Blob, durationMs: number) {
    if (durationMs < 500 || blob.size < 80) {
      noteVoiceError(durationMs >= 500 ? t.voiceFail : t.voiceShort);
      return;
    }
    const clientId = crypto.randomUUID();
    const localUrl = URL.createObjectURL(blob);
    localUrls.current.add(localUrl);
    voiceBlobs.current.set(clientId, { blob, ms: durationMs });
    const quoted = replyRef.current;
    const optimistic: Message = {
      id: clientId,
      chat_id: chat.id,
      author_id: me,
      author_name: t.you,
      type: "voice",
      payload: { duration_ms: durationMs },
      client_id: clientId,
      created_at: new Date().toISOString(),
      status: "sending",
      local_url: localUrl,
      reply_to_id: quoted?.id,
      reply_to: quoted,
    };
    setReplyTo(null);
    stick.current = true;
    setMessages((prev) => [...prev, optimistic]);
    setBusy(true);
    try {
      const uploadId = await api.upload(voiceFile(blob), "voice");
      const msg = await api.send(chat.id, clientId, "voice", { duration_ms: durationMs }, [uploadId], quoted?.id);
      voiceBlobs.current.delete(clientId);
      URL.revokeObjectURL(localUrl);
      localUrls.current.delete(localUrl);
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? msg : m)));
      onRefreshChats();
    } catch {
      noteVoiceError(t.voiceFail);
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? { ...m, status: "failed" } : m)));
    } finally {
      setBusy(false);
    }
  }

  async function sendFile(file: File, kind: "photo" | "file") {
    setAttach(false);
    setBusy(true);
    try {
      const uploadId = await api.upload(file, kind);
      const clientId = crypto.randomUUID();
      const msg = await api.send(chat.id, clientId, kind, { caption: file.name }, [uploadId], replyTo?.id);
      setReplyTo(null);
      stick.current = true;
      setMessages((prev) => [...prev, msg]);
      onRefreshChats();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Message) {
    if (!window.confirm(t.confirmDelete)) return;
    setMenuId(null);
    try {
      await api.deleteMessage(m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      onRefreshChats();
    } catch {
      /* ignore */
    }
  }

  async function copyMsg(m: Message) {
    const body = payloadText(m.payload);
    if (body) await navigator.clipboard.writeText(body).catch(() => undefined);
    setMenuId(null);
  }

  const subtitle = isTyping
    ? t.typing
    : chat.peer?.online
      ? t.online
      : group
        ? membersPhrase(chat.member_count, t, lang)
        : t.lastSeen;
  const subColor = isTyping || chat.peer?.online ? "text-success" : "text-muted";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-2">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink md:hidden"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={() => group && setMembersOpen(true)}
        >
          <Avatar name={chat.title} src={chat.avatar_url} size={36} online={chat.peer?.online} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-ink">{chat.title}</p>
            <p className={`text-[12px] font-medium ${subColor}`}>{subtitle}</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onCall("audio")}
          className="flex h-9 w-9 items-center justify-center text-ink"
          aria-label={t.audio}
        >
          <Phone size={18} />
        </button>
        <button
          type="button"
          onClick={() => onCall("video")}
          className="flex h-9 w-9 items-center justify-center text-ink"
          aria-label={t.video}
        >
          <Video size={18} />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 80) void loadOlder();
        }}
        onClick={() => setMenuId(null)}
      >
        <div className="flex min-h-full flex-col justify-end py-2">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">{t.noMessages}</p>
          ) : null}
          {messages.map((m, i) => {
            const mine = m.author_id === me;
            const prev = messages[i - 1];
            const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const showName = group && !mine && m.author_id && m.author_id !== prev?.author_id;
            return (
              <div key={m.id}>
                {showDay ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-elevated px-3 py-0.5 text-[12px] font-medium text-muted">
                      {dayLabel(m.created_at, t, lang)}
                    </span>
                  </div>
                ) : null}
                <div className={`mb-1 flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    {showName ? (
                      <p className="mb-0.5 px-1 text-[12px] font-semibold text-accent">{m.author_name || ""}</p>
                    ) : null}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId((id) => (id === m.id ? null : m.id));
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuId(m.id);
                      }}
                      className={`px-3 py-2 text-left text-base text-ink ${
                        mine
                          ? "rounded-[16px] rounded-br-sm bg-outgoing"
                          : "rounded-[16px] rounded-bl-sm bg-incoming"
                      }`}
                    >
                      {m.reply_to ? (
                        <div className="mb-1 border-l-2 border-white/40 pl-2 text-[12px] text-white/80">
                          <p className="font-semibold">
                            {m.reply_to.author_id === me ? t.you : m.reply_to.author_name || t.replyTo}
                          </p>
                          <p className="truncate">
                            {m.reply_to.deleted ? t.deletedMsg : m.reply_to.text || messageBody({ ...m, type: m.reply_to.type, payload: { text: m.reply_to.text } }, t)}
                          </p>
                        </div>
                      ) : null}
                      {m.type === "voice" && m.local_url ? (
                        <VoiceNote src={m.local_url} durationMs={m.payload?.duration_ms} />
                      ) : null}
                      {m.attachments?.map((a) =>
                        a.kind === "voice" || a.mime?.startsWith("audio/") ? (
                          <VoiceNote key={a.id} src={a.url} durationMs={a.duration_ms || m.payload?.duration_ms} />
                        ) : a.kind === "photo" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={a.id} src={a.url} alt="" className="mb-1 max-h-64 rounded-lg" />
                        ) : (
                          <a
                            key={a.id}
                            href={a.url}
                            className="mb-1 block text-sm underline"
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {a.filename || a.kind}
                          </a>
                        ),
                      )}
                      {m.type === "voice" ? null : m.payload?.text || (m.type !== "text" ? m.payload?.caption : "")}
                    </div>
                    {menuId === m.id ? (
                      <div
                        className="mt-1 flex flex-wrap gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Action onClick={() => { setReplyTo(asPreview(m)); setEditing(null); setMenuId(null); }} icon={<CornerUpLeft size={12} />} label={t.reply} />
                        {payloadText(m.payload) ? (
                          <Action onClick={() => void copyMsg(m)} icon={<Copy size={12} />} label={t.copy} />
                        ) : null}
                        {mine && m.type === "text" && m.status !== "failed" ? (
                          <Action
                            onClick={() => {
                              setEditing(m);
                              setText(payloadText(m.payload));
                              setReplyTo(null);
                              setMenuId(null);
                            }}
                            icon={<Pencil size={12} />}
                            label={t.edit}
                          />
                        ) : null}
                        {mine || canManage ? (
                          <Action onClick={() => void remove(m)} icon={<Trash2 size={12} />} label={t.delete} danger />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-0.5 flex items-center gap-1 px-1 text-[12px] font-medium text-muted">
                      {m.edited_at ? <span>{t.edited}</span> : null}
                      <span>{fmtTime(m.created_at)}</span>
                      {mine ? (
                        m.status === "failed" ? (
                          <button type="button" className="text-danger" onClick={() => void retry(m)}>
                            {t.retrySend}
                          </button>
                        ) : m.status === "read" ? (
                          <CheckCheck size={12} className="text-success" />
                        ) : m.status === "delivered" ? (
                          <CheckCheck size={12} />
                        ) : (
                          <Check size={12} />
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {attach ? (
        <div className="flex gap-4 bg-elevated px-6 py-4">
          <button
            type="button"
            onClick={() => {
              fileRef.current?.setAttribute("accept", "image/*");
              fileRef.current?.click();
            }}
            className="flex flex-1 flex-col items-center gap-2 text-xs text-muted"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Paperclip size={20} />
            </span>
            {t.attachPhoto}
          </button>
          <button
            type="button"
            onClick={() => {
              fileRef.current?.setAttribute("accept", "*/*");
              fileRef.current?.click();
            }}
            className="flex flex-1 flex-col items-center gap-2 text-xs text-muted"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Paperclip size={20} />
            </span>
            {t.attachFile}
          </button>
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void sendFile(f, f.type.startsWith("image/") ? "photo" : "file");
        }}
      />

      {replyTo || editing ? (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-accent pl-2">
            <p className="text-[12px] font-semibold text-accent">{editing ? t.edit : t.replyTo}</p>
            <p className="truncate text-sm text-muted">
              {editing ? payloadText(editing.payload) : replyTo?.text || ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              if (editing) setText("");
            }}
            className="text-muted"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {voiceError ? <p className="px-4 pb-1 text-xs font-medium text-danger">{voiceError}</p> : null}
      <div className="flex items-end gap-2 px-3 py-2">
        {recording ? (
          <button
            type="button"
            onClick={() => stopRec(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-ink"
            aria-label={t.cancel}
          >
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAttach((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-ink"
          >
            <Plus size={20} />
          </button>
        )}
        {recording ? (
          <div className="flex min-h-[40px] flex-1 items-center gap-2 rounded-[20px] bg-elevated px-3">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
            <span className="text-sm font-medium tabular-nums text-ink">{formatClock(elapsed)}</span>
            <span className="text-sm text-muted">{t.recording}</span>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!editing && Date.now() - typingAt.current > 800) {
                typingAt.current = Date.now();
                void api.typing(chat.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={t.composer}
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-[20px] bg-elevated px-3 py-2.5 text-base text-ink outline-none placeholder:text-muted"
          />
        )}
        {recording ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => stopRec(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white"
            aria-label={t.voice}
          >
            <ArrowUp size={16} />
          </button>
        ) : text.trim() ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white"
          >
            <ArrowUp size={16} />
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !!editing}
            onClick={() => askRec(Date.now())}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-ink disabled:opacity-40"
            aria-label={t.voice}
          >
            <Mic size={18} />
          </button>
        )}
      </div>

      {membersOpen ? (
        <div className="fixed inset-0 z-20 flex justify-end bg-black/50" onClick={() => setMembersOpen(false)}>
          <div
            className="flex h-full w-full max-w-md flex-col bg-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center gap-2 border-b border-line px-3">
              <button type="button" onClick={() => setMembersOpen(false)} className="p-2 text-ink">
                <X size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{chat.title}</p>
                <p className="text-[12px] text-muted">{membersPhrase(members.length || chat.member_count, t, lang)}</p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center text-ink"
                  aria-label={t.addMember}
                >
                  <UserPlus size={18} />
                </button>
              ) : null}
            </div>
            {adding ? (
              <div className="border-b border-line px-3 py-3">
                <label className="flex h-10 items-center gap-2 rounded-xl bg-bg px-3">
                  <Search size={16} className="text-muted" />
                  <input
                    value={addQ}
                    onChange={(e) => setAddQ(e.target.value)}
                    placeholder={t.searchPeople}
                    autoFocus
                    className="w-full bg-transparent text-sm outline-none"
                  />
                </label>
                <div className="mt-2 max-h-48 overflow-y-auto">
                  <PeopleResults
                    t={t}
                    query={addQ}
                    items={addSearch.items.filter((u) => !members.some((m) => m.user.id === u.id))}
                    status={addSearch.status}
                    error={addSearch.error}
                    onPick={(u) => void addOne(u)}
                  />
                </div>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {members.map((m) => {
                const canKick = m.user.id !== me && canManage && (myRole === "owner" || m.role === "member");
                return (
                  <div key={m.user.id} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-bg/60"
                        onClick={() => {
                          if (m.user.id === me) return;
                          setMembersOpen(false);
                          onOpenDirect(m.user.id);
                        }}
                      >
                        <Avatar name={m.user.display_name} src={m.user.avatar_url} size={40} online={m.user.online} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-ink">
                            {m.user.id === me ? t.you : m.user.display_name}
                          </p>
                          <p className="text-xs text-muted">{roleLabel(m.role, t) || (m.user.username ? `@${m.user.username}` : "")}</p>
                        </div>
                      </button>
                    </div>
                    {canKick ? (
                      <button
                        type="button"
                        className="px-2 text-danger"
                        title={t.kick}
                        onClick={() => void kick(m.user.id)}
                      >
                        <UserMinus size={16} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="m-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-bg text-danger"
              onClick={() => void leave()}
            >
              <Users size={16} /> {t.leaveGroup}
            </button>
          </div>
        </div>
      ) : null}
      {micAsk ? (
        <PermitToast
          title={t.allowMic}
          body={t.needMicVoice}
          allowLabel={t.allow}
          cancelLabel={t.notNow}
          onAllow={() => {
            flushSync(() => setMicAsk(false));
            void startRec(Date.now());
          }}
          onCancel={() => setMicAsk(false)}
        />
      ) : null}
    </div>
  );

  async function addOne(u: User) {
    try {
      const r = await api.addMembers(chat.id, [u.id]);
      setMembers(r.items);
      setAddQ("");
      onRefreshChats();
    } catch {
      /* ignore */
    }
  }

  async function kick(userId: string) {
    if (!window.confirm(t.confirmKick)) return;
    try {
      await api.removeMember(chat.id, userId);
      setMembers((prev) => prev.filter((m) => m.user.id !== userId));
      onRefreshChats();
    } catch {
      /* ignore */
    }
  }

  async function leave() {
    if (!window.confirm(t.confirmLeave)) return;
    try {
      await api.removeMember(chat.id, me);
      setMembersOpen(false);
      onBack();
      onRefreshChats();
    } catch {
      /* ignore */
    }
  }
}

function voiceFile(blob: Blob) {
  const mime = (blob.type || "audio/webm").split(";")[0];
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
  return new File([blob], `voice.${ext}`, { type: mime });
}

function Action({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium ${
        danger ? "bg-danger/15 text-danger" : "bg-elevated text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
