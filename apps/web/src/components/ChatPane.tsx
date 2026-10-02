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
  ImageIcon,
  Lock,
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
import { levelFromTimeDomain, packWave, WAVE_BARS } from "@/lib/voice";
import { dayKey, dayLabel, formatClock, membersPhrase, messageBody, payloadText } from "@/lib/chat";
import type { Dict, Lang } from "@/lib/i18n";
import type { Chat, ChatMember, Message, ReplyPreview, User } from "@/lib/types";
import { Avatar } from "./Avatar";
import { ProfileSheet } from "./ProfileSheet";
import { PermitToast } from "./PermitToast";
import { PeopleResults, useUserSearch } from "./PeopleSearch";
import { ChatSearch } from "./ChatSearch";
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
  onOpenChat,
  onMuted,
  onCall,
  onLocal,
  onMeta,
  onHide,
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
  onOpenChat?: (chatId: string) => void;
  onMuted?: (chatId: string, mutedUntil: string | null) => void;
  onCall: (kind: "audio" | "video") => void;
  onLocal: (last: Message | null) => void;
  onMeta: (patch: { member_count?: number }) => void;
  onHide: () => void;
  rosterTick?: number;
}) {
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
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
  const fileBlobs = useRef(new Map<string, { file: File; kind: "photo" | "file" }>());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const localUrls = useRef(new Set<string>());
  const replyRef = useRef(replyTo);
  const [recording, setRecording] = useState(false);
  const [micAsk, setMicAsk] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [liveWave, setLiveWave] = useState<number[]>([]);
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const meterRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const samplesRef = useRef<number[]>([]);
  const textRef = useRef("");
  const addSearch = useUserSearch(adding ? addQ : "", me);

  function setComposer(value: string) {
    textRef.current = value;
    setText(value);
  }

  function lastOf(list: Message[]) {
    return [...list].reverse().find((item) => !item.deleted_at) ?? null;
  }

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
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text, recording]);

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
      releaseMic();
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

  /** Search result click: page back until the message is loaded, then scroll to it and flash it. */
  async function jumpTo(target: Message) {
    stick.current = false;
    if (!messages.some((m) => m.id === target.id)) {
      let cur = cursor;
      const older: Message[] = [];
      for (let i = 0; i < 40 && cur; i++) {
        try {
          const r = await api.messages(chat.id, cur);
          const page = [...(r.items ?? [])].reverse();
          older.unshift(...page);
          cur = r.cursor ?? null;
          if (page.some((m) => m.id === target.id)) break;
        } catch {
          break;
        }
      }
      setMessages((prev) => dedupeMessages([...older, ...prev]));
      setCursor(cur);
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.getElementById(`msg-${target.id}`)?.scrollIntoView({ block: "center" });
        setFlashId(target.id);
        window.setTimeout(() => setFlashId((cur) => (cur === target.id ? null : cur)), 1800);
      }),
    );
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
    const trimmed = textRef.current.trim();
    if (!trimmed) return;
    if (editing) {
      const id = editing.id;
      setComposer("");
      setEditing(null);
      try {
        const msg = await api.editMessage(id, trimmed);
        setMessages((prev) => prev.map((m) => (m.id === id ? msg : m)));
        onLocal(msg);
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
    setComposer("");
    const quoted = replyTo;
    setReplyTo(null);
    stick.current = true;
    setMessages((prev) => [...prev, optimistic]);
    onLocal(optimistic);
    try {
      const msg = await api.send(chat.id, clientId, "text", { text: trimmed }, undefined, quoted?.id);
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? msg : m)));
      onLocal(msg);
    } catch {
      const failed = { ...optimistic, status: "failed" };
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? failed : m)));
      onLocal(failed);
    }
  }

  async function retry(m: Message) {
    if (m.status !== "failed") return;
    const saved = voiceBlobs.current.get(m.client_id);
    const sending = { ...m, status: "sending" };
    setMessages((prev) => prev.map((x) => (x.id === m.id ? sending : x)));
    onLocal(sending);
    try {
      if (m.type === "voice" && saved) {
        const file = voiceFile(saved.blob);
        const uploadId = await api.upload(file, "voice");
        const msg = await api.send(
          chat.id,
          m.client_id,
          "voice",
          { duration_ms: saved.ms, waveform: m.payload?.waveform },
          [uploadId],
          m.reply_to_id || undefined,
        );
        voiceBlobs.current.delete(m.client_id);
        if (m.local_url) {
          URL.revokeObjectURL(m.local_url);
          localUrls.current.delete(m.local_url);
        }
        setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? msg : x)));
        onLocal(msg);
      } else if ((m.type === "photo" || m.type === "file") && fileBlobs.current.has(m.client_id)) {
        const saved = fileBlobs.current.get(m.client_id)!;
        const uploadId = await api.upload(saved.file, saved.kind);
        const msg = await api.send(chat.id, m.client_id, m.type, m.payload, [uploadId], m.reply_to_id || undefined);
        fileBlobs.current.delete(m.client_id);
        setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? msg : x)));
        onLocal(msg);
      } else {
        const msg = await api.send(chat.id, m.client_id, m.type, m.payload, undefined, m.reply_to_id || undefined);
        setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? msg : x)));
        onLocal(msg);
      }
    } catch {
      const failed = { ...m, status: "failed" };
      setMessages((prev) => prev.map((x) => (x.client_id === m.client_id ? failed : x)));
      onLocal(failed);
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

  function armMeter() {
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.resume();
      return;
    }
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    void ctx.resume();
  }

  function askRec(started: number) {
    if (recording || editing) return;
    if (mediaRemembered("mic")) {
      armMeter();
      void startRec(started);
      return;
    }
    setMicAsk(true);
  }

  async function startRec(started: number) {
    if (recording || editing) return;
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
      const waveform = () => packWave(samplesRef.current, WAVE_BARS);
      rec.onstop = () => {
        const ms = Date.now() - startedAt.current;
        const wave = waveform();
        releaseMic();
        live.getTracks().forEach((track) => track.stop());
        const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
        const discard = discardRef.current;
        discardRef.current = false;
        recRef.current = null;
        window.setTimeout(() => {
          const blob = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          if (!discard) void sendVoice(blob, ms, wave);
        }, 0);
      };
      streamRef.current = stream;
      recRef.current = rec;
      startedAt.current = started;
      samplesRef.current = [];
      setLiveWave([]);
      setElapsed(0);
      setRecording(true);
      startMeter(stream);
      rec.start(200);
    } catch {
      if (!stream) forgetMedia("mic");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      noteVoiceError(t.voiceDenied);
    }
  }

  function releaseMic() {
    if (meterRef.current) window.clearInterval(meterRef.current);
    meterRef.current = 0;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLiveWave([]);
  }

  function startMeter(stream: MediaStream) {
    const ctx = audioCtxRef.current && audioCtxRef.current.state !== "closed" ? audioCtxRef.current : new AudioContext();
    audioCtxRef.current = ctx;
    void ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const bins = new Uint8Array(analyser.fftSize);
    meterRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(bins);
      samplesRef.current.push(levelFromTimeDomain(bins));
      setLiveWave(packWave(samplesRef.current, 28));
    }, 80);
  }

  function stopRec(discard: boolean) {
    const rec = recRef.current;
    setRecording(false);
    if (!rec || rec.state === "inactive") {
      releaseMic();
      return;
    }
    discardRef.current = discard;
    try {
      if (rec.state === "recording") rec.requestData();
    } catch {
      /* some browsers only flush on stop */
    }
    rec.stop();
    releaseMic();
  }

  async function sendVoice(blob: Blob, durationMs: number, waveform: number[]) {
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
      payload: { duration_ms: durationMs, waveform },
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
    onLocal(optimistic);
    try {
      const uploadId = await api.upload(voiceFile(blob), "voice");
      const msg = await api.send(chat.id, clientId, "voice", { duration_ms: durationMs, waveform }, [uploadId], quoted?.id);
      voiceBlobs.current.delete(clientId);
      URL.revokeObjectURL(localUrl);
      localUrls.current.delete(localUrl);
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? msg : m)));
      onLocal(msg);
    } catch {
      noteVoiceError(t.voiceFail);
      const failed = { ...optimistic, status: "failed" };
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? failed : m)));
      onLocal(failed);
    }
  }

  async function sendFile(file: File, kind: "photo" | "file") {
    setAttach(false);
    const clientId = crypto.randomUUID();
    const prepared = await shrinkPhoto(file);
    const localUrl = URL.createObjectURL(prepared);
    const mime = prepared.type || "application/octet-stream";
    const optimistic: Message = {
      id: clientId,
      chat_id: chat.id,
      author_id: me,
      author_name: t.you,
      type: kind,
      payload: kind === "photo" || !prepared.name ? {} : { caption: prepared.name },
      client_id: clientId,
      created_at: new Date().toISOString(),
      status: "sending",
      reply_to_id: replyTo?.id,
      reply_to: replyTo,
      attachments: [
        {
          id: clientId,
          kind: mime.startsWith("image/") ? "photo" : mime.startsWith("video/") ? "video" : kind,
          url: localUrl,
          mime,
          filename: prepared.name,
        },
      ],
    };
    const quoted = replyTo;
    fileBlobs.current.set(clientId, { file: prepared, kind });
    setReplyTo(null);
    stick.current = true;
    setMessages((prev) => [...prev, optimistic]);
    onLocal(optimistic);
    try {
      const uploadId = await api.upload(prepared, kind);
      const msg = await api.send(
        chat.id,
        clientId,
        kind,
        kind === "photo" || !prepared.name ? {} : { caption: prepared.name },
        [uploadId],
        quoted?.id,
      );
      fileBlobs.current.delete(clientId);
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? msg : m)));
      queueMicrotask(() => URL.revokeObjectURL(localUrl));
      onLocal(msg);
    } catch {
      const failed = { ...optimistic, status: "failed" };
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? failed : m)));
      onLocal(failed);
    }
  }

  async function remove(m: Message) {
    if (!window.confirm(t.confirmDelete)) return;
    setMenuId(null);
    const next = messages.filter((x) => x.id !== m.id);
    setMessages(next);
    onLocal(lastOf(next));
    try {
      await api.deleteMessage(m.id);
      onRefreshChats();
    } catch {
      setMessages(messages);
      onLocal(lastOf(messages));
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
      ? [chat.username ? `@${chat.username}` : "", membersPhrase(chat.member_count, t, lang)].filter(Boolean).join(" · ")
      : t.lastSeen;
  const subColor = isTyping || chat.peer?.online ? "text-success" : "text-muted";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-2">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated md:hidden"
          onClick={onBack}
          aria-label={t.back}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={() => {
            if (group) setMembersOpen(true);
            else if (chat.peer?.id) setProfileId(chat.peer.id);
          }}
        >
          <Avatar name={chat.title} src={chat.avatar_url} size={36} online={chat.peer?.online} />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1 truncate text-[17px] font-semibold text-ink">
              <Lock size={12} className="shrink-0 text-muted" aria-label={t.sealed} />
              <span className="truncate">{chat.title}</span>
            </p>
            <p className={`truncate text-[12px] font-medium ${subColor}`}>{subtitle}</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated ${searchOpen ? "bg-elevated" : ""}`}
          aria-label={t.searchMessages}
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          onClick={() => onCall("audio")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated"
          aria-label={t.audio}
        >
          <Phone size={18} />
        </button>
        <button
          type="button"
          onClick={() => onCall("video")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated"
          aria-label={t.video}
        >
          <Video size={18} />
        </button>
      </div>

      {searchOpen ? (
        <ChatSearch
          key={chat.id}
          chatId={chat.id}
          me={me}
          t={t}
          lang={lang}
          onPick={(m) => void jumpTo(m)}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

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
              <div
                key={m.id}
                id={`msg-${m.id}`}
                className={`rounded-xl transition-colors duration-500 ${flashId === m.id ? "bg-accent/15" : ""}`}
              >
                {showDay ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-elevated px-3 py-0.5 text-[12px] font-medium text-muted">
                      {dayLabel(m.created_at, t, lang)}
                    </span>
                  </div>
                ) : null}
                <div className={`mb-1 flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    {showName && m.author_name ? (
                      <button
                        type="button"
                        className="mb-0.5 px-1 text-left text-[12px] font-semibold text-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (m.author_id) setProfileId(m.author_id);
                        }}
                      >
                        {m.author_name}
                      </button>
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
                      className={`min-w-0 max-w-full cursor-pointer whitespace-pre-wrap px-3 py-2 text-left text-base leading-snug text-ink [overflow-wrap:anywhere] ${
                        mine
                          ? "rounded-[16px] rounded-br-sm bg-outgoing"
                          : "rounded-[16px] rounded-bl-sm bg-incoming"
                      }`}
                    >
                      {m.reply_to ? (
                        <div className="mb-1 whitespace-normal border-l-2 border-white/40 pl-2 text-[12px] text-white/80">
                          <p className="font-semibold">
                            {m.reply_to.author_id === me ? t.you : m.reply_to.author_name || t.replyTo}
                          </p>
                          <p className="truncate">
                            {m.reply_to.deleted
                              ? t.deletedMsg
                              : m.reply_to.type === "photo"
                                ? messageBody({ ...m, type: "photo", payload: {} }, t)
                                : m.reply_to.text || messageBody({ ...m, type: m.reply_to.type, payload: { text: m.reply_to.text } }, t)}
                          </p>
                        </div>
                      ) : null}
                      {m.type === "voice" && m.local_url ? (
                        <VoiceNote
                          key={m.local_url}
                          src={m.local_url}
                          durationMs={m.payload?.duration_ms}
                          waveform={m.payload?.waveform}
                        />
                      ) : null}
                      {m.attachments?.map((a) =>
                        a.kind === "voice" || a.mime?.startsWith("audio/") ? (
                          m.local_url ? null : (
                            <VoiceNote
                              key={a.id}
                              src={a.url}
                              durationMs={a.duration_ms || m.payload?.duration_ms}
                              waveform={m.payload?.waveform}
                            />
                          )
                        ) : (
                          <ChatFile
                            key={a.id}
                            url={a.url}
                            name={a.filename || ""}
                            mime={a.mime || ""}
                            kind={a.kind}
                            photoLabel={t.photo}
                            fileLabel={t.file}
                            onOpen={setOpenDoc}
                          />
                        ),
                      )}
                      {bubbleLine(m)}
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
                              setComposer(payloadText(m.payload));
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
        <div className="flex gap-4 border-t border-line bg-elevated px-6 py-4">
          <button
            type="button"
            onClick={() => {
              fileRef.current?.setAttribute("accept", "image/*");
              fileRef.current?.click();
            }}
            className="flex flex-1 flex-col items-center gap-2 text-xs text-muted"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/20 text-accent">
              <ImageIcon size={20} />
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
              if (editing) setComposer("");
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-elevated"
            aria-label={t.cancel}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {voiceError ? <p className="px-4 pb-1 text-xs font-medium text-danger">{voiceError}</p> : null}
      <div className="flex items-end gap-2 border-t border-line px-3 py-2">
        {recording ? (
          <button
            type="button"
            onClick={() => stopRec(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-ink"
            aria-label={t.cancel}
          >
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAttach((v) => !v)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-ink transition-transform ${attach ? "rotate-45" : ""}`}
            aria-label={t.attach}
            aria-expanded={attach}
          >
            <Plus size={20} />
          </button>
        )}
        {recording ? (
          <div className="flex min-h-[40px] flex-1 items-center gap-2 rounded-[20px] bg-elevated px-3">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
            <span className="w-10 shrink-0 text-sm font-medium tabular-nums text-ink">{formatClock(elapsed)}</span>
            <span className="flex h-8 min-w-0 flex-1 items-end gap-[2px]">
              {(liveWave.length ? liveWave : Array.from({ length: 28 }, () => 0.16)).map((amp, i) => (
                <span
                  key={i}
                  className="block min-w-0 flex-1 rounded-full bg-accent"
                  style={{ height: `${4 + Math.round(Math.max(0, Math.min(1, amp)) * 24)}px` }}
                />
              ))}
            </span>
          </div>
        ) : (
          <textarea
            ref={composerRef}
            value={text}
            onChange={(e) => {
              setComposer(e.target.value);
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
            className="block max-h-32 min-h-[40px] min-w-0 flex-1 resize-none overflow-y-auto rounded-[20px] bg-elevated px-3.5 py-2 text-base leading-6 text-ink outline-none placeholder:text-muted focus:ring-1 focus:ring-accent/60"
          />
        )}
        {recording ? (
          <button
            type="button"
            onClick={() => stopRec(false)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white"
            aria-label={t.send}
          >
            <ArrowUp size={16} />
          </button>
        ) : text.trim() ? (
          <button
            type="button"
            onClick={() => void send()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white"
            aria-label={t.send}
          >
            <ArrowUp size={16} />
          </button>
        ) : (
          <button
            type="button"
            disabled={!!editing}
            onClick={() => askRec(Date.now())}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-ink disabled:opacity-40"
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
              <button
                type="button"
                onClick={() => setMembersOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-bg"
                aria-label={t.cancel}
              >
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
                          setProfileId(m.user.id);
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
                        className="flex h-9 w-9 items-center justify-center rounded-full text-danger hover:bg-danger/10"
                        title={t.kick}
                        aria-label={t.kick}
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
            armMeter();
            flushSync(() => setMicAsk(false));
            void startRec(Date.now());
          }}
          onCancel={() => setMicAsk(false)}
        />
      ) : null}
      {openDoc ? (
        <FileStage doc={openDoc} closeLabel={t.cancel} failLabel={t.previewFail} onClose={() => setOpenDoc(null)} />
      ) : null}
      {profileId ? (
        <ProfileSheet
          key={profileId}
          userId={profileId}
          seed={
            chat.peer?.id === profileId
              ? chat.peer
              : members.find((m) => m.user.id === profileId)?.user
          }
          t={t}
          lang={lang}
          self={profileId === me}
          onMuted={onMuted}
          onOpenChat={(id) => {
            setProfileId(null);
            setMembersOpen(false);
            onOpenChat?.(id);
          }}
          onWrite={
            profileId !== me && !(chat.type !== "group" && chat.peer?.id === profileId)
              ? () => {
                  const id = profileId;
                  setProfileId(null);
                  setMembersOpen(false);
                  onOpenDirect(id);
                }
              : undefined
          }
          onClose={() => setProfileId(null)}
        />
      ) : null}
    </div>
  );

  async function addOne(u: User) {
    const prev = members;
    setMembers((list) => (list.some((m) => m.user.id === u.id) ? list : [...list, { user: u, role: "member", joined_at: new Date().toISOString() }]));
    onMeta({ member_count: (members.some((m) => m.user.id === u.id) ? members.length : members.length + 1) });
    try {
      const r = await api.addMembers(chat.id, [u.id]);
      setMembers(r.items);
      setAddQ("");
      onMeta({ member_count: r.items.length });
      onRefreshChats();
    } catch {
      setMembers(prev);
      onMeta({ member_count: prev.length });
    }
  }

  async function kick(userId: string) {
    if (!window.confirm(t.confirmKick)) return;
    const prev = members;
    const next = prev.filter((m) => m.user.id !== userId);
    setMembers(next);
    onMeta({ member_count: next.length });
    try {
      await api.removeMember(chat.id, userId);
      onRefreshChats();
    } catch {
      setMembers(prev);
      onMeta({ member_count: prev.length });
    }
  }

  function leave() {
    if (!window.confirm(t.confirmLeave)) return;
    setMembersOpen(false);
    onHide();
  }
}

type OpenDoc = {
  url: string;
  name: string;
  mime: string;
  mode: "image" | "video" | "pdf" | "text" | "file";
};

function bubbleLine(m: Message): string {
  if (m.type === "voice" || m.type === "photo") return "";
  const text = m.payload?.text?.trim() || "";
  if (text) return text;
  if (m.type === "text") return "";
  const atts = m.attachments || [];
  if (atts.length > 0 && atts.every((a) => docMode(a.kind, a.mime || "", a.filename || "") === "image")) return "";
  const caption = m.payload?.caption?.trim() || "";
  if (!caption) return "";
  if (atts.some((a) => (a.filename || "").trim() === caption)) return "";
  return caption;
}

function docMode(kind: string, mime: string, name: string): OpenDoc["mode"] {
  const type = (mime || "").split(";")[0].toLowerCase();
  const file = name.toLowerCase();
  if (kind === "photo" || type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|bmp)$/.test(file)) return "image";
  if (kind === "video" || type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv)$/.test(file)) return "video";
  if (type === "application/pdf" || file.endsWith(".pdf")) return "pdf";
  if (type.startsWith("text/") || /\.(txt|md|csv|json|log|xml)$/.test(file)) return "text";
  return "file";
}

function ChatFile({
  url,
  name,
  mime,
  kind,
  photoLabel,
  fileLabel,
  onOpen,
}: {
  url: string;
  name: string;
  mime: string;
  kind: string;
  photoLabel: string;
  fileLabel: string;
  onOpen: (doc: OpenDoc) => void;
}) {
  if (!url) return null;
  const mode = docMode(kind, mime, name);
  const title = mode === "image" ? photoLabel : name || fileLabel;
  const open = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onOpen({ url, name: title, mime, mode });
  };
  if (mode === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={title} onClick={open} className="mb-1 block max-h-64 max-w-full cursor-zoom-in rounded-lg object-cover" />
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className="mb-1 flex max-w-full items-center gap-2 rounded-lg bg-black/15 px-2.5 py-2 text-left text-sm"
    >
      <Paperclip size={16} className="shrink-0 opacity-80" />
      <span className="min-w-0 truncate underline decoration-white/40 underline-offset-2">{title}</span>
    </button>
  );
}

function FileStage({
  doc,
  closeLabel,
  failLabel,
  onClose,
}: {
  doc: OpenDoc;
  closeLabel: string;
  failLabel: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/92" onClick={onClose}>
      <div className="flex items-center gap-3 px-3 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label={closeLabel} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <X size={18} />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm">{doc.name}</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3" onClick={(e) => e.stopPropagation()}>
        {doc.mode === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc.url}
            alt={doc.name}
            onClick={() => setZoom((v) => (v > 1 ? 1 : 2))}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-full max-w-full cursor-zoom-in object-contain"
          />
        ) : doc.mode === "video" ? (
          <video src={doc.url} controls autoPlay className="max-h-full max-w-full" />
        ) : doc.mode === "pdf" ? (
          <iframe title={doc.name} src={doc.url} className="h-full w-full bg-white" />
        ) : doc.mode === "text" ? (
          <TextBody key={doc.url} url={doc.url} failLabel={failLabel} />
        ) : (
          <div className="h-full w-full">
            <AnyBody key={doc.url} url={doc.url} name={doc.name} mime={doc.mime} failLabel={failLabel} />
          </div>
        )}
      </div>
    </div>
  );
}

function TextBody({ url, failLabel }: { url: string; failLabel: string }) {
  const [text, setText] = useState<string | null>(null);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    let gone = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("bad");
        return r.text();
      })
      .then((body) => {
        if (!gone) setText(body.slice(0, 200_000));
      })
      .catch(() => {
        if (!gone) setFail(true);
      });
    return () => {
      gone = true;
    };
  }, [url]);
  if (fail) return <p className="text-sm text-white">{failLabel}</p>;
  if (text == null) return null;
  return <pre className="h-full w-full overflow-auto whitespace-pre-wrap text-sm text-white">{text}</pre>;
}

type AnyView =
  | { kind: "loading" }
  | { kind: "fail" }
  | { kind: "image"; src: string }
  | { kind: "video"; src: string }
  | { kind: "audio"; src: string }
  | { kind: "pdf"; src: string }
  | { kind: "text"; body: string }
  | { kind: "bare"; name: string; size: number };

function AnyBody({ url, name, mime, failLabel }: { url: string; name: string; mime: string; failLabel: string }) {
  const [view, setView] = useState<AnyView>({ kind: "loading" });
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let gone = false;
    let made = "";
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error("bad");
        return r.arrayBuffer();
      })
      .then(async (buf) => {
        if (gone) return;
        const found = await classifyFile(new Uint8Array(buf), name, mime);
        if (gone) {
          if (found.url) URL.revokeObjectURL(found.url);
          return;
        }
        made = found.url || "";
        setView(found.view);
      })
      .catch(() => {
        if (!gone) setView({ kind: "fail" });
      });
    return () => {
      gone = true;
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, name, mime]);
  if (view.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }
  if (view.kind === "fail") return <p className="flex h-full items-center justify-center text-sm text-white">{failLabel}</p>;
  if (view.kind === "text") {
    return <pre className="h-full w-full overflow-auto whitespace-pre-wrap text-sm text-white">{view.body}</pre>;
  }
  if (view.kind === "pdf") return <iframe title={name} src={view.src} className="h-full w-full bg-white" />;
  if (view.kind === "image") {
    return (
      <div className="flex h-full items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={view.src}
          alt={name}
          onClick={() => setZoom((v) => (v > 1 ? 1 : 2))}
          style={{ transform: `scale(${zoom})` }}
          className="max-h-full max-w-full cursor-zoom-in object-contain"
        />
      </div>
    );
  }
  if (view.kind === "video") {
    return (
      <div className="flex h-full items-center justify-center">
        <video src={view.src} controls autoPlay className="max-h-full max-w-full" />
      </div>
    );
  }
  if (view.kind === "audio") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-white">
        <p className="max-w-sm text-center text-sm">{name}</p>
        <audio src={view.src} controls autoPlay />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-white">
      <p className="max-w-sm text-center text-sm">{view.name}</p>
      <p className="text-xs text-white/70">{formatSize(view.size)}</p>
    </div>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function classifyFile(bytes: Uint8Array, name: string, mime: string): Promise<{ view: AnyView; url?: string }> {
  const type = (mime || "").split(";")[0].trim().toLowerCase();
  const ext = extOf(name);
  if (asciiAt(bytes, 0, "%PDF")) return blobView(bytes, "application/pdf", "pdf");
  if (imageMagic(bytes)) return blobView(bytes, imageMime(bytes, type, ext), "image");
  if (audioMagic(bytes, ext, type)) return blobView(bytes, audioMime(bytes, type, ext), "audio");
  if (videoMagic(bytes, ext, type)) return blobView(bytes, videoMime(bytes, type, ext), "video");
  if (zipMagic(bytes) || ["docx", "xlsx", "pptx", "zip", "odt", "ods", "odp"].includes(ext)) {
    const text = await zipText(bytes);
    if (text.trim()) return { view: { kind: "text", body: text.slice(0, 200_000) } };
  }
  if (asciiAt(bytes, 0, "{\\rtf") || ext === "rtf") {
    const body = rtfToText(decodeText(bytes));
    if (body) return { view: { kind: "text", body } };
  }
  if (type === "application/pdf" || ext === "pdf") return blobView(bytes, "application/pdf", "pdf");
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"].includes(ext)) {
    return blobView(bytes, imageMime(bytes, type, ext), "image");
  }
  if (type.startsWith("audio/") || ["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac", "oga"].includes(ext)) {
    return blobView(bytes, audioMime(bytes, type, ext), "audio");
  }
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "m4v", "mkv"].includes(ext)) {
    return blobView(bytes, videoMime(bytes, type, ext), "video");
  }
  if (looksText(bytes) || type.startsWith("text/")) {
    const body = decodeText(bytes).trim();
    if (body) return { view: { kind: "text", body } };
  }
  return { view: { kind: "bare", name: name || "file", size: bytes.byteLength } };
}

function blobView(bytes: Uint8Array, mime: string, kind: "image" | "video" | "audio" | "pdf") {
  const url = URL.createObjectURL(asBlob(bytes, mime));
  return { view: { kind, src: url } as AnyView, url };
}

function asBlob(bytes: Uint8Array, mime: string) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy as ArrayBuffer], { type: mime });
}

function extOf(name: string) {
  const clean = (name.split("/").pop() || "").split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

function asciiAt(bytes: Uint8Array, offset: number, text: string) {
  if (offset < 0 || bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function brandAt(bytes: Uint8Array) {
  if (bytes.length < 12) return "";
  return String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
}

function heifMagic(bytes: Uint8Array) {
  if (!asciiAt(bytes, 4, "ftyp")) return false;
  const brand = brandAt(bytes);
  return brand.startsWith("hei") || brand === "mif1" || brand === "msf1";
}

function imageMagic(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (asciiAt(bytes, 0, "GIF8") || asciiAt(bytes, 0, "BM")) return true;
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return true;
  return heifMagic(bytes);
}

function audioMagic(bytes: Uint8Array, ext: string, type: string) {
  if (heifMagic(bytes)) return false;
  if (asciiAt(bytes, 0, "ID3") || asciiAt(bytes, 0, "fLaC") || asciiAt(bytes, 0, "OggS")) return true;
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) return true;
  if (asciiAt(bytes, 4, "ftyp")) {
    const brand = brandAt(bytes);
    if (brand.startsWith("m4a") || ext === "m4a" || ext === "aac" || type.startsWith("audio/")) return true;
  }
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (ext === "mp3" || type === "audio/mpeg");
}

function videoMagic(bytes: Uint8Array, ext: string, type: string) {
  if (heifMagic(bytes) || audioMagic(bytes, ext, type)) return false;
  if (asciiAt(bytes, 4, "ftyp")) return true;
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function zipMagic(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function imageMime(bytes: Uint8Array, type: string, ext: string) {
  if (type.startsWith("image/")) return type;
  if (asciiAt(bytes, 0, "GIF8") || ext === "gif") return "image/gif";
  if ((bytes.length > 0 && bytes[0] === 0x89) || ext === "png") return "image/png";
  if ((asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) || ext === "webp") return "image/webp";
  if (asciiAt(bytes, 0, "BM") || ext === "bmp") return "image/bmp";
  if (heifMagic(bytes) || ext === "heic") return "image/heic";
  return "image/jpeg";
}

function audioMime(bytes: Uint8Array, type: string, ext: string) {
  if (type.startsWith("audio/")) return type;
  if (asciiAt(bytes, 0, "OggS") || ext === "ogg" || ext === "opus" || ext === "oga") return "audio/ogg";
  if ((asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) || ext === "wav") return "audio/wav";
  if (asciiAt(bytes, 0, "fLaC") || ext === "flac") return "audio/flac";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  return "audio/mpeg";
}

function videoMime(bytes: Uint8Array, type: string, ext: string) {
  if (type.startsWith("video/")) return type;
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "webm" || (bytes.length > 1 && bytes[0] === 0x1a && bytes[1] === 0x45)) return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

function looksText(bytes: Uint8Array) {
  const n = Math.min(bytes.length, 4096);
  if (n === 0) return false;
  let controls = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) controls++;
  }
  return controls * 20 < n;
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 200_000));
}

function rtfToText(raw: string) {
  return raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, num: string) => {
      let code = Number(num);
      if (code < 0) code += 65536;
      return String.fromCharCode(code);
    })
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 200_000);
}

function xmlToText(xml: string) {
  return xml
    .replace(/<\/w:p>|<w:br\s*\/?>|<\/a:p>|<a:br\s*\/?>|<\/si>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/[ \t]*\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

type ZipEntry = { name: string; method: number; compSize: number; uncompSize: number; dataOff: number };

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  const start = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = u16(bytes, eocd + 10);
  let pos = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && n < 500 && pos + 46 <= bytes.length; n++) {
    if (u32(bytes, pos) !== 0x02014b50) break;
    const method = u16(bytes, pos + 10);
    const compSize = u32(bytes, pos + 20);
    const uncompSize = u32(bytes, pos + 24);
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    const localOff = u32(bytes, pos + 42);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    let dataOff = -1;
    if (localOff + 30 <= bytes.length && u32(bytes, localOff) === 0x04034b50) {
      const localName = u16(bytes, localOff + 26);
      const localExtra = u16(bytes, localOff + 28);
      dataOff = localOff + 30 + localName + localExtra;
    }
    out.push({ name, method, compSize, uncompSize, dataOff });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array) {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = asBlob(data, "application/octet-stream").stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function readZipText(bytes: Uint8Array, entry: ZipEntry) {
  if (entry.dataOff < 0 || entry.uncompSize > 1_500_000 || entry.dataOff + entry.compSize > bytes.length) return "";
  const slice = bytes.subarray(entry.dataOff, entry.dataOff + entry.compSize);
  const raw = entry.method === 0 ? slice : entry.method === 8 ? await inflateRaw(slice) : null;
  if (!raw) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(raw);
}

async function zipText(bytes: Uint8Array) {
  const entries = zipEntries(bytes);
  const parts: string[] = [];
  const slides: { n: number; text: string }[] = [];
  for (const entry of entries) {
    const path = entry.name.replace(/\\/g, "/").toLowerCase();
    const slide = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
    const wanted = path === "word/document.xml" || path === "xl/sharedstrings.xml" || path === "content.xml" || slide;
    if (!wanted) continue;
    const plain = xmlToText(await readZipText(bytes, entry));
    if (!plain) continue;
    if (slide) slides.push({ n: Number(slide[1]), text: plain });
    else parts.push(plain);
  }
  slides.sort((a, b) => a.n - b.n);
  const body = [...parts, ...slides.map((slide) => slide.text)].join("\n\n").trim();
  if (body) return body.slice(0, 200_000);
  return entries
    .map((entry) => entry.name.replace(/\\/g, "/"))
    .filter((entry) => entry && !entry.endsWith("/") && !entry.includes("__MACOSX/") && !entry.endsWith(".DS_Store"))
    .slice(0, 200)
    .join("\n");
}

async function shrinkPhoto(file: File) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < 250_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.\w+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
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
