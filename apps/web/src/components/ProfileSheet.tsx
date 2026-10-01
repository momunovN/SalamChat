"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/chat";
import type { Dict, Lang } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";
import type { ProfileLibrary, User } from "@/lib/types";
import { Avatar } from "./Avatar";

type Tab = "media" | "links" | "voice" | "groups";

const emptyLib: ProfileLibrary = { media: [], links: [], voice: [], groups: [] };

function formatBirth(iso: string, lang: Lang) {
  const day = iso.slice(0, 10);
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(lang === "ky" ? "ky-KG" : "ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function ProfileSheet({
  userId,
  seed,
  t,
  lang = "ru",
  self = false,
  onWrite,
  onMuted,
  onOpenChat,
  onClose,
}: {
  userId: string;
  seed?: User | null;
  t: Dict;
  lang?: Lang;
  self?: boolean;
  onWrite?: () => void;
  onMuted?: (chatId: string, mutedUntil: string | null) => void;
  onOpenChat?: (chatId: string) => void;
  onClose: () => void;
}) {
  const [user, setUser] = useState<User | null>(seed && seed.id === userId ? seed : null);
  const [fail, setFail] = useState(false);
  const [tab, setTab] = useState<Tab>("media");
  const [lib, setLib] = useState<ProfileLibrary>(emptyLib);
  const [libReady, setLibReady] = useState(false);
  const [notes, setNotes] = useState(true);
  const [noteBusy, setNoteBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    api
      .user(userId)
      .then((next) => {
        if (gone) return;
        setUser(next);
        if (typeof next.notifications === "boolean") setNotes(next.notifications);
      })
      .catch(() => {
        if (!gone) setFail(true);
      });
    api
      .library(userId)
      .then((next) => {
        if (gone) return;
        setLib(next);
        setLibReady(true);
      })
      .catch(() => {
        if (!gone) setLibReady(true);
      });
    return () => {
      gone = true;
    };
  }, [userId]);
  const name = user?.display_name || seed?.display_name || "";
  const nick = user?.username || (!user ? seed?.username : "");
  const phone = formatPhone((user?.phone || "").trim());
  const bio = (user?.bio || "").trim();
  const birth = (user?.birth_date || "").trim();
  const address = (user?.address || "").trim();
  const online = !!user?.online;
  async function toggleNotes() {
    if (noteBusy || self) return;
    const next = !notes;
    setNotes(next);
    setNoteBusy(true);
    try {
      const saved = await api.setNotifications(userId, next);
      setNotes(saved.enabled);
      onMuted?.(saved.chat_id, saved.muted_until);
    } catch {
      setNotes(!next);
    } finally {
      setNoteBusy(false);
    }
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: "media", label: t.tabMedia },
    { id: "links", label: t.tabLinks },
    { id: "voice", label: t.tabVoice },
    { id: "groups", label: t.tabGroups },
  ];
  const empty =
    tab === "media" ? t.emptyMedia : tab === "links" ? t.emptyLinks : tab === "voice" ? t.emptyVoice : t.emptyGroups;
  const count =
    tab === "media" ? lib.media.length : tab === "links" ? lib.links.length : tab === "voice" ? lib.voice.length : lib.groups.length;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-elevated sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-bg text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col items-center text-center">
            <Avatar name={name || "?"} src={user?.avatar_url || seed?.avatar_url} size={96} online={online} />
            {name ? <h2 className="mt-3 text-xl font-semibold text-ink">{name}</h2> : null}
            {nick ? <p className="text-sm text-accent">@{nick}</p> : null}
            {online || user?.last_seen_at ? (
              <p className={`mt-1 text-sm ${online ? "text-success" : "text-muted"}`}>{online ? t.online : t.lastSeen}</p>
            ) : null}
          </div>
          <div className="mt-5 space-y-3 text-left">
            {phone ? (
              <div>
                <p className="text-xs text-muted">{t.phone}</p>
                <p className="text-sm text-ink">{phone}</p>
              </div>
            ) : null}
            {bio ? (
              <div>
                <p className="text-xs text-muted">{t.bio}</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{bio}</p>
              </div>
            ) : null}
            {birth ? (
              <div>
                <p className="text-xs text-muted">{t.birth}</p>
                <p className="text-sm text-ink">{formatBirth(birth, lang)}</p>
              </div>
            ) : null}
            {address ? (
              <div>
                <p className="text-xs text-muted">{t.address}</p>
                <p className="text-sm text-ink">{address}</p>
              </div>
            ) : null}
            {!self ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ink">{t.notifications}</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notes}
                  disabled={noteBusy}
                  onClick={() => void toggleNotes()}
                  className={`relative h-7 w-12 shrink-0 rounded-full ${notes ? "bg-accent" : "bg-bg"}`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${notes ? "translate-x-5" : "translate-x-0.5"}`}
                  />
                </button>
              </div>
            ) : null}
          </div>
          {fail && !name ? <p className="mt-3 text-center text-sm text-muted">{t.previewFail}</p> : null}
          {onWrite ? (
            <button type="button" onClick={onWrite} className="mt-5 h-11 w-full rounded-xl bg-accent text-sm font-medium text-white">
              {t.profileWrite}
            </button>
          ) : null}
          <div className="mt-5 flex gap-1 rounded-xl bg-bg p-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`h-9 flex-1 rounded-lg text-xs font-semibold ${tab === item.id ? "bg-elevated text-ink" : "text-muted"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {!libReady ? <p className="py-6 text-center text-sm text-muted">{t.searching}</p> : null}
            {libReady && count === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : null}
            {tab === "media" && lib.media.length ? (
              <div className="grid grid-cols-3 gap-1">
                {lib.media.map((item) =>
                  item.kind === "video" ? (
                    <video key={item.id} src={item.url} className="aspect-square w-full rounded-lg bg-bg object-cover" controls />
                  ) : (
                    <button key={item.id} type="button" onClick={() => setPhoto(item.url)} className="aspect-square overflow-hidden rounded-lg bg-bg">
                      <img src={item.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ),
                )}
              </div>
            ) : null}
            {tab === "links" && lib.links.length ? (
              <div className="space-y-2">
                {lib.links.map((item) => (
                  <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-accent">
                    {item.url}
                  </a>
                ))}
              </div>
            ) : null}
            {tab === "voice" && lib.voice.length ? (
              <div className="space-y-3">
                {lib.voice.map((item) => (
                  <div key={item.id}>
                    <p className="mb-1 text-xs text-muted">{item.duration_ms ? formatClock(item.duration_ms) : t.voice}</p>
                    <audio src={item.url} controls className="h-9 w-full" />
                  </div>
                ))}
              </div>
            ) : null}
            {tab === "groups" && lib.groups.length ? (
              <div className="space-y-1">
                {lib.groups.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenChat?.(item.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left"
                  >
                    <Avatar name={item.title || "?"} src={item.avatar_url} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                      {item.username ? <span className="block truncate text-xs text-accent">@{item.username}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {photo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPhoto(null)}>
          <img src={photo} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}
