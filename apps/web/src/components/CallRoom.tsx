"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { api } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import type { Call } from "@/lib/types";

export function CallRoom({
  call,
  title,
  t,
  onHangup,
}: {
  call: Call;
  title: string;
  t: Dict;
  onHangup: () => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const remoteVideo = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLDivElement>(null);
  const remoteAudio = useRef<HTMLDivElement>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(call.kind === "video");
  const [phase, setPhase] = useState<"connecting" | "live" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const video = call.kind === "video";
  const ringing = call.status === "ringing";

  useEffect(() => {
    const room = new Room();
    roomRef.current = room;
    let cancelled = false;

    const place = (track: RemoteTrack) => {
      const box = track.kind === Track.Kind.Video ? remoteVideo.current : remoteAudio.current;
      if (!box) return;
      const el = track.attach();
      el.className = "h-full w-full object-cover";
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      if (track.kind === Track.Kind.Video) box.replaceChildren(el);
      else box.appendChild(el);
    };

    room.on(RoomEvent.TrackSubscribed, (track) => place(track));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });

    void (async () => {
      try {
        const creds = await api.callToken(call.id);
        if (cancelled) return;
        if (!creds.url || creds.token.startsWith("stub-")) throw new Error("livekit");
        await room.connect(creds.url, creds.token);
        if (cancelled) return;
        await room.localParticipant.setMicrophoneEnabled(true);
        if (video) {
          await room.localParticipant.setCameraEnabled(true);
          const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          const local = pub?.track;
          if (local && localVideo.current) {
            const el = local.attach();
            el.className = "h-full w-full object-cover";
            if (el instanceof HTMLVideoElement) {
              el.playsInline = true;
              el.muted = true;
            }
            localVideo.current.replaceChildren(el);
          }
        }
        if (!cancelled) setPhase("live");
      } catch {
        if (!cancelled) {
          setPhase("error");
          setError(t.callFailed);
        }
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
  }, [call.id, t.callFailed, video]);

  async function toggleMic() {
    const next = !mic;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
    setMic(next);
  }

  async function toggleCam() {
    const next = !cam;
    await roomRef.current?.localParticipant.setCameraEnabled(next);
    setCam(next);
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg text-ink">
      <div className="relative min-h-0 flex-1">
        <div ref={remoteVideo} className="h-full w-full bg-black" />
        <div ref={remoteAudio} className="hidden" />
        <div className="pointer-events-none absolute inset-x-0 top-0 p-6 text-center">
          <p className="text-[28px] font-bold">{title}</p>
          <p className="mt-1 text-sm text-muted">
            {phase === "error" ? error : ringing ? t.calling : phase === "connecting" ? t.calling : t.inCall}
          </p>
        </div>
        {video ? (
          <div ref={localVideo} className="absolute bottom-4 right-4 h-36 w-28 overflow-hidden rounded-2xl bg-elevated" />
        ) : null}
      </div>
      <div className="flex items-center justify-center gap-8 px-6 py-8">
        <button type="button" onClick={() => void toggleMic()} className="flex flex-col items-center gap-2">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated">
            {mic ? <Mic size={22} /> : <MicOff size={22} />}
          </span>
          <span className="text-xs text-muted">{t.mic}</span>
        </button>
        {video ? (
          <button type="button" onClick={() => void toggleCam()} className="flex flex-col items-center gap-2">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated">
              {cam ? <Video size={22} /> : <VideoOff size={22} />}
            </span>
            <span className="text-xs text-muted">{t.camera}</span>
          </button>
        ) : null}
        <button type="button" onClick={onHangup} className="flex flex-col items-center gap-2">
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-danger text-white">
            <PhoneOff size={28} />
          </span>
          <span className="text-xs text-muted">{t.hangup}</span>
        </button>
      </div>
    </div>
  );
}
