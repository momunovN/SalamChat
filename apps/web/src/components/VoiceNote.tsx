"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatClock } from "@/lib/chat";
import { finiteVoiceMs, peaksFromBuffer, WAVE_BARS } from "@/lib/voice";

export function VoiceNote({
  src,
  durationMs,
  waveform,
}: {
  src: string;
  durationMs?: number | null;
  waveform?: number[] | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const capTimer = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(() => finiteVoiceMs(durationMs));
  const [bars, setBars] = useState<number[]>(() => cleanWave(waveform));
  const limit = finiteVoiceMs(durationMs) || dur;

  useEffect(() => {
    const onOther = (ev: Event) => {
      const other = (ev as CustomEvent<string>).detail;
      if (other !== src) audioRef.current?.pause();
    };
    window.addEventListener("tooapp:voice", onOther);
    return () => {
      window.removeEventListener("tooapp:voice", onOther);
      clearCap();
    };
  }, [src]);

  useEffect(() => {
    if (cleanWave(waveform).length > 0) return;
    let cancelled = false;
    const ctx = new AudioContext();
    void fetch(src)
      .then((res) => res.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        if (!cancelled) setBars(peaksFromBuffer(audio, WAVE_BARS));
      })
      .catch(() => undefined)
      .finally(() => {
        if (ctx.state !== "closed") void ctx.close();
      });
    return () => {
      cancelled = true;
      if (ctx.state !== "closed") void ctx.close();
    };
  }, [src, waveform]);

  function clearCap() {
    if (capTimer.current) window.clearTimeout(capTimer.current);
    capTimer.current = 0;
  }

  function stopAtEnd(audio: HTMLAudioElement) {
    clearCap();
    audio.pause();
    if (Number.isFinite(audio.duration) || audio.currentTime > 0) {
      try {
        audio.currentTime = 0;
      } catch {
        /* some recordings cannot seek */
      }
    }
    setPlaying(false);
    setAt(0);
  }

  function armCap(audio: HTMLAudioElement) {
    clearCap();
    const total = finiteVoiceMs(durationMs) || dur;
    if (!total) return;
    const remain = total - audio.currentTime * 1000;
    capTimer.current = window.setTimeout(() => {
      const node = audioRef.current;
      if (node && !node.paused) stopAtEnd(node);
    }, Math.max(0, remain));
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      const total = finiteVoiceMs(durationMs) || dur;
      if (total > 0 && audio.currentTime * 1000 >= total - 30) audio.currentTime = 0;
      window.dispatchEvent(new CustomEvent("tooapp:voice", { detail: src }));
      void audio.play().then(() => armCap(audio)).catch(() => setPlaying(false));
    } else {
      clearCap();
      audio.pause();
    }
  }

  function seek(clientX: number, width: number, left: number) {
    const audio = audioRef.current;
    const total = limit;
    if (!audio || !total) return;
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    const next = ratio * total;
    if (next >= total - 30) {
      stopAtEnd(audio);
      return;
    }
    audio.currentTime = next / 1000;
    setAt(next);
    if (!audio.paused) armCap(audio);
  }

  function onTime() {
    const audio = audioRef.current;
    if (!audio) return;
    const ms = audio.currentTime * 1000;
    if (limit > 0 && ms >= limit - 30) {
      stopAtEnd(audio);
      return;
    }
    setAt(ms);
  }

  const shown = limit || finiteVoiceMs(durationMs);
  const progress = shown ? Math.min(1, at / shown) : 0;
  const wave = bars.length ? bars : placeholderWave(WAVE_BARS);

  return (
    <div className="flex w-60 items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
          className="flex h-8 cursor-pointer items-center gap-px"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(e.clientX, rect.width, rect.left);
          }}
        >
          {wave.map((amp, i) => {
            const played = (i + 0.5) / wave.length <= progress;
            return (
              <span
                key={i}
                className={`w-full max-w-[3px] flex-1 rounded-full ${played ? "bg-white" : "bg-white/35"}`}
                style={{ height: `${Math.max(14, Math.round(amp * 100))}%` }}
              />
            );
          })}
        </div>
        <p className="mt-0.5 text-[12px] font-medium tabular-nums text-white/80">
          {formatClock(playing || at > 0 ? at : shown)}
        </p>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          clearCap();
          setPlaying(false);
        }}
        onEnded={() => {
          const audio = audioRef.current;
          if (audio) stopAtEnd(audio);
          else {
            setPlaying(false);
            setAt(0);
          }
        }}
        onTimeUpdate={onTime}
        onLoadedMetadata={() => {
          const secs = audioRef.current?.duration;
          const known = finiteVoiceMs(durationMs, secs);
          if (known) setDur(known);
        }}
      />
    </div>
  );
}

function cleanWave(waveform: number[] | null | undefined) {
  if (!waveform?.length) return [];
  return waveform
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .slice(0, 64)
    .map((n) => Math.max(0.08, Math.min(1, n)));
}

function placeholderWave(count: number) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(0.18 + ((i * 17) % 10) / 28);
  return out;
}
