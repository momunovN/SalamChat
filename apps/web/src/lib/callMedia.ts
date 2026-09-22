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

export async function acquireCallMedia(
  kind: "audio" | "video",
  onStep?: (step: "mic" | "camera") => void,
): Promise<CallMedia> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("mic");
  }
  onStep?.("mic");
  let audioStream: MediaStream;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
  } catch {
    throw new Error("mic");
  }
  const audio = audioStream.getAudioTracks()[0];
  if (!audio) {
    audioStream.getTracks().forEach((track) => track.stop());
    throw new Error("mic");
  }
  if (kind !== "video") return { audio };

  onStep?.("camera");
  let videoStream: MediaStream;
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  } catch {
    audio.stop();
    throw new Error("camera");
  }
  const video = videoStream.getVideoTracks()[0];
  if (!video) {
    audio.stop();
    videoStream.getTracks().forEach((track) => track.stop());
    throw new Error("camera");
  }
  video.contentHint = "detail";
  return { audio, video };
}

export function warmCallConnection(url: string, token: string) {
  if (!url || token.startsWith("stub-")) return Promise.resolve();
  return new Room().prepareConnection(url, token);
}
