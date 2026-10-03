"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
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
import { Avatar } from "./Avatar";

const HANGUP = "hangup";
const HANGUP_TOPIC = "salam.call";

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type Creds = { url: string; token: string; room: string; ice_servers?: IceServer[] };

function callConnectOptions(creds: Creds) {
  const servers = creds.ice_servers || [];
  const hasTurn = servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  });
  if (!hasTurn) return undefined;
  return { rtcConfig: { iceServers: servers } };
}

// 720p H.264, without a second codec in the offer. A VP8 fallback is used only if H.264 is rejected.
const videoPublish = {
  source: Track.Source.Camera,
  simulcast: true,
  videoCodec: "h264" as const,
  backupCodec: false as const,
  degradationPreference: "balanced" as const,
  videoEncoding: VideoPresets.h720.encoding,
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
  avatarUrl,
  t,
  media,
  creds,
  onHangup,
  onConnectFailed,
}: {
  call: Call;
  title: string;
  avatarUrl?: string | null;
  t: Dict;
  media: Promise<CallMedia>;
  creds?: Promise<Creds> | null;
  onHangup: () => void;
  onConnectFailed: (code: string) => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const liveMedia = useRef<CallMedia | null>(null);
  const endRef = useRef<(notifyPeer: boolean) => void>(() => undefined);
  const onHangupRef = useRef(onHangup);
  const onFailedRef = useRef(onConnectFailed);
  const [preview, setPreview] = useState<MediaStreamTrack | null>(null);
  const failedText = useRef(t.callFailed);
  const remoteVideo = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLDivElement>(null);
  const remoteAudio = useRef<HTMLDivElement>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(call.kind === "video");
  const [phase, setPhase] = useState<"connecting" | "live" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [peerJoined, setPeerJoined] = useState(false);
  const [remoteOn, setRemoteOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const video = call.kind === "video";
  const talking = phase === "live" && peerJoined;

  useEffect(() => {
    onHangupRef.current = onHangup;
    onFailedRef.current = onConnectFailed;
    failedText.current = t.callFailed;
  });

  useEffect(() => {
    const box = localVideo.current;
    if (!box || !preview) return;
    mountPreview(box, preview, true);
  }, [preview]);

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
        videoCodec: "h264",
        dtx: true,
        red: true,
        audioPreset: AudioPresets.speech,
        degradationPreference: "balanced",
        videoEncoding: videoPublish.videoEncoding,
      },
    });
    roomRef.current = room;
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
      if (cancelled) return;
      const box = track.kind === Track.Kind.Video ? remoteVideo.current : remoteAudio.current;
      if (!box) return;
      mountRemote(box, track);
      setPeerJoined(true);
      if (track.kind === Track.Kind.Video) setRemoteOn(true);
    };

    room.on(RoomEvent.TrackSubscribed, (track) => place(track));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
      if (!cancelled && track.kind === Track.Kind.Video) setRemoteOn(false);
    });
    room.on(RoomEvent.ParticipantConnected, () => {
      if (leaveTimer) window.clearTimeout(leaveTimer);
      setPeerJoined(true);
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (room.remoteParticipants.size === 0) scheduleLeave();
    });
    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      // In a group the others stay: leave only when the one hanging up was the last peer.
      if (topic === HANGUP_TOPIC && new TextDecoder().decode(payload) === HANGUP && room.remoteParticipants.size <= 1) {
        finish(false);
      }
    });

    void (async () => {
      let got: CallMedia | null = null;
      try {
        // ICE runs while the camera is still opening.
        const connecting = (async () => {
          const ready = await loadCreds(creds, call.id);
          if (cancelled || ended) return;
          if (!ready.url || ready.token.startsWith("stub-")) throw new Error("livekit");
          await room.prepareConnection(ready.url, ready.token);
          if (cancelled || ended) return;
          const ice = callConnectOptions(ready);
          if (ice) await room.connect(ready.url, ready.token, ice);
          else await room.connect(ready.url, ready.token);
        })();
        const readyMedia = await media;
        got = readyMedia;
        if (!cancelled && !ended) setPreview(readyMedia.video ?? null);
        await connecting;
        if (cancelled || ended) return;
        liveMedia.current = readyMedia;
        void room.startAudio();
        void room.startVideo();
        if (room.remoteParticipants.size > 0) setPeerJoined(true);
        const audioPub = room.localParticipant.publishTrack(readyMedia.audio, {
          source: Track.Source.Microphone,
          dtx: true,
          red: true,
          audioPreset: AudioPresets.speech,
        });
        if (readyMedia.video) {
          const camera = readyMedia.video;
          void room.localParticipant.publishTrack(camera, videoPublish).catch(() => {
            if (cancelled || ended) return;
            return room.localParticipant.publishTrack(camera, { ...videoPublish, videoCodec: "vp8", backupCodec: false });
          });
        }
        await audioPub;
        if (cancelled || ended) return;
        setPhase("live");
      } catch (err) {
        if (cancelled || ended) return;
        ended = true;
        got?.audio.stop();
        got?.video?.stop();
        void room.disconnect(false);
        setPhase("error");
        setError(failedText.current);
        const code = err instanceof Error ? err.message : "";
        onFailedRef.current(code === "camera" || code === "mic" ? code : "failed");
      }
    })();

    return () => {
      cancelled = true;
      if (leaveTimer) window.clearTimeout(leaveTimer);
      void room.disconnect(false);
      void media
        .then((ready) => {
          if (liveMedia.current?.audio === ready.audio) liveMedia.current = null;
          queueMicrotask(() => {
            if (liveMedia.current?.audio === ready.audio) return;
            ready.audio.stop();
            ready.video?.stop();
          });
        })
        .catch(() => undefined);
    };
  }, [call.id, creds, media, video]);

  useEffect(() => {
    if (!talking) return;
    const started = Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    const kick = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [talking]);

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

  const status =
    phase === "error" ? error : talking ? formatDuration(elapsed) : call.status === "ringing" && !peerJoined ? t.callDialing : t.callLinking;

  return (
    <CallStage
      title={title}
      avatarUrl={avatarUrl}
      status={status}
      live={talking}
      showAvatar={!remoteOn}
      footer={
        <>
          <CallButton label={t.mic} tone="bg-white/15" onClick={() => void toggleMic()}>
            {mic ? <Mic size={22} /> : <MicOff size={22} />}
          </CallButton>
          {video ? (
            <CallButton label={t.camera} tone="bg-white/15" onClick={() => void toggleCam()}>
              {cam ? <Video size={22} /> : <VideoOff size={22} />}
            </CallButton>
          ) : null}
          <CallButton label={t.hangup} big tone="bg-danger text-white" onClick={() => endRef.current(true)}>
            <PhoneOff size={28} />
          </CallButton>
        </>
      }
    >
      <div ref={remoteVideo} className={`absolute inset-0 bg-black ${remoteOn ? "" : "invisible"}`} />
      <div ref={remoteAudio} className="hidden" />
      {video ? (
        <div
          ref={localVideo}
          className="absolute right-4 h-40 w-28 overflow-hidden rounded-2xl bg-white/10 shadow-lg"
          style={{ bottom: "calc(7.5rem + env(safe-area-inset-bottom))" }}
        />
      ) : null}
    </CallStage>
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

function formatDuration(total: number) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function IncomingCall({
  title,
  avatarUrl,
  kind,
  t,
  busy,
  onDecline,
  onAnswer,
}: {
  title: string;
  avatarUrl?: string | null;
  kind: "audio" | "video";
  t: Dict;
  busy: boolean;
  onDecline: () => void;
  onAnswer: () => void;
}) {
  return (
    <CallStage
      title={title}
      avatarUrl={avatarUrl}
      label={kind === "video" ? t.incomingVideo : t.incomingAudio}
      status={t.callDialing}
      live={false}
      showAvatar
      footer={
        <>
          <CallButton label={t.decline} big tone="bg-danger text-white" onClick={onDecline}>
            <PhoneOff size={28} />
          </CallButton>
          <CallButton label={t.answer} big tone="bg-success text-white" disabled={busy} onClick={onAnswer}>
            <Phone size={28} />
          </CallButton>
        </>
      }
    />
  );
}

function CallStage({
  title,
  avatarUrl,
  label,
  status,
  live,
  showAvatar,
  footer,
  children,
}: {
  title: string;
  avatarUrl?: string | null;
  label?: string;
  status: string | null;
  live: boolean;
  showAvatar: boolean;
  footer: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black text-white">
      <div className="relative flex h-full w-full flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#243044_0%,#05070a_70%)]" />
        {children}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-6 pb-16 text-center"
          style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
        >
          {label ? <p className="mb-2 text-xs font-medium tracking-wide text-white/60">{label}</p> : null}
          <p className="truncate text-[32px] font-bold leading-tight">{title}</p>
          <p className={`mt-2 text-[15px] ${live ? "font-medium tabular-nums text-white" : "text-white/70"}`}>{status}</p>
        </div>
        {showAvatar ? (
          <div className="absolute inset-0 z-[1] flex items-center justify-center pb-28">
            <div className="relative h-[132px] w-[132px]">
              {live ? null : (
                <>
                  <span className="call-ring absolute inset-0 rounded-full border border-white/50" />
                  <span className="call-ring absolute inset-0 rounded-full border border-white/30" style={{ animationDelay: "0.7s" }} />
                </>
              )}
              <Avatar name={title} src={avatarUrl} size={132} />
            </div>
          </div>
        ) : null}
        <div
          className="relative z-10 mt-auto flex items-end justify-center gap-8 px-6"
          style={{ paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))" }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

function CallButton({
  label,
  tone,
  big,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tone: string;
  big?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex flex-col items-center gap-2 disabled:opacity-50">
      <span className={`flex items-center justify-center rounded-full ${big ? "h-[72px] w-[72px]" : "h-16 w-16"} ${tone}`}>{children}</span>
      <span className="text-[11px] text-white/70">{label}</span>
    </button>
  );
}
