"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";
import type { User } from "@/lib/types";
import { Avatar } from "./Avatar";

export function useUserSearch(query: string, excludeId?: string) {
  const [items, setItems] = useState<User[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setItems([]);
      setStatus("idle");
      setError(null);
      return;
    }
    const n = ++seq.current;
    setStatus("loading");
    const id = window.setTimeout(() => {
      void api
        .users(q)
        .then((r) => {
          if (n !== seq.current) return;
          setItems((r.items ?? []).filter((u) => u.id !== excludeId));
          setStatus("ready");
          setError(null);
        })
        .catch((err) => {
          if (n !== seq.current) return;
          setItems([]);
          setStatus("error");
          const msg = err instanceof Error ? err.message : "";
          setError(msg);
        });
    }, 250);
    return () => window.clearTimeout(id);
  }, [query, excludeId]);

  return { items, status, error };
}

export function PersonRow({
  user,
  onClick,
  trailing,
}: {
  user: User;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  const sub = user.username ? `@${user.username}` : formatPhone(user.phone);
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-2 text-left hover:bg-elevated/60">
      <Avatar name={user.display_name} src={user.avatar_url} size={40} online={user.online} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{user.display_name}</p>
        <p className="truncate text-xs text-muted">{sub}</p>
      </div>
      {trailing}
    </button>
  );
}

export function PeopleResults({
  t,
  query,
  items,
  status,
  error,
  onPick,
  picked,
  selectable,
}: {
  t: Dict;
  query: string;
  items: User[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onPick: (user: User) => void;
  picked?: string[];
  selectable?: boolean;
}) {
  if (status === "idle") {
    return <p className="px-1 py-8 text-center text-sm text-muted">{t.emptyContacts}</p>;
  }
  if (status === "loading" && items.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-muted">{t.searching}</p>;
  }
  if (status === "error") {
    const db = error && /timed out|timeout|fetch|unavailable|network/i.test(error);
    return <p className="px-1 py-8 text-center text-sm text-danger">{db ? t.dbWake : t.errLogin}</p>;
  }
  if (items.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted">
        {t.emptyPeople}
        {query.trim() ? <span className="mt-1 block text-xs">«{query.trim()}»</span> : null}
      </p>
    );
  }
  return (
    <>
      {items.map((u) => {
        const on = picked?.includes(u.id);
        return (
          <PersonRow
            key={u.id}
            user={u}
            onClick={() => onPick(u)}
            trailing={
              selectable ? (
                <span className={`h-5 w-5 shrink-0 rounded-full border ${on ? "border-accent bg-accent" : "border-muted"}`} />
              ) : null
            }
          />
        );
      })}
    </>
  );
}
