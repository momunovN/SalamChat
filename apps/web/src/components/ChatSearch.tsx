"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { payloadText } from "@/lib/chat";
import type { Dict, Lang } from "@/lib/i18n";
import type { Message } from "@/lib/types";

/** Same folding as the server: case-insensitive and "ё" = "е" (1:1, so indexes still line up). */
function fold(text: string) {
  return text.toLowerCase().replace(/ё/g, "е");
}

function snippet(text: string, q: string): ReactNode {
  const at = fold(text).indexOf(fold(q.trim()));
  if (at < 0) return text.slice(0, 120);
  const from = Math.max(0, at - 40);
  const end = at + q.trim().length;
  return (
    <>
      {from > 0 ? "…" : ""}
      {text.slice(from, at)}
      <mark className="rounded bg-accent/30 px-0.5 text-ink">{text.slice(at, end)}</mark>
      {text.slice(end, end + 80)}
      {end + 80 < text.length ? "…" : ""}
    </>
  );
}

function when(iso: string, lang: Lang) {
  const d = new Date(iso);
  const locale = lang === "ky" ? "ky-KG" : "ru-RU";
  return `${d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "2-digit" })} ${d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function ChatSearch({
  chatId,
  me,
  t,
  lang,
  onPick,
  onClose,
}: {
  chatId: string;
  me?: string;
  t: Dict;
  lang: Lang;
  onPick: (m: Message) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const gen = useRef(0);
  const query = q.trim();

  useEffect(() => {
    const run = ++gen.current;
    if (query.length < 2) {
      const id = window.setTimeout(() => {
        if (run !== gen.current) return;
        setItems([]);
        setCursor(null);
        setSearched(false);
      }, 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setBusy(true);
      api
        .searchMessages(chatId, query)
        .then((r) => {
          if (run !== gen.current) return;
          setItems(r.items ?? []);
          setCursor(r.cursor ?? null);
          setSearched(true);
        })
        .catch(() => undefined)
        .finally(() => {
          if (run === gen.current) setBusy(false);
        });
    }, 300);
    return () => window.clearTimeout(id);
  }, [chatId, query]);

  async function more() {
    if (!cursor || busy) return;
    const run = gen.current;
    setBusy(true);
    try {
      const r = await api.searchMessages(chatId, query, cursor);
      if (run !== gen.current) return;
      setItems((prev) => [...prev, ...(r.items ?? []).filter((m) => !prev.some((p) => p.id === m.id))]);
      setCursor(r.cursor ?? null);
    } catch {
      /* keep what we have */
    } finally {
      if (run === gen.current) setBusy(false);
    }
  }

  return (
    <div className="border-b border-line bg-bg">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder={t.searchMessages}
          className="h-9 min-w-0 flex-1 rounded-xl bg-elevated px-3 text-[15px] text-ink outline-none placeholder:text-muted focus:ring-1 focus:ring-accent/60"
        />
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated"
          aria-label={t.close}
        >
          <X size={18} />
        </button>
      </div>
      {query.length >= 2 ? (
        <div className="max-h-[50vh] overflow-y-auto pb-1">
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m)}
              className="block w-full px-4 py-2 text-left hover:bg-elevated"
            >
              <div className="flex items-baseline justify-between gap-2 text-[12px] text-muted">
                <span className="truncate font-semibold">{m.author_id === me ? t.you : m.author_name || ""}</span>
                <span className="shrink-0">{when(m.created_at, lang)}</span>
              </div>
              <p className="line-clamp-2 break-words text-[14px] text-ink">{snippet(payloadText(m.payload), query)}</p>
            </button>
          ))}
          {busy ? <p className="px-4 py-2 text-[13px] text-muted">{t.searching}</p> : null}
          {!busy && searched && items.length === 0 && !cursor ? (
            <p className="px-4 py-2 text-[13px] text-muted">{t.nothingFound}</p>
          ) : null}
          {!busy && cursor ? (
            <button type="button" onClick={() => void more()} className="w-full px-4 py-2 text-left text-[13px] font-semibold text-accent">
              {t.searchMore}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
