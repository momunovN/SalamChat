"use client";

import type { Lang } from "@/lib/i18n";

export function LangSwitch({ lang, onLang }: { lang: Lang; onLang: (lang: Lang) => void }) {
  const item = (id: Lang, label: string) => (
    <button
      type="button"
      onClick={() => onLang(id)}
      aria-pressed={lang === id}
      className={`tracking-[0.28em] ${lang === id ? "text-accent" : "text-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold">
      {item("ky", "KG")}
      <span className="text-muted">·</span>
      {item("ru", "RU")}
    </div>
  );
}
