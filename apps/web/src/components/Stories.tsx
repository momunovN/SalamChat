"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, ImagePlus, Plus, Send, Trash2, Type, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import type { Story, StoryGroup, StoryViewer as Viewer } from "@/lib/types";
import { Avatar } from "./Avatar";

const PHOTO_MS = 5000;
const TEXT_MS = 6000;
const MAX_UPLOAD = 20 * 1024 * 1024;
export const STORY_BGS = ["#2b6bff", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#334155"];

function ago(iso: string, t: Dict) {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return t.statusNow;
  if (min < 60) return t.statusMinutes.replace("{n}", String(min));
  return t.statusHours.replace("{n}", String(Math.floor(min / 60)));
}

/** A ring around the avatar: bright while something is unseen, dim once all are watched. */
function Ring({ unseen, children }: { unseen: boolean; children: React.ReactNode }) {
  return (
    <span
      className="block rounded-full p-[2.5px]"
      style={{
        background: unseen ? "conic-gradient(from 210deg, #2b6bff, #22d3ee, #a855f7, #2b6bff)" : "rgb(255 255 255 / 0.18)",
      }}
    >
      <span className="block rounded-full bg-bg p-[2px]">{children}</span>
    </span>
  );
}

export function StoryStrip({
  groups,
  me,
  meName,
  meAvatar,
  t,
  onOpen,
  onAdd,
}: {
  groups: StoryGroup[];
  me: string;
  meName: string;
  meAvatar?: string | null;
  t: Dict;
  onOpen: (index: number) => void;
  onAdd: () => void;
}) {
  const ownIndex = groups.findIndex((g) => g.user.id === me);
  const others = groups.map((g, i) => ({ g, i })).filter(({ g }) => g.user.id !== me);
  return (
    <div className="flex gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-16 shrink-0 flex-col items-center gap-1">
        <div className="relative">
          <button
            type="button"
            aria-label={ownIndex >= 0 ? t.myStatus : t.addStatus}
            onClick={() => (ownIndex >= 0 ? onOpen(ownIndex) : onAdd())}
            className="block"
          >
            {ownIndex >= 0 ? (
              <Ring unseen={false}>
                <Avatar name={meName} src={meAvatar} size={52} />
              </Ring>
            ) : (
              <span className="block p-[4.5px]">
                <Avatar name={meName} src={meAvatar} size={52} />
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label={t.addStatus}
            onClick={onAdd}
            className="absolute right-0 bottom-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-bg bg-accent text-white"
          >
            <Plus size={13} strokeWidth={3} />
          </button>
        </div>
        <span className="w-full truncate text-center text-[11px] text-muted">{t.myStatus}</span>
      </div>
      {others.map(({ g, i }) => (
        <button
          key={g.user.id}
          type="button"
          onClick={() => onOpen(i)}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
        >
          <Ring unseen={g.unseen}>
            <Avatar name={g.user.display_name} src={g.user.avatar_url} size={52} />
          </Ring>
          <span className={`w-full truncate text-center text-[11px] ${g.unseen ? "font-medium text-ink" : "text-muted"}`}>
            {g.user.display_name.split(" ")[0]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function StoryViewer({
  groups,
  start,
  me,
  t,
  onClose,
  onSeen,
  onDeleted,
}: {
  groups: StoryGroup[];
  start: number;
  me: string;
  t: Dict;
  onClose: () => void;
  onSeen: (storyId: string) => void;
  onDeleted: () => void;
}) {
  const [gi, setGi] = useState(start);
  const [si, setSi] = useState(() => {
    const first = groups[start]?.stories.findIndex((s) => !s.viewed) ?? -1;
    return first >= 0 ? first : 0;
  });
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [views, setViews] = useState<Viewer[] | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const press = useRef<{ x: number; t: number } | null>(null);
  const group = groups[gi];
  const story: Story | undefined = group?.stories[si];
  const own = group?.user.id === me;

  function next() {
    if (!group) return onClose();
    if (si + 1 < group.stories.length) {
      setSi(si + 1);
      setProgress(0);
    } else if (gi + 1 < groups.length) {
      const g = groups[gi + 1];
      const unseen = g.stories.findIndex((s) => !s.viewed);
      setGi(gi + 1);
      setSi(unseen >= 0 ? unseen : 0);
      setProgress(0);
    } else onClose();
  }

  function prev() {
    if (si > 0) {
      setSi(si - 1);
    } else if (gi > 0) {
      setGi(gi - 1);
      setSi(Math.max(0, groups[gi - 1].stories.length - 1));
    }
    setProgress(0);
  }

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });

  // Mark it seen once it is on screen.
  useEffect(() => {
    if (!story || own || story.viewed) return;
    onSeen(story.id);
    void api.viewStory(story.id).catch(() => undefined);
  }, [story, own, onSeen]);

  // The clock for photos and text; videos report their own progress. A pause keeps the place.
  const elapsed = useRef(0);
  const storyId = story?.id;
  useEffect(() => {
    elapsed.current = 0;
  }, [storyId]);
  useEffect(() => {
    if (!story || story.kind === "video" || paused || views) return;
    const total = story.kind === "text" ? TEXT_MS : PHOTO_MS;
    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / total);
      setProgress(p);
      if (p >= 1) nextRef.current();
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [story, paused, views]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused || views) v.pause();
    else void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }, [paused, views, story]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") nextRef.current();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!group || !story) return null;

  async function remove() {
    if (!story) return;
    await api.deleteStory(story.id).catch(() => undefined);
    onDeleted();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 select-none">
      <div
        className="relative h-full w-full overflow-hidden bg-black sm:h-[min(100dvh-2rem,860px)] sm:w-auto sm:rounded-2xl"
        style={{ aspectRatio: "9 / 16", paddingTop: "env(safe-area-inset-top)" }}
        onPointerDown={(e) => {
          press.current = { x: e.clientX, t: Date.now() };
          setPaused(true);
        }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          setPaused(false);
          if (!p || Date.now() - p.t > 300 || (e.target as HTMLElement).closest("[data-ui]")) return;
          const box = e.currentTarget.getBoundingClientRect();
          if (e.clientX - box.left < box.width / 3) prev();
          else next();
        }}
        onPointerLeave={() => {
          press.current = null;
          setPaused(false);
        }}
      >
        {story.kind === "text" ? (
          <div className="flex h-full w-full items-center justify-center p-8" style={{ background: story.bg || "#2b6bff" }}>
            <p className="text-center text-[clamp(1.4rem,5.5vw,2.2rem)] leading-snug font-semibold whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
              {story.text}
            </p>
          </div>
        ) : story.kind === "video" && story.url ? (
          <video
            key={story.id}
            ref={videoRef}
            src={story.url}
            playsInline
            autoPlay
            className="h-full w-full object-contain"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress(v.currentTime / v.duration);
            }}
            onEnded={() => nextRef.current()}
          />
        ) : story.url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={story.url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={story.url} alt="" className="relative h-full w-full object-contain" />
          </>
        ) : null}

        {story.kind !== "text" && story.text ? (
          <p className="absolute inset-x-0 bottom-20 mx-4 rounded-xl bg-black/50 px-3 py-2 text-center text-[15px] text-white">
            {story.text}
          </p>
        ) : null}

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pt-[calc(env(safe-area-inset-top)+0.6rem)] pb-8">
          <div className="flex gap-1">
            {group.stories.map((s, i) => (
              <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <span
                  className="block h-full bg-white"
                  style={{ width: `${(i < si ? 1 : i === si ? progress : 0) * 100}%` }}
                />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <Avatar name={group.user.display_name} src={group.user.avatar_url} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-white">{own ? t.myStatus : group.user.display_name}</p>
              <p className="text-xs text-white/70">{ago(story.created_at, t)}</p>
            </div>
            {own ? (
              <button
                type="button"
                data-ui
                aria-label={t.statusDelete}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void remove()}
                className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
              >
                <Trash2 size={20} />
              </button>
            ) : null}
            <button
              type="button"
              data-ui
              aria-label={t.cancel}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {own ? (
          <button
            type="button"
            data-ui
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setViews([]);
              void api
                .storyViews(story.id)
                .then(setViews)
                .catch(() => setViews([]));
            }}
            className="absolute bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm font-medium text-white"
          >
            <Eye size={16} /> {story.views ?? 0}
          </button>
        ) : null}

        <button
          type="button"
          data-ui
          aria-label="prev"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={prev}
          className="absolute top-1/2 -left-14 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white sm:flex"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          data-ui
          aria-label="next"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={next}
          className="absolute top-1/2 -right-14 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white sm:flex"
        >
          <ChevronRight size={22} />
        </button>

        {views ? (
          <div
            data-ui
            className="absolute inset-x-0 bottom-0 max-h-[60%] overflow-y-auto rounded-t-2xl bg-elevated p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-ink">
                {t.statusViews} · {views.length}
              </p>
              <button
                type="button"
                aria-label={t.cancel}
                onClick={() => setViews(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-bg"
              >
                <X size={18} />
              </button>
            </div>
            {views.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t.statusNoViews}</p> : null}
            {views.map((v) => (
              <div key={v.id} className="flex items-center gap-3 py-2">
                <Avatar name={v.display_name} src={v.avatar_url} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{v.display_name}</p>
                  {v.viewed_at ? <p className="text-xs text-muted">{ago(v.viewed_at, t)}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StoryComposer({ t, onClose, onPosted }: { t: Dict; onClose: () => void; onPosted: () => void }) {
  const [mode, setMode] = useState<"pick" | "text" | "media">("pick");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(STORY_BGS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Free the picked file's preview when it is replaced or the composer closes.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "text") {
        await api.postStory({ kind: "text", text: text.trim(), bg });
      } else if (file) {
        const kind = file.type.startsWith("video/") ? "video" : "photo";
        const id = await api.upload(file, kind);
        await api.postStory({ kind, upload_id: id, text: text.trim() });
      }
      onPosted();
      onClose();
    } catch {
      setError(t.statusFailed);
    } finally {
      setBusy(false);
    }
  }

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,video/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        if (f.size > MAX_UPLOAD) {
          setError(t.statusTooBig);
          return;
        }
        setError(null);
        setFile(f);
        setPreview(URL.createObjectURL(f));
        setMode("media");
      }}
    />
  );

  if (mode === "pick") {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:items-center" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-sm rounded-t-2xl bg-elevated p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-semibold text-ink">{t.addStatus}</p>
            <button type="button" aria-label={t.cancel} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-bg">
              <X size={18} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-14 w-full items-center gap-3 rounded-xl px-3 text-left font-medium text-ink hover:bg-bg"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
              <ImagePlus size={20} />
            </span>
            {t.statusPhoto}
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className="flex h-14 w-full items-center gap-3 rounded-xl px-3 text-left font-medium text-ink hover:bg-bg"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Type size={20} />
            </span>
            {t.statusText}
          </button>
          {error ? <p className="mt-2 text-center text-sm text-danger">{error}</p> : null}
          {input}
        </div>
      </div>
    );
  }

  const ready = mode === "text" ? !!text.trim() : !!file;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95">
      <div
        className="relative flex h-full w-full flex-col overflow-hidden sm:h-[min(100dvh-2rem,860px)] sm:w-auto sm:rounded-2xl"
        style={{ aspectRatio: "9 / 16", background: mode === "text" ? bg : "#000" }}
      >
        <div className="relative z-10 flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <button type="button" aria-label={t.cancel} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white">
            <X size={22} />
          </button>
          {mode === "text" ? (
            <div className="flex gap-2">
              {STORY_BGS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setBg(c)}
                  className={`h-7 w-7 rounded-full border-2 ${bg === c ? "border-white" : "border-white/30"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          ) : null}
        </div>

        {mode === "text" ? (
          <textarea
            autoFocus
            value={text}
            maxLength={700}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.statusPlaceholder}
            className="flex-1 resize-none bg-transparent px-8 pt-[30%] text-center text-[clamp(1.4rem,5.5vw,2.2rem)] leading-snug font-semibold text-white outline-none placeholder:text-white/60"
          />
        ) : preview && file ? (
          <div className="absolute inset-0">
            {file.type.startsWith("video/") ? (
              <video src={preview} autoPlay muted loop playsInline className="h-full w-full object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-contain" />
            )}
          </div>
        ) : null}

        <div className="relative z-10 mt-auto flex items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {mode === "media" ? (
            <input
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.statusPlaceholder}
              className="h-12 min-w-0 flex-1 rounded-full bg-black/50 px-4 text-white outline-none placeholder:text-white/60"
            />
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => void publish()}
            aria-label={t.statusPublish}
            className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-white px-5 font-semibold text-black disabled:opacity-50"
          >
            {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/30 border-t-black" /> : <Send size={18} />}
            {busy ? t.statusPublishing : t.statusPublish}
          </button>
        </div>
        {error ? <p className="relative z-10 pb-3 text-center text-sm text-white">{error}</p> : null}
        {input}
      </div>
    </div>
  );
}
