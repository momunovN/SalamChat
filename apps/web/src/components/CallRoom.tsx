"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import {
  AudioPresets,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteTrack,
} from "livekit-client";
import { api, loadSession } from "@/lib/api";
import type { CallMedia } from "@/lib/callMedia";
import type { Dict } from "@/lib/i18n";
import type { Call } from "@/lib/types";

const HANGUP = "hangup";
const HANGUP_TOPIC = "tooapp.call";

type Creds = { url: string; token: string; room: string };

const videoPublish = {
  source: Track.Source.Camera,
  simulcast: true,
  videoCodec: "vp8" as const,
  degradationPreference: "maintain-resolution" as const,
  videoEncoding: { maxBitrate: 2_800_000, maxFramerate: 30, priority: "high" as const },
  videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
};

function mountPreview(box: HTMLDivElement, track: MediaStreamTrack, mirror: boolean) {
  const el = document.createElement("video");
  el.srcObject = new MediaStream([track]);
  el.muted = true;
  el.autoplay = true;
  el.playsInline = true;
  el.className = "h-full w-full object-cover";
  if (mirror) el.style.transform = "scaleX(-1)";
  box.replaceChildren(el);
  void el.play().catch(() => undefined);
}

function mountRemote(box: HTMLDivElement, track: RemoteTrack) {
  const el = track.attach();
  el.className = "h-full w-full object-cover";
  if (el instanceof HTMLVideoElement) {
    el.autoplay = true;
    el.playsInline = true;
  }
  if (track.kind === Track.Kind.Video) box.replaceChildren(el);
  else box.appendChild(el);
  void el.play?.().catch(() => undefined);
}

export function CallRoom({
  call,
  title,
  t,
  media,
  creds,
  onHangup,
  onConnectFailed,
}: {
  call: Call;
  title: string;
  t: Dict;
  media: CallMedia;
  creds?: Promise<Creds> | null;
  onHangup: () => void;
  onConnectFailed: () => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const liveMedia = useRef<CallMedia | null>(null);
  const endRef = useRef<(notifyPeer: boolean) => void>(() => undefined);
  const onHangupRef = useRef(onHangup);
  const onFailedRef = useRef(onConnectFailed);
  const failedText = useRef(t.callFailed);
  const remoteVideo = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLDivElement>(null);
  const remoteAudio = useRef<HTMLDivElement>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(call.kind === "video");
  const [phase, setPhase] = useState<"connecting" | "live" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [peerJoined, setPeerJoined] = useState(false);
  const video = call.kind === "video";
  const waiting = call.status === "ringing" && !peerJoined;

  useEffect(() => {
    onHangupRef.current = onHangup;
    onFailedRef.current = onConnectFailed;
    failedText.current = t.callFailed;
  });

  useEffect(() => {
    const box = localVideo.current;
    const track = media.video;
    if (!box || !track) return;
    mountPreview(box, track, true);
  }, [media.video]);

  useEffect(() => {
    const room = new Room({
      dynacast: true,
      adaptiveStream: false,
      singlePeerConnection: true,
      disconnectOnPageLeave: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
        facingMode: "user",
      },
      publishDefaults: {
        simulcast: true,
        videoCodec: "vp8",
        dtx: true,
        red: true,
        audioPreset: AudioPresets.speech,
        degradationPreference: "maintain-resolution",
        videoEncoding: videoPublish.videoEncoding,
        videoSimulcastLayers: videoPublish.videoSimulcastLayers,
      },
    });
    roomRef.current = room;
    liveMedia.current = media;
    let cancelled = false;
    let ended = false;
    let leaveTimer: number | undefined;
    const scheduleLeave = () => {
      if (leaveTimer) window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => {
        if (cancelled || ended) return;
        if (room.remoteParticipants.size === 0) finish(false);
      }, 1200);
    };

    const finish = (notifyPeer: boolean) => {
      if (ended || cancelled) return;
      ended = true;
      void (async () => {
        if (notifyPeer) {
          try {
            await room.localParticipant.publishData(new TextEncoder().encode(HANGUP), {
              reliable: true,
              topic: HANGUP_TOPIC,
            });
          } catch {
            /* peer is not in the room yet */
          }
        }
        try {
          await room.disconnect(true);
        } catch {
          /* already closed */
        }
        onHangupRef.current();
      })();
    };
    endRef.current = finish;

    const place = (track: RemoteTrack) => {
      const box = track.kind === Track.Kind.Video ? remoteVideo.current : remoteAudio.current;
      if (!box) return;
      mountRemote(box, track);
      setPeerJoined(true);
    };

    room.on(RoomEvent.TrackSubscribed, (track) => place(track));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });
    room.on(RoomEvent.ParticipantConnected, () => {
      if (leaveTimer) window.clearTimeout(leaveTimer);
      setPeerJoined(true);
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (room.remoteParticipants.size === 0) scheduleLeave();
    });
    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic === HANGUP_TOPIC && new TextDecoder().decode(payload) === HANGUP) finish(false);
    });

    void (async () => {
      try {
        const ready = await loadCreds(creds, call.id);
        if (cancelled || ended) return;
        if (!ready.url || ready.token.startsWith("stub-")) throw new Error("livekit");
        await room.prepareConnection(ready.url, ready.token);
        if (cancelled || ended) return;
        await room.connect(ready.url, ready.token);
        if (cancelled || ended) return;
        void room.startAudio();
        void room.startVideo();
        if (room.remoteParticipants.size > 0) setPeerJoined(true);
        const publishes = [
          room.localParticipant.publishTrack(media.audio, {
            source: Track.Source.Microphone,
            dtx: true,
            red: true,
            audioPreset: AudioPresets.speech,
          }),
        ];
        if (video && media.video) {
          publishes.push(room.localParticipant.publishTrack(media.video, videoPublish));
        }
        await Promise.all(publishes);
        if (cancelled || ended) return;
        const local = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (local && localVideo.current) {
          const el = local.attach();
          el.className = "h-full w-full object-cover";
          if (el instanceof HTMLVideoElement) {
            el.playsInline = true;
            el.autoplay = true;
            el.muted = true;
            el.style.transform = "scaleX(-1)";
          }
          localVideo.current.replaceChildren(el);
        }
        setPhase("live");
      } catch {
        if (cancelled || ended) return;
        ended = true;
        media.audio.stop();
        media.video?.stop();
        setPhase("error");
        setError(failedText.current);
        onFailedRef.current();
      }
    })();

    return () => {
      cancelled = true;
      if (leaveTimer) window.clearTimeout(leaveTimer);
      void room.disconnect(false);
      const audio = media.audio;
      const videoTrack = media.video;
      if (liveMedia.current?.audio === audio) liveMedia.current = null;
      queueMicrotask(() => {
        if (liveMedia.current?.audio === audio) return;
        audio.stop();
        videoTrack?.stop();
      });
    };
  }, [call.id, creds, media, media.audio, media.video, video]);

  useEffect(() => {
    const hangupKeepalive = () => {
      const token = loadSession()?.access_token;
      if (!token) return;
      void fetch(`/v1/calls/${call.id}/hangup`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${token}` },
      });
    };
    window.addEventListener("pagehide", hangupKeepalive);
    return () => window.removeEventListener("pagehide", hangupKeepalive);
  }, [call.id]);

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

  const status = phase === "error" ? error : waiting || phase === "connecting" ? t.calling : t.inCall;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg text-ink">
      <div className="relative min-h-0 flex-1">
        <div ref={remoteVideo} className="h-full w-full bg-black" />
        <div ref={remoteAudio} className="hidden" />
        <div className="pointer-events-none absolute inset-x-0 top-0 p-6 text-center">
          <p className="text-[28px] font-bold">{title}</p>
          <p className="mt-1 text-sm text-muted">{status}</p>
        </div>
        {video ? (
          <div ref={localVideo} className="absolute bottom-4 right-4 h-40 w-28 overflow-hidden rounded-2xl bg-elevated" />
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
        <button type="button" onClick={() => endRef.current(true)} className="flex flex-col items-center gap-2">
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-danger text-white">
            <PhoneOff size={28} />
          </span>
          <span className="text-xs text-muted">{t.hangup}</span>
        </button>
      </div>
    </div>
  );
}

async function loadCreds(pending: Promise<Creds> | null | undefined, callId: string) {
  if (pending) {
    try {
      return await pending;
    } catch {
      /* the prefetch failed; ask again */
    }
  }
  return api.callToken(callId);
}
