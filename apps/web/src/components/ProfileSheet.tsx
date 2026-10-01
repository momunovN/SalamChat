"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import type { User } from "@/lib/types";
import { Avatar } from "./Avatar";

export function ProfileSheet({
  userId,
  seed,
  t,
  onWrite,
  onClose,
}: {
  userId: string;
  seed?: User | null;
  t: Dict;
  onWrite?: () => void;
  onClose: () => void;
}) {
  const [user, setUser] = useState<User | null>(seed && seed.id === userId ? seed : null);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    let gone = false;
    api
      .user(userId)
      .then((next) => {
        if (!gone) setUser(next);
      })
      .catch(() => {
        if (!gone) setFail(true);
      });
    return () => {
      gone = true;
    };
  }, [userId]);
  const name = user?.display_name || seed?.display_name || "";
  const nick = user?.username || seed?.username;
  const phone = (user?.phone || "").trim();
  const bio = (user?.bio || "").trim();
  const online = !!user?.online;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-elevated px-6 pt-4 pb-8 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-bg text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col items-center text-center">
          <Avatar name={name || "?"} src={user?.avatar_url || seed?.avatar_url} size={96} online={online} />
          {name ? <h2 className="mt-3 text-xl font-semibold text-ink">{name}</h2> : null}
          {nick ? <p className="text-sm text-accent">@{nick}</p> : null}
          {online || user?.last_seen_at ? (
            <p className={`mt-1 text-sm ${online ? "text-success" : "text-muted"}`}>{online ? t.online : t.lastSeen}</p>
          ) : null}
          {bio ? <p className="mt-4 max-w-full whitespace-pre-wrap text-sm text-ink">{bio}</p> : null}
          {phone ? <p className="mt-3 text-sm text-muted">{phone}</p> : null}
          {fail && !name ? <p className="mt-3 text-sm text-muted">{t.previewFail}</p> : null}
          {onWrite ? (
            <button type="button" onClick={onWrite} className="mt-6 h-11 w-full rounded-xl bg-accent text-sm font-medium text-white">
              {t.profileWrite}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
