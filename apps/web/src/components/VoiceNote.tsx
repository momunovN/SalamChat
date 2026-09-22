"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatClock } from "@/lib/chat";

export function VoiceNote({ src, durationMs }: { src: string; durationMs?: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(durationMs || 0);

  useEffect(() => {
    const onOther = (ev: Event) => {
      const other = (ev as CustomEvent<string>).detail;
      if (other !== src) audioRef.current?.pause();
    };
    window.addEventListener("tooapp:voice", onOther);
    return () => window.removeEventListener("tooapp:voice", onOther);
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      window.dispatchEvent(new CustomEvent("tooapp:voice", { detail: src }));
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }

  function seek(clientX: number, width: number, left: number) {
    const audio = audioRef.current;
    if (!audio || !dur) return;
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    audio.currentTime = (ratio * dur) / 1000;
    setAt(ratio * dur);
  }

  const shown = dur || durationMs || 0;

  return (
    <div className="flex w-56 items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-ink"
        aria-label={playing ? "pause" : "play"}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="relative h-1 cursor-pointer rounded-full bg-white/25"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(e.clientX, rect.width, rect.left);
          }}
        >
          <div
            className="h-full rounded-full bg-white"
            style={{ width: `${shown ? Math.min(100, (at / shown) * 100) : 0}%` }}
          />
        </div>
        <p className="mt-1 text-[12px] font-medium tabular-nums text-white/80">
          {formatClock(playing || at > 0 ? at : shown)}
        </p>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
        onTimeUpdate={() => setAt((audioRef.current?.currentTime || 0) * 1000)}
        onLoadedMetadata={() => {
          const secs = audioRef.current?.duration;
          if (secs && Number.isFinite(secs)) setDur(secs * 1000);
        }}
      />
    </div>
  );
}
