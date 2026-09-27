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
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 30 },
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
  await preferSharpVideo(video);
  video.contentHint = "detail";
  return video;
}

async function preferSharpVideo(video: MediaStreamTrack) {
  const caps = video.getCapabilities?.();
  const width = Math.min(caps?.width?.max ?? 1920, 1920);
  const height = Math.min(caps?.height?.max ?? 1080, 1080);
  try {
    await video.applyConstraints({
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30, max: 30 },
    });
  } catch {
    /* the camera already uses the closest size it can */
  }
}

export function warmCallConnection(url: string, token: string) {
  if (!url || token.startsWith("stub-")) return Promise.resolve();
  return new Room().prepareConnection(url, token);
}
