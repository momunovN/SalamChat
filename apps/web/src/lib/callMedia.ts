import { Room } from "livekit-client";

export type CallMedia = {
  audio: MediaStreamTrack;
  video?: MediaStreamTrack;
};

const audioConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const videoConstraints: MediaTrackConstraints = {
  facingMode: "user",
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export function stopCallMedia(media: CallMedia | null | undefined) {
  media?.audio.stop();
  media?.video?.stop();
}

export async function mediaPermission(kind: "microphone" | "camera"): Promise<"granted" | "prompt" | "denied"> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "prompt";
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    if (status.state === "granted" || status.state === "denied") return status.state;
  } catch {
    /* Safari has no mic/camera permission query */
  }
  return "prompt";
}

export async function captureAudio() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("mic");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
  } catch {
    throw new Error("mic");
  }
  const audio = stream.getAudioTracks()[0];
  if (!audio) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("mic");
  }
  return audio;
}

export async function captureVideo() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("camera");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  } catch {
    throw new Error("camera");
  }
  const video = stream.getVideoTracks()[0];
  if (!video) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("camera");
  }
  video.contentHint = "detail";
  return video;
}

export function warmCallConnection(url: string, token: string) {
  if (!url || token.startsWith("stub-")) return Promise.resolve();
  return new Room().prepareConnection(url, token);
}
