"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  Check,
  Languages,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Search,
  Settings,
  Users,
  Video,
  X,
} from "lucide-react";
import { api, loadSession, saveSession } from "@/lib/api";
import { migrateLegacyStorage } from "@/lib/storage";
import { dedupeChats, dedupeMessages, forgetChat, mergeChats, mergeThread, readActive, readRoster, readThread, writeActive, writeRoster, writeThread } from "@/lib/cache";
import { captureAudio, captureCall, captureVideo, forgetMedia, mediaRemembered, rememberMedia, stopCallMedia, warmCallConnection, type CallMedia } from "@/lib/callMedia";
import { chatMatchesSlug, lastPreview, pathForChat, pathsEqual, slugFromPath } from "@/lib/chat";
import { dict, type Lang } from "@/lib/i18n";
import { needsDisplayName, sanitizeDisplayName, sanitizeUsername } from "@/lib/name";
import {
  armSoundUnlock,
  enableWebPush,
  notifyCall,
  notifyMessage,
  playMessageChime,
  rememberNotify,
  shouldAskNotify,
  startRingtone,
  stopRingtone,
  unlockSounds,
} from "@/lib/notify";
import { formatPhone } from "@/lib/phone";
import type { Call, Chat, Envelope, Message, Session, User } from "@/lib/types";
import { Avatar } from "./Avatar";
import { BrandMark } from "./BrandMark";
import { CallRoom, IncomingCall } from "./CallRoom";
import { ChatPane } from "./ChatPane";
import { EmailAttach } from "./EmailAttach";
import { NameOnboarding } from "./NameOnboarding";
import { PeopleResults, PersonRow, useUserSearch } from "./PeopleSearch";
import { PermitToast } from "./PermitToast";
import { PhoneAuth } from "./PhoneAuth";

type Tab = "chats" | "calls" | "contacts" | "more";
type Seg = "all" | "direct" | "group";

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function MessengerApp() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState<Lang>("ru");
  const t = dict[lang];

  function chooseLang(next: Lang) {
    setLang(next);
    try {
      localStorage.setItem("salam.lang", next);
    } catch {
      /* private mode */
    }
  }

  const [tab, setTab] = useState<Tab>("chats");
  const [seg, setSeg] = useState<Seg>("all");
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [rosterTick, setRosterTick] = useState(0);
  const [calls, setCalls] = useState<Call[]>([]);
  const [contactQ, setContactQ] = useState("");
  const [pickerQ, setPickerQ] = useState("");
  const [syncedPeople, setSyncedPeople] = useState<User[]>([]);
  const [contactsSynced, setContactsSynced] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Call | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callMedia, setCallMedia] = useState<Promise<CallMedia> | null>(null);
  const [callCreds, setCallCreds] = useState<Promise<{ url: string; token: string; room: string }> | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [pendingCall, setPendingCall] = useState<{ kind: "audio" | "video"; step: "mic" | "camera" } | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [notifyAsk, setNotifyAsk] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [typingNow, setTypingNow] = useState(0);
  const [newOpen, setNewOpen] = useState<"direct" | "group" | null>(null);
  const [chatMenu, setChatMenu] = useState<Chat | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [rename, setRename] = useState<Chat | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupNick, setGroupNick] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [birth, setBirth] = useState("");
  const [address, setAddress] = useState("");
  const [hideNick, setHideNick] = useState(false);
  const [renameNick, setRenameNick] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [emailEdit, setEmailEdit] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const meRef = useRef<string | undefined>(undefined);
  const activeCallIdRef = useRef<string | null>(null);
  const incomingIdRef = useRef<string | null>(null);
  const closedCalls = useRef(new Set<string>());
  const fetchedThread = useRef("");
  const attemptRef = useRef(0);
  const armingRef = useRef(false);
  const allowingRef = useRef(false);
  const pendingStart = useRef<(() => Promise<Call>) | null>(null);
  const pendingAudio = useRef<MediaStreamTrack | null>(null);
  const goneChats = useRef(new Set<string>());
  const heard = useRef(new Set<string>());
  const pinnedChats = useRef(new Map<string, Chat>());
  const renamed = useRef(new Map<string, string>());
  const refreshGen = useRef(0);
  const groupBusy = useRef(false);
  const paintRef = useRef<(chatId: string, patch: (chat: Chat) => Chat) => void>(() => undefined);
  const errorTimer = useRef<number | null>(null);
  const chatsRef = useRef(chats);
  const routerRef = useRef(router);
  routerRef.current = router;
  const pendingUrl = useRef<string | null>(null);
  const bootRef = useRef(true);
  const nickFlight = useRef<string | null>(null);
  const activeChatRef = useRef<Chat | null>(null);
  const showChatRef = useRef<(chat: Chat) => void>(() => undefined);
  const selectChatRef = useRef<(id: string, known?: Chat) => void>(() => undefined);

  const active = chats.find((c) => c.id === activeId) || null;
  const me = session?.user.id;

  useEffect(() => {
    activeIdRef.current = activeId;
    meRef.current = me;
    activeCallIdRef.current = activeCall?.id ?? null;
    incomingIdRef.current = incoming?.id ?? null;
  }, [activeId, me, activeCall, incoming]);

  useEffect(() => {
    const s = loadSession();
    migrateLegacyStorage();
    const stored = localStorage.getItem("salam.lang");
    queueMicrotask(() => {
      setSession(s);
      if (s?.user) {
        setName(s.user.display_name);
        setUsername(s.user.username || "");
        setBio(s.user.bio || "");
        setBirth(s.user.birth_date || "");
        setAddress(s.user.address || "");
        setHideNick(!!s.user.username_hidden);
        const roster = readRoster(s.user.id);
        if (roster.length) setChats(roster);
        const fromUrl = slugFromPath(window.location.pathname);
        const linked = fromUrl ? roster.find((chat) => chatMatchesSlug(chat, fromUrl)) : undefined;
        if (linked) {
          activeChatRef.current = linked;
          setActiveId(linked.id);
          setMessages(readThread(s.user.id, linked.id));
        } else if (!fromUrl) {
          const open = readActive(s.user.id);
          const saved = open ? roster.find((chat) => chat.id === open) : undefined;
          if (saved) {
            activeChatRef.current = saved;
            setActiveId(saved.id);
            setMessages(readThread(s.user.id, saved.id));
          }
        }
      }
      if (stored === "ru" || stored === "ky") setLang(stored);
      setReady(true);
      if (s?.user && !needsDisplayName(s.user.display_name) && shouldAskNotify()) setNotifyAsk(true);
    });
    if (s?.access_token) {
      void api.me().then((user) => {
        setSession((prev) => {
          if (!prev || prev.user.id !== user.id) return prev;
          const next = { ...prev, user };
          saveSession(next);
          return next;
        });
        setName(user.display_name);
        setUsername(user.username || "");
        setBio(user.bio || "");
        setBirth(user.birth_date || "");
        setAddress(user.address || "");
        setHideNick(!!user.username_hidden);
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    armSoundUnlock();
  }, []);

  useEffect(() => {
    const outgoing = activeCall?.status === "ringing" && activeCall.initiator_id === me;
    const incomingRing = !!incoming && !callBusy && !activeCall;
    if (incomingRing || outgoing) {
      startRingtone();
      if (incoming && document.visibilityState !== "visible") {
        const title = chatsRef.current.find((chat) => chat.id === incoming.chat_id)?.title;
        notifyCall(title || t.incomingAudio, incoming.kind === "video" ? t.incomingVideo : t.incomingAudio);
      }
      return () => stopRingtone();
    }
    stopRingtone();
  }, [incoming, callBusy, activeCall, me, t.incomingAudio, t.incomingVideo]);

  const refreshChats = useCallback(async () => {
    const userId = meRef.current;
    const type = seg === "all" ? "" : seg;
    const filtering = !!(query || seg !== "all");
    const gen = ++refreshGen.current;
    try {
      const r = await api.chats(query, type);
      if (gen !== refreshGen.current) return;
      const fresh = r.items ?? [];
      const freshIds = new Set(fresh.map((chat) => chat.id));
      let next: Chat[];
      if (!filtering) {
        for (const id of [...pinnedChats.current.keys()]) {
          if (freshIds.has(id)) pinnedChats.current.delete(id);
        }
        const local = userId ? readRoster(userId) : [];
        next = mergeChats(local, fresh);
        for (const chat of pinnedChats.current.values()) {
          if (!next.some((item) => item.id === chat.id)) next.push(chat);
        }
      } else {
        next = fresh.slice();
      }
      next = dedupeChats(next)
        .filter((chat) => !goneChats.current.has(chat.id))
        .map((chat) => {
          const title = renamed.current.get(chat.id);
          if (!title) return chat;
          if (chat.title === title) {
            renamed.current.delete(chat.id);
            return chat;
          }
          return { ...chat, title };
        });
      if (userId && !filtering) writeRoster(userId, next);
      setChats(next);
    } catch {
      if (gen !== refreshGen.current || filtering || !userId) return;
      setChats(dedupeChats(readRoster(userId)).filter((chat) => !goneChats.current.has(chat.id)));
    }
  }, [query, seg]);

  useEffect(() => {
    if (!session) return;
    const id = window.setTimeout(() => {
      void refreshChats().catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(id);
  }, [session, refreshChats]);

  useEffect(() => {
    const onLost = () => {
      setSession(null);
      setChats([]);
      setMessages([]);
      activeChatRef.current = null;
      setActiveId(null);
      if ((window.location.pathname || "/") !== "/") {
        pendingUrl.current = "/";
        routerRef.current.replace("/");
      }
    };
    window.addEventListener("salam:auth-lost", onLost);
    return () => window.removeEventListener("salam:auth-lost", onLost);
  }, []);

  useEffect(() => {
    if (!session || !activeId) return;
    const chatId = activeId;
    const userId = session.user.id;
    let cancelled = false;
    void api
      .messages(chatId)
      .then((r) => {
        if (cancelled) return;
        const fresh = [...(r.items ?? [])].reverse();
        setMessages((prev) => {
          const next = mergeThread(prev.length ? prev : readThread(userId, chatId), fresh);
          writeThread(userId, chatId, next);
          return next;
        });
        const last = [...fresh].reverse().find((item) => !item.deleted_at);
        if (last && !goneChats.current.has(chatId)) {
          setChats((prev) =>
            dedupeChats(
              prev.map((chat) =>
                chat.id === chatId
                  ? {
                      ...chat,
                      last_message: last,
                      unread_count: 0,
                      updated_at: last.created_at > chat.updated_at ? last.created_at : chat.updated_at,
                    }
                  : chat,
              ),
            ),
          );
        }
        fetchedThread.current = chatId;
        setCursor(r.cursor ?? null);
        const incomingIds = fresh.filter((m) => m.author_id && m.author_id !== me).map((m) => m.id);
        if (incomingIds.length) void api.receipts(incomingIds, "read");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, activeId, me]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !activeId) return;
    if (messages.length === 0 && fetchedThread.current !== activeId) return;
    writeThread(userId, activeId, messages);
    const last = [...messages].reverse().find((m) => !m.deleted_at) ?? null;
    const stored = readRoster(userId)
      .filter((chat) => !goneChats.current.has(chat.id))
      .map((chat) => {
        if (chat.id !== activeId) return chat;
        if (!last) return { ...chat, last_message: null, unread_count: 0 };
        return {
          ...chat,
          last_message: last,
          updated_at: last.created_at > chat.updated_at ? last.created_at : chat.updated_at,
          unread_count: 0,
        };
      });
    writeRoster(userId, stored);
  }, [session, activeId, messages]);

  useEffect(() => {
    paintRef.current = paintChat;
  });

  const applyRemoteCall = useCallback((call: Call) => {
    setCalls((prev) => [call, ...prev.filter((item) => item.id !== call.id)]);
    const myId = meRef.current;
    const terminal = call.status === "ended" || call.status === "missed" || call.status === "declined";
    if (terminal) {
      const watched = activeCallIdRef.current === call.id || incomingIdRef.current === call.id;
      if (watched && !closedCalls.current.has(call.id)) {
        closedCalls.current.add(call.id);
        attemptRef.current += 1;
        armingRef.current = false;
        pendingAudio.current?.stop();
        pendingAudio.current = null;
        pendingStart.current = null;
        allowingRef.current = false;
        setCallBusy(false);
        setPendingCall(null);
      }
      setIncoming((c) => (c?.id === call.id ? null : c));
      if (activeCallIdRef.current === call.id) {
        setCallMedia(null);
        setCallCreds(null);
        setActiveCall(null);
      }
      return;
    }
    if (call.status === "ringing" && call.initiator_id !== myId) {
      setIncoming((c) => (c?.id === call.id ? c : call));
      return;
    }
    if (call.status === "active") {
      setIncoming((c) => {
        if (c?.id !== call.id || armingRef.current) return c;
        return null;
      });
      setActiveCall((c) => {
        if (!c || c.id !== call.id) return c;
        if (c.status === "active") return c;
        return { ...c, ...call, status: "active" };
      });
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const es = new EventSource(`/v1/stream?token=${encodeURIComponent(session.access_token)}`);
    es.onmessage = (ev) => {
      try {
        const env = JSON.parse(ev.data) as Envelope;
        const openId = activeIdRef.current;
        const myId = meRef.current;
        if (env.type === "message.created" || env.type === "message.new") {
          const msg = env.body as Message;
          if (msg.id && heard.current.has(msg.id)) return;
          if (msg.id) {
            if (heard.current.size > 400) heard.current.clear();
            heard.current.add(msg.id);
          }
          if (goneChats.current.has(msg.chat_id)) goneChats.current.delete(msg.chat_id);
          const viewing = openId === msg.chat_id;
          const mine = msg.author_id === myId;
          paintRef.current(msg.chat_id, (chat) => {
            const updated = msg.created_at > chat.updated_at ? msg.created_at : chat.updated_at;
            const same = chat.last_message?.id === msg.id || (!!msg.client_id && chat.last_message?.client_id === msg.client_id);
            const unread = viewing ? 0 : mine || same ? chat.unread_count : chat.unread_count + 1;
            return { ...chat, last_message: msg, updated_at: updated, unread_count: unread };
          });
          setMessages((prev) => {
            if (!openId || msg.chat_id !== openId) return prev;
            const same = (m: Message) => m.id === msg.id || (!!msg.client_id && m.client_id === msg.client_id);
            const next = prev.some(same)
              ? prev.map((m) => (same(m) ? { ...m, ...msg, local_url: m.local_url } : m))
              : [...prev, msg];
            return dedupeMessages(next);
          });
          void refreshChats();
          if (!mine && msg.author_id) {
            const row = chatsRef.current.find((chat) => chat.id === msg.chat_id) || pinnedChats.current.get(msg.chat_id);
            const until = row?.muted_until ? new Date(row.muted_until).getTime() : 0;
            const quiet = until > Date.now();
            if (!quiet) playMessageChime();
            const looking = document.visibilityState === "visible" && openId === msg.chat_id;
            if (!looking && !quiet) {
              const title = chatsRef.current.find((chat) => chat.id === msg.chat_id)?.title || "Salam";
              const body = msg.type === "photo" ? msg.payload?.text || "" : msg.payload?.text || msg.payload?.caption || "";
              notifyMessage(title, body);
            }
          }
          if (msg.chat_id === openId && msg.author_id !== myId) {
            void api.receipts([msg.id], "read");
          }
        }
        if (env.type === "message.updated") {
          const msg = env.body as Message;
          paintRef.current(msg.chat_id, (chat) => (chat.last_message?.id === msg.id ? { ...chat, last_message: msg } : chat));
          setMessages((prev) => {
            if (!openId || msg.chat_id !== openId) return prev;
            return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m));
          });
          void refreshChats();
        }
        if (env.type === "message.deleted") {
          const body = env.body as { id: string; chat_id: string };
          paintRef.current(body.chat_id, (chat) => (chat.last_message?.id === body.id ? { ...chat, last_message: null } : chat));
          setMessages((prev) => {
            if (!openId || body.chat_id !== openId) return prev;
            return prev.filter((m) => m.id !== body.id);
          });
          void refreshChats();
        }
        if (env.type === "chat.updated") {
          setRosterTick((n) => n + 1);
          void refreshChats();
        }
        if (env.type === "message.ack") {
          const body = env.body as { id?: string; client_id?: string };
          if (body.id && body.client_id) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.client_id !== body.client_id && m.id !== body.client_id && m.id !== body.id) return m;
                const status = m.status === "read" || m.status === "delivered" ? m.status : "sent";
                return { ...m, id: body.id || m.id, status };
              }),
            );
          }
        }
        if (env.type === "receipt" || env.type === "receipt.upserted") {
          const body = env.body as { message_id: string; status: string };
          setMessages((prev) => prev.map((m) => (m.id === body.message_id ? { ...m, status: body.status } : m)));
        }
        if (env.type === "typing") {
          const body = env.body as { chat_id: string };
          const until = Date.now() + 3000;
          setTyping((prev) => ({ ...prev, [body.chat_id]: until }));
          setTypingNow(until - 3000);
        }
        if (env.type === "call.updated") {
          applyRemoteCall(env.body as Call);
          void api
            .calls()
            .then((r) => setCalls(r.items ?? []))
            .catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [session, refreshChats, applyRemoteCall]);

  useEffect(() => {
    if (!session) return;
    const id = activeCall?.id || incoming?.id;
    if (!id) return;
    let stop = false;
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      void api
        .call(id)
        .then((call) => {
          if (!stop) applyRemoteCall(call);
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, 1000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [session, activeCall?.id, incoming?.id, applyRemoteCall]);

  useEffect(() => {
    const id = incoming?.id;
    if (!id) return;
    let cancel = false;
    void api
      .callToken(id)
      .then((creds) => {
        if (!cancel) return warmCallConnection(creds.url, creds.token);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [incoming?.id]);

  useEffect(() => {
    if (!session || tab !== "calls") return;
    void api
      .calls()
      .then((r) => setCalls(r.items ?? []))
      .catch(() => undefined);
  }, [session, tab]);

  useEffect(() => {
    if (!session || tab !== "contacts") return;
    void api
      .contacts()
      .then((r) => {
        setSyncedPeople((r.items ?? []).filter((u) => u.id !== me));
        setContactsSynced(!!r.synced);
      })
      .catch(() => undefined);
  }, [session, tab, me]);

  const contactsSearch = useUserSearch(tab === "contacts" ? contactQ : "", me);
  const pickerSearch = useUserSearch(newOpen ? pickerQ : "", me);

  function showCallError(text: string) {
    setCallError(text);
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setCallError(null), 5000);
  }

  function closeCall(id: string) {
    void api.hangupCall(id).catch(() => undefined);
    setCallMedia(null);
    setCallCreds(null);
    setActiveCall((c) => (c?.id === id ? null : c));
    setIncoming((c) => (c?.id === id ? null : c));
    setCalls((prev) => prev.map((call) => (call.id === id ? { ...call, status: "ended" } : call)));
  }

  function stopPendingAudio() {
    pendingAudio.current?.stop();
    pendingAudio.current = null;
  }

  function cancelPermit() {
    attemptRef.current += 1;
    armingRef.current = false;
    allowingRef.current = false;
    stopPendingAudio();
    pendingStart.current = null;
    setCallBusy(false);
    setPendingCall(null);
  }

  function failCall(attempt: number, code: string) {
    stopPendingAudio();
    if (code === "camera") forgetMedia("camera");
    else if (code === "mic") forgetMedia("mic");
    if (attempt !== attemptRef.current) return;
    armingRef.current = false;
    allowingRef.current = false;
    pendingStart.current = null;
    setCallBusy(false);
    setPendingCall(null);
    showCallError(code === "camera" ? t.camDenied : code === "mic" ? t.micDenied : t.callFailed);
  }

  function credsFor(call: Call) {
    if (call.token) {
      const creds = { url: call.url || "", token: call.token, room: call.room || "" };
      if (!call.token.startsWith("stub-")) void warmCallConnection(creds.url, creds.token);
      return Promise.resolve(creds);
    }
    const pending = api.callToken(call.id);
    void pending.then((creds) => warmCallConnection(creds.url, creds.token)).catch(() => undefined);
    return pending;
  }

  function listedCall(call: Call): Call {
    return {
      id: call.id,
      chat_id: call.chat_id,
      initiator_id: call.initiator_id,
      kind: call.kind,
      status: call.status,
      started_at: call.started_at,
      answered_at: call.answered_at,
      ended_at: call.ended_at,
    };
  }

  function captureFresh(kind: "audio" | "video", together: boolean) {
    if (kind === "video" && together) return captureCall("video");
    if (kind !== "video") return captureAudio().then((audio) => ({ audio }));
    return captureAudio().then(async (audio) => {
      try {
        return { audio, video: await captureVideo() };
      } catch (err) {
        audio.stop();
        throw err;
      }
    });
  }

  async function beginJoin(attempt: number, start: () => Promise<Call>, capture: () => Promise<CallMedia>) {
    const mediaPromise = capture().then((media) => {
      rememberMedia("mic");
      if (media.video) rememberMedia("camera");
      return media;
    });
    void mediaPromise.catch(() => undefined);
    let call: Call;
    try {
      call = await start();
    } catch (err) {
      void mediaPromise.then(stopCallMedia).catch(() => undefined);
      throw err;
    }
    if (attempt !== attemptRef.current) {
      void mediaPromise.then(stopCallMedia).catch(() => undefined);
      if (call.status === "ringing" || call.status === "active") void api.hangupCall(call.id);
      armingRef.current = false;
      setCallBusy(false);
      return;
    }
    if (call.status !== "ringing" && call.status !== "active") {
      void mediaPromise.then(stopCallMedia).catch(() => undefined);
      failCall(attempt, "failed");
      return;
    }
    pendingAudio.current = null;
    pendingStart.current = null;
    armingRef.current = false;
    setCallBusy(false);
    setPendingCall(null);
    setCallCreds(credsFor(call));
    setCallMedia(mediaPromise);
    setIncoming(null);
    const shown = listedCall(call);
    setActiveCall(shown);
    setCalls((prev) => [shown, ...prev.filter((item) => item.id !== shown.id)]);
  }

  function showCameraPermit(attempt: number, kind: "audio" | "video", audio: MediaStreamTrack, start: () => Promise<Call>) {
    if (attempt !== attemptRef.current) {
      audio.stop();
      armingRef.current = false;
      setCallBusy(false);
      return;
    }
    pendingAudio.current = audio;
    pendingStart.current = start;
    allowingRef.current = false;
    setCallBusy(false);
    setPendingCall({ kind, step: "camera" });
  }

  function placeCall(kind: "audio" | "video", start: () => Promise<Call>) {
    if (armingRef.current || activeCall) return;
    const attempt = ++attemptRef.current;
    armingRef.current = true;
    setCallError(null);
    pendingStart.current = start;
    const ready = mediaRemembered("mic") && (kind !== "video" || mediaRemembered("camera"));
    if (ready) {
      setCallBusy(true);
      void beginJoin(attempt, start, () => captureFresh(kind, kind === "video")).catch((err) => {
        const code = err instanceof Error ? err.message : "";
        failCall(attempt, code === "camera" ? "camera" : code === "mic" ? "mic" : "failed");
      });
      return;
    }
    setCallBusy(false);
    setPendingCall({ kind, step: "mic" });
  }

  function allowPending() {
    const pending = pendingCall;
    const start = pendingStart.current;
    if (!pending || !start || allowingRef.current) return;
    const attempt = attemptRef.current;
    allowingRef.current = true;
    // The browser permission bar is at the top. Unmount the toast before getUserMedia or the prompt stays hidden and the call never starts.
    flushSync(() => {
      setPendingCall(null);
      setCallBusy(true);
    });
    void (async () => {
      try {
        if (pending.step === "mic") {
          if (pending.kind !== "video" || mediaRemembered("camera")) {
            await beginJoin(attempt, start, () => captureFresh(pending.kind, pending.kind === "video"));
            return;
          }
          const audio = await captureAudio();
          rememberMedia("mic");
          if (attempt !== attemptRef.current) {
            audio.stop();
            armingRef.current = false;
            setCallBusy(false);
            return;
          }
          showCameraPermit(attempt, pending.kind, audio, start);
          return;
        }
        const audio = pendingAudio.current;
        if (!audio) throw new Error("mic");
        await beginJoin(attempt, start, async () => {
          try {
            return { audio, video: await captureVideo() };
          } catch (err) {
            audio.stop();
            pendingAudio.current = null;
            throw err;
          }
        });
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        failCall(attempt, code === "camera" ? "camera" : code === "mic" ? "mic" : "failed");
      } finally {
        allowingRef.current = false;
      }
    })();
  }

  function beginCall(chatId: string, kind: "audio" | "video") {
    if (incoming) return;
    void placeCall(kind, () => api.startCall(chatId, kind));
  }

  function acceptIncoming() {
    if (!incoming) return;
    const id = incoming.id;
    const kind = incoming.kind === "video" ? "video" : "audio";
    void placeCall(kind, () => api.answerCall(id));
  }

  function paintChat(chatId: string, patch: (chat: Chat) => Chat) {
    if (!chatId || goneChats.current.has(chatId)) return;
    setChats((prev) => {
      if (!prev.some((chat) => chat.id === chatId)) return prev;
      return dedupeChats(prev.map((chat) => (chat.id === chatId ? patch(chat) : chat)));
    });
    const userId = meRef.current;
    if (!userId) return;
    const stored = readRoster(userId);
    if (!stored.some((chat) => chat.id === chatId)) return;
    writeRoster(
      userId,
      dedupeChats(
        stored
          .filter((chat) => !goneChats.current.has(chat.id))
          .map((chat) => (chat.id === chatId ? patch(chat) : chat)),
      ),
    );
  }

  function showChat(chat: Chat) {
    goneChats.current.delete(chat.id);
    pinnedChats.current.set(chat.id, chat);
    const userId = meRef.current;
    if (userId) {
      const stored = readRoster(userId).filter((item) => item.id !== chat.id && !goneChats.current.has(item.id));
      writeRoster(userId, dedupeChats([chat, ...stored]));
    }
    setQuery("");
    setSeg("all");
    setChats((prev) => dedupeChats([chat, ...prev.filter((item) => item.id !== chat.id && !goneChats.current.has(item.id))]));
  }

  function hideChats(ids: string[]) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return;
    setPendingDelete([]);
    setChatMenu(null);
    setPicking(false);
    setSelectedIds((prev) => prev.filter((id) => !unique.includes(id)));
    // Keep the ids hidden for this visit. A list response that started before the delete can still contain them.
    for (const id of unique) {
      goneChats.current.add(id);
      pinnedChats.current.delete(id);
      renamed.current.delete(id);
    }
    setChats((prev) => prev.filter((item) => !goneChats.current.has(item.id)));
    const userId = meRef.current;
    if (userId) {
      for (const id of unique) forgetChat(userId, id);
      if (activeIdRef.current && unique.includes(activeIdRef.current)) writeActive(userId, null);
    }
    if (activeIdRef.current && unique.includes(activeIdRef.current)) {
      activeChatRef.current = null;
      setActiveId(null);
      setMessages([]);
      publishUrl("/", "push");
    }
    void Promise.allSettled(unique.map((id) => api.hideChat(id))).then((results) => {
      const failed = unique.filter((_, index) => results[index].status === "rejected");
      if (!failed.length) return;
      for (const id of failed) goneChats.current.delete(id);
      void refreshChats();
    });
  }

  function publishUrl(want: string, mode: "push" | "replace") {
    const now = window.location.pathname || "/";
    if (pathsEqual(now, want)) return;
    pendingUrl.current = want;
    const nav = { scroll: false } as const;
    if (mode === "push") router.push(want, nav);
    else router.replace(want, nav);
  }

  function leaveChat() {
    activeChatRef.current = null;
    setActiveId(null);
    publishUrl("/", "push");
  }

  function selectChat(id: string, known?: Chat) {
    const chat = known || chatsRef.current.find((item) => item.id === id) || pinnedChats.current.get(id) || null;
    if (chat) activeChatRef.current = chat;
    if (id !== activeId) {
      fetchedThread.current = "";
      const userId = meRef.current;
      setMessages(userId ? readThread(userId, id) : []);
      setCursor(null);
    }
    setActiveId(id);
    if (meRef.current) writeActive(meRef.current, id);
    paintChat(id, (item) => ({ ...item, unread_count: 0 }));
    setTab("chats");
    publishUrl(pathForChat(chat), "push");
  }

  async function openKnown(id: string) {
    const have = chatsRef.current.find((chat) => chat.id === id) || pinnedChats.current.get(id);
    if (have) {
      selectChat(have.id, have);
      return;
    }
    try {
      const chat = await api.chat(id);
      showChat(chat);
      selectChat(chat.id, chat);
    } catch {
      /* the profile stays on the current chat */
    }
  }

  async function openDirect(userId: string) {
    try {
      const chat = await api.direct(userId);
      showChat(chat);
      selectChat(chat.id, chat);
      setNewOpen(null);
    } catch {
      /* the picker stays open */
    }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title || groupBusy.current) return;
    groupBusy.current = true;
    try {
      const nick = sanitizeUsername(groupNick);
      if (groupNick.trim() && !nick) {
        setProfileError(t.errNick);
        return;
      }
      const chat = await api.group(title, picked, nick || undefined);
      showChat(chat);
      selectChat(chat.id, chat);
      setNewOpen(null);
      setGroupTitle("");
      setGroupNick("");
      setPicked([]);
      setProfileError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setProfileError(/username taken|conflict/i.test(msg) ? t.errNickTaken : t.errLogin);
    } finally {
      groupBusy.current = false;
    }
  }

  function askDelete(ids: string[]) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return;
    setChatMenu(null);
    setPendingDelete(unique);
  }

  async function saveRename() {
    if (!rename) return;
    const title = renameTitle.trim();
    if (!title) return;
    const nick = sanitizeUsername(renameNick);
    if (renameNick.trim() && !nick) {
      setProfileError(t.errNick);
      return;
    }
    const id = rename.id;
    setRename(null);
    setProfileError(null);
    renamed.current.set(id, title);
    paintChat(id, (chat) => ({ ...chat, title, username: nick || null }));
    const userId = meRef.current;
    if (userId) {
      const stored = readRoster(userId).map((chat) => (chat.id === id ? { ...chat, title, username: nick || null } : chat));
      writeRoster(userId, stored);
    }
    try {
      await api.renameChat(id, title, nick || "");
    } catch {
      renamed.current.delete(id);
      setProfileError(t.errNickTaken);
      void refreshChats();
    }
  }

  function logout() {
    void api.logout().catch(() => undefined);
    saveSession(null);
    setSession(null);
    setChats([]);
    setMessages([]);
    activeChatRef.current = null;
    setActiveId(null);
    publishUrl("/", "replace");
  }

  async function saveProfile() {
    const nextName = sanitizeDisplayName(name);
    if (!nextName) return;
    const nick = sanitizeUsername(username);
    if (username.trim() && nick === null) {
      setProfileError(t.errNick);
      return;
    }
    setProfileError(null);
    setProfileSaved(false);
    setProfileBusy(true);
    try {
      const user = await api.patchMe({
        display_name: nextName,
        username: nick || "",
        bio,
        birth_date: birth,
        address,
        username_hidden: hideNick,
      });
      if (session) {
        const next = { ...session, user };
        saveSession(next);
        setSession(next);
      }
      setProfileSaved(true);
      window.setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setProfileError(
        /username taken|conflict/i.test(msg) ? t.errNickTaken : /birth/i.test(msg) ? t.errBirth : t.errLogin,
      );
    } finally {
      setProfileBusy(false);
    }
  }

  showChatRef.current = showChat;
  selectChatRef.current = selectChat;

  useEffect(() => {
    if (!activeId) return;
    const fresh = chats.find((chat) => chat.id === activeId);
    if (!fresh) return;
    activeChatRef.current = fresh;
    if (!ready || !session || bootRef.current || pendingUrl.current || nickFlight.current) return;
    const want = pathForChat(fresh);
    if (!pathsEqual(window.location.pathname || "/", want)) {
      pendingUrl.current = want;
      router.replace(want, { scroll: false });
    }
  }, [chats, activeId, ready, session, router]);

  useEffect(() => {
    if (!ready || !session) return;
    if (pendingUrl.current) {
      if (pathsEqual(pathname || "/", pendingUrl.current)) pendingUrl.current = null;
      bootRef.current = false;
      return;
    }
    const nick = slugFromPath(pathname);
    if (!nick && pathname.startsWith("/cont/")) {
      pendingUrl.current = "/";
      routerRef.current.replace("/", { scroll: false });
      return;
    }
    const isBoot = bootRef.current;
    bootRef.current = false;
    let cancel = false;
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
    }, 0);
    const cancelled = () => cancel;

    async function openNick(name: string) {
      const flight = `${name}:${Date.now()}`;
      if (nickFlight.current?.startsWith(`${name}:`)) return;
      nickFlight.current = flight;
      try {
        const have =
          chatsRef.current.find((chat) => chatMatchesSlug(chat, name)) ||
          [...pinnedChats.current.values()].find((chat) => chatMatchesSlug(chat, name));
        let chat = have;
        if (!chat) {
          const found = await api.resolve(name);
          if (cancelled() || nickFlight.current !== flight) return;
          if (found.chat) chat = found.chat;
          else if (found.user) {
            chat = await api.direct(found.user.id);
            if (cancelled() || nickFlight.current !== flight) return;
          } else {
            pendingUrl.current = "/";
            routerRef.current.replace("/", { scroll: false });
            return;
          }
        }
        if (cancelled() || nickFlight.current !== flight || !chat) return;
        showChatRef.current(chat);
        selectChatRef.current(chat.id, chat);
      } catch {
        if (!cancelled() && nickFlight.current === flight) {
          pendingUrl.current = "/";
          routerRef.current.replace("/", { scroll: false });
        }
      } finally {
        if (nickFlight.current === flight) nickFlight.current = null;
      }
    }

    if (isBoot) {
      if (nick && !chatMatchesSlug(activeChatRef.current, nick)) void openNick(nick);
      else {
        const chat = activeChatRef.current;
        const want = pathForChat(chat);
        if (chat && chat.id === activeIdRef.current && !pathsEqual(want, pathname || "/")) {
          pendingUrl.current = want;
          routerRef.current.replace(want, { scroll: false });
        }
      }
    } else if (!nick) {
      if (activeIdRef.current) {
        activeChatRef.current = null;
        setActiveId(null);
      }
    } else if (!chatMatchesSlug(activeChatRef.current, nick)) {
      void openNick(nick);
    }

    return () => {
      cancel = true;
      window.clearTimeout(timer);
      nickFlight.current = null;
      if (isBoot && !settled) bootRef.current = true;
    };
  }, [pathname, ready, session]);

  useEffect(() => {
    document.documentElement.lang = lang === "ky" ? "ky" : "ru";
  }, [lang]);

  useEffect(() => {
    if (!newOpen && !chatMenu && !rename && !pendingDelete.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingDelete.length) setPendingDelete([]);
      else if (rename) setRename(null);
      else if (chatMenu) setChatMenu(null);
      else setNewOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newOpen, chatMenu, rename, pendingDelete.length]);

  useEffect(() => {
    if (!session?.access_token) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    enableWebPush(lang);
  }, [session?.access_token, lang]);

  const isTyping = !!(activeId && (typing[activeId] || 0) > typingNow);

  useEffect(() => {
    const pending = Object.values(typing).filter((until) => until > typingNow);
    if (pending.length === 0) return;
    const nextAt = Math.min(...pending);
    const id = window.setTimeout(() => setTypingNow(Date.now()), Math.max(0, nextAt - Date.now()) + 20);
    return () => window.clearTimeout(id);
  }, [typing, typingNow]);

  if (!ready) return <div className="min-h-full bg-bg" />;
  if (!session) {
    return (
      <div className="min-h-dvh bg-bg">
        <PhoneAuth
          t={t}
          lang={lang}
          onLang={chooseLang}
          onSession={(s) => {
            setSession(s);
            setName(s.user.display_name);
            setUsername(s.user.username || "");
            setBio(s.user.bio || "");
            if (!needsDisplayName(s.user.display_name) && shouldAskNotify()) setNotifyAsk(true);
          }}
        />
      </div>
    );
  }
  if (needsDisplayName(session.user.display_name)) {
    return (
      <div className="min-h-dvh bg-bg">
        <NameOnboarding
          t={t}
          lang={lang}
          onLang={chooseLang}
          onDone={(user) => {
            const next = { ...session, user };
            saveSession(next);
            setSession(next);
            setName(user.display_name);
            if (shouldAskNotify()) setNotifyAsk(true);
          }}
        />
      </div>
    );
  }

  function callStatusLabel(status: string) {
    if (status === "ended") return t.callStatusEnded;
    if (status === "missed") return t.callStatusMissed;
    if (status === "declined") return t.callStatusDeclined;
    if (status === "active") return t.callStatusActive;
    if (status === "ringing") return t.callStatusRinging;
    return status;
  }

  function attachEmail(user: User) {
    if (!session) return;
    const next = { ...session, user };
    saveSession(next);
    setSession(next);
    setEmailEdit(false);
  }

  // A phone-only account must confirm an email before using the app: it is the way back in.
  if (!session.user.email) {
    return (
      <div className="min-h-dvh overflow-y-auto bg-bg px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 sm:mb-10">
            <BrandMark alt="" className="mb-5 h-14 w-14 sm:h-16 sm:w-16" />
            <h1 className="text-[28px] font-bold tracking-tight text-ink sm:text-[32px]">{t.emailAttachTitle}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{t.emailAttachSubtitle}</p>
          </div>
          <EmailAttach t={t} onDone={attachEmail} />
          <button type="button" onClick={logout} className="mt-6 h-11 w-full rounded-2xl text-sm font-semibold text-muted hover:bg-elevated">
            {t.logout}
          </button>
        </div>
      </div>
    );
  }

  const navBtn = (id: Tab, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(id);
        if (id !== "chats") leaveChat();
      }}
      aria-label={label}
      aria-current={tab === id ? "page" : undefined}
      className={`flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors ${
        tab === id ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const listPanel = (
    <div className="flex h-full min-w-0 flex-col border-r border-line bg-bg">
      <div className="flex min-h-14 items-center justify-between gap-2 px-4 pt-2 pb-2 sm:pt-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BrandMark alt="" className="h-8 w-8 shrink-0 sm:h-9 sm:w-9 md:hidden" />
          <h1 className="truncate text-[22px] font-bold tracking-tight text-ink sm:text-[28px]">
            {tab === "chats" ? t.app : tab === "calls" ? t.tabCalls : tab === "contacts" ? t.tabContacts : t.tabMore}
          </h1>
        </div>
        {tab === "chats" ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setPicking((on) => !on);
                setSelectedIds([]);
              }}
              className="shrink-0 rounded-full px-2.5 py-1.5 text-sm font-semibold text-accent hover:bg-elevated"
            >
              {picking ? t.cancel : t.selectChats}
            </button>
            <button
              type="button"
              onClick={() => {
                setPickerQ("");
                setPicked([]);
                setNewOpen("direct");
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-elevated"
              aria-label={t.newChat}
            >
              <Pencil size={18} />
            </button>
          </div>
        ) : null}
      </div>

      {tab === "chats" || tab === "contacts" ? (
        <div className="px-4 pb-3">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 focus-within:ring-1 focus-within:ring-accent/60">
            <Search size={16} className="shrink-0 text-muted" />
            <input
              type="search"
              value={tab === "chats" ? query : contactQ}
              onChange={(e) => (tab === "chats" ? setQuery(e.target.value) : setContactQ(e.target.value))}
              placeholder={tab === "contacts" ? t.searchPeople : t.search}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        </div>
      ) : null}

      {tab === "chats" ? (
        <div className="flex flex-wrap gap-1 px-4 pb-2">
          {picking ? (
            <button
              type="button"
              onClick={() => setSelectedIds(chats.map((chat) => chat.id))}
              className="h-8 rounded-full px-3 text-sm font-semibold text-accent"
            >
              {t.selectAll}
            </button>
          ) : null}
          {(["all", "direct", "group"] as Seg[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeg(s)}
              className={`h-8 rounded-full px-3 text-sm font-semibold transition-colors ${
                seg === s ? "bg-accent text-white" : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {s === "all" ? t.segAll : s === "direct" ? t.segDirect : t.segGroups}
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "chats" && chats.length === 0 ? (
          <p className="px-4 pt-16 text-center text-base text-muted">{t.emptyChats}</p>
        ) : null}
        {tab === "chats"
          ? chats.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (picking) {
                    setSelectedIds((prev) => (prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]));
                    return;
                  }
                  selectChat(c.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (picking) {
                      setSelectedIds((prev) => (prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]));
                    } else selectChat(c.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setChatMenu(c);
                }}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-[10px] text-left outline-none transition-colors focus-visible:bg-elevated ${
                  activeId === c.id ? "bg-elevated" : "hover:bg-elevated/60"
                }`}
              >
                {picking ? (
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      selectedIds.includes(c.id) ? "border-accent bg-accent text-white" : "border-muted"
                    }`}
                  >
                    {selectedIds.includes(c.id) ? <Check size={14} /> : null}
                  </span>
                ) : null}
                <Avatar name={c.title} src={c.avatar_url} size={56} online={c.peer?.online} />
                <div className="min-w-0 flex-1 border-b border-line pb-2">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">{c.title}</p>
                    <span className="shrink-0 text-[12px] font-medium tabular-nums text-muted">{fmtTime(c.updated_at)}</span>
                    <button
                      type="button"
                      aria-label={t.edit}
                      onClick={(e) => {
                        e.stopPropagation();
                        setChatMenu(c);
                      }}
                      className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-ink"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-muted">
                      {(typing[c.id] || 0) > typingNow
                        ? t.typing
                        : lastPreview(c.last_message, t, me, c.type === "group")}
                    </p>
                    {c.unread_count > 0 ? (
                      <span
                        className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums text-white ${
                          c.muted_until && new Date(c.muted_until).getTime() > Date.now() ? "bg-muted/60" : "bg-accent"
                        }`}
                      >
                        {c.unread_count > 99 ? "99+" : c.unread_count}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          : null}

        {tab === "calls" && calls.length === 0 ? (
          <p className="px-4 pt-16 text-center text-base text-muted">{t.emptyCalls}</p>
        ) : null}
        {tab === "calls"
          ? calls.map((c) => {
              const row = chats.find((chat) => chat.id === c.chat_id);
              const missed = c.status === "missed" || c.status === "declined";
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!row}
                  onClick={() => row && selectChat(row.id, row)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-elevated/60 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {row ? (
                    <Avatar name={row.title} src={row.avatar_url} size={48} />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-elevated text-accent">
                      {c.kind === "video" ? <Video size={18} /> : <Phone size={18} />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 border-b border-line pb-2.5">
                    <p className={`truncate font-semibold ${missed ? "text-danger" : "text-ink"}`}>
                      {row?.title || (c.kind === "video" ? t.video : t.audio)}
                    </p>
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      {c.kind === "video" ? <Video size={13} className="shrink-0" /> : <Phone size={13} className="shrink-0" />}
                      <span className="truncate">
                        {callStatusLabel(c.status)} · {fmtTime(c.started_at)}
                      </span>
                    </p>
                  </div>
                </button>
              );
            })
          : null}

        {tab === "contacts" ? (
          <div className="px-3">
            {contactQ.trim() ? (
              <PeopleResults
                t={t}
                query={contactQ}
                items={contactsSearch.items}
                status={contactsSearch.status}
                error={contactsSearch.error}
                onPick={(u) => void openDirect(u.id)}
              />
            ) : syncedPeople.length > 0 ? (
              syncedPeople.map((u) => (
                <PersonRow key={u.id} user={u} onClick={() => void openDirect(u.id)} />
              ))
            ) : (
              <div className="px-1 py-10 text-center">
                <p className="text-sm text-muted">{contactsSynced ? t.emptySynced : t.emptyContacts}</p>
                <p className="mt-3 text-xs leading-5 text-muted">{t.syncHint}</p>
              </div>
            )}
          </div>
        ) : null}

        {tab === "more" ? (
          <div className="px-4 py-2">
            <div className="flex items-center gap-3 rounded-2xl bg-elevated p-4">
              <Avatar name={session.user.display_name} src={session.user.avatar_url} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{session.user.display_name}</p>
                <p className="truncate text-sm text-muted">
                  {[
                    session.user.username ? `@${session.user.username}` : "",
                    formatPhone(session.user.phone),
                    session.user.email || "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <label className="mt-5 block text-xs font-medium text-muted">{t.name}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl bg-elevated px-3 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <label className="mt-3 block text-xs font-medium text-muted">{t.nick}</label>
            <div className="mt-1 flex h-11 items-center rounded-xl bg-elevated px-3 focus-within:ring-2 focus-within:ring-accent">
              <span className="text-muted">@</span>
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.replace(/^@/, ""));
                  setProfileError(null);
                }}
                placeholder="nickname"
                className="h-full w-full bg-transparent text-ink outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-muted">{t.nickHint}</p>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={hideNick}
                onChange={(e) => setHideNick(e.target.checked)}
                className="h-4 w-4 shrink-0 cursor-pointer rounded"
              />
              {t.hideNick}
            </label>
            <p className="mt-1 text-xs text-muted">{t.hideNickHint}</p>
            <label className="mt-3 block text-xs font-medium text-muted">{t.bio}</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-xl bg-elevated px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <label className="mt-3 block text-xs font-medium text-muted">{t.birth}</label>
            <input
              type="date"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl bg-elevated px-3 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <label className="mt-3 block text-xs font-medium text-muted">{t.address}</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl bg-elevated px-3 text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <label className="mt-3 block text-xs font-medium text-muted">{t.emailField}</label>
            {emailEdit ? (
              <div className="mt-1">
                <EmailAttach t={t} initial="" onDone={attachEmail} onCancel={() => setEmailEdit(false)} />
              </div>
            ) : (
              <div className="mt-1 flex h-11 items-center gap-2 rounded-xl bg-elevated pr-1 pl-3">
                <span className={`min-w-0 flex-1 truncate ${session.user.email ? "text-ink" : "text-muted"}`}>
                  {session.user.email || t.emailMissing}
                </span>
                <button
                  type="button"
                  onClick={() => setEmailEdit(true)}
                  className="h-9 shrink-0 rounded-lg px-3 text-sm font-semibold text-accent hover:bg-bg"
                >
                  {t.changeEmail}
                </button>
              </div>
            )}
            {profileError ? <p className="mt-2 text-xs font-medium text-danger">{profileError}</p> : null}
            <button
              type="button"
              disabled={profileBusy || !sanitizeDisplayName(name)}
              onClick={() => void saveProfile()}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white transition-opacity disabled:opacity-60"
            >
              {profileSaved ? (
                <>
                  <Check size={16} /> {t.saved}
                </>
              ) : (
                t.save
              )}
            </button>
            <div className="mt-6 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted">
                <Languages size={16} /> {t.language}
              </span>
              <div className="flex rounded-full bg-elevated p-1">
                {(["ru", "ky"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => chooseLang(l)}
                    aria-pressed={lang === l}
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${lang === l ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="mt-6 mb-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-elevated font-semibold text-danger"
            >
              <LogOut size={16} /> {t.logout}
            </button>
          </div>
        ) : null}
      </div>
      {picking && tab === "chats" ? (
        <div className="border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => askDelete(selectedIds)}
            className="h-11 w-full rounded-xl bg-danger font-semibold text-white disabled:opacity-40"
          >
            {t.deleteChat}
            {selectedIds.length ? ` · ${selectedIds.length}` : ""}
          </button>
        </div>
      ) : null}
    </div>
  );

  const conversation = active && me ? (
    <ChatPane
      key={active.id}
      t={t}
      lang={lang}
      me={me}
      chat={active}
      messages={messages}
      setMessages={setMessages}
      cursor={cursor}
      setCursor={setCursor}
      isTyping={isTyping}
      rosterTick={rosterTick}
      onBack={() => leaveChat()}
      onRefreshChats={() => void refreshChats()}
      onOpenDirect={(userId) => void openDirect(userId)}
      onOpenChat={(id) => void openKnown(id)}
      onMuted={(chatId, mutedUntil) => paintChat(chatId, (chat) => ({ ...chat, muted_until: mutedUntil }))}
      onCall={(kind) => void beginCall(active.id, kind)}
      onLocal={(last) => {
        const chatId = activeIdRef.current;
        if (!chatId) return;
        paintChat(chatId, (chat) => {
          if (!last) return { ...chat, last_message: null, unread_count: 0 };
          return {
            ...chat,
            last_message: last,
            unread_count: 0,
            updated_at: last.created_at > chat.updated_at ? last.created_at : chat.updated_at,
          };
        });
      }}
      onMeta={(patch) => {
        const chatId = activeIdRef.current;
        if (!chatId) return;
        paintChat(chatId, (chat) => ({ ...chat, ...patch }));
      }}
      onHide={() => {
        const chatId = activeIdRef.current;
        if (chatId) hideChats([chatId]);
      }}
    />
  ) : (
    <div className="hidden flex-1 items-center justify-center bg-bg text-muted md:flex">
      <div className="text-center">
        <BrandMark alt="" className="mx-auto mb-3 h-16 w-16" />
        <p className="text-lg font-semibold text-ink">{t.pickChat}</p>
      </div>
    </div>
  );

  const incomingChat = incoming ? chats.find((c) => c.id === incoming.chat_id) : null;
  const activeChat = activeCall ? chats.find((c) => c.id === activeCall.chat_id) : null;

  return (
    <div
      className="flex h-[100dvh] bg-bg text-ink"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <aside className="hidden w-16 flex-col items-center gap-2 border-r border-line bg-elevated py-4 md:flex">
        <BrandMark className="mb-4 h-10 w-10" />
        {navBtn("chats", <MessageSquare size={20} />, t.tabChats)}
        {navBtn("calls", <Phone size={20} />, t.tabCalls)}
        {navBtn("contacts", <Users size={20} />, t.tabContacts)}
        {navBtn("more", <Settings size={20} />, t.tabMore)}
      </aside>

      <div className={`w-full md:w-[340px] md:shrink-0 ${activeId ? "hidden md:flex md:flex-col" : "flex flex-col"}`}>
        {listPanel}
        <nav className="flex border-t border-line bg-elevated py-1 md:hidden">
          <div className="flex w-full justify-around">
            {navBtn("chats", <MessageSquare size={20} />, t.tabChats)}
            {navBtn("calls", <Phone size={20} />, t.tabCalls)}
            {navBtn("contacts", <Users size={20} />, t.tabContacts)}
            {navBtn("more", <Settings size={20} />, t.tabMore)}
          </div>
        </nav>
      </div>

      <div className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1`}>{conversation}</div>

      {newOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 md:items-center"
          onClick={() => setNewOpen(null)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-elevated p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:rounded-2xl md:pb-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{newOpen === "group" ? t.newGroup : t.newChat}</h2>
              <button
                type="button"
                onClick={() => setNewOpen(null)}
                aria-label={t.cancel}
                className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setNewOpen("direct")}
                className={`h-8 rounded-full px-3 text-sm font-semibold ${newOpen === "direct" ? "bg-accent text-white" : "bg-bg text-muted hover:text-ink"}`}
              >
                {t.newChat}
              </button>
              <button
                type="button"
                onClick={() => setNewOpen("group")}
                className={`h-8 rounded-full px-3 text-sm font-semibold ${newOpen === "group" ? "bg-accent text-white" : "bg-bg text-muted hover:text-ink"}`}
              >
                {t.newGroup}
              </button>
            </div>
            {newOpen === "group" ? (
              <>
                <input
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder={t.groupTitle}
                  className="mb-3 h-11 w-full rounded-xl bg-bg px-3 text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
                />
                <input
                  value={groupNick}
                  onChange={(e) => {
                    setGroupNick(e.target.value.replace(/^@/, ""));
                    setProfileError(null);
                  }}
                  placeholder={t.groupNick}
                  className="mb-3 h-11 w-full rounded-xl bg-bg px-3 text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
                />
                {profileError ? <p className="mb-3 text-xs font-medium text-danger">{profileError}</p> : null}
              </>
            ) : null}
            <label className="mb-3 flex h-10 items-center gap-2 rounded-xl bg-bg px-3 focus-within:ring-1 focus-within:ring-accent/60">
              <Search size={16} className="shrink-0 text-muted" />
              <input
                value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)}
                placeholder={t.searchPeople}
                autoFocus
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
            </label>
            <div className="max-h-[min(16rem,45dvh)] overflow-y-auto">
              <PeopleResults
                t={t}
                query={pickerQ}
                items={pickerSearch.items}
                status={pickerSearch.status}
                error={pickerSearch.error}
                picked={picked}
                selectable={newOpen === "group"}
                onPick={(u) => {
                  if (newOpen === "direct") void openDirect(u.id);
                  else setPicked((prev) => (prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]));
                }}
              />
            </div>
            {newOpen === "group" ? (
              <button
                type="button"
                disabled={!groupTitle.trim()}
                onClick={() => void createGroup()}
                className="mt-4 h-11 w-full rounded-xl bg-accent font-semibold text-white disabled:opacity-40"
              >
                {t.create}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingDelete.length ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:items-center" onClick={() => setPendingDelete([])}>
          <div className="w-full max-w-md rounded-2xl bg-elevated p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold text-ink">
              {pendingDelete.length > 1
                ? t.confirmHideMany
                : chats.find((chat) => chat.id === pendingDelete[0])?.type === "group"
                  ? t.confirmLeaveList
                  : t.confirmHideChat}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete([])}
                className="h-11 flex-1 rounded-xl bg-bg font-semibold text-ink"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => hideChats(pendingDelete)}
                className="h-11 flex-1 rounded-xl bg-danger font-semibold text-white"
              >
                {t.delete}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {chatMenu ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:items-center" onClick={() => setChatMenu(null)}>
          <div className="w-full max-w-md rounded-2xl bg-elevated p-2" onClick={(e) => e.stopPropagation()}>
            <p className="truncate px-3 py-2 font-semibold text-ink">{chatMenu.title}</p>
            {chatMenu.type === "group" ? (
              <button
                type="button"
                onClick={() => {
                  setRenameTitle(chatMenu.title);
                  setRenameNick(chatMenu.username || "");
                  setProfileError(null);
                  setRename(chatMenu);
                  setChatMenu(null);
                }}
                className="flex h-11 w-full items-center rounded-xl px-3 text-left font-medium text-ink hover:bg-bg"
              >
                {t.rename}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => askDelete([chatMenu.id])}
              className="flex h-11 w-full items-center rounded-xl px-3 text-left font-medium text-danger hover:bg-bg"
            >
              {t.deleteChat}
            </button>
          </div>
        </div>
      ) : null}

      {rename ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:items-center" onClick={() => setRename(null)}>
          <div className="w-full max-w-md rounded-2xl bg-elevated p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 font-semibold text-ink">{t.rename}</p>
            <input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder={t.newTitle}
              className="mb-3 h-11 w-full rounded-xl bg-bg px-3 text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
            />
            <input
              value={renameNick}
              onChange={(e) => {
                setRenameNick(e.target.value.replace(/^@/, ""));
                setProfileError(null);
              }}
              placeholder={t.groupNick}
              className="mb-3 h-11 w-full rounded-xl bg-bg px-3 text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
            />
            {profileError ? <p className="mb-3 text-xs font-medium text-danger">{profileError}</p> : null}
            <button
              type="button"
              disabled={!renameTitle.trim()}
              onClick={() => void saveRename()}
              className="h-11 w-full rounded-xl bg-accent font-semibold text-white disabled:opacity-40"
            >
              {t.save}
            </button>
          </div>
        </div>
      ) : null}

      {notifyAsk && !pendingCall ? (
        <PermitToast
          title={t.allowNotify}
          body={t.needNotify}
          allowLabel={t.allow}
          cancelLabel={t.notNow}
          onAllow={() => {
            unlockSounds();
            flushSync(() => setNotifyAsk(false));
            if (typeof Notification === "undefined") {
              rememberNotify("denied");
              return;
            }
            void Notification.requestPermission()
              .then((permission) => {
                rememberNotify(permission === "granted" ? "granted" : permission === "denied" ? "denied" : "skip");
                if (permission === "granted") enableWebPush(lang);
              })
              .catch(() => rememberNotify("skip"));
          }}
          onCancel={() => {
            rememberNotify("skip");
            setNotifyAsk(false);
          }}
        />
      ) : null}
      {pendingCall ? (
        <PermitToast
          title={pendingCall.step === "camera" ? t.allowCam : t.allowMic}
          body={pendingCall.step === "camera" ? t.needCamCall : t.needMicCall}
          allowLabel={t.allow}
          cancelLabel={t.notNow}
          onAllow={() => void allowPending()}
          onCancel={cancelPermit}
        />
      ) : null}
      {callError ? (
        <div className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4" style={{ top: "max(1rem, env(safe-area-inset-top))" }}>
          <p className="rounded-2xl bg-elevated px-4 py-3 text-center text-sm text-ink shadow-lg">{callError}</p>
        </div>
      ) : null}
      {callBusy && !pendingCall && !activeCall ? (
        <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          <p className="rounded-2xl bg-elevated px-4 py-3 text-center text-sm text-ink shadow-lg">{t.callDialing}</p>
        </div>
      ) : null}

      {incoming && !callBusy ? (
        <IncomingCall
          title={incomingChat?.title || (incoming.kind === "video" ? t.incomingVideo : t.incomingAudio)}
          avatarUrl={incomingChat?.avatar_url}
          kind={incoming.kind === "video" ? "video" : "audio"}
          t={t}
          busy={callBusy || pendingCall !== null}
          onDecline={() => {
            cancelPermit();
            void api.rejectCall(incoming.id);
            setIncoming(null);
          }}
          onAnswer={() => acceptIncoming()}
        />
      ) : null}

      {activeCall && callMedia ? (
        <CallRoom
          key={activeCall.id}
          call={activeCall}
          media={callMedia}
          creds={callCreds}
          title={activeChat?.title || t.inCall}
          avatarUrl={activeChat?.avatar_url}
          t={t}
          onHangup={() => closeCall(activeCall.id)}
          onConnectFailed={(code) => {
            if (code === "camera") forgetMedia("camera");
            else if (code === "mic") forgetMedia("mic");
            showCallError(code === "camera" ? t.camDenied : code === "mic" ? t.micDenied : t.callFailed);
            closeCall(activeCall.id);
          }}
        />
      ) : null}
    </div>
  );
}
