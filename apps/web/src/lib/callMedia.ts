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

export function requestUserMedia(constraints: MediaStreamConstraints, code: "mic" | "camera") {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error(code));
  }
  const pending = navigator.mediaDevices.getUserMedia(constraints);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<MediaStream>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), 20000);
  });
  return Promise.race([pending, timed]).then(
    (stream) => {
      if (timer) clearTimeout(timer);
      return stream;
    },
    (err: unknown) => {
      if (timer) clearTimeout(timer);
      void pending.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
      if (err instanceof Error && (err.message === "mic" || err.message === "camera")) throw err;
      throw new Error(code);
    },
  );
}

export async function captureAudio() {
  const stream = await requestUserMedia({ audio: audioConstraints, video: false }, "mic");
  const audio = stream.getAudioTracks()[0];
  if (!audio) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("mic");
  }
  return audio;
}

export async function captureVideo() {
  const stream = await requestUserMedia({ audio: false, video: videoConstraints }, "camera");
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
