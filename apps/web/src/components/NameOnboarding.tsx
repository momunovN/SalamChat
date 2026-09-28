"use client";

import { useEffect, useState } from "react";
import { api, loadSession, saveSession } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import { sanitizeDisplayName, sanitizeUsername } from "@/lib/name";
import type { Session, User } from "@/lib/types";
import { BrandMark } from "./BrandMark";

export function NameOnboarding({
  t,
  onDone,
}: {
  t: Dict;
  onDone: (user: User) => void;
}) {
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) {
      setWaited(false);
      return;
    }
    const id = window.setTimeout(() => setWaited(true), 1200);
    return () => window.clearTimeout(id);
  }, [busy]);

  async function save() {
    if (busy) return;
    const next = sanitizeDisplayName(name);
    if (!next) {
      setError(t.errName);
      return;
    }
    const username = sanitizeUsername(nick);
    if (nick.trim() && username === null) {
      setError(t.errNick);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.patchMe({
        display_name: next,
        ...(username ? { username } : {}),
      });
      const session = loadSession();
      if (session) {
        const updated: Session = { ...session, user };
        saveSession(updated);
      }
      onDone(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/username taken|conflict/i.test(msg)) setError(t.errNickTaken);
      else setError(/timed out|timeout|fetch|unavailable|network|HTTP 5/i.test(msg) ? t.dbWake : t.errLogin);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <BrandMark alt="" className="mb-5 h-16 w-16" />
          <p className="text-xs font-semibold tracking-[0.28em] text-accent">KG · RU</p>
          <h1 className="mt-2 text-[40px] font-bold tracking-tight text-ink">{t.app}</h1>
          <p className="mt-3 text-[17px] font-semibold text-ink">{t.nameTitle}</p>
          <p className="mt-1 text-sm text-muted">{t.nameSubtitle}</p>
        </div>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          autoFocus
          autoComplete="name"
          maxLength={40}
          placeholder={t.namePlaceholder}
          className="h-[52px] w-full rounded-[14px] bg-elevated px-3.5 text-base text-ink outline-none ring-accent/0 focus:ring-2 focus:ring-accent"
        />
        <label className="mt-4 block text-xs font-medium text-muted">
          {t.nick} · {t.nickOptional}
        </label>
        <div className="mt-1 flex h-[52px] items-center rounded-[14px] bg-elevated px-3.5 focus-within:ring-2 focus-within:ring-accent">
          <span className="pr-0.5 text-base text-muted">@</span>
          <input
            value={nick}
            onChange={(e) => {
              setNick(e.target.value.replace(/^@/, ""));
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            autoComplete="username"
            maxLength={24}
            placeholder="nickname"
            className="h-full w-full bg-transparent text-base text-ink outline-none"
          />
        </div>
        <p className="mt-2 text-xs text-muted">{t.nickHint}</p>
        {busy && waited ? <p className="mt-3 text-xs font-medium text-muted">{t.connecting}</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
        <button
          type="button"
          disabled={busy || !sanitizeDisplayName(name)}
          onClick={() => void save()}
          className="mt-4 h-[52px] w-full rounded-2xl bg-accent text-[17px] font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {t.continue}
        </button>
      </div>
    </div>
  );
}
