"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from "lucide-react";
import {
  AudioPresets,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalVideoTrack,
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

/** The corner picture: tap it to swap with the big one. */
const PIP =
  "absolute right-4 z-[5] w-28 cursor-pointer rounded-2xl shadow-lg ring-1 ring-white/15 transition-[width] sm:w-44 lg:w-60";
const PIP_BOTTOM = "calc(7.5rem + env(safe-area-inset-bottom))";

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

/**
 * Fills the screen when the picture's shape is close to the screen's; otherwise (a phone's
 * portrait video on a laptop, or the reverse) shows it whole over a blurred copy of itself,
 * instead of cropping half the face away.
 */
function fitRemote(box: HTMLDivElement, el: HTMLVideoElement) {
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  const bw = box.clientWidth;
  const bh = box.clientHeight;
  if (!vw || !vh || !bw || !bh) return;
  const ratio = vw / vh / (bw / bh);
  const fill = ratio > 0.8 && ratio < 1.25;
  el.style.objectFit = fill ? "cover" : "contain";
  box.dataset.fit = fill ? "cover" : "contain";
}

function mountRemote(box: HTMLDivElement, track: RemoteTrack) {
  const el = track.attach();
  el.className = "relative h-full w-full object-contain";
  if (el instanceof HTMLVideoElement) {
    el.autoplay = true;
    el.playsInline = true;
  }
  if (track.kind === Track.Kind.Video && el instanceof HTMLVideoElement) {
    // The backdrop: the same stream, cropped to fill and blurred, under the whole picture.
    const backdrop = document.createElement("video");
    backdrop.srcObject = new MediaStream([track.mediaStreamTrack]);
    backdrop.muted = true;
    backdrop.autoplay = true;
    backdrop.playsInline = true;
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.className = "pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl";
    box.replaceChildren(backdrop, el);
    const fit = () => fitRemote(box, el);
    el.addEventListener("loadedmetadata", fit);
    el.addEventListener("resize", fit);
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    el.addEventListener("emptied", () => watch.disconnect(), { once: true });
    void backdrop.play().catch(() => undefined);
  } else if (track.kind === Track.Kind.Video) box.replaceChildren(el);
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
  /** Which camera is on: the front one (mirrored in our preview) or the back one. */
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [canFlip, setCanFlip] = useState(false);
  const [flipping, setFlipping] = useState(false);
  /** Our own picture big and theirs in the corner, as after a tap on the corner in WhatsApp. */
  const [swapped, setSwapped] = useState(false);
  /** Camera tracks opened by a flip: ours to stop, unlike the one the call started with. */
  const flipped = useRef<MediaStreamTrack[]>([]);
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
    mountPreview(box, preview, facing === "user");
  }, [preview, facing]);

  // Only phones and tablets have a second camera worth offering.
  useEffect(() => {
    if (!preview || !navigator.mediaDevices?.enumerateDevices) return;
    let stop = false;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (!stop) setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [preview]);

  useEffect(
    () => () => {
      for (const track of flipped.current) track.stop();
    },
    [],
  );

  // Our own picture keeps its camera's shape: a laptop's landscape, a phone's portrait.
  // Phones report the sensor's landscape size even when held upright, so they stay portrait.
  const settings = preview?.getSettings();
  const phone = typeof window !== "undefined" && window.innerWidth < 640;
  const localAspect =
    !phone && settings?.width && settings?.height ? `${settings.width} / ${settings.height}` : "3 / 4";

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

  async function openCamera(want: "user" | "environment", exact: boolean) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: exact ? { exact: want } : want,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    return stream.getVideoTracks()[0];
  }

  async function flipCamera() {
    if (flipping || !preview) return;
    setFlipping(true);
    const next: "user" | "environment" = facing === "user" ? "environment" : "user";
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
    const sending = pub?.track as LocalVideoTrack | undefined;
    // iPhones open one camera at a time: release the current one first.
    preview.stop();
    let fresh: MediaStreamTrack | null = null;
    let now = next;
    try {
      fresh = await openCamera(next, true);
    } catch {
      now = facing;
      fresh = await openCamera(facing, false).catch(() => null);
    }
    if (fresh) {
      flipped.current.push(fresh);
      try {
        if (sending) await sending.replaceTrack(fresh, true);
      } catch {
        /* the next publish picks the camera up */
      }
      if (liveMedia.current) liveMedia.current = { ...liveMedia.current, video: fresh };
      setPreview(fresh);
      setFacing(now);
    }
    setFlipping(false);
  }

  // Swapping makes sense only while their video is there to put in the corner.
  const big = swapped && remoteOn && video;

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
          {video && canFlip ? (
            <CallButton label={t.flipCamera} tone="bg-white/15" onClick={() => void flipCamera()}>
              <SwitchCamera size={22} className={flipping ? "animate-spin" : ""} />
            </CallButton>
          ) : null}
          <CallButton label={t.hangup} big tone="bg-danger text-white" onClick={() => endRef.current(true)}>
            <PhoneOff size={28} />
          </CallButton>
        </>
      }
    >
      <div
        ref={remoteVideo}
        role={big ? "button" : undefined}
        aria-label={big ? t.swapVideo : undefined}
        onClick={big ? () => setSwapped(false) : undefined}
        className={`overflow-hidden bg-black ${remoteOn ? "" : "invisible"} ${big ? PIP : "absolute inset-0"}`}
        style={big ? { bottom: PIP_BOTTOM, aspectRatio: "3 / 4" } : undefined}
      />
      <div ref={remoteAudio} className="hidden" />
      {video ? (
        <div
          ref={localVideo}
          role={big ? undefined : "button"}
          aria-label={big ? undefined : t.swapVideo}
          onClick={big || !remoteOn ? undefined : () => setSwapped(true)}
          className={`overflow-hidden bg-black ${big ? "absolute inset-0" : `${PIP} bg-white/10`}`}
          style={big ? undefined : { bottom: PIP_BOTTOM, aspectRatio: localAspect }}
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
  ongoing,
  t,
  busy,
  onDecline,
  onAnswer,
}: {
  title: string;
  avatarUrl?: string | null;
  kind: "audio" | "video";
  /** A group call already in progress: offer to join it rather than answer. */
  ongoing?: boolean;
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
      status={ongoing ? t.inCall : t.callDialing}
      live={false}
      showAvatar
      footer={
        <>
          <CallButton label={t.decline} big tone="bg-danger text-white" onClick={onDecline}>
            <PhoneOff size={28} />
          </CallButton>
          <CallButton label={ongoing ? t.join : t.answer} big tone="bg-success text-white" disabled={busy} onClick={onAnswer}>
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
