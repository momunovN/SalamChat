"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Languages,
  LogOut,
  MessageSquare,
  Pencil,
  Phone,
  PhoneOff,
  Search,
  Settings,
  Users,
  Video,
  X,
} from "lucide-react";
import { api, loadSession, saveSession } from "@/lib/api";
import { lastPreview } from "@/lib/chat";
import { dict, type Lang } from "@/lib/i18n";
import { needsDisplayName, sanitizeDisplayName, sanitizeUsername } from "@/lib/name";
import { formatPhone } from "@/lib/phone";
import type { Call, Chat, Envelope, Message, Session, User } from "@/lib/types";
import { Avatar } from "./Avatar";
import { CallRoom } from "./CallRoom";
import { ChatPane } from "./ChatPane";
import { NameOnboarding } from "./NameOnboarding";
import { PeopleResults, PersonRow, useUserSearch } from "./PeopleSearch";
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
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState<Lang>("ru");
  const t = dict[lang];

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
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [typingNow, setTypingNow] = useState(0);
  const [newOpen, setNewOpen] = useState<"direct" | "group" | null>(null);
  const [groupTitle, setGroupTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const activeIdRef = useRef<string | null>(null);
  const meRef = useRef<string | undefined>(undefined);

  const active = chats.find((c) => c.id === activeId) || null;
  const me = session?.user.id;

  useEffect(() => {
    activeIdRef.current = activeId;
    meRef.current = me;
  }, [activeId, me]);

  useEffect(() => {
    const s = loadSession();
    const stored = localStorage.getItem("tooapp.lang") || localStorage.getItem("samal.lang");
    queueMicrotask(() => {
      setSession(s);
      if (s?.user) {
        setName(s.user.display_name);
        setUsername(s.user.username || "");
        setBio(s.user.bio || "");
      }
      if (stored === "ru" || stored === "ky") setLang(stored);
      setReady(true);
    });
  }, []);

  const refreshChats = useCallback(async () => {
    const type = seg === "all" ? "" : seg;
    const r = await api.chats(query, type);
    setChats(r.items);
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
      setActiveId(null);
    };
    window.addEventListener("tooapp:auth-lost", onLost);
    return () => window.removeEventListener("tooapp:auth-lost", onLost);
  }, []);

  useEffect(() => {
    if (!session || !activeId) return;
    const chatId = activeId;
    let cancelled = false;
    void api
      .messages(chatId)
      .then((r) => {
        if (cancelled) return;
        const items = [...(r.items ?? [])].reverse();
        setMessages(items);
        setCursor(r.cursor ?? null);
        const incomingIds = items.filter((m) => m.author_id && m.author_id !== me).map((m) => m.id);
        if (incomingIds.length) void api.receipts(incomingIds, "read");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, activeId, me]);

  useEffect(() => {
    if (!session) return;
    const es = new EventSource(`/v1/stream?token=${encodeURIComponent(session.access_token)}`);
    es.onmessage = (ev) => {
      try {
        const env = JSON.parse(ev.data) as Envelope;
        const openId = activeIdRef.current;
        const myId = meRef.current;
        if (env.type === "message.created") {
          const msg = env.body as Message;
          setMessages((prev) => {
            if (!openId || msg.chat_id !== openId) return prev;
            if (prev.some((m) => m.id === msg.id || m.client_id === msg.client_id)) {
              return prev.map((m) => (m.client_id === msg.client_id ? msg : m));
            }
            return [...prev, msg];
          });
          void refreshChats();
          if (msg.chat_id === openId && msg.author_id !== myId) {
            void api.receipts([msg.id], "read");
          }
        }
        if (env.type === "message.updated") {
          const msg = env.body as Message;
          setMessages((prev) => {
            if (!openId || msg.chat_id !== openId) return prev;
            return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m));
          });
          void refreshChats();
        }
        if (env.type === "message.deleted") {
          const body = env.body as { id: string; chat_id: string };
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
        if (env.type === "receipt.upserted") {
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
          const call = env.body as Call;
          void api.calls().then((r) => setCalls(r.items ?? []));
          if (call.status === "ringing" && call.initiator_id !== myId) setIncoming(call);
          if (call.status === "ringing" && call.initiator_id === myId) setActiveCall(call);
          if (call.status === "active") {
            setIncoming(null);
            setActiveCall(call);
          }
          if (["ended", "missed", "declined"].includes(call.status)) {
            setIncoming(null);
            setActiveCall((c) => (c?.id === call.id ? null : c));
          }
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [session, refreshChats]);

  useEffect(() => {
    if (!session || tab !== "calls") return;
    void api.calls().then((r) => setCalls(r.items));
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

  async function beginCall(chatId: string, kind: "audio" | "video") {
    try {
      const call = await api.startCall(chatId, kind);
      setIncoming(null);
      setActiveCall(call);
    } catch {
      /* ignore */
    }
  }

  function selectChat(id: string) {
    if (id !== activeId) {
      setMessages([]);
      setCursor(null);
    }
    setActiveId(id);
    setTab("chats");
  }

  async function openDirect(userId: string) {
    const chat = await api.direct(userId);
    await refreshChats();
    selectChat(chat.id);
    setNewOpen(null);
  }

  async function createGroup() {
    if (!groupTitle.trim()) return;
    const chat = await api.group(groupTitle.trim(), picked);
    await refreshChats();
    selectChat(chat.id);
    setNewOpen(null);
    setGroupTitle("");
    setPicked([]);
  }

  function logout() {
    void api.logout().catch(() => undefined);
    saveSession(null);
    setSession(null);
    setChats([]);
    setMessages([]);
    setActiveId(null);
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
    try {
      const user = await api.patchMe({ display_name: nextName, ...(nick ? { username: nick } : {}), bio });
      if (session) {
        const next = { ...session, user };
        saveSession(next);
        setSession(next);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setProfileError(/username taken|conflict/i.test(msg) ? t.errNickTaken : t.errLogin);
    }
  }

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
      <div className="min-h-full bg-bg">
        <PhoneAuth
          t={t}
          onSession={(s) => {
            setSession(s);
            setName(s.user.display_name);
            setUsername(s.user.username || "");
            setBio(s.user.bio || "");
          }}
        />
      </div>
    );
  }
  if (needsDisplayName(session.user.display_name)) {
    return (
      <div className="min-h-full bg-bg">
        <NameOnboarding
          t={t}
          onDone={(user) => {
            const next = { ...session, user };
            saveSession(next);
            setSession(next);
            setName(user.display_name);
          }}
        />
      </div>
    );
  }

  const navBtn = (id: Tab, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(id);
        if (id !== "chats") setActiveId(null);
      }}
      className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition-colors ${
        tab === id ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const listPanel = (
    <div className="flex h-full min-w-0 flex-col border-r border-line bg-bg">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-[28px] font-bold tracking-tight text-ink">
          {tab === "chats" ? t.app : tab === "calls" ? t.tabCalls : tab === "contacts" ? t.tabContacts : t.tabMore}
        </h1>
        {tab === "chats" ? (
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
        ) : null}
      </div>

      {tab === "chats" || tab === "contacts" ? (
        <div className="px-4 pb-3">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-elevated px-3">
            <Search size={16} className="text-muted" />
            <input
              value={tab === "chats" ? query : contactQ}
              onChange={(e) => (tab === "chats" ? setQuery(e.target.value) : setContactQ(e.target.value))}
              placeholder={tab === "contacts" ? t.searchPeople : t.search}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
          </label>
        </div>
      ) : null}

      {tab === "chats" ? (
        <div className="flex gap-1 px-4 pb-2">
          {(["all", "direct", "group"] as Seg[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeg(s)}
              className={`h-8 rounded-full px-3 text-sm font-semibold transition-colors ${
                seg === s ? "bg-accent text-ink" : "text-muted hover:text-ink"
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
              <button
                key={c.id}
                type="button"
                onClick={() => selectChat(c.id)}
                className={`flex w-full items-center gap-3 px-4 py-[10px] text-left transition-colors ${
                  activeId === c.id ? "bg-elevated" : "hover:bg-elevated/60"
                }`}
              >
                <Avatar name={c.title} src={c.avatar_url} size={56} online={c.peer?.online} />
                <div className="min-w-0 flex-1 border-b border-line pb-2">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">{c.title}</p>
                    <span className="text-[12px] font-medium text-muted">{fmtTime(c.updated_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-muted">
                      {(typing[c.id] || 0) > typingNow
                        ? t.typing
                        : lastPreview(c.last_message, t, me, c.type === "group")}
                    </p>
                    {c.unread_count > 0 ? (
                      <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[12px] font-medium text-ink">
                        {c.unread_count}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))
          : null}

        {tab === "calls" && calls.length === 0 ? (
          <p className="px-4 pt-16 text-center text-base text-muted">{t.emptyCalls}</p>
        ) : null}
        {tab === "calls"
          ? calls.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-accent">
                  {c.kind === "video" ? <Video size={18} /> : <Phone size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{c.kind === "video" ? t.video : t.audio}</p>
                  <p className="text-sm text-muted">
                    {c.status} · {fmtTime(c.started_at)}
                  </p>
                </div>
              </div>
            ))
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
              <div>
                <p className="font-semibold text-ink">{session.user.display_name}</p>
                <p className="text-sm text-muted">
                  {session.user.username ? `@${session.user.username} · ` : ""}
                  {formatPhone(session.user.phone)}
                </p>
              </div>
            </div>
            <label className="mt-5 block text-xs font-medium text-muted">{t.name}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl bg-elevated px-3 text-ink outline-none"
            />
            <label className="mt-3 block text-xs font-medium text-muted">{t.nick}</label>
            <div className="mt-1 flex h-11 items-center rounded-xl bg-elevated px-3">
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
            <label className="mt-3 block text-xs font-medium text-muted">{t.bio}</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-xl bg-elevated px-3 py-2 text-ink outline-none"
            />
            {profileError ? <p className="mt-2 text-xs font-medium text-danger">{profileError}</p> : null}
            <button
              type="button"
              onClick={() => void saveProfile()}
              className="mt-3 h-11 w-full rounded-xl bg-accent font-semibold text-white"
            >
              {t.save}
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
                    onClick={() => {
                      setLang(l);
                      localStorage.setItem("tooapp.lang", l);
                    }}
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${lang === l ? "bg-accent text-ink" : "text-muted"}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="mt-6 flex items-center gap-2 text-danger"
            >
              <LogOut size={16} /> {t.logout}
            </button>
            <p className="mt-8 text-xs text-muted">{t.apiHint}</p>
          </div>
        ) : null}
      </div>
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
      onBack={() => setActiveId(null)}
      onRefreshChats={() => void refreshChats()}
      onOpenDirect={(userId) => void openDirect(userId)}
      onCall={(kind) => void beginCall(active.id, kind)}
    />
  ) : (
    <div className="hidden flex-1 items-center justify-center bg-bg text-muted md:flex">
      <div className="text-center">
        <MessageSquare className="mx-auto mb-3 text-accent" size={36} />
        <p className="text-lg font-semibold text-ink">{t.pickChat}</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-bg text-ink">
      <aside className="hidden w-16 flex-col items-center gap-2 border-r border-line bg-elevated py-4 md:flex">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-bold">T</div>
        {navBtn("chats", <MessageSquare size={20} />, t.tabChats)}
        {navBtn("calls", <Phone size={20} />, t.tabCalls)}
        {navBtn("contacts", <Users size={20} />, t.tabContacts)}
        {navBtn("more", <Settings size={20} />, t.tabMore)}
      </aside>

      <div className={`w-full md:w-[340px] md:shrink-0 ${activeId ? "hidden md:flex md:flex-col" : "flex flex-col"}`}>
        {listPanel}
        <nav className="flex border-t border-line bg-elevated py-1.5 md:hidden">
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
            className="w-full max-w-md rounded-t-2xl bg-elevated p-5 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{newOpen === "group" ? t.newGroup : t.newChat}</h2>
              <button type="button" onClick={() => setNewOpen(null)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setNewOpen("direct")}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${newOpen === "direct" ? "bg-accent" : "bg-bg text-muted"}`}
              >
                {t.newChat}
              </button>
              <button
                type="button"
                onClick={() => setNewOpen("group")}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${newOpen === "group" ? "bg-accent" : "bg-bg text-muted"}`}
              >
                {t.newGroup}
              </button>
            </div>
            {newOpen === "group" ? (
              <input
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder={t.groupTitle}
                className="mb-3 h-11 w-full rounded-xl bg-bg px-3 text-ink outline-none"
              />
            ) : null}
            <label className="mb-3 flex h-10 items-center gap-2 rounded-xl bg-bg px-3">
              <Search size={16} className="text-muted" />
              <input
                value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)}
                placeholder={t.searchPeople}
                autoFocus
                className="w-full bg-transparent text-sm outline-none"
              />
            </label>
            <div className="max-h-64 overflow-y-auto">
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
                onClick={() => void createGroup()}
                className="mt-4 h-11 w-full rounded-xl bg-accent font-semibold"
              >
                {t.create}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {incoming ? (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-bg/95">
          <p className="text-[28px] font-bold">{incoming.kind === "video" ? t.incomingVideo : t.incomingAudio}</p>
          <p className="mt-2 text-muted">{t.inCall}</p>
          <div className="mt-10 flex gap-12">
            <button
              type="button"
              onClick={() => {
                void api.rejectCall(incoming.id);
                setIncoming(null);
              }}
              className="flex flex-col items-center gap-2"
            >
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-danger text-white">
                <PhoneOff size={28} />
              </span>
              <span className="text-xs text-muted">{t.decline}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void api.answerCall(incoming.id).then((call) => {
                  setIncoming(null);
                  setActiveCall(call);
                });
              }}
              className="flex flex-col items-center gap-2"
            >
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-success text-white">
                <Phone size={28} />
              </span>
              <span className="text-xs text-muted">{t.answer}</span>
            </button>
          </div>
        </div>
      ) : null}

      {activeCall ? (
        <CallRoom
          key={activeCall.id}
          call={activeCall}
          title={chats.find((c) => c.id === activeCall.chat_id)?.title || t.inCall}
          t={t}
          onHangup={() => {
            void api.hangupCall(activeCall.id);
            setActiveCall(null);
          }}
        />
      ) : null}
    </div>
  );
}
